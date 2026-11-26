import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  STORAGE_LIMITS,
  type PlaceCategory,
  type PlaceItem,
  type ReviewItem,
  type VisitStatus,
} from '../types/place';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

const SHARED_PLACES_TTL_MS = 5 * 60 * 1000;
const USER_WISHLIST_TTL_MS = 10 * 60 * 1000;
const HIDDEN_IDS_TTL_MS = 10 * 60 * 1000;
const REVIEWS_TTL_MS = 10 * 60 * 1000;

const SHARED_PLACES_QUERY_LIMIT = 250;
const WISHLIST_QUERY_LIMIT = 200;
const REVIEWS_QUERY_LIMIT = 100;

const CACHE_KEY_SHARED_PLACES = 'gourmand_cache_shared_places_v1';
const CACHE_KEY_WISHLIST_PREFIX = 'gourmand_cache_wishlist_v1_';
const CACHE_KEY_HIDDEN_IDS_PREFIX = 'gourmand_cache_hidden_ids_v1_';
const CACHE_KEY_REVIEW_LOOKUP_PREFIX = 'gourmand_cache_review_lookup_v1_';
const FLAG_KEY_LEGACY_WISHLIST_DONE_PREFIX = 'gourmand_flag_legacy_wish_done_v1_';
const FLAG_KEY_LEGACY_PERSONAL_ZERO_PREFIX = 'gourmand_flag_legacy_personal_zero_v1_';

function readStorageJson<T>(key: string): T | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeStorageJson(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore QuotaExceededError or private-mode storage restrictions; in-memory & Firestore IndexedDB caches remain active
  }
}

