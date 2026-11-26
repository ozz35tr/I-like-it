import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT) || 3000;

const ALLOWED_MAPS_HOSTS = [
  'maps.app.goo.gl',
  'search.app.goo.gl',
  'goo.gl',
  'app.goo.gl',
  'g.page',
  'share.google',
  'www.share.google',
  'maps.google.com',
  'www.google.com',
  'google.com',
];

function isAllowedGoogleMapsUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    const allowed =
      ALLOWED_MAPS_HOSTS.includes(host) ||
      /^(www\.|maps\.)?google\.[a-z.]{2,6}$/i.test(host);
    return allowed ? parsed : null;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMetaTag(html: string, property: string): string {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const match = html.match(regex);
  if (match?.[1]) return decodeHtmlEntities(match[1].trim());

  const reverseRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i'
  );
  const reverseMatch = html.match(reverseRegex);
  return reverseMatch?.[1] ? decodeHtmlEntities(reverseMatch[1].trim()) : '';
}

function parseDetailsFromUrl(urlStr: string, depth = 0): {
  name: string;
  lat?: number;
  lng?: number;
  unwrappedUrl?: string;
} {
  try {
    const parsed = new URL(urlStr);
    const pathnameLower = parsed.pathname.toLowerCase();
    const isSorryPage = pathnameLower === '/sorry' || pathnameLower.startsWith('/sorry/');
    const isShareGoogleRedirect =
      parsed.hostname.toLowerCase() === 'share.google' ||
      parsed.hostname.toLowerCase() === 'www.share.google' ||
      pathnameLower === '/share.google';

    if (isSorryPage && depth < 2) {
      const continueParam = parsed.searchParams.get('continue');
      if (continueParam && isAllowedGoogleMapsUrl(continueParam)) {
        const inner = parseDetailsFromUrl(continueParam, depth + 1);
        return {
          name: inner.name,
          lat: inner.lat,
          lng: inner.lng,
          unwrappedUrl: inner.unwrappedUrl || continueParam,
        };
      }
      return { name: '' };
    }

    let name = '';

    const placeMatch = parsed.pathname.match(/\/maps\/place\/([^/]+)/i);
    if (placeMatch?.[1]) {
      name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
    }

    const qParam = parsed.searchParams.get('q') || parsed.searchParams.get('query') || '';
    const coordMatch =
      urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
      urlStr.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
      qParam.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);

    let lat: number | undefined;
    let lng: number | undefined;
    if (coordMatch) {
      const pLat = Number(coordMatch[1]);
      const pLng = Number(coordMatch[2]);
      if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
        lat = pLat;
        lng = pLng;
      }
    } else if (qParam && !name && !isShareGoogleRedirect && !isSorryPage) {
      name = qParam.trim();
    }

    return { name, lat, lng };
  } catch {
    return { name: '' };
  }
}

