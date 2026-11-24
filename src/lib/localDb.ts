import {
  STORAGE_LIMITS,
  type PlaceCategory,
  type PlaceItem,
  type ReviewItem,
  type VisitStatus,
} from '../types/place';

export interface LegacyLocalPlace {
  id: string;
  name: string;
  category?: string;
  visitStatus?: VisitStatus;
  cuisineType?: string;
  mapsUrl?: string;
  coverImage?: string;
  latestComment?: string;
  avgRating?: number;
  updatedAt?: number;
}

export interface LegacyLocalReview {
  id: string;
  placeId: string;
  rating?: number;
  comment: string;
  photos?: string[];
  createdAt?: number;
}

const DB_NAME = 'mekannotu_local_db';
const DB_VERSION = 1;
const STORE_PLACES = 'places';
const STORE_REVIEWS = 'reviews';
const LOCAL_OWNER_ID = 'local-device';
const LOCAL_CHANGE_EVENT = 'mekannotu-local-db-changed';
const FALLBACK_STORAGE_KEY = 'mekannotu_local_fallback_v1';

interface FallbackStoreData {
  places: PlaceItem[];
  reviews: ReviewItem[];
}

let memoryFallback: FallbackStoreData = { places: [], reviews: [] };

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function notifyLocalChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
  }
}

function readFallbackStore(): FallbackStoreData {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FallbackStoreData>;
        return {
          places: Array.isArray(parsed.places) ? parsed.places : [],
          reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
        };
      }
    }
  } catch {
    // Ignore storage access restriction and use memory fallback
  }
  return memoryFallback;
}

function writeFallbackStore(data: FallbackStoreData): void {
  memoryFallback = data;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(data));
    }
  } catch {
    // Ignore quota/private-mode localStorage error; memoryFallback keeps session state
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB desteklenmiyor.'));
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PLACES)) {
          db.createObjectStore(STORE_PLACES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_REVIEWS)) {
          const reviewStore = db.createObjectStore(STORE_REVIEWS, { keyPath: 'id' });
          reviewStore.createIndex('placeId', 'placeId', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Yerel veritabanı açılamadı.'));
      req.onblocked = () => reject(new Error('Yerel veritabanı meşgul.'));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Veritabanı okunamadı.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Yerel kayıt tamamlanamadı.'));
    tx.onabort = () => reject(tx.error || new Error('Yerel işlem iptal edildi.'));
  });
}

function normalizePlace(raw: Partial<PlaceItem> & { id: string }): PlaceItem {
  const now = Date.now();
  const category: PlaceCategory =
    raw.category === 'restaurant' ||
    raw.category === 'cafe' ||
    raw.category === 'bakery' ||
    raw.category === 'bistro'
      ? raw.category
      : 'restaurant';

  const visitStatus: VisitStatus = raw.visitStatus === 'wishlist' ? 'wishlist' : 'visited';

  return {
    id: raw.id,
    ownerId: typeof raw.ownerId === 'string' && raw.ownerId ? raw.ownerId : LOCAL_OWNER_ID,
    authorName:
      typeof raw.authorName === 'string' && raw.authorName.trim()
        ? raw.authorName.trim().slice(0, STORAGE_LIMITS.AUTHOR_NAME_MAX)
        : 'Bu Cihaz',
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Mekan',
    category,
    visitStatus,
    cuisineType:
      typeof raw.cuisineType === 'string'
        ? raw.cuisineType.trim().slice(0, STORAGE_LIMITS.CUISINE_TYPE_MAX)
        : '',
    mapsUrl: typeof raw.mapsUrl === 'string' ? raw.mapsUrl : '',
    coverImage: typeof raw.coverImage === 'string' ? raw.coverImage : '',
    latestComment: typeof raw.latestComment === 'string' ? raw.latestComment : '',
    avgRating: typeof raw.avgRating === 'number' && Number.isFinite(raw.avgRating) ? raw.avgRating : 0,
    reviewCount:
      typeof raw.reviewCount === 'number' && Number.isFinite(raw.reviewCount)
        ? raw.reviewCount
        : visitStatus === 'wishlist'
          ? 0
          : 1,
    ratingSum:
      typeof raw.ratingSum === 'number' && Number.isFinite(raw.ratingSum)
        ? raw.ratingSum
        : typeof raw.avgRating === 'number'
          ? raw.avgRating
          : 0,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };
}

