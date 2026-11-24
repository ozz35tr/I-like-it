import type { PlaceItem, ReviewItem } from '../types/place';
import {
  addLocalReviewToPlace,
  createLocalPlaceWithInitialReview,
  deleteLocalPlace,
  deleteLocalReviewFromPlace,
  exportDatabaseBackup,
  importBackupToLocal,
  subscribeLocalPlaceReviews,
  subscribeLocalPlaces,
  updateLocalPlaceCuisineType,
  updateLocalPlaceMapsUrl,
} from './localDb';
import {
  addReviewToPlace,
  createPlaceWithInitialReview,
  deletePlace,
  deleteReviewFromPlace,
  exportFirestoreBackup,
  importBackupToFirestore,
  subscribePlaceReviews,
  subscribePlaces,
  updatePlaceCuisineType,
  updatePlaceMapsUrl,
  type AddReviewInput,
  type CreatePlaceInput,
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

export async function updateCuisineType(
  actor: CloudActor | null | undefined,
  placeId: string,
  cuisineType: string
): Promise<void> {
  if (actor) {
    return updatePlaceCuisineType(placeId, cuisineType);
  }
  return updateLocalPlaceCuisineType(placeId, cuisineType);
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
