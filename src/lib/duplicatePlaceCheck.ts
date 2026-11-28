import type { PlaceItem } from '../types/place';
import { haversineDistanceKm, normalizeTurkishSearchText } from './mapsLink';

export type DuplicateMatchStrength = 'exact' | 'strong' | 'branch_or_similar';

export interface DuplicatePlaceCandidate {
  place: PlaceItem;
  strength: DuplicateMatchStrength;
  reason: string;
}

const GENERIC_PLACE_WORDS = new Set([
  'restoran',
  'restaurant',
  'lokanta',
  'lokantasi',
  'cafe',
  'kafe',
  'bistro',
  'pastane',
  'firin',
  'bufe',
  'bar',
  'mekan',
  'usta',
  'yeri',
  'evi',
  'mutfak',
  'mutfagi',
]);

function normalizeNameForComparison(value: string): string {
  return normalizeTurkishSearchText(value)
    .replace(/['’"`.,\-–—/&()+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSignificantWords(normalized: string): string[] {
  return normalized
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC_PLACE_WORDS.has(w));
}

function normalizeUrlForComparison(rawUrl?: string | null): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    const importantParams = ['q', 'query', 'cid', 'ftid', 'place_id'];
    const kept: string[] = [];
    for (const key of importantParams) {
      const val = parsed.searchParams.get(key);
      if (val) kept.push(`${key}=${val.trim().toLowerCase()}`);
    }
    return `${host}${path}${kept.length ? `?${kept.join('&')}` : ''}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

function tokenizeArea(area?: string | null): string[] {
  return normalizeTurkishSearchText(area || '')
    .split(/[\s,./\-–—()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function areasOverlap(areaA?: string | null, areaB?: string | null): 'same' | 'different' | 'unknown' {
  const tokensA = tokenizeArea(areaA);
  const tokensB = tokenizeArea(areaB);
  if (tokensA.length === 0 || tokensB.length === 0) return 'unknown';

  const setB = new Set(tokensB);
  for (const t of tokensA) {
    if (setB.has(t)) return 'same';
  }
  return 'different';
}

export interface DuplicateCheckInput {
  name: string;
  locationArea?: string;
  mapsUrl?: string;
  promoUrl?: string;
  lat?: number | null;
  lng?: number | null;
}

const STRENGTH_RANK: Record<DuplicateMatchStrength, number> = {
  exact: 3,
  strong: 2,
  branch_or_similar: 1,
};

export function findPotentialDuplicatePlaces(
  existingPlaces: PlaceItem[],
  input: DuplicateCheckInput,
  maxResults = 3
): DuplicatePlaceCandidate[] {
  const cleanInputName = normalizeNameForComparison(input.name);
  const sigInputWords = tokenizeSignificantWords(cleanInputName);
  const cleanInputUrl = normalizeUrlForComparison(input.mapsUrl);
  const cleanInputPromoUrl = normalizeUrlForComparison(input.promoUrl);
  const hasInputCoords =
    typeof input.lat === 'number' &&
    typeof input.lng === 'number' &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng);

  if (cleanInputName.length < 3 && !cleanInputUrl && !cleanInputPromoUrl && !hasInputCoords) {
    return [];
  }

  const matches: DuplicatePlaceCandidate[] = [];

  for (const place of existingPlaces) {
    let bestStrength: DuplicateMatchStrength | null = null;
    let bestReason = '';

    const setMatch = (strength: DuplicateMatchStrength, reason: string) => {
      if (!bestStrength || STRENGTH_RANK[strength] > STRENGTH_RANK[bestStrength]) {
        bestStrength = strength;
        bestReason = reason;
      }
    };

    // 1. Google Maps URL match
    if (cleanInputUrl && place.mapsUrl) {
      const placeUrlNorm = normalizeUrlForComparison(place.mapsUrl);
      if (placeUrlNorm && cleanInputUrl === placeUrlNorm) {
        setMatch('exact', 'Aynı Google Haritalar bağlantısı');
      }
    }

    // 1b. Instagram / Social Media URL match
    if (cleanInputPromoUrl && place.promoUrl) {
      const placePromoNorm = normalizeUrlForComparison(place.promoUrl);
      if (placePromoNorm && cleanInputPromoUrl.toLowerCase() === placePromoNorm.toLowerCase()) {
        setMatch('exact', 'Aynı sosyal medya / Instagram bağlantısı');
      }
    }

    // 2. Coordinate proximity match
    if (
      hasInputCoords &&
      typeof place.lat === 'number' &&
      typeof place.lng === 'number' &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lng)
    ) {
      const distKm = haversineDistanceKm(
        input.lat as number,
        input.lng as number,
        place.lat,
        place.lng
      );
      if (distKm <= 0.08) {
        setMatch('exact', 'Aynı konum (~80 m içinde)');
      } else if (distKm <= 0.2) {
        setMatch('strong', 'Çok yakın konum (~200 m içinde)');
      }
    }

    // 3. Name + area similarity
    if (cleanInputName.length >= 3) {
      const cleanPlaceName = normalizeNameForComparison(place.name);
      if (cleanPlaceName.length >= 3) {
        const areaRelation = areasOverlap(input.locationArea, place.locationArea);

        if (cleanInputName === cleanPlaceName) {
          if (areaRelation === 'same') {
            setMatch('exact', 'Aynı mekân adı ve aynı bölge');
          } else if (areaRelation === 'unknown') {
            setMatch('strong', 'Aynı mekân adı sistemde kayıtlı');
          } else {
            setMatch(
              'branch_or_similar',
              `Aynı isim, farklı bölge (${place.locationArea || 'diğer şube olabilir'})`
            );
          }
        } else {
          const isSubstringMatch =
            cleanInputName.length >= 4 &&
            cleanPlaceName.length >= 4 &&
            (cleanPlaceName.includes(cleanInputName) || cleanInputName.includes(cleanPlaceName));

          const placeWords = tokenizeSignificantWords(cleanPlaceName);
          const sharedWords = sigInputWords.filter((w) => placeWords.includes(w));
          const hasMeaningfulWordMatch =
            sigInputWords.length > 0 &&
            placeWords.length > 0 &&
            (sharedWords.length >= 2 ||
              (sharedWords.length === 1 &&
                sigInputWords.length === 1 &&
                placeWords.length === 1 &&
                sharedWords[0].length >= 4));

          if (isSubstringMatch || hasMeaningfulWordMatch) {
            if (areaRelation === 'same') {
              setMatch('strong', 'Benzer mekân adı ve aynı bölge');
            } else if (areaRelation === 'different') {
              setMatch(
                'branch_or_similar',
                `Benzer isim, farklı bölge (${place.locationArea || 'şube olabilir'})`
              );
            } else {
              setMatch('branch_or_similar', 'Benzer isimde mevcut kayıt');
            }
          }
        }
      }
    }

    if (bestStrength) {
      matches.push({
        place,
        strength: bestStrength,
        reason: bestReason,
      });
    }
  }

  matches.sort((a, b) => {
    const rankDiff = STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength];
    if (rankDiff !== 0) return rankDiff;
    return b.place.updatedAt - a.place.updatedAt;
  });

  return matches.slice(0, maxResults);
}