function normalizeReview(raw: Partial<ReviewItem> & { id: string; placeId: string }): ReviewItem {
  const now = Date.now();
  const rating: 1 | 2 | 3 | 4 | 5 =
    raw.rating === 1 || raw.rating === 2 || raw.rating === 3 || raw.rating === 4 || raw.rating === 5
      ? raw.rating
      : 5;

  return {
    id: raw.id,
    ownerId: typeof raw.ownerId === 'string' && raw.ownerId ? raw.ownerId : LOCAL_OWNER_ID,
    authorName:
      typeof raw.authorName === 'string' && raw.authorName.trim()
        ? raw.authorName.trim().slice(0, STORAGE_LIMITS.AUTHOR_NAME_MAX)
        : 'Bu Cihaz',
    placeId: raw.placeId,
    rating,
    comment: typeof raw.comment === 'string' ? raw.comment : '',
    photos: Array.isArray(raw.photos)
      ? raw.photos.filter((x): x is string => typeof x === 'string').slice(0, STORAGE_LIMITS.MAX_PHOTOS)
      : [],
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };
}

export async function listPlaces(): Promise<PlaceItem[]> {
  try {
    const db = await openDb();
    if (!db.objectStoreNames.contains(STORE_PLACES)) return [];
    const tx = db.transaction(STORE_PLACES, 'readonly');
    const raw = await reqToPromise<Array<Partial<PlaceItem> & { id: string }>>(
      tx.objectStore(STORE_PLACES).getAll()
    );
    return raw.map(normalizePlace).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return readFallbackStore()
      .places.map((p) => normalizePlace(p))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export async function listLocalPlaceReviews(placeId: string): Promise<ReviewItem[]> {
  try {
    const db = await openDb();
    if (!db.objectStoreNames.contains(STORE_REVIEWS)) return [];
    const tx = db.transaction(STORE_REVIEWS, 'readonly');
    const index = tx.objectStore(STORE_REVIEWS).index('placeId');
    const raw = await reqToPromise<Array<Partial<ReviewItem> & { id: string; placeId: string }>>(
      index.getAll(placeId)
    );
    return raw.map(normalizeReview).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return readFallbackStore()
      .reviews.filter((r) => r.placeId === placeId)
      .map((r) => normalizeReview(r))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

export function subscribeLocalPlaces(
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  let active = true;
  const load = () => {
    void listPlaces()
      .then((items) => {
        if (active) onData(items);
      })
      .catch((err) => {
        if (active) onError(err instanceof Error ? err : new Error(String(err)));
      });
  };

  load();
  const handleChange = () => load();
  window.addEventListener(LOCAL_CHANGE_EVENT, handleChange);
  return () => {
    active = false;
    window.removeEventListener(LOCAL_CHANGE_EVENT, handleChange);
  };
}

export function subscribeLocalPlaceReviews(
  placeId: string,
  onData: (reviews: ReviewItem[]) => void,
  onError: (error: Error) => void
): () => void {
  let active = true;
  const load = () => {
    void listLocalPlaceReviews(placeId)
      .then((items) => {
        if (active) onData(items);
      })
      .catch((err) => {
        if (active) onError(err instanceof Error ? err : new Error(String(err)));
      });
  };

  load();
  const handleChange = () => load();
  window.addEventListener(LOCAL_CHANGE_EVENT, handleChange);
  return () => {
    active = false;
    window.removeEventListener(LOCAL_CHANGE_EVENT, handleChange);
  };
}

export async function createLocalPlaceWithInitialReview(input: {
  name: string;
  category: PlaceCategory;
  visitStatus?: VisitStatus;
  cuisineType?: string;
  mapsUrl?: string;
  initialRating?: 1 | 2 | 3 | 4 | 5;
  initialComment?: string;
  photos: string[];
}): Promise<string> {
  const placeId = generateId();
  const now = Date.now();
  const visitStatus: VisitStatus = input.visitStatus === 'wishlist' ? 'wishlist' : 'visited';

  const cleanName = input.name.trim().slice(0, STORAGE_LIMITS.NAME_MAX);
  const cleanCuisine = (input.cuisineType || '').trim().slice(0, STORAGE_LIMITS.CUISINE_TYPE_MAX);
  const cleanMapsUrl = (input.mapsUrl || '').trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX);
  const cleanComment = (input.initialComment || '').trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);

  if (visitStatus === 'wishlist') {
    const place: PlaceItem = {
      id: placeId,
      ownerId: LOCAL_OWNER_ID,
      authorName: 'Bu Cihaz',
      name: cleanName,
      category: input.category,
      visitStatus: 'wishlist',
      cuisineType: cleanCuisine,
      mapsUrl: cleanMapsUrl,
      coverImage: cleanPhotos[0] || '',
      latestComment: cleanComment,
      avgRating: 0,
      reviewCount: 0,
      ratingSum: 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const db = await openDb();
      const tx = db.transaction(STORE_PLACES, 'readwrite');
      tx.objectStore(STORE_PLACES).put(place);
      await txDone(tx);
    } catch {
      const data = readFallbackStore();
      data.places.unshift(place);
      writeFallbackStore(data);
    }

    notifyLocalChange();
    return placeId;
  }

  const reviewId = generateId();
  const rating: 1 | 2 | 3 | 4 | 5 = input.initialRating || 5;
  const finalComment = cleanComment.length >= STORAGE_LIMITS.COMMENT_MIN ? cleanComment : 'Ziyaret notu';

  const place: PlaceItem = {
    id: placeId,
    ownerId: LOCAL_OWNER_ID,
    authorName: 'Bu Cihaz',
    name: cleanName,
    category: input.category,
    visitStatus: 'visited',
    cuisineType: cleanCuisine,
    mapsUrl: cleanMapsUrl,
    coverImage: cleanPhotos[0] || '',
    latestComment: finalComment,
    avgRating: rating,
    reviewCount: 1,
    ratingSum: rating,
    createdAt: now,
    updatedAt: now,
  };

  const review: ReviewItem = {
    id: reviewId,
    ownerId: LOCAL_OWNER_ID,
    authorName: 'Bu Cihaz',
    placeId,
    rating,
    comment: finalComment,
    photos: cleanPhotos,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const db = await openDb();
    const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readwrite');
    tx.objectStore(STORE_PLACES).put(place);
    tx.objectStore(STORE_REVIEWS).put(review);
    await txDone(tx);
  } catch {
    const data = readFallbackStore();
    data.places.unshift(place);
    data.reviews.unshift(review);
    writeFallbackStore(data);
  }

  notifyLocalChange();
  return placeId;
}

export async function updateLocalPlaceMapsUrl(placeId: string, mapsUrl: string): Promise<void> {
  const cleanMapsUrl = mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX);
  const now = Date.now();

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PLACES, 'readwrite');
      const store = tx.objectStore(STORE_PLACES);
      const getReq = store.get(placeId);
      getReq.onsuccess = () => {
        const existing = getReq.result as (Partial<PlaceItem> & { id: string }) | undefined;
        if (!existing) {
          reject(new Error('Mekan bulunamadı.'));
          return;
        }
        const updated = normalizePlace(existing);
        updated.mapsUrl = cleanMapsUrl;
        updated.updatedAt = now;
        store.put(updated);
      };
      getReq.onerror = () => reject(getReq.error || new Error('Mekan güncellenemedi.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Yerel kayıt tamamlanamadı.'));
      tx.onabort = () => reject(tx.error || new Error('Yerel işlem iptal edildi.'));
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Mekan bulunamadı.') throw err;
    const data = readFallbackStore();
    const idx = data.places.findIndex((p) => p.id === placeId);
    if (idx === -1) throw new Error('Mekan bulunamadı.');
    data.places[idx] = { ...normalizePlace(data.places[idx]), mapsUrl: cleanMapsUrl, updatedAt: now };
    writeFallbackStore(data);
  }

  notifyLocalChange();
}

