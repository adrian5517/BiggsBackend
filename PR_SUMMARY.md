# PR: Auth refactor — DB-backed refresh rotation + hashed tokens (draft)

Summary
- Centralized auth signing/verifying into `services/authService.js` (already present).
- Added DB-level refresh-token helpers to `models/usersModel.js`:
  - `addRefreshToken(userId, token)`
  - `rotateRefreshToken(userId, candidate, newToken)`
  - `removeRefreshToken(userId, token)`
- Added pure helpers in `models/userUtils.js` and unit test `scripts/test_refresh_rotation.js`.
- Wired `controllers/authController.js` to use DB helpers and added optional hashed-refresh-token support behind `USE_HASHED_REFRESH_TOKENS` (SHA-256).
- Added migration script `scripts/migrate_refresh_tokens_to_hash.js` to convert existing plaintext tokens to SHA-256 hex hashes.
- Added integration test `scripts/test_users_model_rotation_integration.js` (skips when `PG_CONN`/`DATABASE_URL` not set).

Why
- Users experienced 401s and repeated "revoked_or_missing" refresh events. Using DB-level atomic rotation reduces race conditions and makes refresh rotation robust.
- Hashing stored refresh tokens prevents plain-token leakage from DB backups/logs and aligns with best practices.

Behavioral changes
- By default, behavior is unchanged: refresh tokens are still JWTs returned to clients. The server will compare the provided token against DB entries.
- To enable hashed storage/comparison, set `USE_HASHED_REFRESH_TOKENS=true`. When enabled:
  - Server stores SHA-256(token) in `users.refresh_tokens`.
  - Server compares SHA-256(candidate) during rotation and removal.
  - Use `scripts/migrate_refresh_tokens_to_hash.js` to migrate existing tokens before flipping the flag.

Migration steps (recommended)
1. Ensure you have a DB backup/snapshot.
2. From a maintenance window (no concurrent auth writes), run:

```powershell
set PG_CONN="postgres://user:pass@host:5432/dbname"
node scripts/migrate_refresh_tokens_to_hash.js
```

3. Verify a few users in the DB: `SELECT id, refresh_tokens FROM users LIMIT 5;` — tokens should be 64-char hex strings.
4. Enable the feature flag in your environment: `USE_HASHED_REFRESH_TOKENS=true` and restart the service.
5. Run the integration test against the DB:

```powershell
node scripts/test_users_model_rotation_integration.js
```

6. Test login + refresh flows from the frontend (staging) to confirm operations.

Rollout notes
- The migration is idempotent (tokens already hashed are left as-is). The migration script will skip users whose tokens already appear hashed.
- Keep `USE_HASHED_REFRESH_TOKENS` off until migration completes.
- If you cannot take a maintenance window, consider coordinating a short read-only period for auth writes.

Testing & validation
- Unit test: `node scripts/test_refresh_rotation.js` (already passing locally).
- Integration test (requires PG): `node scripts/test_users_model_rotation_integration.js` — will skip when `PG_CONN` not set.

Next PR checklist (what to include in the PR)
- This summary (copy into PR description).
- Diff of changed files: `controllers/authController.js`, `models/usersModel.js`, `models/userUtils.js`, `services/authService.js` (already present), `scripts/*`.
- Migration script and instructions.
- Suggested release notes and environment flag docs.

Questions / CI notes
- I did not run the migration here because `PG_CONN` is not configured in this environment. If you want, I can run the migration once you provide DB access or run it in your staging environment.

--
Created by automated refactor on branch `refactor/auth-and-mvc`.
