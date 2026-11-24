import {
  STORAGE_LIMITS,
  type PlaceCategory,
  type PlaceItem,
  type ReviewItem,
} from '../types/place';

export interface LegacyLocalPlace {
  id: string;
  name: string;
  category?: string;
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Yerel veritabanı açılamadı.'));
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

  return {
    id: raw.id,
    ownerId: typeof raw.ownerId === 'string' && raw.ownerId ? raw.ownerId : LOCAL_OWNER_ID,
    authorName:
      typeof raw.authorName === 'string' && raw.authorName.trim()
        ? raw.authorName.trim().slice(0, STORAGE_LIMITS.AUTHOR_NAME_MAX)
        : 'Bu Cihaz',
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Mekan',
    category,
    mapsUrl: typeof raw.mapsUrl === 'string' ? raw.mapsUrl : '',
    coverImage: typeof raw.coverImage === 'string' ? raw.coverImage : '',
    latestComment: typeof raw.latestComment === 'string' ? raw.latestComment : '',
    avgRating: typeof raw.avgRating === 'number' && Number.isFinite(raw.avgRating) ? raw.avgRating : 0,
    reviewCount: typeof raw.reviewCount === 'number' && Number.isFinite(raw.reviewCount) ? raw.reviewCount : 1,
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
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  if (!db.objectStoreNames.contains(STORE_PLACES)) return [];
  const tx = db.transaction(STORE_PLACES, 'readonly');
  const raw = await reqToPromise<Array<Partial<PlaceItem> & { id: string }>>(
    tx.objectStore(STORE_PLACES).getAll()
  );
  return raw.map(normalizePlace).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listLocalPlaceReviews(placeId: string): Promise<ReviewItem[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  if (!db.objectStoreNames.contains(STORE_REVIEWS)) return [];
  const tx = db.transaction(STORE_REVIEWS, 'readonly');
  const index = tx.objectStore(STORE_REVIEWS).index('placeId');
  const raw = await reqToPromise<Array<Partial<ReviewItem> & { id: string; placeId: string }>>(
    index.getAll(placeId)
  );
  return raw.map(normalizeReview).sort((a, b) => b.createdAt - a.createdAt);
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
  mapsUrl?: string;
  initialRating: 1 | 2 | 3 | 4 | 5;
  initialComment: string;
  photos: string[];
}): Promise<string> {
  const db = await openDb();
  const placeId = generateId();
  const reviewId = generateId();
  const now = Date.now();

  const cleanName = input.name.trim().slice(0, STORAGE_LIMITS.NAME_MAX);
  const cleanMapsUrl = (input.mapsUrl || '').trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX);
  const cleanComment = input.initialComment.trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);

  const place: PlaceItem = {
    id: placeId,
    ownerId: LOCAL_OWNER_ID,
    authorName: 'Bu Cihaz',
    name: cleanName,
    category: input.category,
    mapsUrl: cleanMapsUrl,
    coverImage: cleanPhotos[0] || '',
    latestComment: cleanComment,
    avgRating: input.initialRating,
    reviewCount: 1,
    ratingSum: input.initialRating,
    createdAt: now,
    updatedAt: now,
  };

  const review: ReviewItem = {
    id: reviewId,
    ownerId: LOCAL_OWNER_ID,
    authorName: 'Bu Cihaz',
    placeId,
    rating: input.initialRating,
    comment: cleanComment,
    photos: cleanPhotos,
    createdAt: now,
    updatedAt: now,
  };

  const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readwrite');
  tx.objectStore(STORE_PLACES).put(place);
  tx.objectStore(STORE_REVIEWS).put(review);
  await txDone(tx);
  notifyLocalChange();
  return placeId;
}