function readStorageFlag(key: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeStorageFlag(key: string, val: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (val) {
      window.localStorage.setItem(key, '1');
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage error
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveSafeAuthorName(
  displayName?: string | null,
  email?: string | null
): string {
  const candidate =
    displayName?.trim() ||
    (email ? email.split('@')[0]?.trim() : '') ||
    'Kullanıcı';
  const clean = candidate.slice(0, STORAGE_LIMITS.AUTHOR_NAME_MAX).trim();
  return clean.length >= 1 ? clean : 'Kullanıcı';
}

export function normalizeCategory(raw: unknown): PlaceCategory {
  if (
    raw === 'restaurant' ||
    raw === 'esnaf' ||
    raw === 'cafe' ||
    raw === 'bakery' ||
    raw === 'bistro' ||
    raw === 'bufe' ||
    raw === 'bar' ||
    raw === 'pastane'
  ) {
    return raw;
  }
  return 'restaurant';
}

export function normalizeCuisineTags(
  cuisineTypes?: unknown,
  cuisineTypeFallback?: unknown
): { cuisineTypes: string[]; cuisineType: string } {
  const rawList: string[] = [];

  if (Array.isArray(cuisineTypes)) {
    for (const item of cuisineTypes) {
      if (typeof item === 'string' && item.trim()) {
        rawList.push(item.trim());
      }
    }
  }

  if (rawList.length === 0 && typeof cuisineTypeFallback === 'string' && cuisineTypeFallback.trim()) {
    for (const part of cuisineTypeFallback.split(',')) {
      if (part.trim()) {
        rawList.push(part.trim());
      }
    }
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const tag of rawList) {
    const clean = tag.slice(0, STORAGE_LIMITS.CUISINE_TYPE_MAX).trim();
    if (!clean) continue;
    const key = clean.toLocaleLowerCase('tr');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(clean);
    if (deduped.length >= STORAGE_LIMITS.MAX_CUISINE_TYPES) break;
  }

  const summary = deduped.join(', ').slice(0, STORAGE_LIMITS.CUISINE_SUMMARY_MAX);
  return { cuisineTypes: deduped, cuisineType: summary };
}

function normalizeCoord(val: unknown, min: number, max: number): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max) {
    return val;
  }
  return null;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return Date.now();
}

function normalizePriceRating(raw: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
  if (raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5) {
    return raw;
  }
  return undefined;
}

function mapPlaceDoc(id: string, data: DocumentData): PlaceItem {
  const { cuisineTypes, cuisineType } = normalizeCuisineTags(data.cuisineTypes, data.cuisineType);
  return {
    id,
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : '',
    authorName:
      typeof data.authorName === 'string' && data.authorName.trim()
        ? data.authorName.trim().slice(0, STORAGE_LIMITS.AUTHOR_NAME_MAX)
        : 'Kullanıcı',
    name: typeof data.name === 'string' ? data.name : 'Mekan',
    category: normalizeCategory(data.category),
    visitStatus: data.visitStatus === 'wishlist' ? 'wishlist' : 'visited',
    cuisineType,
    cuisineTypes,
    locationArea:
      typeof data.locationArea === 'string'
        ? data.locationArea.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX)
        : '',
    lat: normalizeCoord(data.lat, -90, 90),
    lng: normalizeCoord(data.lng, -180, 180),
    mapsUrl: typeof data.mapsUrl === 'string' ? data.mapsUrl : '',
    promoUrl: typeof data.promoUrl === 'string' ? data.promoUrl : '',
    coverImage: typeof data.coverImage === 'string' ? data.coverImage : '',
    latestComment: typeof data.latestComment === 'string' ? data.latestComment : '',
    avgRating: typeof data.avgRating === 'number' ? data.avgRating : 0,
    reviewCount: typeof data.reviewCount === 'number' ? data.reviewCount : 0,
    ratingSum: typeof data.ratingSum === 'number' ? data.ratingSum : 0,
    avgPriceRating: typeof data.avgPriceRating === 'number' ? data.avgPriceRating : 0,
    priceRatingCount: typeof data.priceRatingCount === 'number' ? data.priceRatingCount : 0,
    priceRatingSum: typeof data.priceRatingSum === 'number' ? data.priceRatingSum : 0,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function mapReviewDoc(id: string, data: DocumentData): ReviewItem {
  const priceRating = normalizePriceRating(data.priceRating);
  return {
    id,
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : '',
    authorName:
      typeof data.authorName === 'string' && data.authorName.trim()
        ? data.authorName.trim().slice(0, STORAGE_LIMITS.AUTHOR_NAME_MAX)
        : 'Kullanıcı',
    placeId: typeof data.placeId === 'string' ? data.placeId : '',
    rating:
      data.rating === 1 || data.rating === 2 || data.rating === 3 || data.rating === 4 || data.rating === 5
        ? data.rating
        : 5,
    ...(priceRating ? { priceRating } : {}),
    comment: typeof data.comment === 'string' ? data.comment : '',
    photos: Array.isArray(data.photos)
      ? data.photos.filter((x): x is string => typeof x === 'string').slice(0, STORAGE_LIMITS.MAX_PHOTOS)
      : [],
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// In-Memory + LocalStorage TTL Stores & Reactive Listener Registries
// ---------------------------------------------------------------------------

interface CachedListState<T> {
  items: T[] | null;
  fetchedAt: number;
}

interface PersistedListCache<T> {
  fetchedAt: number;
  items: T[];
}

interface ReviewCacheEntry {
  signature: string;
  fetchedAt: number;
  items: ReviewItem[];
}

const sharedPlacesState: CachedListState<PlaceItem> = {
  items: null,
  fetchedAt: 0,
};
let sharedPlacesInFlight: Promise<PlaceItem[]> | null = null;
const sharedPlacesListeners = new Set<(places: PlaceItem[]) => void>();

// Holds any legacy shared wishlist docs detected during fetchSharedPlacesOnce so migration needs 0 extra reads
let detectedLegacySharedWishlistDocs: QueryDocumentSnapshot<DocumentData>[] | null = null;

const wishlistStates = new Map<string, CachedListState<PlaceItem>>();
const wishlistInFlight = new Map<string, Promise<PlaceItem[]>>();
const wishlistListeners = new Map<string, Set<(places: PlaceItem[]) => void>>();

const hiddenIdsStates = new Map<string, CachedListState<string>>();
const hiddenIdsInFlight = new Map<string, Promise<string[]>>();
const hiddenIdsListeners = new Map<string, Set<(ids: string[]) => void>>();

const reviewsCache = new Map<string, ReviewCacheEntry>();
const reviewsInFlight = new Map<string, Promise<ReviewItem[]>>();
const reviewListeners = new Map<string, Set<(reviews: ReviewItem[]) => void>>();

function isFresh(fetchedAt: number, ttlMs: number): boolean {
  return fetchedAt > 0 && Date.now() - fetchedAt < ttlMs;
}

function placeSignature(place: Pick<PlaceItem, 'reviewCount' | 'updatedAt'>): string {
  return `${place.reviewCount}:${place.updatedAt}`;
}

function getKnownSharedPlace(placeId: string): PlaceItem | undefined {
  return sharedPlacesState.items?.find((p) => p.id === placeId);
}

function isKnownWishlistWithNoReviews(placeId: string): boolean {
  for (const state of wishlistStates.values()) {
    if (state.items?.some((p) => p.id === placeId)) {
      return true;
    }
  }
  const shared = getKnownSharedPlace(placeId);
  if (shared && shared.visitStatus === 'wishlist' && shared.reviewCount === 0) {
    return true;
  }
  return false;
}

function notifySharedPlaces(): void {
  if (!sharedPlacesState.items) return;
  const snapshot = sharedPlacesState.items;
  for (const listener of sharedPlacesListeners) {
    listener(snapshot);
  }
}

function notifyWishlist(userId: string): void {
  const state = wishlistStates.get(userId);
  const listeners = wishlistListeners.get(userId);
  if (!state?.items || !listeners) return;
  const snapshot = state.items;
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function notifyHiddenIds(userId: string): void {
  const state = hiddenIdsStates.get(userId);
  const listeners = hiddenIdsListeners.get(userId);
  if (!state?.items || !listeners) return;
  const snapshot = state.items;
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function notifyPlaceReviews(placeId: string): void {
  const entry = reviewsCache.get(placeId);
  const listeners = reviewListeners.get(placeId);
  if (!entry || !listeners) return;
  const snapshot = entry.items;
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function persistSharedPlaces(items: PlaceItem[], fetchedAt: number): void {
  sharedPlacesState.items = items;
  sharedPlacesState.fetchedAt = fetchedAt;
  writeStorageJson(CACHE_KEY_SHARED_PLACES, { fetchedAt, items } satisfies PersistedListCache<PlaceItem>);
}

function persistWishlistPlaces(userId: string, items: PlaceItem[], fetchedAt: number): void {
  wishlistStates.set(userId, { items, fetchedAt });
  writeStorageJson(
    `${CACHE_KEY_WISHLIST_PREFIX}${userId}`,
    { fetchedAt, items } satisfies PersistedListCache<PlaceItem>
  );
}

function persistHiddenIds(userId: string, ids: string[], fetchedAt: number): void {
  hiddenIdsStates.set(userId, { items: ids, fetchedAt });
  writeStorageJson(
    `${CACHE_KEY_HIDDEN_IDS_PREFIX}${userId}`,
    { fetchedAt, items: ids } satisfies PersistedListCache<string>
  );
}

function hydrateSharedPlacesFromStorage(): PlaceItem[] | null {
  if (sharedPlacesState.items && isFresh(sharedPlacesState.fetchedAt, SHARED_PLACES_TTL_MS)) {
    return sharedPlacesState.items;
  }
  const stored = readStorageJson<PersistedListCache<PlaceItem>>(CACHE_KEY_SHARED_PLACES);
  if (stored && Array.isArray(stored.items) && isFresh(stored.fetchedAt, SHARED_PLACES_TTL_MS)) {
    sharedPlacesState.items = stored.items;
    sharedPlacesState.fetchedAt = stored.fetchedAt;
    return stored.items;
  }
  return null;
}

function hydrateWishlistFromStorage(userId: string): PlaceItem[] | null {
  const mem = wishlistStates.get(userId);
  if (mem?.items && isFresh(mem.fetchedAt, USER_WISHLIST_TTL_MS)) {
    return mem.items;
  }
  const stored = readStorageJson<PersistedListCache<PlaceItem>>(`${CACHE_KEY_WISHLIST_PREFIX}${userId}`);
  if (stored && Array.isArray(stored.items) && isFresh(stored.fetchedAt, USER_WISHLIST_TTL_MS)) {
    wishlistStates.set(userId, { items: stored.items, fetchedAt: stored.fetchedAt });
    return stored.items;
  }
  return null;
}

function hydrateHiddenIdsFromStorage(userId: string): string[] | null {
  const mem = hiddenIdsStates.get(userId);
  if (mem?.items && isFresh(mem.fetchedAt, HIDDEN_IDS_TTL_MS)) {
    return mem.items;
  }
  const stored = readStorageJson<PersistedListCache<string>>(`${CACHE_KEY_HIDDEN_IDS_PREFIX}${userId}`);
  if (stored && Array.isArray(stored.items) && isFresh(stored.fetchedAt, HIDDEN_IDS_TTL_MS)) {
    hiddenIdsStates.set(userId, { items: stored.items, fetchedAt: stored.fetchedAt });
    return stored.items;
  }
  return null;
}

export interface UserReviewLookupCacheEntry {
  signature: string;
  hasReview: boolean;
}

function readPersistedReviewLookup(userId: string): Record<string, UserReviewLookupCacheEntry> {
  return readStorageJson<Record<string, UserReviewLookupCacheEntry>>(
    `${CACHE_KEY_REVIEW_LOOKUP_PREFIX}${userId}`
  ) || {};
}

function writePersistedReviewLookup(
  userId: string,
  map: Map<string, UserReviewLookupCacheEntry>
): void {
  const obj: Record<string, UserReviewLookupCacheEntry> = {};
  map.forEach((value, key) => {
    obj[key] = value;
  });
  writeStorageJson(`${CACHE_KEY_REVIEW_LOOKUP_PREFIX}${userId}`, obj);
}

function updateUserReviewLookupEntry(
  userId: string | null | undefined,
  placeId: string,
  signature: string,
  hasReview: boolean
): void {
  if (!userId) return;
  const existing = readPersistedReviewLookup(userId);
  existing[placeId] = { signature, hasReview };
  writeStorageJson(`${CACHE_KEY_REVIEW_LOOKUP_PREFIX}${userId}`, existing);
}

export function clearFirestoreReadCaches(): void {
  sharedPlacesState.items = null;
  sharedPlacesState.fetchedAt = 0;
  sharedPlacesInFlight = null;
  detectedLegacySharedWishlistDocs = null;
  wishlistStates.clear();
  wishlistInFlight.clear();
  hiddenIdsStates.clear();
  hiddenIdsInFlight.clear();
  reviewsCache.clear();
  reviewsInFlight.clear();

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (
          key &&
          (key === CACHE_KEY_SHARED_PLACES ||
            key.startsWith(CACHE_KEY_WISHLIST_PREFIX) ||
            key.startsWith(CACHE_KEY_HIDDEN_IDS_PREFIX))
        ) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        window.localStorage.removeItem(k);
      }
    } catch {
      // Ignore storage error
    }
  }
}

async function fetchSharedPlacesOnce(force = false): Promise<PlaceItem[]> {
  if (!force) {
    const cached = hydrateSharedPlacesFromStorage();
    if (cached) return cached;
  }

  if (sharedPlacesInFlight) {
    return sharedPlacesInFlight;
  }

  const path = 'places';
  const q = query(
    collection(db, path),
    where('visibility', '==', 'shared'),
    limit(SHARED_PLACES_QUERY_LIMIT)
  );

  sharedPlacesInFlight = (async () => {
    try {
      const snap = await getDocs(q);
      const legacyDocs: QueryDocumentSnapshot<DocumentData>[] = [];
      const items: PlaceItem[] = [];

      for (const d of snap.docs) {
        const data = d.data();
        const mapped = mapPlaceDoc(d.id, data);
        if (mapped.visitStatus === 'wishlist' && mapped.reviewCount === 0) {
          legacyDocs.push(d);
          continue;
        }
        items.push(mapped);
      }

      detectedLegacySharedWishlistDocs = legacyDocs;
      items.sort((a, b) => b.updatedAt - a.updatedAt);

      persistSharedPlaces(items, Date.now());
      return items;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    } finally {
      sharedPlacesInFlight = null;
    }
  })();

  return sharedPlacesInFlight;
}

export function subscribePlaces(
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  let active = true;
  sharedPlacesListeners.add(onData);

  const cached = hydrateSharedPlacesFromStorage();
  if (cached) {
    onData(cached);
  } else {
    void fetchSharedPlacesOnce()
      .then((items) => {
        if (active) {
          onData(items);
        }
      })
      .catch((err) => {
        if (active) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      });
  }

  return () => {
    active = false;
    sharedPlacesListeners.delete(onData);
  };
}

export interface FindUserReviewedOptions {
  fetchMissing?: boolean;
}

export async function findUserReviewedPlaceIds(
  userId: string,
  places: PlaceItem[],
  cache: Map<string, UserReviewLookupCacheEntry>,
  options?: FindUserReviewedOptions
): Promise<Set<string>> {
  const result = new Set<string>();
  const activeIds = new Set(places.map((p) => p.id));
  const persisted = readPersistedReviewLookup(userId);
  let cacheDirty = false;

  // Seed in-memory cache from persistent localStorage entries so reloads retain lookup state
  for (const [placeId, entry] of Object.entries(persisted)) {
    if (activeIds.has(placeId) && !cache.has(placeId)) {
      cache.set(placeId, entry);
    }
  }

  for (const key of Array.from(cache.keys())) {
    if (!activeIds.has(key)) {
      cache.delete(key);
    }
  }

  const targetsToFetch: Array<{ place: PlaceItem; signature: string }> = [];

  for (const place of places) {
    const isWishlist = place.visitStatus === 'wishlist' && place.reviewCount === 0;
    if (isWishlist) continue;

    if (place.ownerId === userId) {
      result.add(place.id);
      continue;
    }

    if (place.reviewCount <= 0) continue;

    const signature = placeSignature(place);
    const memReviews = reviewsCache.get(place.id);
    if (memReviews && memReviews.signature === signature) {
      const hasReview = memReviews.items.some((r) => r.ownerId === userId);
      const prev = cache.get(place.id);
      if (!prev || prev.signature !== signature || prev.hasReview !== hasReview) {
        cache.set(place.id, { signature, hasReview });
        cacheDirty = true;
      }
      if (hasReview) {
        result.add(place.id);
      }
      continue;
    }

    const cached = cache.get(place.id);
    if (cached && cached.signature === signature) {
      if (cached.hasReview) {
        result.add(place.id);
      }
    } else {
      if (cached?.hasReview) {
        // Optimistically retain prior positive match until checked
        result.add(place.id);
      }
      if (options?.fetchMissing) {
        targetsToFetch.push({ place, signature });
      }
    }
  }

  if (options?.fetchMissing && targetsToFetch.length > 0) {
    for (let i = 0; i < targetsToFetch.length; i += 6) {
      const chunk = targetsToFetch.slice(i, i + 6);
      await Promise.all(
        chunk.map(async ({ place, signature }) => {
          try {
            const reviews = await fetchPlaceReviewsOnce(place.id, signature);
            const hasReview = reviews.some((r) => r.ownerId === userId);
            cache.set(place.id, { signature, hasReview });
            cacheDirty = true;
            if (hasReview) {
              result.add(place.id);
            } else {
              result.delete(place.id);
            }
          } catch {
            const fallback = cache.get(place.id);
            if (fallback?.hasReview) {
              result.add(place.id);
            }
          }
        })
      );
    }
  }

  if (cacheDirty) {
    writePersistedReviewLookup(userId, cache);
  }

  return result;
}

async function fetchUserWishlistOnce(userId: string, force = false): Promise<PlaceItem[]> {
  if (!force) {
    const cached = hydrateWishlistFromStorage(userId);
    if (cached) return cached;
  }

  const pending = wishlistInFlight.get(userId);
  if (pending) return pending;

  const path = `users/${userId}/wishlist`;
  const q = query(
    collection(db, path),
    where('ownerId', '==', userId),
    limit(WISHLIST_QUERY_LIMIT)
  );

  const req = (async () => {
    try {
      const snap = await getDocs(q);
      const items = snap.docs
        .map((d) => ({
          ...mapPlaceDoc(d.id, d.data()),
          visitStatus: 'wishlist' as const,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      persistWishlistPlaces(userId, items, Date.now());
      return items;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    } finally {
      wishlistInFlight.delete(userId);
    }
  })();

  wishlistInFlight.set(userId, req);
  return req;
}

export function subscribeUserWishlistPlaces(
  userId: string,
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  let active = true;
  let set = wishlistListeners.get(userId);
  if (!set) {
    set = new Set();
    wishlistListeners.set(userId, set);
  }
  set.add(onData);

  const cached = hydrateWishlistFromStorage(userId);
  if (cached) {
    onData(cached);
  } else {
    void fetchUserWishlistOnce(userId)
      .then((items) => {
        if (active) {
          onData(items);
        }
      })
      .catch((err) => {
        if (active) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      });
  }

  return () => {
    active = false;
    const listeners = wishlistListeners.get(userId);
    listeners?.delete(onData);
  };
}

export async function migrateLegacySharedWishlistToPrivate(userId: string): Promise<number> {
  const flagKey = `${FLAG_KEY_LEGACY_WISHLIST_DONE_PREFIX}${userId}`;
  if (readStorageFlag(flagKey)) {
    return 0;
  }

  try {
    // Reuse the already-fetched shared places snapshot instead of triggering another full-collection read
    if (detectedLegacySharedWishlistDocs === null) {
      await fetchSharedPlacesOnce();
    }

    const rawLegacyDocs = detectedLegacySharedWishlistDocs || [];
    const legacyOwnWishlistDocs = rawLegacyDocs.filter((d) => {
      const data = d.data();
      return (
        data.ownerId === userId &&
        data.visitStatus === 'wishlist' &&
        (typeof data.reviewCount !== 'number' || data.reviewCount === 0)
      );
    });

    if (legacyOwnWishlistDocs.length === 0) {
      writeStorageFlag(flagKey, true);
      return 0;
    }

    let migrated = 0;
    const migratedItems: PlaceItem[] = [];

    for (let i = 0; i < legacyOwnWishlistDocs.length; i += 200) {
      const chunk = legacyOwnWishlistDocs.slice(i, i + 200);
      const batch = writeBatch(db);

      for (const legacyDoc of chunk) {
        const data = legacyDoc.data();
        const { cuisineTypes, cuisineType } = normalizeCuisineTags(
          data.cuisineTypes,
          data.cuisineType
        );
        const cleanName =
          typeof data.name === 'string' && data.name.trim().length >= STORAGE_LIMITS.NAME_MIN
            ? data.name.trim().slice(0, STORAGE_LIMITS.NAME_MAX)
            : 'Mekan';
        const cleanAuthor = resolveSafeAuthorName(
          typeof data.authorName === 'string' ? data.authorName : undefined
        );
        const cleanCategory = normalizeCategory(data.category);
        const cleanArea =
          typeof data.locationArea === 'string'
            ? data.locationArea.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX)
            : '';
        const cleanLat = normalizeCoord(data.lat, -90, 90);
        const cleanLng = normalizeCoord(data.lng, -180, 180);
        const cleanMapsUrl =
          typeof data.mapsUrl === 'string'
            ? data.mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX)
            : '';
        const cleanPromoUrl =
          typeof data.promoUrl === 'string'
            ? data.promoUrl.trim().slice(0, STORAGE_LIMITS.PROMO_URL_MAX)
            : '';
        const cleanCover =
          typeof data.coverImage === 'string' ? data.coverImage.slice(0, 160000) : '';
        const cleanComment =
          typeof data.latestComment === 'string'
            ? data.latestComment.slice(0, STORAGE_LIMITS.COMMENT_MAX)
            : '';

        batch.set(doc(db, `users/${userId}/wishlist/${legacyDoc.id}`), {
          ownerId: userId,
          authorName: cleanAuthor,
          visibility: 'private',
          name: cleanName,
          category: cleanCategory,
          visitStatus: 'wishlist',
          cuisineType,
          cuisineTypes,
          locationArea: cleanArea,
          lat: cleanLat,
          lng: cleanLng,
          mapsUrl: cleanMapsUrl,
          promoUrl: cleanPromoUrl,
          coverImage: cleanCover,
          latestComment: cleanComment,
          avgRating: 0,
          reviewCount: 0,
          ratingSum: 0,
          avgPriceRating: 0,
          priceRatingCount: 0,
          priceRatingSum: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.delete(legacyDoc.ref);
        migrated += 1;

        const now = Date.now();
        migratedItems.push({
          id: legacyDoc.id,
          ownerId: userId,
          authorName: cleanAuthor,
          name: cleanName,
          category: cleanCategory,
          visitStatus: 'wishlist',
          cuisineType,
          cuisineTypes,
          locationArea: cleanArea,
          lat: cleanLat,
          lng: cleanLng,
          mapsUrl: cleanMapsUrl,
          promoUrl: cleanPromoUrl,
          coverImage: cleanCover,
          latestComment: cleanComment,
          avgRating: 0,
          reviewCount: 0,
          ratingSum: 0,
          avgPriceRating: 0,
          priceRatingCount: 0,
          priceRatingSum: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

      await batch.commit();
    }

    if (migratedItems.length > 0) {
      const currentWish = wishlistStates.get(userId)?.items || hydrateWishlistFromStorage(userId) || [];
      const existingIds = new Set(currentWish.map((p) => p.id));
      const merged = [
        ...migratedItems.filter((item) => !existingIds.has(item.id)),
        ...currentWish,
      ].sort((a, b) => b.updatedAt - a.updatedAt);
      persistWishlistPlaces(userId, merged, Date.now());
      notifyWishlist(userId);
    }

    detectedLegacySharedWishlistDocs = rawLegacyDocs.filter(
      (d) => !migratedItems.some((m) => m.id === d.id)
    );
    writeStorageFlag(flagKey, true);
    return migrated;
  } catch {
    return 0;
  }
}

async function fetchPlaceReviewsOnce(
  placeId: string,
  expectedSignature?: string,
  force = false
): Promise<ReviewItem[]> {
  if (isKnownWishlistWithNoReviews(placeId)) {
    return [];
  }

  const sharedPlace = getKnownSharedPlace(placeId);
  if (sharedPlace && sharedPlace.reviewCount === 0) {
    return [];
  }

  const effectiveSignature =
    expectedSignature || (sharedPlace ? placeSignature(sharedPlace) : '');

  if (!force) {
    const cached = reviewsCache.get(placeId);
    if (cached) {
      const signatureMatches =
        effectiveSignature !== ''
          ? cached.signature === effectiveSignature
          : isFresh(cached.fetchedAt, REVIEWS_TTL_MS);
      if (signatureMatches) {
        return cached.items;
      }
    }
  }

  const pending = reviewsInFlight.get(placeId);
  if (pending) return pending;

  const path = `places/${placeId}/reviews`;
  const q = query(
    collection(db, path),
    where('visibility', '==', 'shared'),
    limit(REVIEWS_QUERY_LIMIT)
  );

  const req = (async () => {
    try {
      const snap = await getDocs(q);
      const items = snap.docs
        .map((d) => mapReviewDoc(d.id, d.data()))
        .sort((a, b) => b.createdAt - a.createdAt);

      const sig =
        effectiveSignature ||
        (sharedPlace ? placeSignature(sharedPlace) : `${items.length}:${Date.now()}`);
      reviewsCache.set(placeId, {
        signature: sig,
        fetchedAt: Date.now(),
        items,
      });

      const currentUid = auth.currentUser?.uid;
      if (currentUid && effectiveSignature) {
        updateUserReviewLookupEntry(
          currentUid,
          placeId,
          effectiveSignature,
          items.some((r) => r.ownerId === currentUid)
        );
      }

      return items;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    } finally {
      reviewsInFlight.delete(placeId);
    }
  })();

  reviewsInFlight.set(placeId, req);
  return req;
}

export function subscribePlaceReviews(
  placeId: string,
  onData: (reviews: ReviewItem[]) => void,
  onError: (error: Error) => void
): () => void {
  let active = true;
  let set = reviewListeners.get(placeId);
  if (!set) {
    set = new Set();
    reviewListeners.set(placeId, set);
  }
  set.add(onData);

  if (isKnownWishlistWithNoReviews(placeId)) {
    onData([]);
    return () => {
      active = false;
      reviewListeners.get(placeId)?.delete(onData);
    };
  }

  const sharedPlace = getKnownSharedPlace(placeId);
  const sig = sharedPlace ? placeSignature(sharedPlace) : undefined;
  const cached = reviewsCache.get(placeId);
  const cacheHit =
    cached &&
    (sig ? cached.signature === sig : isFresh(cached.fetchedAt, REVIEWS_TTL_MS));

  if (cacheHit && cached) {
    onData(cached.items);
  } else {
    void fetchPlaceReviewsOnce(placeId, sig)
      .then((items) => {
        if (active) {
          onData(items);
        }
      })
      .catch((err) => {
        if (active) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      });
  }

  return () => {
    active = false;
    reviewListeners.get(placeId)?.delete(onData);
  };
}

export interface CreatePlaceInput {
  name: string;
  category: PlaceCategory;
  visitStatus?: VisitStatus;
  cuisineType?: string;
  cuisineTypes?: string[];
  locationArea?: string;
  lat?: number | null;
  lng?: number | null;
  mapsUrl?: string;
  promoUrl?: string;
  initialRating?: 1 | 2 | 3 | 4 | 5;
  initialPriceRating?: 1 | 2 | 3 | 4 | 5;
  initialComment?: string;
  photos: string[];
}

export async function createPlaceWithInitialReview(
  userId: string,
  authorName: string,
  input: CreatePlaceInput
): Promise<string> {
  const placeId = generateId();
  const placePath = `places/${placeId}`;
  const visitStatus: VisitStatus = input.visitStatus === 'wishlist' ? 'wishlist' : 'visited';

  const cleanAuthor = resolveSafeAuthorName(authorName);
  const cleanName = input.name.trim().slice(0, STORAGE_LIMITS.NAME_MAX);
  const cleanCategory = normalizeCategory(input.category);
  const { cuisineTypes, cuisineType } = normalizeCuisineTags(input.cuisineTypes, input.cuisineType);
  const cleanLocationArea = (input.locationArea || '').trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX);
  const cleanLat = normalizeCoord(input.lat, -90, 90);
  const cleanLng = normalizeCoord(input.lng, -180, 180);
  const cleanMapsUrl = (input.mapsUrl || '').trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX);
  const cleanPromoUrl = (input.promoUrl || '').trim().slice(0, STORAGE_LIMITS.PROMO_URL_MAX);
  const cleanComment = (input.initialComment || '').trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);
  const coverImage = cleanPhotos[0] || '';
  const now = Date.now();

  if (visitStatus === 'wishlist') {
    const wishlistPath = `users/${userId}/wishlist/${placeId}`;
    try {
      await setDoc(doc(db, wishlistPath), {
        ownerId: userId,
        authorName: cleanAuthor,
        visibility: 'private',
        name: cleanName,
        category: cleanCategory,
        visitStatus: 'wishlist',
        cuisineType,
        cuisineTypes,
        locationArea: cleanLocationArea,
        lat: cleanLat,
        lng: cleanLng,
        mapsUrl: cleanMapsUrl,
        promoUrl: cleanPromoUrl,
        coverImage,
        latestComment: cleanComment,
        avgRating: 0,
        reviewCount: 0,
        ratingSum: 0,
        avgPriceRating: 0,
        priceRatingCount: 0,
        priceRatingSum: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const newPlace: PlaceItem = {
        id: placeId,
        ownerId: userId,
        authorName: cleanAuthor,
        name: cleanName,
        category: cleanCategory,
        visitStatus: 'wishlist',
        cuisineType,
        cuisineTypes,
        locationArea: cleanLocationArea,
        lat: cleanLat,
        lng: cleanLng,
        mapsUrl: cleanMapsUrl,
        promoUrl: cleanPromoUrl,
        coverImage,
        latestComment: cleanComment,
        avgRating: 0,
        reviewCount: 0,
        ratingSum: 0,
        avgPriceRating: 0,
        priceRatingCount: 0,
        priceRatingSum: 0,
        createdAt: now,
        updatedAt: now,
      };
      const prevWish = wishlistStates.get(userId)?.items || hydrateWishlistFromStorage(userId) || [];
      persistWishlistPlaces(userId, [newPlace, ...prevWish], now);
      notifyWishlist(userId);
      return placeId;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, wishlistPath);
    }
  }

  const reviewId = generateId();
  const reviewPath = `places/${placeId}/reviews/${reviewId}`;
  const rating: 1 | 2 | 3 | 4 | 5 = input.initialRating || 5;
  const priceRating = normalizePriceRating(input.initialPriceRating);
  const finalComment = cleanComment.length >= STORAGE_LIMITS.COMMENT_MIN ? cleanComment : 'Ziyaret notu';

  const batch = writeBatch(db);
  batch.set(doc(db, placePath), {
    ownerId: userId,
    authorName: cleanAuthor,
    visibility: 'shared',
    name: cleanName,
    category: cleanCategory,
    visitStatus: 'visited',
    cuisineType,
    cuisineTypes,
    locationArea: cleanLocationArea,
    lat: cleanLat,
    lng: cleanLng,
    mapsUrl: cleanMapsUrl,
    promoUrl: cleanPromoUrl,
    coverImage,
    latestComment: finalComment,
    avgRating: rating,
    reviewCount: 1,
    ratingSum: rating,
    avgPriceRating: priceRating ?? 0,
    priceRatingCount: priceRating ? 1 : 0,
    priceRatingSum: priceRating ?? 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, reviewPath), {
    ownerId: userId,
    authorName: cleanAuthor,
    visibility: 'shared',
    placeId,
    rating,
    ...(priceRating ? { priceRating } : {}),
    comment: finalComment,
    photos: cleanPhotos,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();

    const newPlace: PlaceItem = {
      id: placeId,
      ownerId: userId,
      authorName: cleanAuthor,
      name: cleanName,
      category: cleanCategory,
      visitStatus: 'visited',
      cuisineType,
      cuisineTypes,
      locationArea: cleanLocationArea,
      lat: cleanLat,
      lng: cleanLng,
      mapsUrl: cleanMapsUrl,
      promoUrl: cleanPromoUrl,
      coverImage,
      latestComment: finalComment,
      avgRating: rating,
      reviewCount: 1,
      ratingSum: rating,
      avgPriceRating: priceRating ?? 0,
      priceRatingCount: priceRating ? 1 : 0,
      priceRatingSum: priceRating ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    const newReview: ReviewItem = {
      id: reviewId,
      ownerId: userId,
      authorName: cleanAuthor,
      placeId,
      rating,
      ...(priceRating ? { priceRating } : {}),
      comment: finalComment,
      photos: cleanPhotos,
      createdAt: now,
      updatedAt: now,
    };

    const prevShared = sharedPlacesState.items || hydrateSharedPlacesFromStorage() || [];
    persistSharedPlaces([newPlace, ...prevShared], now);
    reviewsCache.set(placeId, {
      signature: placeSignature(newPlace),
      fetchedAt: now,
      items: [newReview],
    });
    updateUserReviewLookupEntry(userId, placeId, placeSignature(newPlace), true);
    notifySharedPlaces();
    notifyPlaceReviews(placeId);

    return placeId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, placePath);
  }
}

function patchPlaceInLocalStores(
  placeId: string,
  patch: Partial<PlaceItem>,
  userId?: string,
  isWishlist?: boolean
): void {
  const now = Date.now();
  if (isWishlist && userId) {
    const list = wishlistStates.get(userId)?.items || hydrateWishlistFromStorage(userId);
    if (list) {
      const next = list
        .map((p) => (p.id === placeId ? { ...p, ...patch, updatedAt: now } : p))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      persistWishlistPlaces(userId, next, now);
      notifyWishlist(userId);
    }
    return;
  }

  const shared = sharedPlacesState.items || hydrateSharedPlacesFromStorage();
  if (shared) {
    let changed = false;
    const next = shared
      .map((p) => {
        if (p.id !== placeId) return p;
        changed = true;
        return { ...p, ...patch, updatedAt: now };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (changed) {
      persistSharedPlaces(next, now);
      notifySharedPlaces();
    }
  }
}

export async function updatePlaceMapsUrl(
  placeId: string,
  mapsUrl: string,
  userId?: string,
  isWishlist?: boolean
): Promise<void> {
  const cleanUrl = mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX);
  const placePath =
    isWishlist && userId ? `users/${userId}/wishlist/${placeId}` : `places/${placeId}`;
  try {
    await updateDoc(doc(db, placePath), {
      mapsUrl: cleanUrl,
      updatedAt: serverTimestamp(),
    });
    patchPlaceInLocalStores(placeId, { mapsUrl: cleanUrl }, userId, isWishlist);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, placePath);
  }
}

export async function updatePlacePromoUrl(
  placeId: string,
  promoUrl: string,
  userId?: string,
  isWishlist?: boolean
): Promise<void> {
  const cleanUrl = promoUrl.trim().slice(0, STORAGE_LIMITS.PROMO_URL_MAX);
  const placePath =
    isWishlist && userId ? `users/${userId}/wishlist/${placeId}` : `places/${placeId}`;
  try {
    await updateDoc(doc(db, placePath), {
      promoUrl: cleanUrl,
      updatedAt: serverTimestamp(),
    });
    patchPlaceInLocalStores(placeId, { promoUrl: cleanUrl }, userId, isWishlist);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, placePath);
  }
}

export interface UpdatePlaceTagsAndLocationInput {
  cuisineTypes?: string[];
  cuisineType?: string;
  locationArea?: string;
  category?: PlaceCategory;
  lat?: number | null;
  lng?: number | null;
}

export async function updatePlaceTagsAndLocation(
  placeId: string,
  input: UpdatePlaceTagsAndLocationInput,
  userId?: string,
  isWishlist?: boolean
): Promise<void> {
  const placePath =
    isWishlist && userId ? `users/${userId}/wishlist/${placeId}` : `places/${placeId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  const localPatch: Partial<PlaceItem> = {};

  if (input.cuisineTypes !== undefined || input.cuisineType !== undefined) {
    const { cuisineTypes, cuisineType } = normalizeCuisineTags(input.cuisineTypes, input.cuisineType);
    payload.cuisineTypes = cuisineTypes;
    payload.cuisineType = cuisineType;
    localPatch.cuisineTypes = cuisineTypes;
    localPatch.cuisineType = cuisineType;
  }
  if (input.locationArea !== undefined) {
    const cleanArea = input.locationArea.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX);
    payload.locationArea = cleanArea;
    localPatch.locationArea = cleanArea;
  }
  if (input.category !== undefined) {
    const cleanCat = normalizeCategory(input.category);
    payload.category = cleanCat;
    localPatch.category = cleanCat;
  }
  if (input.lat !== undefined) {
    const cleanLat = normalizeCoord(input.lat, -90, 90);
    payload.lat = cleanLat;
    localPatch.lat = cleanLat;
  }
  if (input.lng !== undefined) {
    const cleanLng = normalizeCoord(input.lng, -180, 180);
    payload.lng = cleanLng;
    localPatch.lng = cleanLng;
  }

  try {
    await updateDoc(doc(db, placePath), payload);
    patchPlaceInLocalStores(placeId, localPatch, userId, isWishlist);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, placePath);
  }
}

export interface AddReviewInput {
  placeId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  priceRating?: 1 | 2 | 3 | 4 | 5;
  comment: string;
  photos: string[];
}

export async function addReviewToPlace(
  userId: string,
  authorName: string,
  input: AddReviewInput
): Promise<void> {
  const reviewId = generateId();
  const placePath = `places/${input.placeId}`;
  const reviewPath = `${placePath}/reviews/${reviewId}`;
  const wishPath = `users/${userId}/wishlist/${input.placeId}`;

  const cleanAuthor = resolveSafeAuthorName(authorName);
  const cleanComment = input.comment.trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPriceRating = normalizePriceRating(input.priceRating);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);
  const now = Date.now();

  try {
    const outcome = await runTransaction(db, async (tx) => {
      const placeRef = doc(db, placePath);
      const snap = await tx.get(placeRef);

      if (snap.exists()) {
        const data = snap.data();
        const nextCount = (typeof data.reviewCount === 'number' ? data.reviewCount : 0) + 1;
        const nextSum = (typeof data.ratingSum === 'number' ? data.ratingSum : 0) + input.rating;
        const nextAvg = Math.round((nextSum / nextCount) * 100) / 100;

        const prevPriceCount = typeof data.priceRatingCount === 'number' ? data.priceRatingCount : 0;
        const prevPriceSum = typeof data.priceRatingSum === 'number' ? data.priceRatingSum : 0;
        const nextPriceCount = prevPriceCount + (cleanPriceRating ? 1 : 0);
        const nextPriceSum = prevPriceSum + (cleanPriceRating ?? 0);
        const nextAvgPrice =
          nextPriceCount > 0 ? Math.round((nextPriceSum / nextPriceCount) * 100) / 100 : 0;

        const existingCover = typeof data.coverImage === 'string' ? data.coverImage : '';
        const nextCover = existingCover || cleanPhotos[0] || '';

        tx.set(doc(db, reviewPath), {
          ownerId: userId,
          authorName: cleanAuthor,
          visibility: 'shared',
          placeId: input.placeId,
          rating: input.rating,
          ...(cleanPriceRating ? { priceRating: cleanPriceRating } : {}),
          comment: cleanComment,
          photos: cleanPhotos,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        tx.update(placeRef, {
          avgRating: nextAvg,
          reviewCount: nextCount,
          ratingSum: nextSum,
          avgPriceRating: nextAvgPrice,
          priceRatingCount: nextPriceCount,
          priceRatingSum: nextPriceSum,
          latestComment: cleanComment,
          coverImage: nextCover,
          visitStatus: 'visited',
          updatedAt: serverTimestamp(),
        });

        return {
          promotedFromWishlist: false,
          updatedPlace: {
            ...mapPlaceDoc(input.placeId, data),
            avgRating: nextAvg,
            reviewCount: nextCount,
            ratingSum: nextSum,
            avgPriceRating: nextAvgPrice,
            priceRatingCount: nextPriceCount,
            priceRatingSum: nextPriceSum,
            latestComment: cleanComment,
            coverImage: nextCover,
            visitStatus: 'visited' as const,
            updatedAt: now,
          },
        };
      }

      const wishRef = doc(db, wishPath);
      const wishSnap = await tx.get(wishRef);
      if (!wishSnap.exists()) {
        throw new Error('Mekan bulunamadı.');
      }

      const wishData = wishSnap.data();
      const { cuisineTypes, cuisineType } = normalizeCuisineTags(
        wishData.cuisineTypes,
        wishData.cuisineType
      );
      const wishName =
        typeof wishData.name === 'string' && wishData.name.trim().length >= STORAGE_LIMITS.NAME_MIN
          ? wishData.name.trim().slice(0, STORAGE_LIMITS.NAME_MAX)
          : 'Mekan';
      const existingCover = typeof wishData.coverImage === 'string' ? wishData.coverImage : '';
      const nextCover = existingCover || cleanPhotos[0] || '';
      const placeAuthor = resolveSafeAuthorName(
        typeof wishData.authorName === 'string' ? wishData.authorName : cleanAuthor
      );
      const placeCategory = normalizeCategory(wishData.category);
      const placeArea =
        typeof wishData.locationArea === 'string'
          ? wishData.locationArea.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX)
          : '';
      const placeLat = normalizeCoord(wishData.lat, -90, 90);
      const placeLng = normalizeCoord(wishData.lng, -180, 180);
      const placeMapsUrl =
        typeof wishData.mapsUrl === 'string'
          ? wishData.mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX)
          : '';
      const placePromoUrl =
        typeof wishData.promoUrl === 'string'
          ? wishData.promoUrl.trim().slice(0, STORAGE_LIMITS.PROMO_URL_MAX)
          : '';

      tx.set(placeRef, {
        ownerId: userId,
        authorName: placeAuthor,
        visibility: 'shared',
        name: wishName,
        category: placeCategory,
        visitStatus: 'visited',
        cuisineType,
        cuisineTypes,
        locationArea: placeArea,
        lat: placeLat,
        lng: placeLng,
        mapsUrl: placeMapsUrl,
        promoUrl: placePromoUrl,
        coverImage: nextCover,
        latestComment: cleanComment,
        avgRating: input.rating,
        reviewCount: 1,
        ratingSum: input.rating,
        avgPriceRating: cleanPriceRating ?? 0,
        priceRatingCount: cleanPriceRating ? 1 : 0,
        priceRatingSum: cleanPriceRating ?? 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, reviewPath), {
        ownerId: userId,
        authorName: cleanAuthor,
        visibility: 'shared',
        placeId: input.placeId,
        rating: input.rating,
        ...(cleanPriceRating ? { priceRating: cleanPriceRating } : {}),
        comment: cleanComment,
        photos: cleanPhotos,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.delete(wishRef);

      return {
        promotedFromWishlist: true,
        updatedPlace: {
          id: input.placeId,
          ownerId: userId,
          authorName: placeAuthor,
          name: wishName,
          category: placeCategory,
          visitStatus: 'visited' as const,
          cuisineType,
          cuisineTypes,
          locationArea: placeArea,
          lat: placeLat,
          lng: placeLng,
          mapsUrl: placeMapsUrl,
          promoUrl: placePromoUrl,
          coverImage: nextCover,
          latestComment: cleanComment,
          avgRating: input.rating,
          reviewCount: 1,
          ratingSum: input.rating,
          avgPriceRating: cleanPriceRating ?? 0,
          priceRatingCount: cleanPriceRating ? 1 : 0,
          priceRatingSum: cleanPriceRating ?? 0,
          createdAt: toMillis(wishData.createdAt),
          updatedAt: now,
        },
      };
    });

    const newReview: ReviewItem = {
      id: reviewId,
      ownerId: userId,
      authorName: cleanAuthor,
      placeId: input.placeId,
      rating: input.rating,
      ...(cleanPriceRating ? { priceRating: cleanPriceRating } : {}),
      comment: cleanComment,
      photos: cleanPhotos,
      createdAt: now,
      updatedAt: now,
    };

    const existingReviews = reviewsCache.get(input.placeId)?.items || [];
    const nextReviews = [newReview, ...existingReviews].sort((a, b) => b.createdAt - a.createdAt);
    const nextSig = placeSignature(outcome.updatedPlace);
    reviewsCache.set(input.placeId, {
      signature: nextSig,
      fetchedAt: now,
      items: nextReviews,
    });
    updateUserReviewLookupEntry(userId, input.placeId, nextSig, true);

    if (outcome.promotedFromWishlist) {
      const wishList = wishlistStates.get(userId)?.items || hydrateWishlistFromStorage(userId);
      if (wishList) {
        persistWishlistPlaces(
          userId,
          wishList.filter((p) => p.id !== input.placeId),
          now
        );
        notifyWishlist(userId);
      }
    }

    const shared = sharedPlacesState.items || hydrateSharedPlacesFromStorage() || [];
    const withoutTarget = shared.filter((p) => p.id !== input.placeId);
    const nextShared = [outcome.updatedPlace, ...withoutTarget].sort((a, b) => b.updatedAt - a.updatedAt);
    persistSharedPlaces(nextShared, now);

    notifySharedPlaces();
    notifyPlaceReviews(input.placeId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, placePath);
  }
}

export interface UpdateReviewInput {
  placeId: string;
  reviewId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  priceRating?: 1 | 2 | 3 | 4 | 5;
  comment: string;
  photos: string[];
}

export async function updateReviewInPlace(input: UpdateReviewInput): Promise<void> {
  const placePath = `places/${input.placeId}`;
  const reviewsPath = `${placePath}/reviews`;
  const reviewPath = `${reviewsPath}/${input.reviewId}`;

  const cleanComment = input.comment.trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPriceRating = normalizePriceRating(input.priceRating);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);

  try {
    const sharedPlace = getKnownSharedPlace(input.placeId);
    const currentReviews = await fetchPlaceReviewsOnce(
      input.placeId,
      sharedPlace ? placeSignature(sharedPlace) : undefined
    );

    const now = Date.now();
    const allReviews = currentReviews
      .map((mapped) => {
        if (mapped.id === input.reviewId) {
          const updated: ReviewItem = {
            ...mapped,
            rating: input.rating,
            comment: cleanComment,
            photos: cleanPhotos,
            updatedAt: now,
          };
          if (cleanPriceRating) {
            updated.priceRating = cleanPriceRating;
          } else {
            delete updated.priceRating;
          }
          return updated;
        }
        return mapped;
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const nextCount = allReviews.length;
    const nextSum = allReviews.reduce((acc, r) => acc + r.rating, 0);
    const nextAvg = nextCount > 0 ? Math.round((nextSum / nextCount) * 100) / 100 : 0;

    const priceReviews = allReviews.filter((r) => typeof r.priceRating === 'number');
    const nextPriceCount = priceReviews.length;
    const nextPriceSum = priceReviews.reduce((acc, r) => acc + (r.priceRating || 0), 0);
    const nextAvgPrice =
      nextPriceCount > 0 ? Math.round((nextPriceSum / nextPriceCount) * 100) / 100 : 0;

    const nextLatestComment = allReviews[0]?.comment ?? '';
    const nextCover = allReviews.find((r) => r.photos.length > 0)?.photos[0] ?? '';

    const batch = writeBatch(db);
    batch.update(doc(db, reviewPath), {
      rating: input.rating,
      ...(cleanPriceRating ? { priceRating: cleanPriceRating } : {}),
      comment: cleanComment,
      photos: cleanPhotos,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, placePath), {
      avgRating: nextAvg,
      reviewCount: nextCount,
      ratingSum: nextSum,
      avgPriceRating: nextAvgPrice,
      priceRatingCount: nextPriceCount,
      priceRatingSum: nextPriceSum,
      latestComment: nextLatestComment,
      coverImage: nextCover,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    const nextSig = `${nextCount}:${now}`;
    reviewsCache.set(input.placeId, {
      signature: nextSig,
      fetchedAt: now,
      items: allReviews,
    });
    patchPlaceInLocalStores(input.placeId, {
      avgRating: nextAvg,
      reviewCount: nextCount,
      ratingSum: nextSum,
      avgPriceRating: nextAvgPrice,
      priceRatingCount: nextPriceCount,
      priceRatingSum: nextPriceSum,
      latestComment: nextLatestComment,
      coverImage: nextCover,
    });
    const uid = auth.currentUser?.uid;
    if (uid) {
      updateUserReviewLookupEntry(
        uid,
        input.placeId,
        nextSig,
        allReviews.some((r) => r.ownerId === uid)
      );
    }
    notifyPlaceReviews(input.placeId);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, reviewPath);
  }
}

export async function deleteReviewFromPlace(
  placeId: string,
  reviewId: string
): Promise<void> {
  const placePath = `places/${placeId}`;
  const reviewsPath = `${placePath}/reviews`;
  const reviewPath = `${reviewsPath}/${reviewId}`;

  try {
    const sharedPlace = getKnownSharedPlace(placeId);
    const currentReviews = await fetchPlaceReviewsOnce(
      placeId,
      sharedPlace ? placeSignature(sharedPlace) : undefined
    );

    const remaining = currentReviews
      .filter((r) => r.id !== reviewId)
      .sort((a, b) => b.createdAt - a.createdAt);

    const nextCount = remaining.length;
    const nextSum = remaining.reduce((acc, r) => acc + r.rating, 0);
    const nextAvg = nextCount > 0 ? Math.round((nextSum / nextCount) * 100) / 100 : 0;

    const priceReviews = remaining.filter((r) => typeof r.priceRating === 'number');
    const nextPriceCount = priceReviews.length;
    const nextPriceSum = priceReviews.reduce((acc, r) => acc + (r.priceRating || 0), 0);
    const nextAvgPrice =
      nextPriceCount > 0 ? Math.round((nextPriceSum / nextPriceCount) * 100) / 100 : 0;

    const nextLatestComment = remaining[0]?.comment ?? '';

    const batch = writeBatch(db);
    batch.delete(doc(db, reviewPath));
    batch.update(doc(db, placePath), {
      avgRating: nextAvg,
      reviewCount: nextCount,
      ratingSum: nextSum,
      avgPriceRating: nextAvgPrice,
      priceRatingCount: nextPriceCount,
      priceRatingSum: nextPriceSum,
      latestComment: nextLatestComment,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    const now = Date.now();
    const nextSig = `${nextCount}:${now}`;
    reviewsCache.set(placeId, {
      signature: nextSig,
      fetchedAt: now,
      items: remaining,
    });
    patchPlaceInLocalStores(placeId, {
      avgRating: nextAvg,
      reviewCount: nextCount,
      ratingSum: nextSum,
      avgPriceRating: nextAvgPrice,
      priceRatingCount: nextPriceCount,
      priceRatingSum: nextPriceSum,
      latestComment: nextLatestComment,
    });
    const uid = auth.currentUser?.uid;
    if (uid) {
      updateUserReviewLookupEntry(
        uid,
        placeId,
        nextSig,
        remaining.some((r) => r.ownerId === uid)
      );
    }
    notifyPlaceReviews(placeId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, reviewPath);
  }
}

export async function deletePlace(
  userId: string,
  placeId: string,
  isWishlist?: boolean
): Promise<void> {
  const now = Date.now();
  if (isWishlist) {
    const wishPath = `users/${userId}/wishlist/${placeId}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, wishPath));
      await batch.commit();

      const list = wishlistStates.get(userId)?.items || hydrateWishlistFromStorage(userId);
      if (list) {
        persistWishlistPlaces(
          userId,
          list.filter((p) => p.id !== placeId),
          now
        );
        notifyWishlist(userId);
      }
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, wishPath);
    }
  }

  const placePath = `places/${placeId}`;
  const reviewsPath = `${placePath}/reviews`;

  try {
    const reviewsSnap = await getDocs(
      query(
        collection(db, reviewsPath),
        where('visibility', '==', 'shared'),
        limit(REVIEWS_QUERY_LIMIT)
      )
    );
    const batch = writeBatch(db);
    reviewsSnap.docs.forEach((d) => {
      if (d.data().ownerId === userId) {
        batch.delete(d.ref);
      }
    });
    batch.delete(doc(db, placePath));
    await batch.commit();

    const shared = sharedPlacesState.items || hydrateSharedPlacesFromStorage();
    if (shared) {
      persistSharedPlaces(
        shared.filter((p) => p.id !== placeId),
        now
      );
      notifySharedPlaces();
    }
    reviewsCache.delete(placeId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, placePath);
  }
}

async function fetchHiddenWishlistIdsOnce(userId: string, force = false): Promise<string[]> {
  if (!force) {
    const cached = hydrateHiddenIdsFromStorage(userId);
    if (cached) return cached;
  }

  const pending = hiddenIdsInFlight.get(userId);
  if (pending) return pending;

  const prefPath = `users/${userId}/preferences/wishlist`;
  const req = (async () => {
    try {
      const snap = await getDoc(doc(db, prefPath));
      if (!snap.exists()) {
        persistHiddenIds(userId, [], Date.now());
        return [];
      }
      const data = snap.data();
      const ids = Array.isArray(data.hiddenPlaceIds)
        ? data.hiddenPlaceIds.filter(
            (x): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x)
          )
        : [];
      persistHiddenIds(userId, ids, Date.now());
      return ids;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, prefPath);
    } finally {
      hiddenIdsInFlight.delete(userId);
    }
  })();

  hiddenIdsInFlight.set(userId, req);
  return req;
}

export function subscribeFirestoreHiddenWishlistIds(
  userId: string,
  onData: (ids: string[]) => void,
  onError?: (error: Error) => void
): () => void {
  let active = true;
  let set = hiddenIdsListeners.get(userId);
  if (!set) {
    set = new Set();
    hiddenIdsListeners.set(userId, set);
  }
  set.add(onData);

  const cached = hydrateHiddenIdsFromStorage(userId);
  if (cached) {
    onData(cached);
  } else {
    void fetchHiddenWishlistIdsOnce(userId)
      .then((ids) => {
        if (active) {
          onData(ids);
        }
      })
      .catch((err) => {
        if (active) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      });
  }

  return () => {
    active = false;
    hiddenIdsListeners.get(userId)?.delete(onData);
  };
}

export async function toggleFirestoreWishlistPlaceHidden(
  userId: string,
  placeId: string,
  hide: boolean
): Promise<string[]> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(placeId)) {
    throw new Error('Geçersiz mekan kimliği.');
  }
  const prefPath = `users/${userId}/preferences/wishlist`;
  const prefRef = doc(db, prefPath);

  try {
    const nextIds = await runTransaction(db, async (tx) => {
      const snap = await tx.get(prefRef);
      const existingIds =
        snap.exists() && Array.isArray(snap.data().hiddenPlaceIds)
          ? (snap.data().hiddenPlaceIds as unknown[]).filter(
              (id): id is string =>
                typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)
            )
          : [];

      const computed = hide
        ? Array.from(new Set([...existingIds, placeId])).slice(0, 500)
        : existingIds.filter((id) => id !== placeId);

      if (!snap.exists()) {
        tx.set(prefRef, {
          ownerId: userId,
          hiddenPlaceIds: computed,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(prefRef, {
          hiddenPlaceIds: computed,
          updatedAt: serverTimestamp(),
        });
      }

      return computed;
    });

    persistHiddenIds(userId, nextIds, Date.now());
    notifyHiddenIds(userId);
    return nextIds;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, prefPath);
  }
}

