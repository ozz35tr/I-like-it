import type { PlaceItem, ReviewItem } from '../types/place';
import {
  addLocalReviewToPlace,
  createLocalPlaceWithInitialReview,
  deleteLocalPlace,
  deleteLocalReviewFromPlace,
  exportDatabaseBackup,
  importBackupToLocal,
  readLocalHiddenWishlistIds,
  subscribeLocalPlaceReviews,
  subscribeLocalPlaces,
  updateLocalPlaceMapsUrl,
  updateLocalPlacePromoUrl,
  updateLocalPlaceTagsAndLocation,
  updateLocalReviewInPlace,
} from './localDb';
import {
  addExistingPlaceToWishlist,
  addReviewToPlace,
  clearFirestoreReadCaches,
  createPlaceWithInitialReview,
  deletePlace,
  deleteReviewFromPlace,
  exportFirestoreBackup,
  importBackupToFirestore,
  subscribeFirestoreHiddenWishlistIds,
  subscribePlaceReviews,
  subscribePlaces,
  subscribeUserWishlistPlaces,
  toggleFirestoreWishlistPlaceHidden,
  updatePlaceMapsUrl,
  updatePlacePromoUrl,
  updatePlaceTagsAndLocation,
  updateReviewInPlace,
  type AddReviewInput,
  type CreatePlaceInput,
  type UpdatePlaceTagsAndLocationInput,
  type UpdateReviewInput,
} from './placesService';

export { clearFirestoreReadCaches };

export interface CloudActor {
  uid: string;
  authorName: string;
}

export function isLocalDeviceRecord(ownerId?: string | null): boolean {
  return ownerId === 'local-device';
}

