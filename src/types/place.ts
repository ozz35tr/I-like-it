export type PlaceCategory = 'cafe' | 'restaurant' | 'bakery' | 'bistro';
export type SortField = 'name' | 'rating' | 'location' | 'comment' | 'date';
export type SortDirection = 'asc' | 'desc';

export interface PlaceItem {
  id: string;
  ownerId: string;
  name: string;
  category: PlaceCategory;
  mapsUrl: string;
  coverImage: string;
  latestComment: string;
  avgRating: number;
  reviewCount: number;
  ratingSum: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewItem {
  id: string;
  ownerId: string;
  placeId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
  photos: string[];
  createdAt: number;
  updatedAt: number;
}

export const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  restaurant: 'Restoran',
  cafe: 'Kafe',
  bakery: 'Tatlı & Fırın',
  bistro: 'Bistro',
};

export const STORAGE_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 100,
  MAPS_URL_MAX: 600,
  COMMENT_MIN: 2,
  COMMENT_MAX: 1500,
  MAX_PHOTOS: 2,
  MAX_IMAGE_CHARS: 155000,
} as const;
