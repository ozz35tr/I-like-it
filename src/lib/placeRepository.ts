import type { PlaceItem, ReviewItem } from '../types/place';
import {
  addLocalReviewToPlace,
  createLocalPlaceWithInitialReview,
  deleteLocalPlace,
  deleteLocalReviewFromPlace,
  exportDatabaseBackup,
  importBackupToLocal,
  readLocalHiddenWishlistIds,
  subscribeLocalHiddenWishlistIds,
  subscribeLocalPlaceReviews,
  subscribeLocalPlaces,
  updateLocalPlaceMapsUrl,
  updateLocalPlaceTagsAndLocation,
  updateLocalReviewInPlace,
  writeLocalHiddenWishlistIds,
} from './localDb';
import {
  addReviewToPlace,
  createPlaceWithInitialReview,
  deletePlace,
  deleteReviewFromPlace,
  exportFirestoreBackup,
  importBackupToFirestore,
  subscribeFirestoreHiddenWishlistIds,
  subscribePlaceReviews,
  subscribePlaces,
  toggleFirestoreWishlistPlaceHidden,
  updatePlaceMapsUrl,
  updatePlaceTagsAndLocation,
  updateReviewInPlace,
  type AddReviewInput,
  type CreatePlaceInput,
  type UpdatePlaceTagsAndLocationInput,
  type UpdateReviewInput,
} from './placesService';

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

export function subscribeUserOrLocalPlaces(
  actor: CloudActor | null | undefined,
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  if (actor) {
    return subscribePlaces(onData, onError);
  }

  let cloudPlaces: PlaceItem[] = [];
  let localPlaces: PlaceItem[] = [];
  let cloudReady = false;
  let localReady = false;

  const emit = () => {
    if (cloudReady || localReady) {
      onData(mergePlaces(cloudPlaces, localPlaces));
    }
  };

  const unsubCloud = subscribePlaces(
    (items) => {
      cloudPlaces = items;
      cloudReady = true;
      emit();
    },
    (err) => {
      cloudReady = true;
      if (localReady && localPlaces.length > 0) {
        emit();
      } else {
        onError(err);
      }
    }
  );

  const unsubLocal = subscribeLocalPlaces(
    (items) => {
      localPlaces = items;
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
  return subscribeLocalHiddenWishlistIds(onData);
}

export async function toggleWishlistPlaceHidden(
  actor: CloudActor | null | undefined,
  placeId: string,
  hide: boolean
): Promise<string[]> {
  if (actor) {
    return toggleFirestoreWishlistPlaceHidden(actor.uid, placeId, hide);
  }
  const current = readLocalHiddenWishlistIds();
  const nextIds = hide
    ? Array.from(new Set([...current, placeId])).slice(0, 500)
    : current.filter((id) => id !== placeId);
  writeLocalHiddenWishlistIds(nextIds);
  return nextIds;
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
  return createLocalPlaceWithInitialReview(input);
}

export async function updateMapsUrl(
  actor: CloudActor | null | undefined,
  placeId: string,
  mapsUrl: string
): Promise<void> {
  if (actor) {
    return updatePlaceMapsUrl(placeId, mapsUrl);
  }
  return updateLocalPlaceMapsUrl(placeId, mapsUrl);
}

export async function updatePlaceMetadata(
  actor: CloudActor | null | undefined,
  placeId: string,
  input: UpdatePlaceTagsAndLocationInput
): Promise<void> {
  if (actor) {
    return updatePlaceTagsAndLocation(placeId, input);
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

export async function removePlace(
  actor: CloudActor | null | undefined,
  placeId: string
): Promise<void> {
  if (actor) {
    return deletePlace(actor.uid, placeId);
  }
  return deleteLocalPlace(placeId);
}

export async function exportBackup(actor: CloudActor | null | undefined) {
  if (actor) {
    return exportFirestoreBackup();
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
  for (const p of local.places) placeMap.set(p.id, p);
  for (const p of cloud.places) placeMap.set(p.id, p);

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
