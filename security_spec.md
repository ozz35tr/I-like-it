# Security Specification — MekanNotu Firestore Rules

## 1. Data Invariants
1. **Strict Ownership & Isolation:** Every place and review lives under `/users/{userId}/places/{placeId}` and `/users/{userId}/places/{placeId}/reviews/{reviewId}` where `userId == request.auth.uid` and `request.auth.token.email_verified == true`.
2. **Identity Integrity:** `ownerId` inside every `Place` and `Review` document must strictly equal `request.auth.uid` on create and remain immutable on update.
3. **Path Variable Hardening:** All document IDs (`userId`, `placeId`, `reviewId`) must match `^[a-zA-Z0-9_\-]+$` with length `1..128`.
4. **Master Gate & Atomicity:** A `Review` cannot exist without a valid parent `Place` owned by `request.auth.uid` (verified via `getAfter(...)` on create so atomic batch creation of a place + initial review succeeds, and `get(...)` on update/delete).
5. **Temporal Integrity:** `createdAt` and `updatedAt` must equal `request.time` on create; `createdAt` is immutable and `updatedAt == request.time` on update.
6. **Strict Schema & Bounds:** Every field has explicit type and size constraints (`name`: 2..100, `mapsUrl`: 0..600, `comment`: 2..1500, `photos`: list size <= 2 with each item `<= 160000` chars). Ghost/extra fields are rejected via `hasAll` + `hasOnly`.

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Cross-User Read:** User A tries to `get` or `list` `/users/userB/places`.
2. **Unverified Email Write:** Authenticated user with `email_verified: false` tries to create a place under their own UID.
3. **Owner Spoofing on Create:** User A writes under `/users/userA/places/p1` with `ownerId: "userB"`.
4. **Shadow/Ghost Field Injection:** User A creates a place with an extra field `{ ..., isAdmin: true }`.
5. **ID Poisoning:** User A writes to `/users/userA/places/bad$id..with..dots` or >128 chars.
6. **Client Timestamp Spoofing:** User A creates a place with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
7. **Immutable Field Tampering:** User A updates `ownerId` or `createdAt` on an existing place.
8. **Out-of-Bounds Rating:** User A submits a review with `rating: 6` or `rating: 0` or `rating: "5"`.
9. **Oversized String / Wallet Exhaustion:** User A submits `name` with 5000 chars or `mapsUrl` with 10000 chars.
10. **Array Element Poisoning:** User A submits `photos: [12345]` (non-string) or `photos` with 5 items (> MAX 2).
11. **Orphaned Subcollection Write:** User A creates `/users/userA/places/nonexistent/reviews/r1` without creating the parent place in the same batch.
12. **Blanket Query Bypass:** Unauthenticated client or User B runs `collection(db, 'users/userA/places')` list query without matching UID.