export async function updateLocalPlaceCuisineType(
  placeId: string,
  cuisineType: string
): Promise<void> {
  const cleanCuisine = cuisineType.trim().slice(0, STORAGE_LIMITS.CUISINE_TYPE_MAX);
  const now = Date.now();

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PLACES, 'readwrite');
      const store = tx.objectStore(STORE_PLACES);
      const getReq = store.get(placeId);
      getReq.onsuccess = () => {
        const existing = getReq.result as (Partial<PlaceItem> & { id: string }) | undefined;
        if (!existing) {
          reject(new Error('Mekan bulunamadı.'));
          return;
        }
        const updated = normalizePlace(existing);
        updated.cuisineType = cleanCuisine;
        updated.updatedAt = now;
        store.put(updated);
      };
      getReq.onerror = () => reject(getReq.error || new Error('Mekan güncellenemedi.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Yerel kayıt tamamlanamadı.'));
      tx.onabort = () => reject(tx.error || new Error('Yerel işlem iptal edildi.'));
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Mekan bulunamadı.') throw err;
    const data = readFallbackStore();
    const idx = data.places.findIndex((p) => p.id === placeId);
    if (idx === -1) throw new Error('Mekan bulunamadı.');
    data.places[idx] = { ...normalizePlace(data.places[idx]), cuisineType: cleanCuisine, updatedAt: now };
    writeFallbackStore(data);
  }

  notifyLocalChange();
}