async function startServer() {
  const app = express();

  /**
   * Resolves shortened Google Maps share links (e.g. https://maps.app.goo.gl/... or https://share.google/...)
   * safely by following redirects only across allowlisted Google domains.
   */
  app.get('/api/resolve-maps-link', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const initial = isAllowedGoogleMapsUrl(rawUrl);

    if (!initial) {
      res.status(400).json({ error: 'Geçerli bir Google Haritalar bağlantısı giriniz.' });
      return;
    }

    let currentUrl = initial.toString();
    let finalHtml = '';

    try {
      for (let hop = 0; hop < 6; hop += 1) {
        const response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MekanNotu/1.0)',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
          },
          signal: AbortSignal.timeout(6000),
        });

        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          const nextAbsolute = new URL(location, currentUrl).toString();
          const allowedNext = isAllowedGoogleMapsUrl(nextAbsolute);
          if (!allowedNext) {
            break;
          }
          currentUrl = allowedNext.toString();
          continue;
        }

        if (response.ok) {
          const text = await response.text();
          finalHtml = text.slice(0, 120000);
        }
        break;
      }

      let urlInfo = parseDetailsFromUrl(currentUrl);
      if (urlInfo.unwrappedUrl) {
        currentUrl = urlInfo.unwrappedUrl;
      }
      let name = urlInfo.name;
      let address = '';

      if (finalHtml) {
        const continueMatch = finalHtml.match(
          /<input[^>]+name=["']continue["'][^>]+value=["']([^"']+)["']/i
        );
        const titleUrlMatch = finalHtml.match(/<title>(https?:\/\/[^<]+)<\/title>/i);
        const embeddedTargetRaw = decodeHtmlEntities(
          (continueMatch?.[1] || titleUrlMatch?.[1] || '').trim()
        );
        if (embeddedTargetRaw) {
          const allowedEmbedded = isAllowedGoogleMapsUrl(embeddedTargetRaw);
          if (allowedEmbedded) {
            const embeddedInfo = parseDetailsFromUrl(allowedEmbedded.toString());
            if (!name && embeddedInfo.name) {
              name = embeddedInfo.name;
            }
            if (urlInfo.lat === undefined && embeddedInfo.lat !== undefined) {
              urlInfo = { ...urlInfo, lat: embeddedInfo.lat, lng: embeddedInfo.lng };
            }
            currentUrl = embeddedInfo.unwrappedUrl || allowedEmbedded.toString();
          }
        }

        const ogTitle = extractMetaTag(finalHtml, 'og:title');
        const ogDesc = extractMetaTag(finalHtml, 'og:description');
        const cleanOgTitle = ogTitle
          .replace(/\s*[-·]\s*Google\s*(Maps|Haritalar)\s*$/i, '')
          .trim();

        if (
          cleanOgTitle &&
          !/^https?:\/\//i.test(cleanOgTitle) &&
          !/^Google\s*(Maps|Haritalar)$/i.test(cleanOgTitle) &&
          (!name || name.length < 2)
        ) {
          name = cleanOgTitle;
        }

        if (ogDesc && !/Find local businesses/i.test(ogDesc) && !/Yerel işletmeleri/i.test(ogDesc)) {
          address = ogDesc.replace(/^★+\s*[\d.,]+\s*·\s*/u, '').trim();
        }
      }

      res.json({
        resolvedUrl: currentUrl,
        name,
        address,
        lat: urlInfo.lat,
        lng: urlInfo.lng,
      });
    } catch {
      const urlInfo = parseDetailsFromUrl(currentUrl);
      res.json({
        resolvedUrl: currentUrl,
        name: urlInfo.name,
        address: '',
        lat: urlInfo.lat,
        lng: urlInfo.lng,
      });
    }
  });

  app.get('/api/reverse-geocode', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ error: 'Geçersiz koordinat.' });
      return;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        String(lat)
      )}&lon=${encodeURIComponent(String(lng))}&zoom=14&accept-language=tr`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'GourmandApp/1.0',
          Accept: 'application/json',
          'Accept-Language': 'tr-TR,tr;q=0.9',
        },
        signal: AbortSignal.timeout(4500),
      });

      if (!response.ok) {
        res.json({ area: '', city: '' });
        return;
      }

      const data = (await response.json()) as {
        address?: Record<string, string | undefined>;
      };
      const addr = data.address || {};
      const district =
        addr.town ||
        addr.city_district ||
        addr.suburb ||
        addr.neighbourhood ||
        addr.county ||
        addr.city ||
        addr.province ||
        '';
      const city = addr.province || addr.city || addr.state || '';
      res.json({ area: district.trim(), city: city.trim() });
    } catch {
      res.json({ area: '', city: '' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    if (process.env.DISABLE_HMR === 'true') {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const result = await vite.transformRequest('/@vite/client');
          if (!result?.code) {
            next();
            return;
          }
          const patched = result.code
            .replace('await wsTransport.connect(handlers);', 'return;')
            .replace(
              'ws.send(JSON.stringify(data));',
              'if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));'
            );
          res.type('application/javascript').send(patched);
        } catch {
          next();
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
