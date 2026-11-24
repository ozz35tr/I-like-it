export interface ResolvedMapsLink {
  cleanUrl: string;
  resolvedUrl: string;
  name: string;
  address: string;
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
 * Extracts a Google Maps URL and any shared title text from clipboard/share input.
 * For example, iOS/Android Google Maps Share sometimes copies:
 * "Kronotrop Coffee\nhttps://maps.app.goo.gl/abc123"
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
      return {
        cleanUrl: url,
        resolvedUrl: data.resolvedUrl || url,
        name: data.name || localParsed.name || sharedLabel || '',
        address: data.address || '',
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
    lat: localParsed.lat,
    lng: localParsed.lng,
  };
}

export function getPlaceExternalMapsUrl(place: {
  mapsUrl?: string;
  lat?: number;
  lng?: number;
  name: string;
  address?: string;
}): string {
  if (place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl)) {
    return place.mapsUrl;
  }
  if (typeof place.lat === 'number' && typeof place.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  }
  const q = [place.name, place.address].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