export async function saveFirestoreHiddenWishlistIds(
  userId: string,
  nextIds: string[]
): Promise<void> {
  const prefPath = `users/${userId}/preferences/wishlist`;
  const cleanIds = Array.from(
    new Set(nextIds.filter((id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)))
  ).slice(0, 500);

  try {
    await setDoc(doc(db, prefPath), {
      ownerId: userId,
      hiddenPlaceIds: cleanIds,
      updatedAt: serverTimestamp(),
    });
    persistHiddenIds(userId, cleanIds, Date.now());
    notifyHiddenIds(userId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, prefPath);
  }
}

export async function countLegacyPersonalCloudPlaces(userId: string): Promise<number> {
  const flagKey = `${FLAG_KEY_LEGACY_PERSONAL_ZERO_PREFIX}${userId}`;
  if (readStorageFlag(flagKey)) {
    return 0;
  }

  const legacyPath = `users/${userId}/places`;
  try {
    const probeSnap = await getDocs(
      query(collection(db, legacyPath), where('ownerId', '==', userId), limit(1))
    );
    if (probeSnap.empty) {
      writeStorageFlag(flagKey, true);
      return 0;
    }

    const fullSnap = await getDocs(
      query(collection(db, legacyPath), where('ownerId', '==', userId), limit(200))
    );
    return fullSnap.size;
  } catch {
    return 0;
  }
}