export async function addLocalReviewToPlace(input: {
  placeId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
  photos: string[];
}): Promise<void> {
  const now = Date.now();
  const cleanComment = input.comment.trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);

  const review: ReviewItem = {
    id: generateId(),
    ownerId: LOCAL_OWNER_ID,
    authorName: 'Bu Cihaz',
    placeId: input.placeId,
    rating: input.rating,
    comment: cleanComment,
    photos: cleanPhotos,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readwrite');
      const placeStore = tx.objectStore(STORE_PLACES);
      const reviewStore = tx.objectStore(STORE_REVIEWS);

      const getReq = placeStore.get(input.placeId);
      getReq.onsuccess = () => {
        const existing = getReq.result as (Partial<PlaceItem> & { id: string }) | undefined;
        if (!existing) {
          reject(new Error('Mekan bulunamadı.'));
          return;
        }
        const place = normalizePlace(existing);
        const nextCount = place.reviewCount + 1;
        const nextSum = place.ratingSum + input.rating;
        place.reviewCount = nextCount;
        place.ratingSum = nextSum;
        place.avgRating = Math.round((nextSum / nextCount) * 100) / 100;
        place.latestComment = cleanComment;
        place.coverImage = place.coverImage || cleanPhotos[0] || '';
        place.visitStatus = 'visited';
        place.updatedAt = now;

        placeStore.put(place);
        reviewStore.put(review);
      };
      getReq.onerror = () => reject(getReq.error || new Error('Mekan okunamadı.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Yerel kayıt tamamlanamadı.'));
      tx.onabort = () => reject(tx.error || new Error('Yerel işlem iptal edildi.'));
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Mekan bulunamadı.') throw err;
    const data = readFallbackStore();
    const idx = data.places.findIndex((p) => p.id === input.placeId);
    if (idx === -1) throw new Error('Mekan bulunamadı.');
    const place = normalizePlace(data.places[idx]);
    const nextCount = place.reviewCount + 1;
    const nextSum = place.ratingSum + input.rating;
    place.reviewCount = nextCount;
    place.ratingSum = nextSum;
    place.avgRating = Math.round((nextSum / nextCount) * 100) / 100;
    place.latestComment = cleanComment;
    place.coverImage = place.coverImage || cleanPhotos[0] || '';
    place.visitStatus = 'visited';
    place.updatedAt = now;
    data.places[idx] = place;
    data.reviews.unshift(review);
    writeFallbackStore(data);
  }

  notifyLocalChange();
}

