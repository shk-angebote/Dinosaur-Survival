# Dinosaur Survival — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Owner-Only Private Save (`users/{userId}/private/save`)**: Only `request.auth.uid == userId` may read or write their private save document. No `list` access is ever permitted.
2. **PII Isolation (`users/{userId}/public/profile`)**: Public profiles contain zero PII (no email, phone, or IP) — only `uid`, `tribeName`, `bonfireLevel`, `power`, `tileX`, `tileY`, and `updatedAt`.
3. **Coordinate & Grid Bounds (`world_settlements/{userId}`)**: `tileX` must be `0..1198`, `tileY` must be `0..1198` (2×2 footprint on the 1200×1200 world map), `bonfireLevel` must be `1..25`, and `chunkKey` must match `^[0-9]+_[0-9]+$`.
4. **Immutable Chat Messages (`world_chat/{messageId}`)**: Signed-in users may only create messages under their own `uid` with `channel == 'world'`, `text.size()` between 1 and 240, and `createdAt == request.time`. Messages cannot be edited or deleted by clients.
5. **Terminal State Locking (`world_marches/{marchId}`)**: Once a march reaches `status == 'completed'`, it can never be updated again.
6. **Strict Timestamp Integrity**: All `createdAt` and `updatedAt` fields must equal `request.time` on write.
7. **Dual-Confirmation Trade Integrity (`world_trades/{tradeId}`)**: Trades start `pending` with `fromConfirmed: false` and `toConfirmed: false`. Only `fromUid` may flip `fromConfirmed` to `true`, only `toUid` may flip `toConfirmed` to `true`, and `status` may only transition to `completed` once both sides are `true`. Trade terms are immutable, and terminal states (`completed`, `cancelled`) are permanently locked. Only trade participants may read or list their trades.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Be Rejected)
1. **Cross-User Private Save Read**: User B attempts `get` on `/users/userA/private/save` -> `PERMISSION_DENIED`.
2. **Cross-User Private Save Overwrite**: User B attempts `update` on `/users/userA/private/save` -> `PERMISSION_DENIED`.
3. **Ghost / Shadow Field Injection**: User A creates `/world_settlements/userA` with extra field `isAdmin: true` -> `PERMISSION_DENIED` (`hasOnly` check).
4. **UID Spoofing on Chat**: User A creates `/world_chat/msg1` with `uid: "userB"` -> `PERMISSION_DENIED`.
5. **Client Timestamp Forgery**: User A creates `/world_chat/msg2` with backdated `createdAt` (`!= request.time`) -> `PERMISSION_DENIED`.
6. **Out-of-Bounds Settlement Coordinates**: User A writes `/world_settlements/userA` with `tileX: 9999, tileY: -5` -> `PERMISSION_DENIED`.
7. **Invalid Bonfire Level Poisoning**: User A writes `/world_settlements/userA` with `bonfireLevel: 999` -> `PERMISSION_DENIED`.
8. **ID Poisoning**: User A writes `/world_chat/<200-char-invalid-id!@#>` -> `PERMISSION_DENIED` (`isValidId`).
9. **Chat Message Tampering**: User A attempts `update` on an existing `/world_chat/msg1` -> `PERMISSION_DENIED`.
10. **March Terminal State Reopen**: User A attempts to change `/world_marches/m1` from `status: 'completed'` back to `'active'` -> `PERMISSION_DENIED`.
11. **Oversized String Payload (Denial of Wallet)**: User A submits 500-character `tribeName` or 5000-character chat `text` -> `PERMISSION_DENIED`.
12. **Unauthenticated Access**: Unauthenticated caller attempts `list` on `/world_settlements` or `/world_chat` -> `PERMISSION_DENIED`.
13. **Unilateral Trade Confirmation / Forgery**: User A attempts to create `/world_trades/t1` already marked `toConfirmed: true` or `status: 'completed'`, or updates `toConfirmed: true` on behalf of User B -> `PERMISSION_DENIED`.
14. **Trade Term Tampering**: User B attempts to alter `offerAmount` or `requestResource` while confirming `/world_trades/t1` -> `PERMISSION_DENIED`.
15. **Third-Party Trade Snooping**: User C attempts `get` or `list` on `/world_trades/t1` between User A and User B -> `PERMISSION_DENIED`.
