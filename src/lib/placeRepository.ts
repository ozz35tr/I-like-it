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
  updatePlaceMapsUrl,
  type AddReviewInput,
  type CreatePlaceInput,
} from './placesService';

export function subscribeUserOrLocalPlaces(
  userId: string | null | undefined,
  onData: (places: PlaceItem[]) => void,
  onError: (error: Error) => void
): () => void {
  if (userId) {
    return subscribePlaces(userId, onData, onError);
  }
  return subscribeLocalPlaces(onData, onError);
}

export function subscribeUserOrLocalPlaceReviews(
  userId: string | null | undefined,
  placeId: string,
  onData: (reviews: ReviewItem[]) => void,
  onError: (error: Error) => void
): () => void {
  if (userId) {
    return subscribePlaceReviews(userId, placeId, onData, onError);
  }
  return subscribeLocalPlaceReviews(placeId, onData, onError);
}

export async function createPlace(
  userId: string | null | undefined,
  input: CreatePlaceInput
): Promise<string> {
  if (userId) {
    return createPlaceWithInitialReview(userId, input);
  }
  return createLocalPlaceWithInitialReview(input);
}

export async function updateMapsUrl(
  userId: string | null | undefined,
  placeId: string,
  mapsUrl: string
): Promise<void> {
  if (userId) {
    return updatePlaceMapsUrl(userId, placeId, mapsUrl);
  }
  return updateLocalPlaceMapsUrl(placeId, mapsUrl);
}

export async function addReview(
  userId: string | null | undefined,
  input: AddReviewInput
): Promise<void> {
  if (userId) {
    return addReviewToPlace(userId, input);
  }
  return addLocalReviewToPlace(input);
}

export async function deleteReview(
  userId: string | null | undefined,
  placeId: string,
  reviewId: string
): Promise<void> {
  if (userId) {
    return deleteReviewFromPlace(userId, placeId, reviewId);
  }
  return deleteLocalReviewFromPlace(placeId, reviewId);
}

export async function removePlace(
  userId: string | null | undefined,
  placeId: string
): Promise<void> {
  if (userId) {
    return deletePlace(userId, placeId);
  }
  return deleteLocalPlace(placeId);
}

export async function exportBackup(userId: string | null | undefined) {
  if (userId) {
    return exportFirestoreBackup(userId);
  }
  return exportDatabaseBackup();
}

export async function importBackup(
  userId: string | null | undefined,
  jsonText: string
): Promise<number> {
  if (userId) {
    return importBackupToFirestore(userId, jsonText);
  }
  return importBackupToLocal(jsonText);
}
