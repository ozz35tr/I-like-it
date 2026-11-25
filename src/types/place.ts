export type PlaceCategory =
  | 'restaurant'
  | 'esnaf'
  | 'cafe'
  | 'bakery'
  | 'bistro'
  | 'bufe'
  | 'bar'
  | 'pastane';
export type VisitStatus = 'visited' | 'wishlist';
export type SortField =
  | 'name'
  | 'product'
  | 'rating'
  | 'price'
  | 'location'
  | 'distance'
  | 'comment'
  | 'date';
export type SortDirection = 'asc' | 'desc';

export interface PlaceItem {
  id: string;
  ownerId: string;
  authorName: string;
  name: string;
  category: PlaceCategory;
  visitStatus: VisitStatus;
  cuisineType: string;
  cuisineTypes: string[];
  locationArea: string;
  lat: number | null;
  lng: number | null;
  mapsUrl: string;
  coverImage: string;
  latestComment: string;
  avgRating: number;
  reviewCount: number;
  ratingSum: number;
  avgPriceRating?: number;
  priceRatingCount?: number;
  priceRatingSum?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewItem {
  id: string;
  ownerId: string;
  authorName: string;
  placeId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  priceRating?: 1 | 2 | 3 | 4 | 5;
  comment: string;
  photos: string[];
  createdAt: number;
  updatedAt: number;
}

export const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  restaurant: 'Restoran',
  esnaf: 'Lokanta',
  cafe: 'Kafe',
  pastane: 'Pastane',
  bufe: 'Büfe',
  bar: 'Bar',
  bakery: 'Tatlı & Fırın',
  bistro: 'Bistro',
};

export const PRODUCT_TYPE_PRESETS: readonly string[] = [
  'Kebap',
  'Köfte',
  'Et',
  'Tavuk',
  'Çiğ Köfte',
  'Kokoreç',
  'Hamburger',
  'Balık & Deniz Ürünleri',
  'Döner & İskender',
  'Lahmacun & Pide',
  'Pizza',
  'Ev Yemeği',
  'Kahve & Tatlı',
  'Kahvaltı',
  'Sokak Lezzetleri',
];

export const STORAGE_LIMITS = {
  AUTHOR_NAME_MAX: 60,
  CUISINE_TYPE_MAX: 40,
  CUISINE_SUMMARY_MAX: 160,
  MAX_CUISINE_TYPES: 6,
  LOCATION_AREA_MAX: 80,
  NAME_MIN: 2,
  NAME_MAX: 100,
  MAPS_URL_MAX: 600,
  COMMENT_MIN: 2,
  COMMENT_MAX: 1500,
  MAX_PHOTOS: 2,
  MAX_IMAGE_CHARS: 155000,
} as const;
