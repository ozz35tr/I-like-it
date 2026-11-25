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

export function subscribeUserOrLocalPlaces(
  actor: CloudActor | null | undefined,
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  if (actor) {
    return subscribePlaces(onData, onError);
  }
  return subscribeLocalPlaces(onData, onError);
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
  return subscribeLocalPlaceReviews(placeId, onData, onError);
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
  return exportDatabaseBackup();
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