export async function migrateLegacyPersonalCloudToShared(
  userId: string,
  authorName: string
): Promise<number> {
  const legacyPath = `users/${userId}/places`;
  try {
    const placesSnap = await getDocs(
      query(collection(db, legacyPath), where('ownerId', '==', userId), limit(200))
    );
    if (placesSnap.empty) {
      writeStorageFlag(`${FLAG_KEY_LEGACY_PERSONAL_ZERO_PREFIX}${userId}`, true);
      return 0;
    }

    let migrated = 0;
    for (const pDoc of placesSnap.docs) {
      const p = mapPlaceDoc(pDoc.id, pDoc.data());
      const reviewsPath = `${legacyPath}/${pDoc.id}/reviews`;
      const revSnap = await getDocs(
        query(collection(db, reviewsPath), where('ownerId', '==', userId), limit(REVIEWS_QUERY_LIMIT))
      );
      const reviews = revSnap.docs
        .map((d) => mapReviewDoc(d.id, d.data()))
        .sort((a, b) => a.createdAt - b.createdAt);

      const firstRev = reviews[0];
      const newPlaceId = await createPlaceWithInitialReview(userId, authorName, {
        name: p.name,
        category: p.category,
        visitStatus: p.visitStatus,
        cuisineType: p.cuisineType,
        cuisineTypes: p.cuisineTypes,
        locationArea: p.locationArea,
        lat: p.lat,
        lng: p.lng,
        mapsUrl: p.mapsUrl,
        promoUrl: p.promoUrl,
        initialRating: firstRev?.rating || 5,
        initialPriceRating: firstRev?.priceRating,
        initialComment:
          firstRev?.comment ||
          (p.latestComment.length >= 2 ? p.latestComment : 'Ziyaret notu'),
        photos: firstRev?.photos || (p.coverImage ? [p.coverImage] : []),
      });

      for (const extraRev of reviews.slice(1)) {
        await addReviewToPlace(userId, authorName, {
          placeId: newPlaceId,
          rating: extraRev.rating,
          priceRating: extraRev.priceRating,
          comment: extraRev.comment,
          photos: extraRev.photos,
        });
      }

      const cleanupBatch = writeBatch(db);
      revSnap.docs.forEach((d) => cleanupBatch.delete(d.ref));
      cleanupBatch.delete(pDoc.ref);
      await cleanupBatch.commit();

      migrated += 1;
    }

    writeStorageFlag(`${FLAG_KEY_LEGACY_PERSONAL_ZERO_PREFIX}${userId}`, true);
    return migrated;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, legacyPath);
  }
}

