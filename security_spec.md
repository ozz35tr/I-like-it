# Security Specification — MekanNotu Shared Firestore Rules

## 1. Data Invariants
1. **Verified Authentication Required:** Only authenticated users with `request.auth.token.email_verified == true` may read or write shared `/places/{placeId}` and `/places/{placeId}/reviews/{reviewId}` documents.
2. **Non-PII Author Attribution:** Every shared `Place` and `Review` records `authorName` (`1..60` chars, display name) without storing raw email addresses or phone numbers.
3. **Identity Integrity & Tiered Ownership:**
   - `ownerId` must equal `request.auth.uid` on create and is immutable on update.
   - Only the creator (`existing().ownerId == request.auth.uid`) may delete a `Place`, edit its `mapsUrl`, or delete their own `Review`.
   - Any verified signed-in user may contribute a `Review` to an existing shared `Place` and atomically update only the aggregate fields (`avgRating`, `reviewCount`, `ratingSum`, `latestComment`, `coverImage`, `updatedAt`).
4. **Master Gate & Atomicity:** A `Review` under `/places/{placeId}/reviews/{reviewId}` requires a valid shared parent `Place` verified via `getAfter(...)`.
5. **Query Enforcement:** All shared `allow list` rules explicitly enforce `resource.data.visibility == 'shared'`.
6. **Temporal Integrity & Strict Schema:** `createdAt` and `updatedAt` are bound to `request.time`; `hasAll` + `hasOnly` reject ghost fields; all IDs match `^[a-zA-Z0-9_\-]+$` (`1..128`).
7. **Legacy Private Data Migration:** Existing `/users/{userId}/places` collections remain accessible strictly to `isVerifiedOwner(userId)` for migration cleanup.

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read:** Unauthenticated client attempts `get` or `list` on `/places`.
2. **Unverified Email Write:** Signed-in user with `email_verified: false` creates a place or review.
3. **Owner Spoofing on Create:** User A creates `/places/p1` with `ownerId: "userB"`.
4. **Cross-User Deletion:** User B attempts to `delete` `/places/p1` or `/places/p1/reviews/r1` owned by User A.
5. **Unauthorized Name/Category Tampering:** User B attempts to `update` `name`, `category`, `ownerId`, or `authorName` on User A's place.
6. **Shadow/Ghost Field Injection:** User A includes `{ ..., isAdmin: true }` or `{ ..., email: "a@b.com" }` on create or update.
7. **ID Poisoning:** User A creates `/places/bad..id..with$chars` or >128 chars.
8. **Client Timestamp Spoofing:** User A sets `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
9. **Out-of-Bounds Rating:** User A submits a review with `rating: 6`, `rating: 0`, or `rating: "5"`.
10. **Oversized String / Wallet Exhaustion:** User A submits `name` (>100 chars), `authorName` (>60 chars), or `mapsUrl` (>600 chars).
11. **Array Element Poisoning:** User A submits `photos: [12345]` or `photos` with >2 elements.
12. **Orphaned Subcollection Write:** User A creates `/places/nonexistent/reviews/r1` without an existing or batched parent place.
