import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
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

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return Date.now();
}

function mapPlaceDoc(id: string, data: DocumentData): PlaceItem {
  return {
    id,
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : '',
    authorName:
      typeof data.authorName === 'string' && data.authorName.trim()
        ? data.authorName.trim().slice(0, STORAGE_LIMITS.AUTHOR_NAME_MAX)
        : 'Kullanıcı',
    name: typeof data.name === 'string' ? data.name : 'Mekan',
    category:
      data.category === 'restaurant' ||
      data.category === 'cafe' ||
      data.category === 'bakery' ||
      data.category === 'bistro'
        ? data.category
        : 'restaurant',
    mapsUrl: typeof data.mapsUrl === 'string' ? data.mapsUrl : '',
    coverImage: typeof data.coverImage === 'string' ? data.coverImage : '',
    latestComment: typeof data.latestComment === 'string' ? data.latestComment : '',
    avgRating: typeof data.avgRating === 'number' ? data.avgRating : 0,
    reviewCount: typeof data.reviewCount === 'number' ? data.reviewCount : 0,
    ratingSum: typeof data.ratingSum === 'number' ? data.ratingSum : 0,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function mapReviewDoc(id: string, data: DocumentData): ReviewItem {
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
  mapsUrl?: string;
  initialRating: 1 | 2 | 3 | 4 | 5;
  initialComment: string;
  photos: string[];
}

export async function createPlaceWithInitialReview(
  userId: string,
  authorName: string,
  input: CreatePlaceInput
): Promise<string> {
  const placeId = generateId();
  const reviewId = generateId();
  const placePath = `places/${placeId}`;
  const reviewPath = `places/${placeId}/reviews/${reviewId}`;

  const cleanAuthor = resolveSafeAuthorName(authorName);
  const cleanName = input.name.trim().slice(0, STORAGE_LIMITS.NAME_MAX);
  const cleanMapsUrl = (input.mapsUrl || '').trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX);
  const cleanComment = input.initialComment.trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);
  const coverImage = cleanPhotos[0] || '';

  const batch = writeBatch(db);
  batch.set(doc(db, placePath), {
    ownerId: userId,
    authorName: cleanAuthor,
    visibility: 'shared',
    name: cleanName,
    category: input.category,
    mapsUrl: cleanMapsUrl,
    coverImage,
    latestComment: cleanComment,
    avgRating: input.initialRating,
    reviewCount: 1,
    ratingSum: input.initialRating,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, reviewPath), {
    ownerId: userId,
    authorName: cleanAuthor,
    visibility: 'shared',
    placeId,
    rating: input.initialRating,
    comment: cleanComment,
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
  mapsUrl: string
): Promise<void> {
  const placePath = `places/${placeId}`;
  try {
    await updateDoc(doc(db, placePath), {
      mapsUrl: mapsUrl.trim().slice(0, STORAGE_LIMITS.MAPS_URL_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, placePath);
  }
}

export interface AddReviewInput {
  placeId: string;
  rating: 1 | 2 | 3 | 4 | 5;
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

  const cleanAuthor = resolveSafeAuthorName(authorName);
  const cleanComment = input.comment.trim().slice(0, STORAGE_LIMITS.COMMENT_MAX);
  const cleanPhotos = input.photos
    .filter((p) => typeof p === 'string' && p.length <= 160000)
    .slice(0, STORAGE_LIMITS.MAX_PHOTOS);

  try {
    await runTransaction(db, async (tx) => {
      const placeRef = doc(db, placePath);
      const snap = await tx.get(placeRef);
      if (!snap.exists()) {
        throw new Error('Mekan bulunamadı.');
      }

      const data = snap.data();
      const nextCount = (typeof data.reviewCount === 'number' ? data.reviewCount : 0) + 1;
      const nextSum = (typeof data.ratingSum === 'number' ? data.ratingSum : 0) + input.rating;
      const nextAvg = Math.round((nextSum / nextCount) * 100) / 100;
      const existingCover = typeof data.coverImage === 'string' ? data.coverImage : '';
      const nextCover = existingCover || cleanPhotos[0] || '';

      tx.set(doc(db, reviewPath), {
        ownerId: userId,
        authorName: cleanAuthor,
        visibility: 'shared',
        placeId: input.placeId,
        rating: input.rating,
        comment: cleanComment,
        photos: cleanPhotos,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.update(placeRef, {
        avgRating: nextAvg,
        reviewCount: nextCount,
        ratingSum: nextSum,
        latestComment: cleanComment,
        coverImage: nextCover,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, placePath);
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
    const nextLatestComment = remaining[0]?.comment ?? '';

    const batch = writeBatch(db);
    batch.delete(doc(db, reviewPath));
    batch.update(doc(db, placePath), {
      avgRating: nextAvg,
      reviewCount: nextCount,
      ratingSum: nextSum,
      latestComment: nextLatestComment,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, reviewPath);
  }
}

export async function deletePlace(userId: string, placeId: string): Promise<void> {
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
        mapsUrl: p.mapsUrl,
        initialRating: firstRev?.rating || 5,
        initialComment:
          firstRev?.comment ||
          (p.latestComment.length >= 2 ? p.latestComment : 'Ziyaret notu'),
        photos: firstRev?.photos || (p.coverImage ? [p.coverImage] : []),
      });

      for (const extraRev of reviews.slice(1)) {
        await addReviewToPlace(userId, authorName, {
          placeId: newPlaceId,
          rating: extraRev.rating,
          comment: extraRev.comment,
          photos: extraRev.photos,
        });
      }

      // Clean up legacy personal docs after successful copy
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

export async function exportFirestoreBackup(): Promise<BackupPayload> {
  const placesPath = 'places';
  try {
    const placesSnap = await getDocs(
      query(collection(db, placesPath), where('visibility', '==', 'shared'))
    );
    const places = placesSnap.docs.map((d) => mapPlaceDoc(d.id, d.data()));
    const reviewSnaps = await Promise.all(
      places.map((p) =>
        getDocs(query(collection(db, `${placesPath}/${p.id}/reviews`), where('visibility', '==', 'shared')))
      )
    );
    const reviews = reviewSnaps.flatMap((snap) =>
      snap.docs.map((d) => mapReviewDoc(d.id, d.data()))
    );

    return {
      version: 3,
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
    const relatedReviews = reviewsByPlace.get(p.id) || [];
    const firstRev = relatedReviews[0];
    const comment = (firstRev?.comment || p.latestComment || 'Ziyaret notu').trim();
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

    const placeId = await createPlaceWithInitialReview(userId, authorName, {
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

    for (const extraRev of relatedReviews.slice(1)) {
      await addReviewToPlace(userId, authorName, {
        placeId,
        rating: extraRev.rating,
        comment: extraRev.comment.trim().length >= 2 ? extraRev.comment : 'Ziyaret notu',
        photos: extraRev.photos,
      });
    }

    imported += 1;
  }

  return imported;
}
