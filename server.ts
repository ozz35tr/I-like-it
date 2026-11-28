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

const ALLOWED_SOCIAL_HOSTS = [
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
];

function isAllowedSocialUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_SOCIAL_HOSTS.includes(host) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeUnicodeEscapes(str: string): string {
  return str
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, ' ')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

function stripHtmlTags(str: string): string {
  return decodeHtmlEntities(str.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericInstagramBoilerplate(text: string): boolean {
  const clean = text.trim();
  if (!clean) return true;
  return (
    /^(login\s*[•·-]\s*instagram|instagram|welcome back to instagram)/i.test(clean) ||
    /sign in to check out what your friends/i.test(clean) ||
    /create an account or log in to instagram/i.test(clean) ||
    /giriş yap\s*[•·-]\s*instagram/i.test(clean)
  );
}

function extractInstagramUsernameFromUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return '';
    const first = segments[0].toLowerCase();
    const reserved = new Set([
      'p',
      'reel',
      'reels',
      'tv',
      'stories',
      'explore',
      'accounts',
      'direct',
      'share',
      's',
      'about',
      'legal',
      'developer',
    ]);
    if (reserved.has(first)) return '';
    return segments[0].replace(/^@/, '').trim();
  } catch {
    return '';
  }
}

function extractShortcodeFromInstagramUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const match = parsed.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function extractFirstAllowedMapsUrl(text: string): string {
  if (!text) return '';
  const matches = text.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[),.;]+$/, '');
    const allowed = isAllowedGoogleMapsUrl(cleaned);
    if (allowed) {
      return allowed.toString();
    }
  }
  return '';
}