export async function deleteLocalReviewFromPlace(placeId: string, reviewId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readwrite');
      const placeStore = tx.objectStore(STORE_PLACES);
      const reviewStore = tx.objectStore(STORE_REVIEWS);

      reviewStore.delete(reviewId);
      const listReq = reviewStore.index('placeId').getAll(placeId);
      listReq.onsuccess = () => {
        const allReviews = (listReq.result || []) as Array<
          Partial<ReviewItem> & { id: string; placeId: string }
        >;
        const remaining = allReviews
          .filter((r) => r.id !== reviewId)
          .map(normalizeReview)
          .sort((a, b) => b.createdAt - a.createdAt);

        const placeReq = placeStore.get(placeId);
        placeReq.onsuccess = () => {
          const existing = placeReq.result as (Partial<PlaceItem> & { id: string }) | undefined;
          if (existing) {
            const place = normalizePlace(existing);
            const nextCount = remaining.length;
            const nextSum = remaining.reduce((acc, r) => acc + r.rating, 0);
            place.reviewCount = nextCount;
            place.ratingSum = nextSum;
            place.avgRating = nextCount > 0 ? Math.round((nextSum / nextCount) * 100) / 100 : 0;
            place.latestComment = remaining[0]?.comment ?? '';
            place.updatedAt = Date.now();
            placeStore.put(place);
          }
        };
      };
      listReq.onerror = () => reject(listReq.error || new Error('Yorum silinemedi.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Yerel kayıt tamamlanamadı.'));
      tx.onabort = () => reject(tx.error || new Error('Yerel işlem iptal edildi.'));
    });
  } catch {
    const data = readFallbackStore();
    data.reviews = data.reviews.filter((r) => r.id !== reviewId);
    const remaining = data.reviews
      .filter((r) => r.placeId === placeId)
      .map(normalizeReview)
      .sort((a, b) => b.createdAt - a.createdAt);
    const idx = data.places.findIndex((p) => p.id === placeId);
    if (idx !== -1) {
      const place = normalizePlace(data.places[idx]);
      const nextCount = remaining.length;
      const nextSum = remaining.reduce((acc, r) => acc + r.rating, 0);
      place.reviewCount = nextCount;
      place.ratingSum = nextSum;
      place.avgRating = nextCount > 0 ? Math.round((nextSum / nextCount) * 100) / 100 : 0;
      place.latestComment = remaining[0]?.comment ?? '';
      place.updatedAt = Date.now();
      data.places[idx] = place;
    }
    writeFallbackStore(data);
  }

  notifyLocalChange();
}

export async function deleteLocalPlace(placeId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readwrite');
      const placeStore = tx.objectStore(STORE_PLACES);
      const reviewStore = tx.objectStore(STORE_REVIEWS);

      const revReq = reviewStore.index('placeId').getAll(placeId);
      revReq.onsuccess = () => {
        const reviews = (revReq.result || []) as Array<{ id: string }>;
        for (const rev of reviews) {
          reviewStore.delete(rev.id);
        }
        placeStore.delete(placeId);
      };
      revReq.onerror = () => reject(revReq.error || new Error('Mekan silinemedi.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Yerel kayıt tamamlanamadı.'));
      tx.onabort = () => reject(tx.error || new Error('Yerel işlem iptal edildi.'));
    });
  } catch {
    const data = readFallbackStore();
    data.places = data.places.filter((p) => p.id !== placeId);
    data.reviews = data.reviews.filter((r) => r.placeId !== placeId);
    writeFallbackStore(data);
  }

  notifyLocalChange();
}