export async function updateLocalPlaceMapsUrl(placeId: string, mapsUrl: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PLACES, 'readwrite');
  const store = tx.objectStore(STORE_PLACES);
  const existing = await reqToPromise<(Partial<PlaceItem> & { id: string }) | undefined>(
    store.get(placeId)
  );
  if (!existing) throw new Error('Mekan bulunamadı.');

  const updated = normalizePlace(existing);
  updated.mapsUrl = mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX);
  updated.updatedAt = Date.now();
  store.put(updated);
  await txDone(tx);
  notifyLocalChange();
}

export async function addLocalReviewToPlace(input: {
  placeId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
  photos: string[];
}): Promise<void> {
  const db = await openDb();
  const now = Date.now();
  const cleanComment = input.comment.trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);

  const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readwrite');
  const placeStore = tx.objectStore(STORE_PLACES);
  const reviewStore = tx.objectStore(STORE_REVIEWS);

  const existing = await reqToPromise<(Partial<PlaceItem> & { id: string }) | undefined>(
    placeStore.get(input.placeId)
  );
  if (!existing) throw new Error('Mekan bulunamadı.');

  const place = normalizePlace(existing);
  const nextCount = place.reviewCount + 1;
  const nextSum = place.ratingSum + input.rating;
  place.reviewCount = nextCount;
  place.ratingSum = nextSum;
  place.avgRating = Math.round((nextSum / nextCount) * 100) / 100;
  place.latestComment = cleanComment;
  place.coverImage = place.coverImage || cleanPhotos[0] || '';
  place.updatedAt = now;

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

  placeStore.put(place);
  reviewStore.put(review);
  await txDone(tx);
  notifyLocalChange();
}

export async function deleteLocalReviewFromPlace(placeId: string, reviewId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readwrite');
  const placeStore = tx.objectStore(STORE_PLACES);
  const reviewStore = tx.objectStore(STORE_REVIEWS);

  reviewStore.delete(reviewId);
  const allReviews = await reqToPromise<Array<Partial<ReviewItem> & { id: string; placeId: string }>>(
    reviewStore.index('placeId').getAll(placeId)
  );
  const remaining = allReviews
    .filter((r) => r.id !== reviewId)
    .map(normalizeReview)
    .sort((a, b) => b.createdAt - a.createdAt);

  const existing = await reqToPromise<(Partial<PlaceItem> & { id: string }) | undefined>(
    placeStore.get(placeId)
  );
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

  await txDone(tx);
  notifyLocalChange();
}

export async function deleteLocalPlace(placeId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readwrite');
  const placeStore = tx.objectStore(STORE_PLACES);
  const reviewStore = tx.objectStore(STORE_REVIEWS);

  const reviews = await reqToPromise<Array<{ id: string }>>(
    reviewStore.index('placeId').getAll(placeId)
  );
  for (const rev of reviews) {
    reviewStore.delete(rev.id);
  }
  placeStore.delete(placeId);
  await txDone(tx);
  notifyLocalChange();
}

export async function exportDatabaseBackup(): Promise<{
  version: number;
  exportedAt: string;
  places: LegacyLocalPlace[];
  reviews: LegacyLocalReview[];
}> {
  const db = await openDb();
  const tx = db.transaction([STORE_PLACES, STORE_REVIEWS], 'readonly');
  const [places, reviews] = await Promise.all([
    reqToPromise<LegacyLocalPlace[]>(tx.objectStore(STORE_PLACES).getAll()),
    reqToPromise<LegacyLocalReview[]>(tx.objectStore(STORE_REVIEWS).getAll()),
  ]);

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    places,
    reviews,
  };
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
    const comment = (firstRev?.comment || p.latestComment || 'Ziyaret notu').trim();
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
      mapsUrl: typeof p.mapsUrl === 'string' ? p.mapsUrl : '',
      initialRating: rating,
      initialComment: comment.length >= 2 ? comment : 'Ziyaret notu',
      photos: firstRev?.photos || (p.coverImage ? [p.coverImage] : []),
    });
    imported += 1;
  }

  return imported;
}

export async function clearLegacyLocalDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
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
  notifyLocalChange();
}