export interface BackupPayload {
  version: number;
  exportedAt: string;
  places: PlaceItem[];
  reviews: ReviewItem[];
}

export async function exportFirestoreBackup(userId?: string): Promise<BackupPayload> {
  const placesPath = 'places';
  try {
    const sharedVisitedPlaces = await fetchSharedPlacesOnce();

    let wishlistPlaces: PlaceItem[] = [];
    if (userId) {
      wishlistPlaces = await fetchUserWishlistOnce(userId);
    }

    const places = [...sharedVisitedPlaces, ...wishlistPlaces];
    const allReviews: ReviewItem[] = [];

    for (let i = 0; i < sharedVisitedPlaces.length; i += 6) {
      const chunk = sharedVisitedPlaces.slice(i, i + 6);
      const chunkReviews = await Promise.all(
        chunk.map((p) =>
          p.reviewCount > 0 ? fetchPlaceReviewsOnce(p.id, placeSignature(p)) : Promise.resolve([])
        )
      );
      for (const list of chunkReviews) {
        allReviews.push(...list);
      }
    }

    return {
      version: 5,
      exportedAt: new Date().toISOString(),
      places,
      reviews: allReviews,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, placesPath);
  }
}

export async function importBackupToFirestore(
  userId: string,
  authorName: string,
  jsonText: string
): Promise<number> {
  const parsed = JSON.parse(jsonText) as Partial<BackupPayload>;
  if (!parsed || !Array.isArray(parsed.places)) {
    throw new Error('Geçersiz yedek dosyası formatı.');
  }

  const reviewsByPlace = new Map<
    string,
    Array<{ rating: 1 | 2 | 3 | 4 | 5; priceRating?: 1 | 2 | 3 | 4 | 5; comment: string; photos: string[] }>
  >();
  if (Array.isArray(parsed.reviews)) {
    for (const r of parsed.reviews) {
      if (r && typeof r.placeId === 'string' && typeof r.comment === 'string') {
        const list = reviewsByPlace.get(r.placeId) || [];
        const priceRating = normalizePriceRating(r.priceRating);
        list.push({
          rating:
            r.rating === 1 || r.rating === 2 || r.rating === 3 || r.rating === 4 || r.rating === 5
              ? r.rating
              : 5,
          ...(priceRating ? { priceRating } : {}),
          comment: r.comment,
          photos: Array.isArray(r.photos) ? r.photos.slice(0, STORAGE_LIMITS.MAX_PHOTOS) : [],
        });
        reviewsByPlace.set(r.placeId, list);
      }
    }
  }

  let imported = 0;
  for (const p of parsed.places) {
    if (!p || typeof p.name !== 'string' || p.name.trim().length < 2) continue;
    const relatedReviews = reviewsByPlace.get(p.id) || [];
    const firstRev = relatedReviews[0];
    const isWishlist = p.visitStatus === 'wishlist' && relatedReviews.length === 0;
    const comment = (firstRev?.comment || p.latestComment || (isWishlist ? '' : 'Ziyaret notu')).trim();
    const rating: 1 | 2 | 3 | 4 | 5 =
      firstRev?.rating ||
      (p.avgRating >= 4.5
        ? 5
        : p.avgRating >= 3.5
          ? 4
          : p.avgRating >= 2.5
            ? 3
            : p.avgRating >= 1.5
              ? 2
              : 1);
    const derivedPriceRating: 1 | 2 | 3 | 4 | 5 | undefined =
      firstRev?.priceRating ||
      (typeof p.avgPriceRating === 'number' && p.avgPriceRating > 0
        ? p.avgPriceRating >= 4.5
          ? 5
          : p.avgPriceRating >= 3.5
            ? 4
            : p.avgPriceRating >= 2.5
              ? 3
              : p.avgPriceRating >= 1.5
                ? 2
                : 1
        : undefined);

    const placeId = await createPlaceWithInitialReview(userId, authorName, {
      name: p.name,
      category: normalizeCategory(p.category),
      visitStatus: isWishlist ? 'wishlist' : 'visited',
      cuisineType: typeof p.cuisineType === 'string' ? p.cuisineType : '',
      cuisineTypes: Array.isArray(p.cuisineTypes) ? p.cuisineTypes : undefined,
      locationArea: typeof p.locationArea === 'string' ? p.locationArea : '',
      lat: typeof p.lat === 'number' ? p.lat : null,
      lng: typeof p.lng === 'number' ? p.lng : null,
      mapsUrl: typeof p.mapsUrl === 'string' ? p.mapsUrl : '',
      promoUrl: typeof p.promoUrl === 'string' ? p.promoUrl : '',
      initialRating: rating,
      initialPriceRating: isWishlist ? undefined : derivedPriceRating,
      initialComment: isWishlist ? comment : comment.length >= 2 ? comment : 'Ziyaret notu',
      photos: firstRev?.photos || (p.coverImage ? [p.coverImage] : []),
    });

    for (const extraRev of relatedReviews.slice(1)) {
      await addReviewToPlace(userId, authorName, {
        placeId,
        rating: extraRev.rating,
        priceRating: extraRev.priceRating,
        comment: extraRev.comment.trim().length >= 2 ? extraRev.comment : 'Ziyaret notu',
        photos: extraRev.photos,
      });
    }

    imported += 1;
  }

  return imported;
}