function mergePlaces(cloudPlaces: PlaceItem[], localPlaces: PlaceItem[]): PlaceItem[] {
  const map = new Map<string, PlaceItem>();
  for (const item of localPlaces) {
    map.set(item.id, item);
  }
  for (const item of cloudPlaces) {
    map.set(item.id, item);
  }
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function mergeReviews(cloudReviews: ReviewItem[], localReviews: ReviewItem[]): ReviewItem[] {
  const map = new Map<string, ReviewItem>();
  for (const item of localReviews) {
    map.set(item.id, item);
  }
  for (const item of cloudReviews) {
    map.set(item.id, item);
  }
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function isPublicVisitedPlace(place: { visitStatus?: string; reviewCount?: number }): boolean {
  return !(place.visitStatus === 'wishlist' && (place.reviewCount ?? 0) === 0);
}

export function subscribeUserOrLocalPlaces(
  actor: CloudActor | null | undefined,
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  if (actor) {
    let sharedPlaces: PlaceItem[] = [];
    let wishlistPlaces: PlaceItem[] = [];
    let sharedReady = false;
    let wishlistReady = false;

    const emit = () => {
      if (sharedReady || wishlistReady) {
        onData([...sharedPlaces, ...wishlistPlaces].sort((a, b) => b.updatedAt - a.updatedAt));
      }
    };

    const unsubShared = subscribePlaces(
      (items) => {
        sharedPlaces = items.filter(isPublicVisitedPlace);
        sharedReady = true;
        emit();
      },
      (err) => {
        sharedReady = true;
        if (wishlistReady) {
          emit();
        } else {
          onError(err);
        }
      }
    );

    const unsubWishlist = subscribeUserWishlistPlaces(
      actor.uid,
      (items) => {
        wishlistPlaces = items;
        wishlistReady = true;
        emit();
      },
      (err) => {
        wishlistReady = true;
        if (sharedReady) {
          emit();
        }
        onError(err);
      }
    );

    return () => {
      unsubShared();
      unsubWishlist();
    };
  }

  let cloudPlaces: PlaceItem[] = [];
  let localPlaces: PlaceItem[] = [];
  let cloudReady = false;
  let localReady = false;

  const emit = () => {
    if (cloudReady || localReady) {
      onData(
        mergePlaces(
          cloudPlaces.filter(isPublicVisitedPlace),
          localPlaces.filter(isPublicVisitedPlace)
        )
      );
    }
  };

  const unsubCloud = subscribePlaces(
    (items) => {
      cloudPlaces = items.filter(isPublicVisitedPlace);
      cloudReady = true;
      emit();
    },
    (err) => {
      cloudReady = true;
      if (localReady && localPlaces.some(isPublicVisitedPlace)) {
        emit();
      } else {
        onError(err);
      }
    }
  );

  const unsubLocal = subscribeLocalPlaces(
    (items) => {
      localPlaces = items.filter(isPublicVisitedPlace);
      localReady = true;
      emit();
    },
    () => {
      localReady = true;
      emit();
    }
  );

  return () => {
    unsubCloud();
    unsubLocal();
  };
}

export function subscribeUserOrLocalPlaceReviews(
  actor: CloudActor | null | undefined,
  placeId: string,
  onData: (reviews: ReviewItem[]) => void,
  onError: (error: Error) => void
): () => void {
  if (actor) {
    return subscribePlaceReviews(placeId, onData, onError);
  }

  let cloudReviews: ReviewItem[] = [];
  let localReviews: ReviewItem[] = [];
  let cloudReady = false;
  let localReady = false;

  const emit = () => {
    if (cloudReady || localReady) {
      onData(mergeReviews(cloudReviews, localReviews));
    }
  };

  const unsubCloud = subscribePlaceReviews(
    placeId,
    (items) => {
      cloudReviews = items;
      cloudReady = true;
      emit();
    },
    (err) => {
      cloudReady = true;
      if (localReady && localReviews.length > 0) {
        emit();
      } else {
        onError(err);
      }
    }
  );

  const unsubLocal = subscribeLocalPlaceReviews(
    placeId,
    (items) => {
      localReviews = items;
      localReady = true;
      emit();
    },
    () => {
      localReady = true;
      emit();
    }
  );

  return () => {
    unsubCloud();
    unsubLocal();
  };
}

export function subscribeHiddenWishlistIds(
  actor: CloudActor | null | undefined,
  onData: (ids: string[]) => void,
  onError?: (error: Error) => void
): () => void {
  if (actor) {
    return subscribeFirestoreHiddenWishlistIds(actor.uid, onData, onError);
  }
  onData([]);
  return () => {};
}

export async function toggleWishlistPlaceHidden(
  actor: CloudActor | null | undefined,
  placeId: string,
  hide: boolean
): Promise<string[]> {
  if (actor) {
    return toggleFirestoreWishlistPlaceHidden(actor.uid, placeId, hide);
  }
  return [];
}

export function readCurrentLocalHiddenIds(): string[] {
  return readLocalHiddenWishlistIds();
}

export async function createPlace(
  actor: CloudActor | null | undefined,
  input: CreatePlaceInput
): Promise<string> {
  if (actor) {
    return createPlaceWithInitialReview(actor.uid, actor.authorName, input);
  }
  return createLocalPlaceWithInitialReview({
    ...input,
    visitStatus: 'visited',
  });
}

export async function updateMapsUrl(
  actor: CloudActor | null | undefined,
  placeId: string,
  mapsUrl: string,
  isWishlist?: boolean
): Promise<void> {
  if (actor) {
    return updatePlaceMapsUrl(placeId, mapsUrl, actor.uid, isWishlist);
  }
  return updateLocalPlaceMapsUrl(placeId, mapsUrl);
}

export async function updatePromoUrl(
  actor: CloudActor | null | undefined,
  placeId: string,
  promoUrl: string,
  isWishlist?: boolean
): Promise<void> {
  if (actor) {
    return updatePlacePromoUrl(placeId, promoUrl, actor.uid, isWishlist);
  }
  return updateLocalPlacePromoUrl(placeId, promoUrl);
}

export async function updatePlaceMetadata(
  actor: CloudActor | null | undefined,
  placeId: string,
  input: UpdatePlaceTagsAndLocationInput,
  isWishlist?: boolean
): Promise<void> {
  if (actor) {
    return updatePlaceTagsAndLocation(placeId, input, actor.uid, isWishlist);
  }
  return updateLocalPlaceTagsAndLocation(placeId, input);
}

export async function addReview(
  actor: CloudActor | null | undefined,
  input: AddReviewInput
): Promise<void> {
  if (actor) {
    return addReviewToPlace(actor.uid, actor.authorName, input);
  }
  return addLocalReviewToPlace(input);
}

export async function updateReview(
  actor: CloudActor | null | undefined,
  input: UpdateReviewInput
): Promise<void> {
  if (actor) {
    return updateReviewInPlace(input);
  }
  return updateLocalReviewInPlace(input);
}

export async function deleteReview(
  actor: CloudActor | null | undefined,
  placeId: string,
  reviewId: string
): Promise<void> {
  if (actor) {
    return deleteReviewFromPlace(placeId, reviewId);
  }
  return deleteLocalReviewFromPlace(placeId, reviewId);
}

export async function toggleExistingPlaceWishlist(
  actor: CloudActor,
  sourcePlace: PlaceItem,
  add: boolean
): Promise<void> {
  if (add) {
    return addExistingPlaceToWishlist(actor.uid, actor.authorName, sourcePlace);
  }
  return deletePlace(actor.uid, sourcePlace.id, true);
}

export async function removePlace(
  actor: CloudActor | null | undefined,
  placeId: string,
  isWishlist?: boolean
): Promise<void> {
  if (actor) {
    return deletePlace(actor.uid, placeId, isWishlist);
  }
  return deleteLocalPlace(placeId);
}

export async function exportBackup(actor: CloudActor | null | undefined) {
  if (actor) {
    return exportFirestoreBackup(actor.uid);
  }
  const [cloud, local] = await Promise.all([
    exportFirestoreBackup().catch(() => ({
      version: 5,
      exportedAt: new Date().toISOString(),
      places: [] as PlaceItem[],
      reviews: [] as ReviewItem[],
    })),
    exportDatabaseBackup(),
  ]);

  const placeMap = new Map<string, unknown>();
  for (const p of local.places.filter(isPublicVisitedPlace)) placeMap.set(p.id, p);
  for (const p of cloud.places.filter(isPublicVisitedPlace)) placeMap.set(p.id, p);

  const reviewMap = new Map<string, unknown>();
  for (const r of local.reviews) reviewMap.set(r.id, r);
  for (const r of cloud.reviews) reviewMap.set(r.id, r);

  return {
    version: 5,
    exportedAt: new Date().toISOString(),
    places: Array.from(placeMap.values()),
    reviews: Array.from(reviewMap.values()),
  };
}

export async function importBackup(
  actor: CloudActor | null | undefined,
  jsonText: string
): Promise<number> {
  if (actor) {
    return importBackupToFirestore(actor.uid, actor.authorName, jsonText);
  }
  return importBackupToLocal(jsonText);
}