export async function exportDatabaseBackup(): Promise<{
  version: number;
  exportedAt: string;
  places: LegacyLocalPlace[];
  reviews: LegacyLocalReview[];
}> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readonly');
    const [places, reviews] = await Promise.all([
      reqToPromise<LegacyLocalPlace[]>(tx.objectStore(STORE_PLACES).getAll()),
      reqToPromise<LegacyLocalReview[]>(tx.objectStore(STORE_REVIEWS).getAll()),
    ]);

    return {
      version: 4,
      exportedAt: new Date().toISOString(),
      places,
      reviews,
    };
  } catch {
    const data = readFallbackStore();
    return {
      version: 4,
      exportedAt: new Date().toISOString(),
      places: data.places,
      reviews: data.reviews,
    };
  }
}

export async function importBackupToLocal(jsonText: string): Promise<number> {
  const parsed = JSON.parse(jsonText) as {
    places?: Array<Partial<PlaceItem>>;
    reviews?: Array<Partial<ReviewItem>>;
  };
  if (!parsed || !Array.isArray(parsed.places)) {
    throw new Error('Geçersiz yedek dosyası formatı.');
  }

  const reviewsByPlace = new Map<
    string,
    Array<{ rating: 1 | 2 | 3 | 4 | 5; comment: string; photos: string[] }>
  >();

  if (Array.isArray(parsed.reviews)) {
    for (const r of parsed.reviews) {
      if (r && typeof r.placeId === 'string' && typeof r.comment === 'string') {
        const list = reviewsByPlace.get(r.placeId) || [];
        list.push({
          rating:
            r.rating === 1 || r.rating === 2 || r.rating === 3 || r.rating === 4 || r.rating === 5
              ? r.rating
              : 5,
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
    const relatedReviews = p.id ? reviewsByPlace.get(p.id) || [] : [];
    const firstRev = relatedReviews[0];
    const isWishlist = p.visitStatus === 'wishlist' && relatedReviews.length === 0;
    const comment = (firstRev?.comment || p.latestComment || (isWishlist ? '' : 'Ziyaret notu')).trim();
    const avg = typeof p.avgRating === 'number' ? p.avgRating : 5;
    const rating: 1 | 2 | 3 | 4 | 5 =
      firstRev?.rating ||
      (avg >= 4.5 ? 5 : avg >= 3.5 ? 4 : avg >= 2.5 ? 3 : avg >= 1.5 ? 2 : 1);

    await createLocalPlaceWithInitialReview({
      name: p.name,
      category:
        p.category === 'restaurant' ||
        p.category === 'cafe' ||
        p.category === 'bakery' ||
        p.category === 'bistro'
          ? p.category
          : 'restaurant',
      visitStatus: isWishlist ? 'wishlist' : 'visited',
      cuisineType: typeof p.cuisineType === 'string' ? p.cuisineType : '',
      mapsUrl: typeof p.mapsUrl === 'string' ? p.mapsUrl : '',
      initialRating: rating,
      initialComment: isWishlist ? comment : comment.length >= 2 ? comment : 'Ziyaret notu',
      photos: firstRev?.photos || (p.coverImage ? [p.coverImage] : []),
    });
    imported += 1;
  }

  return imported;
}

export async function clearLegacyLocalDatabase(): Promise<void> {
  writeFallbackStore({ places: [], reviews: [] });
  try {
    const db = await openDb();
    const storeNames = [STORE_PLACES, STORE_REVIEWS].filter((s) =>
      db.objectStoreNames.contains(s)
    );
    if (storeNames.length === 0) return;
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    await txDone(tx);
  } catch {
    // Ignore IDB clear failure when fallback already cleared
  }
  notifyLocalChange();
}
