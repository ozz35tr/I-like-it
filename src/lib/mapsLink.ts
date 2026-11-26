export interface ResolvedMapsLink {
  cleanUrl: string;
  resolvedUrl: string;
  name: string;
  address: string;
  locationArea: string;
  lat?: number;
  lng?: number;
}

const ALLOWED_MAPS_HOSTS = [
  'maps.app.goo.gl',
  'goo.gl',
  'app.goo.gl',
  'g.page',
  'maps.google.com',
  'www.google.com',
  'google.com',
];

export function isAllowedGoogleMapsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (ALLOWED_MAPS_HOSTS.includes(host)) return true;
  if (/^(www\.|maps\.)?google\.[a-z.]{2,6}$/i.test(host)) return true;
  return false;
}

/**
 * Extracts a concise neighborhood/district/city string (e.g. "Buca, İzmir" or "Kemeraltı, Konak")
 * from a Google Maps formatted address.
 */
export function extractLocationAreaFromAddress(address: string): string {
  const clean = address.trim();
  if (!clean) return '';

  // Remove country suffix like ", Türkiye" or ", Turkey"
  const withoutCountry = clean.replace(/,\s*(Türkiye|Turkey)$/i, '').trim();

  // Check for Turkish postal-code + "District/City" pattern (e.g. "35390 Buca/İzmir")
  const slashMatch = withoutCountry.match(/(?:\b\d{5}\s+)?([A-Za-zÇĞIİÖŞÜçğıöşü\s.-]+\/[A-Za-zÇĞIİÖŞÜçğıöşü\s.-]+)$/);
  const parts = withoutCountry
    .split(',')
    .map((p) => p.replace(/\b\d{5}\b/g, '').trim())
    .filter(Boolean);

  if (slashMatch?.[1]) {
    const districtCity = slashMatch[1].replace('/', ', ').trim();
    if (parts.length >= 2) {
      const prevPart = parts[parts.length - 2];
      // Include neighborhood if short and informative (not just a building number)
      if (prevPart && prevPart.length <= 28 && !/\bNo[:.\s]/i.test(prevPart)) {
        const combined = `${prevPart}, ${districtCity}`;
        if (combined.length <= 80) return combined;
      }
    }
    return districtCity.slice(0, 80);
  }

  if (parts.length >= 2) {
    return parts.slice(-2).join(', ').slice(0, 80);
  }
  return withoutCountry.slice(0, 80);
}

export function normalizeTurkishSearchText(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesMultiWordQuery(fields: Array<string | undefined | null>, rawQuery: string): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) return true;

  const tokens = normalizeTurkishSearchText(trimmed).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;

  const haystackRaw = fields.filter(Boolean).join(' ').toLocaleLowerCase('tr');
  const haystackFolded = normalizeTurkishSearchText(fields.filter(Boolean).join(' '));

  return tokens.every((token) => haystackRaw.includes(token) || haystackFolded.includes(token));
}

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function formatDistanceLabel(km: number): string {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function matchesDetectedArea(
  placeLocationArea: string | undefined | null,
  detectedArea: string | null
): boolean {
  if (!placeLocationArea || !detectedArea) return false;
  const primarySegment = detectedArea.split(',')[0]?.trim() || detectedArea.trim();
  const areaNorm = normalizeTurkishSearchText(primarySegment);
  if (!areaNorm || areaNorm.length < 2) return false;
  const placeNorm = normalizeTurkishSearchText(placeLocationArea);
  return placeNorm.includes(areaNorm);
}

export async function reverseGeocodeArea(lat: number, lng: number): Promise<string> {
  const pickArea = (addr?: Record<string, string | undefined>): string => {
    if (!addr) return '';
    return (
      addr.town ||
      addr.city_district ||
      addr.suburb ||
      addr.neighbourhood ||
      addr.county ||
      addr.city ||
      addr.province ||
      ''
    ).trim();
  };

  try {
    const res = await fetch(
      `/api/reverse-geocode?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const data = (await res.json()) as { area?: string };
      if (data.area && data.area.trim()) {
        return data.area.trim();
      }
    }
  } catch {
    // Fallback to direct Nominatim if /api route is unavailable (e.g. static host)
  }

  try {
    const nominatimRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        String(lat)
      )}&lon=${encodeURIComponent(String(lng))}&zoom=14&accept-language=tr`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (nominatimRes.ok) {
      const data = (await nominatimRes.json()) as {
        address?: Record<string, string | undefined>;
      };
      return pickArea(data.address);
    }
  } catch {
    // Ignore reverse geocoding failure
  }

  return '';
}

/**
 * Extracts a Google Maps URL and any shared title text from clipboard/share input.
 */
export function extractSharedMapsInput(rawText: string): {
  url: string | null;
  sharedLabel: string;
} {
  const trimmed = rawText.trim();
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
  if (!urlMatch) {
    return { url: null, sharedLabel: trimmed };
  }

  const candidateUrl = urlMatch[0].replace(/[),.;]+$/, '');
  const remainingText = trimmed.replace(urlMatch[0], '').trim();

  try {
    const parsed = new URL(candidateUrl);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && isAllowedGoogleMapsHost(parsed.hostname)) {
      return {
        url: parsed.toString(),
        sharedLabel: remainingText,
      };
    }
  } catch {
    return { url: null, sharedLabel: '' };
  }

  return { url: null, sharedLabel: '' };
}