function parseInstagramHtmlMetadata(html: string, sourceUrl: string): {
  username: string;
  displayName: string;
  description: string;
  locationText: string;
  mapsUrl: string;
} {
  let username = extractInstagramUsernameFromUrl(sourceUrl);
  let displayName = '';
  let description = '';
  let locationText = '';
  let mapsUrl = '';

  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = titleTagMatch?.[1] ? decodeHtmlEntities(titleTagMatch[1].trim()) : '';
  const ogTitle = extractMetaTag(html, 'og:title');
  const ogDesc = extractMetaTag(html, 'og:description');
  const metaDesc = extractMetaTag(html, 'description');

  const candidateTitle = [ogTitle, rawTitle].find((t) => t && !isGenericInstagramBoilerplate(t)) || '';
  if (candidateTitle) {
    // e.g. "İlk Isırık Kokoreç (@ilkisirikkokorec) • Instagram photos and videos"
    const handleMatch = candidateTitle.match(/\(@([A-Za-z0-9._]+)\)/);
    if (handleMatch?.[1] && !username) {
      username = handleMatch[1];
    }
    // e.g. "Mekan Adı on Instagram: "caption...""
    const onIgMatch = candidateTitle.match(/^(.+?)\s+(?:on Instagram|Instagram'da)\s*:/i);
    if (onIgMatch?.[1]) {
      displayName = onIgMatch[1].trim();
    } else {
      displayName = candidateTitle
        .replace(/\(@[A-Za-z0-9._]+\)/g, '')
        .replace(/\s*[•·|]\s*Instagram.*$/i, '')
        .trim();
    }
  }

  const candidateDesc = [ogDesc, metaDesc].find((d) => d && !isGenericInstagramBoilerplate(d)) || '';
  if (candidateDesc) {
    // e.g. "12K Followers, 50 Following, 100 Posts - See Instagram photos and videos from Mekan (@handle)"
    const fromMatch = candidateDesc.match(/See Instagram photos and videos from\s+(.+?)\s*\(@([A-Za-z0-9._]+)\)/i);
    if (fromMatch) {
      if (!displayName) displayName = fromMatch[1].trim();
      if (!username) username = fromMatch[2].trim();
    }
    // e.g. "123 likes, 4 comments - handle on Date: "caption""
    const postDescMatch = candidateDesc.match(/^\d[\d.,KMBkmb\s]*(?:likes|beğeni)[^-]+-\s*([^\s:]+)\s+(?:on|tarihinde)[^:]*:\s*"?([\s\S]+)"?$/i);
    if (postDescMatch) {
      if (!username && !postDescMatch[1].includes(' ')) {
        username = postDescMatch[1].replace(/^@/, '').trim();
      }
      description = postDescMatch[2].replace(/^"|"$/g, '').trim();
    } else if (!/^[\d.,KMBkmb\s]+Followers/i.test(candidateDesc)) {
      description = candidateDesc;
    }
  }

  // Embedded JSON fields from Instagram SSR HTML when available
  const jsonFullName = html.match(/"full_name"\s*:\s*"((?:\\.|[^"\\])+)"/);
  if (jsonFullName?.[1] && !displayName) {
    const decoded = decodeUnicodeEscapes(jsonFullName[1]).trim();
    if (decoded && !isGenericInstagramBoilerplate(decoded)) {
      displayName = decoded;
    }
  }

  const jsonBio = html.match(/"biography"\s*:\s*"((?:\\.|[^"\\])+)"/);
  if (jsonBio?.[1]) {
    const decoded = decodeUnicodeEscapes(jsonBio[1]).trim();
    if (decoded) {
      description = description ? `${decoded} · ${description}` : decoded;
    }
  }

  const jsonCity = html.match(/"city_name"\s*:\s*"((?:\\.|[^"\\])+)"/);
  const jsonStreet = html.match(/"street_address"\s*:\s*"((?:\\.|[^"\\])+)"/);
  const jsonLocName = html.match(/"location"\s*:\s*\{[^}]*"name"\s*:\s*"((?:\\.|[^"\\])+)"/);
  const locParts = [
    jsonStreet?.[1] ? decodeUnicodeEscapes(jsonStreet[1]).trim() : '',
    jsonCity?.[1] ? decodeUnicodeEscapes(jsonCity[1]).trim() : '',
    jsonLocName?.[1] ? decodeUnicodeEscapes(jsonLocName[1]).trim() : '',
  ].filter(Boolean);
  if (locParts.length > 0) {
    locationText = Array.from(new Set(locParts)).join(', ');
  }

  // Embed page (/embed/captioned/) specific selectors
  const embedUsername = html.match(/class=["'][^"']*UsernameText[^"']*["'][^>]*>([^<]+)</i);
  if (embedUsername?.[1] && !username) {
    username = decodeHtmlEntities(embedUsername[1]).replace(/^@/, '').trim();
  }
  const embedLocation = html.match(/class=["'][^"']*HeaderLocation[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (embedLocation?.[1] && !locationText) {
    locationText = stripHtmlTags(embedLocation[1]);
  }
  const embedCaption = html.match(/class=["'][^"']*Caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (embedCaption?.[1]) {
    const cleanCaption = stripHtmlTags(embedCaption[1]);
    if (cleanCaption && !description) {
      description = cleanCaption;
    }
  }

  // External URL / Google Maps URL in bio or JSON
  const jsonExtUrl = html.match(/"external_url"\s*:\s*"((?:\\.|[^"\\])+)"/);
  if (jsonExtUrl?.[1]) {
    const ext = decodeUnicodeEscapes(jsonExtUrl[1]).trim();
    const allowedExtMap = extractFirstAllowedMapsUrl(ext);
    if (allowedExtMap) mapsUrl = allowedExtMap;
  }
  if (!mapsUrl && description) {
    mapsUrl = extractFirstAllowedMapsUrl(description);
  }

  if (displayName && /^@[A-Za-z0-9._]+$/.test(displayName)) {
    if (!username) username = displayName.slice(1);
    displayName = '';
  }

  return {
    username: username.slice(0, 80),
    displayName: displayName.slice(0, 120),
    description: description.slice(0, 500),
    locationText: locationText.slice(0, 120),
    mapsUrl,
  };
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

  /**
   * Resolves public Instagram profile/post/reel links safely across allowlisted Instagram hosts.
   */
  app.get('/api/resolve-social-link', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const initial = isAllowedSocialUrl(rawUrl);

    if (!initial) {
      res.status(400).json({ error: 'Geçerli bir Instagram bağlantısı giriniz.' });
      return;
    }

    let currentUrl = initial.toString();
    let finalHtml = '';

    const fetchWithBotUa = async (targetUrl: string, ua: string) => {
      return fetch(targetUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(5500),
      });
    };

    try {
      for (let hop = 0; hop < 5; hop += 1) {
        const response = await fetchWithBotUa(currentUrl, 'TelegramBot (like TwitterBot)');
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          const nextAbsolute = new URL(location, currentUrl);
          if (nextAbsolute.pathname.toLowerCase().startsWith('/accounts/login')) {
            break;
          }
          const allowedNext = isAllowedSocialUrl(nextAbsolute.toString());
          if (!allowedNext) {
            break;
          }
          currentUrl = allowedNext.toString();
          continue;
        }
        if (response.ok) {
          const text = await response.text();
          finalHtml = text.slice(0, 160000);
        }
        break;
      }

      let meta = parseInstagramHtmlMetadata(finalHtml, currentUrl);

      // For posts/reels, also check /embed/captioned/ if caption/username/location is still missing
      const shortcode = extractShortcodeFromInstagramUrl(currentUrl);
      if (shortcode && (!meta.description || !meta.username || !meta.locationText)) {
        try {
          const embedUrl = `https://www.instagram.com/p/${encodeURIComponent(shortcode)}/embed/captioned/`;
          const embedRes = await fetchWithBotUa(
            embedUrl,
            'Mozilla/5.0 (compatible; MekanNotu/1.0)'
          );
          if (embedRes.ok) {
            const embedHtml = (await embedRes.text()).slice(0, 160000);
            const embedMeta = parseInstagramHtmlMetadata(embedHtml, currentUrl);
            meta = {
              username: meta.username || embedMeta.username,
              displayName: meta.displayName || embedMeta.displayName,
              description: meta.description || embedMeta.description,
              locationText: meta.locationText || embedMeta.locationText,
              mapsUrl: meta.mapsUrl || embedMeta.mapsUrl,
            };
          }
        } catch {
          // Ignore embed fetch errors
        }
      }

      res.json({
        resolvedUrl: currentUrl,
        username: meta.username,
        displayName: meta.displayName,
        description: meta.description,
        locationText: meta.locationText,
        mapsUrl: meta.mapsUrl,
      });
    } catch {
      res.json({
        resolvedUrl: currentUrl,
        username: extractInstagramUsernameFromUrl(currentUrl),
        displayName: '',
        description: '',
        locationText: '',
        mapsUrl: '',
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
