import { CATEGORY_LABELS, type PlaceItem } from '../types/place';

export type SharePlaceResult = 'shared' | 'copied' | 'cancelled' | 'unsupported';

export function buildPlaceShareUrl(placeId: string): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('place', placeId);
  return url.toString();
}

export function buildPlaceShareText(place: PlaceItem): string {
  const isWishlist = place.visitStatus === 'wishlist' && place.reviewCount === 0;
  const headerParts = [CATEGORY_LABELS[place.category]];
  if (place.locationArea) {
    headerParts.push(place.locationArea);
  }

  const lines: string[] = [`📍 ${place.name} (${headerParts.join(' · ')})`];

  if (isWishlist) {
    lines.push('🔖 Gitmek İstiyorum Listesi');
  } else {
    const ratingLine = `⭐ Puan: ${place.avgRating.toFixed(1)}/5 (${place.reviewCount} değerlendirme)`;
    const priceSuffix =
      (place.priceRatingCount ?? 0) > 0 && typeof place.avgPriceRating === 'number'
        ? ` · Fiyat: ${place.avgPriceRating.toFixed(1)}/5`
        : '';
    lines.push(`${ratingLine}${priceSuffix}`);
  }

  if (place.cuisineType) {
    lines.push(`🍽️ ${place.cuisineType}`);
  }

  const trimmedComment = (place.latestComment || '').trim();
  if (trimmedComment) {
    const snippet =
      trimmedComment.length > 220 ? `${trimmedComment.slice(0, 217)}...` : trimmedComment;
    lines.push(`💬 "${snippet}"`);
  }

  if (place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl)) {
    lines.push(`🗺️ Harita: ${place.mapsUrl}`);
  }

  if (place.promoUrl && /^https?:\/\//i.test(place.promoUrl)) {
    lines.push(`🔗 Bağlantı: ${place.promoUrl}`);
  }

  return lines.join('\n');
}

export async function sharePlaceDetails(place: PlaceItem): Promise<SharePlaceResult> {
  const title = `${place.name} — Gourmand`;
  const text = buildPlaceShareText(place);
  const url = buildPlaceShareUrl(place.id);

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const shareData: ShareData = {
      title,
      text,
      ...(url ? { url } : {}),
    };

    try {
      if (typeof navigator.canShare !== 'function' || navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return 'shared';
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return 'cancelled';
      }
      // Fall through to clipboard fallback if Web Share is blocked (e.g. iframe / desktop permissions)
    }
  }

  const clipboardText = url ? `${text}\n📲 Detay: ${url}` : text;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(clipboardText);
      return 'copied';
    } catch {
      return 'unsupported';
    }
  }

  return 'unsupported';
}
