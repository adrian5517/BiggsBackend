Backend Authentication Audit — refactor/auth-and-mvc

Scope
- Reviewed: `controllers/authController.js`, `middleware/authMiddleware.js`, `models/usersModel.js`, `BiggsFrontend/utils/auth.ts`, and tmp logs.
- Goal: identify issues, security concerns, maintainability problems, and propose prioritized, incremental refactors starting with authentication.

Summary Findings
1) Mixed token transport strategies
- Server and client both support Authorization header, query token, JSON body, and cookies. This increases complexity and creates multiple code paths to maintain.
- Frontend currently stores `refreshToken` in `localStorage` in dev, and server returns refresh token in JSON. Cookies codepaths remain in middleware/controller.

Risk/Impact: More surface area for bugs and security mistakes (e.g., localStorage vs httpOnly cookies). Reproducible cross-origin cookie problems (SameSite) drove the current approach.

2) Refresh token storage and rotation
- Refresh tokens are stored in plaintext in Postgres array column `refresh_tokens` and are rotated on refresh: old token removed, new token added.
- Rotation implemented but may be vulnerable to race conditions if multiple concurrent refresh requests present; code serializes refresh on front-end but server has no locking.

Risk/Impact: Concurrent requests could cause accidental revocation of a valid token (rotate race). Storing raw refresh tokens in DB increases risk if DB compromise occurs.

3) Token verification secret handling
- Secrets are read from env vars but there are warnings when `JWT_SECRET` looks like a token string; detection exists in middleware. Several places use fallback secrets like `dev_jwt_secret`.

Risk/Impact: Potential misconfiguration in production can lead to verification errors; fallback secrets are useful in dev but must be clearly gated for production.

4) User model patterns
- `models/usersModel.js` is implemented as a class factory and uses raw SQL via `services/pg.query`. Some behaviors are duplicated across model and controller (token persistence logging, handling hashed password detection).

Risk/Impact: Model responsibilities are mixed (persistence + hashing + logging). More conventional separation will improve clarity and reduce bugs (e.g., avoid double-hash logic spread around).

5) Logging and temporary debug files
- Many `tmp/*.log` files are appended for debugging. Good for local troubleshooting but should be gated by a debug flag and not committed to production.

Risk/Impact: Noise, potential sensitive information leakage if logs are uploaded; remove or secure before production.

6) Frontend logic
- `BiggsFrontend/utils/auth.ts` contains robust retry+refresh logic and dev fallbacks. It serializes refresh attempts and caches token. However, it uses `credentials: 'include'` and also sends refreshToken in JSON body.

Risk/Impact: In production, refresh tokens should be stored in httpOnly secure cookies to mitigate XSS. Current dev approach is acceptable for local development but must be changed for production.

Priority Recommendations (incremental)
A. Short-term (safe, minimal-risk)
- Consolidate token extraction to a single helper (server-side) and make middleware call that. Gate old cookie-based code behind a feature flag `ENABLE_COOKIE_AUTH`.
- Make `tmp/*.log` writes conditional on `DEBUG_AUTH` env var and ensure logs are excluded by `.gitignore` (already done). Remove any writes of full tokens; only write masked prefixes.
- Add defensive checks to `refreshAccessToken` to log `user.refreshTokens` length and mask candidates when returning 401 to help debugging.

B. Mid-term (refactor with tests)
- Extract auth logic into `services/authService.js`: responsibilities include signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, rotateRefreshToken, persistRefreshToken.
- Refactor `controllers/authController.js` to call `authService` methods; `authMiddleware` should call `authService.verifyAccessToken`.
- Refactor `models/usersModel.js` to clearly separate hashing/persistence. Consider renaming to `UserModel` and export both factory (create) and static lookups. Add unit tests for `save()`, `comparePassword`, and refresh token persistence/rotation.
- Hash refresh tokens before storing in DB (store hashed token with salt) to avoid raw tokens in DB; compare by hashing the presented token. This is more secure but requires migration if tokens already exist.

C. Long-term (security + architecture)
- Use httpOnly, secure cookies for refresh tokens in production (set Secure + SameSite=None for cross-site scenarios with proper CORS); fall back to JSON body only for non-browser clients or local dev.
- Implement a refresh token blacklist/cleanup strategy (remove expired tokens periodically) and limit active refresh tokens per user (e.g., allow N recent tokens).
- Add integration tests that simulate concurrent refresh requests and validate rotation behavior.
- Consider moving to a layered architecture: `routes/` -> `controllers/` -> `services/` -> `models/` with clear responsibilities.

Specific Quick Fixes I Can Implement Now
1. Create `services/authService.js` (thin wrapper) and move token creation/verification into it.
2. Make `authController` call the service and reduce inline logic.
3. Add `DEBUG_AUTH` gating around file log writes and ensure masked output only.
4. Add tests skeleton and a README section documenting auth behavior and environment variables to set.

Next Steps (first code changes)
1. Add `services/authService.js` and wire `controllers/authController.js` to use it (non-breaking changes; keep existing endpoints intact).
2. Add unit tests for token sign/verify and `User.comparePassword`.
3. Run the app and reproduce current refresh failure with logs enabled to verify behavior.

Notes about production readiness
- Before promoting to production: remove non-essential tmp logging, ensure env secrets are set and not fallback, switch to httpOnly cookies for refresh tokens (and set correct CORS), and perform a security review for token storage.

I'll proceed to create `services/authService.js` as a safe refactor (non-breaking): it will export token helpers and be used by `authController.js` and `middleware/authMiddleware.js`. I'll keep behavior identical initially.
