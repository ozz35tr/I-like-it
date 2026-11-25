# Security Specification — Gourmand Shared Firestore Rules

## 1. Data Invariants
1. **Public Read on Shared Visited Places, Strict Private Isolation for Personal Wishlists:** Any visitor (including unauthenticated first-time users) may `get` or `list` shared non-PII `/places/{placeId}` (`visibility == 'shared'`, visited only) and `/places/{placeId}/reviews/{reviewId}` documents. All writes (`create`, `update`, `delete`) on `/places` and `/reviews`, as well as ALL reads and writes on `/users/{userId}/wishlist/{placeId}`, `/users/{userId}/preferences/{prefId}`, and legacy `/users/{userId}/places/{placeId}`, strictly require `request.auth.token.email_verified == true`.
2. **Per-User Wishlist Isolation:** Personal wishlist (`Gidilecekler`) places live under `/users/{userId}/wishlist/{placeId}` (`visibility == 'private'`, `visitStatus == 'wishlist'`) and are strictly restricted (`get`, `list`, `create`, `update`, `delete`) to `isVerifiedOwner(userId)`. Unauthenticated visitors and other signed-in users cannot see or query another user's wishlist.
3. **Non-PII Author Attribution:** Every shared `Place` and `Review` records `authorName` (`1..60` chars, display name) without storing raw email addresses or phone numbers.
4. **Identity Integrity & Tiered Ownership:**
   - `ownerId` must equal `request.auth.uid` on create and is immutable on update.
   - Only the place creator (`existing().ownerId == request.auth.uid`) may delete a `Place` or change its `name` / `mapsUrl` / `visitStatus`.
   - Verified signed-in users may enrich shared `cuisineType` (`0..160`), `cuisineTypes` (`0..6` tags, each `1..40`), `locationArea` (`0..80`), `lat`/`lng`, and `category` (`restaurant`, `esnaf`, `cafe`, `pastane`, `bufe`, `bar`, `bakery`, `bistro`) on existing shared places so older records can be categorized.
   - Any verified signed-in user may contribute a `Review` to an existing shared `Place` (including optional `priceRating` 1..5) and atomically update only the aggregate fields (`avgRating`, `reviewCount`, `ratingSum`, `avgPriceRating`, `priceRatingCount`, `priceRatingSum`, `latestComment`, `coverImage`, `visitStatus`, `updatedAt`).
5. **Strict Per-User Review Ownership:**
   - Only the review author (`existing().ownerId == request.auth.uid`) may `update` (`rating`, `priceRating`, `comment`, `photos`, `updatedAt`) or `delete` their own review. Other signed-in users receive `PERMISSION_DENIED`.
6. **Private Wishlist Hide/Show Preferences:**
   - `/users/{userId}/preferences/{prefId}` is strictly restricted (`get`, `create`, `update`, `delete`) to `isVerifiedOwner(userId)` (`list` disabled unless `resource.data.ownerId == request.auth.uid`). Unauthenticated or cross-user reads return `PERMISSION_DENIED`.
7. **Master Gate & Atomicity:** A `Review` create or update under `/places/{placeId}/reviews/{reviewId}` verifies the shared parent `Place` via `getAfter(...)`.
8. **Query Enforcement:** All shared `allow list` rules explicitly enforce `resource.data.visibility == 'shared'`.
9. **Temporal Integrity & Strict Schema:** `createdAt` and `updatedAt` are bound to `request.time`; `hasAll` + `hasOnly` reject ghost fields; all IDs match `^[a-zA-Z0-9_\-]+$` (`1..128`).

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Write / Wishlist / Private Read:** Unauthenticated client attempts `create`/`update`/`delete` on `/places`, or `get`/`list` on `/users/userA/wishlist` or `/users/userA/preferences/wishlist`.
2. **Unverified Email Write:** Signed-in user with `email_verified: false` creates a place, wishlist item, review, or preference.
3. **Owner Spoofing on Create:** User A creates `/places/p1` with `ownerId: "userB"`.
4. **Cross-User Review Edit:** User B attempts to `update` `/places/p1/reviews/r1` owned by User A.
5. **Cross-User Deletion:** User B attempts to `delete` `/places/p1` or `/places/p1/reviews/r1` owned by User A.
6. **Cross-User Preference Access:** User B attempts to `get`, `create`, or `update` `/users/userA/preferences/wishlist`.
7. **Shadow/Ghost Field Injection:** User A includes `{ ..., isAdmin: true }` or `{ ..., email: "a@b.com" }` on create or update.
8. **ID Poisoning:** User A creates `/places/bad..id..with$chars` or >128 chars.
9. **Client Timestamp Spoofing:** User A sets `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
10. **Out-of-Bounds Rating or Coordinates:** User A submits a review with `rating: 6`, or `lat: 120`.
11. **Oversized Array / String Exhaustion:** User A submits `cuisineTypes` with >6 elements or `locationArea` >80 chars.
12. **Orphaned Subcollection Write:** User A creates `/places/nonexistent/reviews/r1` without an existing or batched parent place.