export function parseGoogleMapsUrlLocally(urlString: string): Partial<ResolvedMapsLink> {
  try {
    const parsed = new URL(urlString);
    let name = '';
    let lat: number | undefined;
    let lng: number | undefined;

    const placeMatch = parsed.pathname.match(/\/maps\/place\/([^/]+)/i);
    if (placeMatch && placeMatch[1]) {
      name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
    }

    const qParam = parsed.searchParams.get('q') || parsed.searchParams.get('query') || '';
    const coordMatch =
      urlString.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
      urlString.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
      qParam.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);

    if (coordMatch) {
      const parsedLat = Number(coordMatch[1]);
      const parsedLng = Number(coordMatch[2]);
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
        lat = parsedLat;
        lng = parsedLng;
      }
    } else if (qParam && !name) {
      name = qParam.trim();
    }

    return { name, lat, lng, resolvedUrl: urlString };
  } catch {
    return {};
  }
}

export async function resolveGoogleMapsLink(
  rawInput: string,
  signal?: AbortSignal
): Promise<ResolvedMapsLink | null> {
  const { url, sharedLabel } = extractSharedMapsInput(rawInput);
  if (!url) return null;

  const localParsed = parseGoogleMapsUrlLocally(url);

  try {
    const res = await fetch(`/api/resolve-maps-link?url=${encodeURIComponent(url)}`, {
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as Partial<ResolvedMapsLink>;
      const address = data.address || '';
      return {
        cleanUrl: url,
        resolvedUrl: data.resolvedUrl || url,
        name: data.name || localParsed.name || sharedLabel || '',
        address,
        locationArea: extractLocationAreaFromAddress(address),
        lat: typeof data.lat === 'number' ? data.lat : localParsed.lat,
        lng: typeof data.lng === 'number' ? data.lng : localParsed.lng,
      };
    }
  } catch {
    // Offline or timeout fallback uses locally extracted metadata
  }

  return {
    cleanUrl: url,
    resolvedUrl: url,
    name: localParsed.name || sharedLabel || '',
    address: '',
    locationArea: '',
    lat: localParsed.lat,
    lng: localParsed.lng,
  };
}

export function getPlaceExternalMapsUrl(place: {
  mapsUrl?: string;
  lat?: number | null;
  lng?: number | null;
  name: string;
  address?: string;
  locationArea?: string;
}): string {
  if (place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl)) {
    return place.mapsUrl;
  }
  if (typeof place.lat === 'number' && typeof place.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  }
  const q = [place.name, place.locationArea, place.address].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function getPromoPlatformLabel(urlString: string): string | null {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    if (/(^|\.)(instagram\.com|instagr\.am)$/i.test(host)) return 'Instagram';
    if (/(^|\.)(youtube\.com|youtu\.be|m\.youtube\.com)$/i.test(host)) return 'YouTube';
    if (/(^|\.)(facebook\.com|fb\.watch|fb\.com|m\.facebook\.com)$/i.test(host)) return 'Facebook';
    if (/(^|\.)(tiktok\.com|vm\.tiktok\.com)$/i.test(host)) return 'TikTok';
    if (/(^|\.)(x\.com|twitter\.com)$/i.test(host)) return 'X';
    return null;
  } catch {
    return null;
  }
}

export function extractPromoLinkInput(rawText: string): {
  url: string | null;
  platform: string | null;
} {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { url: null, platform: null };
  }

  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
  let candidate = urlMatch ? urlMatch[0].replace(/[),.;]+$/, '') : '';

  if (!candidate) {
    const bareMatch = trimmed.match(
      /(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|x\.com|twitter\.com|[a-z0-9-]+\.[a-z]{2,})(?:\/[^\s]*)?/i
    );
    if (bareMatch) {
      candidate = `https://${bareMatch[0].replace(/[),.;]+$/, '')}`;
    }
  }

  if (!candidate) {
    return { url: null, platform: null };
  }

  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.includes('.')) {
      const normalized = parsed.toString().slice(0, 600);
      return {
        url: normalized,
        platform: getPromoPlatformLabel(normalized),
      };
    }
  } catch {
    return { url: null, platform: null };
  }

  return { url: null, platform: null };
}


