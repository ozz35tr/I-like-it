import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import {
  STORAGE_LIMITS,
  type PlaceCategory,
  type PlaceItem,
  type ReviewItem,
  type VisitStatus,
} from '../types/place';
import { db, handleFirestoreError, OperationType } from './firebase';

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

export function subscribePlaces(
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  const path = 'places';
  const q = query(collection(db, path), where('visibility', '==', 'shared'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => mapPlaceDoc(d.id, d.data()))
        .filter((p) => !(p.visitStatus === 'wishlist' && p.reviewCount === 0))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeUserWishlistPlaces(
  userId: string,
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  const path = `users/${userId}/wishlist`;
  const q = query(collection(db, path), where('ownerId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          ...mapPlaceDoc(d.id, d.data()),
          visitStatus: 'wishlist' as const,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function migrateLegacySharedWishlistToPrivate(userId: string): Promise<number> {
  const path = 'places';
  try {
    const snap = await getDocs(
      query(collection(db, path), where('visibility', '==', 'shared'))
    );
    const legacyOwnWishlistDocs = snap.docs.filter((d) => {
      const data = d.data();
      return (
        data.ownerId === userId &&
        data.visitStatus === 'wishlist' &&
        (typeof data.reviewCount !== 'number' || data.reviewCount === 0)
      );
    });

    if (legacyOwnWishlistDocs.length === 0) return 0;

    let migrated = 0;
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

        batch.set(doc(db, `users/${userId}/wishlist/${legacyDoc.id}`), {
          ownerId: userId,
          authorName: resolveSafeAuthorName(
            typeof data.authorName === 'string' ? data.authorName : undefined
          ),
          visibility: 'private',
          name: cleanName,
          category: normalizeCategory(data.category),
          visitStatus: 'wishlist',
          cuisineType,
          cuisineTypes,
          locationArea:
            typeof data.locationArea === 'string'
              ? data.locationArea.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX)
              : '',
          lat: normalizeCoord(data.lat, -90, 90),
          lng: normalizeCoord(data.lng, -180, 180),
          mapsUrl:
            typeof data.mapsUrl === 'string'
              ? data.mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX)
              : '',
          coverImage:
            typeof data.coverImage === 'string' ? data.coverImage.slice(0, 160000) : '',
          latestComment:
            typeof data.latestComment === 'string'
              ? data.latestComment.slice(0, STORAGE_LIMITS.COMMENT_MAX)
              : '',
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
      }

      await batch.commit();
    }

    return migrated;
  } catch {
    return 0;
  }
}

export function subscribePlaceReviews(
  placeId: string,
  onData: (reviews: ReviewItem[]) => void,
  onError: (error: Error) => void
): () => void {
  const path = `places/${placeId}/reviews`;
  const q = query(collection(db, path), where('visibility', '==', 'shared'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => mapReviewDoc(d.id, d.data()))
        .sort((a, b) => b.createdAt - a.createdAt);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
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
  const { cuisineTypes, cuisineType } = normalizeCuisineTags(input.cuisineTypes, input.cuisineType);
  const cleanLocationArea = (input.locationArea || '').trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX);
  const cleanLat = normalizeCoord(input.lat, -90, 90);
  const cleanLng = normalizeCoord(input.lng, -180, 180);
  const cleanMapsUrl = (input.mapsUrl || '').trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX);
  const cleanComment = (input.initialComment || '').trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);
  const coverImage = cleanPhotos[0] || '';

  if (visitStatus === 'wishlist') {
    const wishlistPath = `users/${userId}/wishlist/${placeId}`;
    try {
      await setDoc(doc(db, wishlistPath), {
        ownerId: userId,
        authorName: cleanAuthor,
        visibility: 'private',
        name: cleanName,
        category: normalizeCategory(input.category),
        visitStatus: 'wishlist',
        cuisineType,
        cuisineTypes,
        locationArea: cleanLocationArea,
        lat: cleanLat,
        lng: cleanLng,
        mapsUrl: cleanMapsUrl,
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
    category: normalizeCategory(input.category),
    visitStatus: 'visited',
    cuisineType,
    cuisineTypes,
    locationArea: cleanLocationArea,
    lat: cleanLat,
    lng: cleanLng,
    mapsUrl: cleanMapsUrl,
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
    return placeId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, placePath);
  }
}

export async function updatePlaceMapsUrl(
  placeId: string,
  mapsUrl: string,
  userId?: string,
  isWishlist?: boolean
): Promise<void> {
  const placePath =
    isWishlist && userId ? `users/${userId}/wishlist/${placeId}` : `places/${placeId}`;
  try {
    await updateDoc(doc(db, placePath), {
      mapsUrl: mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX),
      updatedAt: serverTimestamp(),
    });
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

  if (input.cuisineTypes !== undefined || input.cuisineType !== undefined) {
    const { cuisineTypes, cuisineType } = normalizeCuisineTags(input.cuisineTypes, input.cuisineType);
    payload.cuisineTypes = cuisineTypes;
    payload.cuisineType = cuisineType;
  }
  if (input.locationArea !== undefined) {
    payload.locationArea = input.locationArea.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX);
  }
  if (input.category !== undefined) {
    payload.category = normalizeCategory(input.category);
  }
  if (input.lat !== undefined) {
    payload.lat = normalizeCoord(input.lat, -90, 90);
  }
  if (input.lng !== undefined) {
    payload.lng = normalizeCoord(input.lng, -180, 180);
  }

  try {
    await updateDoc(doc(db, placePath), payload);
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

  try {
    await runTransaction(db, async (tx) => {
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
        return;
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

      tx.set(placeRef, {
        ownerId: userId,
        authorName: resolveSafeAuthorName(
          typeof wishData.authorName === 'string' ? wishData.authorName : cleanAuthor
        ),
        visibility: 'shared',
        name: wishName,
        category: normalizeCategory(wishData.category),
        visitStatus: 'visited',
        cuisineType,
        cuisineTypes,
        locationArea:
          typeof wishData.locationArea === 'string'
            ? wishData.locationArea.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX)
            : '',
        lat: normalizeCoord(wishData.lat, -90, 90),
        lng: normalizeCoord(wishData.lng, -180, 180),
        mapsUrl:
          typeof wishData.mapsUrl === 'string'
            ? wishData.mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX)
            : '',
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
    });
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
    const reviewsSnap = await getDocs(
      query(collection(db, reviewsPath), where('visibility', '==', 'shared'))
    );
    const allReviews = reviewsSnap.docs.map((d) => {
      const mapped = mapReviewDoc(d.id, d.data());
      if (d.id === input.reviewId) {
        return {
          ...mapped,
          rating: input.rating,
          ...(cleanPriceRating ? { priceRating: cleanPriceRating } : {}),
          comment: cleanComment,
          photos: cleanPhotos,
          updatedAt: Date.now(),
        };
      }
      return mapped;
    });
    allReviews.sort((a, b) => b.createdAt - a.createdAt);

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
    const reviewsSnap = await getDocs(
      query(collection(db, reviewsPath), where('visibility', '==', 'shared'))
    );
    const remaining = reviewsSnap.docs
      .filter((d) => d.id !== reviewId)
      .map((d) => mapReviewDoc(d.id, d.data()))
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
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, reviewPath);
  }
}

export async function deletePlace(
  userId: string,
  placeId: string,
  isWishlist?: boolean
): Promise<void> {
  if (isWishlist) {
    const wishPath = `users/${userId}/wishlist/${placeId}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, wishPath));
      await batch.commit();
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, wishPath);
    }
  }

  const placePath = `places/${placeId}`;
  const reviewsPath = `${placePath}/reviews`;

  try {
    const reviewsSnap = await getDocs(
      query(collection(db, reviewsPath), where('visibility', '==', 'shared'))
    );
    const batch = writeBatch(db);
    reviewsSnap.docs.forEach((d) => {
      if (d.data().ownerId === userId) {
        batch.delete(d.ref);
      }
    });
    batch.delete(doc(db, placePath));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, placePath);
  }
}

export function subscribeFirestoreHiddenWishlistIds(
  userId: string,
  onData: (ids: string[]) => void,
  onError?: (error: Error) => void
): () => void {
  const prefPath = `users/${userId}/preferences/wishlist`;
  return onSnapshot(
    doc(db, prefPath),
    (snap) => {
      if (!snap.exists()) {
        onData([]);
        return;
      }
      const data = snap.data();
      const ids = Array.isArray(data.hiddenPlaceIds)
        ? data.hiddenPlaceIds.filter(
            (x): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x)
          )
        : [];
      onData(ids);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, prefPath);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
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
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(prefRef);
      const existingIds =
        snap.exists() && Array.isArray(snap.data().hiddenPlaceIds)
          ? (snap.data().hiddenPlaceIds as unknown[]).filter(
              (id): id is string =>
                typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)
            )
          : [];

      const nextIds = hide
        ? Array.from(new Set([...existingIds, placeId])).slice(0, 500)
        : existingIds.filter((id) => id !== placeId);

      if (!snap.exists()) {
        tx.set(prefRef, {
          ownerId: userId,
          hiddenPlaceIds: nextIds,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(prefRef, {
          hiddenPlaceIds: nextIds,
          updatedAt: serverTimestamp(),
        });
      }

      return nextIds;
    });
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
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, prefPath);
  }
}

export async function countLegacyPersonalCloudPlaces(userId: string): Promise<number> {
  const legacyPath = `users/${userId}/places`;
  try {
    const snap = await getDocs(
      query(collection(db, legacyPath), where('ownerId', '==', userId))
    );
    return snap.size;
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
      query(collection(db, legacyPath), where('ownerId', '==', userId))
    );
    if (placesSnap.empty) return 0;

    let migrated = 0;
    for (const pDoc of placesSnap.docs) {
      const p = mapPlaceDoc(pDoc.id, pDoc.data());
      const reviewsPath = `${legacyPath}/${pDoc.id}/reviews`;
      const revSnap = await getDocs(
        query(collection(db, reviewsPath), where('ownerId', '==', userId))
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
    const placesSnap = await getDocs(
      query(collection(db, placesPath), where('visibility', '==', 'shared'))
    );
    const sharedVisitedPlaces = placesSnap.docs
      .map((d) => mapPlaceDoc(d.id, d.data()))
      .filter((p) => !(p.visitStatus === 'wishlist' && p.reviewCount === 0));

    let wishlistPlaces: PlaceItem[] = [];
    if (userId) {
      const wishSnap = await getDocs(
        query(collection(db, `users/${userId}/wishlist`), where('ownerId', '==', userId))
      );
      wishlistPlaces = wishSnap.docs.map((d) => ({
        ...mapPlaceDoc(d.id, d.data()),
        visitStatus: 'wishlist' as const,
      }));
    }

    const places = [...sharedVisitedPlaces, ...wishlistPlaces];
    const reviewSnaps = await Promise.all(
      sharedVisitedPlaces.map((p) =>
        getDocs(query(collection(db, `${placesPath}/${p.id}/reviews`), where('visibility', '==', 'shared')))
      )
    );
    const reviews = reviewSnaps.flatMap((snap) =>
      snap.docs.map((d) => mapReviewDoc(d.id, d.data()))
    );

    return {
      version: 5,
      exportedAt: new Date().toISOString(),
      places,
      reviews,
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
