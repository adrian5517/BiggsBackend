Refactor: Auth & MVC (bootstrap plan)

Goal
- Clean, simplify and reorganize the project starting with authentication and the MVC structure.
- Make incremental, safe changes on a feature branch `refactor/auth-and-mvc`.

Scope (initial iteration)
1. Audit current auth flow (controllers/authController.js, middleware/authMiddleware.js, models/usersModel.js, frontend utils/auth.ts).
2. Add non-invasive documentation and a step-by-step plan (this file).
3. Implement small, safe refactors: move helpers to `lib/` and create `services/authService.js` (in later commits).
4. Add tests and CI steps after refactor core is stable.

Immediate actions (this commit)
- Create branch `refactor/auth-and-mvc` and commit this plan file.
- Run a static audit (manual) of auth files and collect findings.

Initial observations
- Backend already returns `refreshToken` in JSON and persists it to Postgres `refresh_tokens` array; however middleware and client code still support cookie flows.
- Several debug logs (tmp/*.log) added — keep while debugging but plan to remove or make conditional.
- `models/usersModel.js` implements Postgres-backed user but exposes factory-style functions; consider converting to a clearer class/factory exported as `User`.
- Frontend `BiggsFrontend/utils/auth.ts` stores tokens in localStorage and appends query-token fallback; this is acceptable for dev but needs secure handling and tests.

Next steps (order)
- Create branch and push locally.
- Audit and add unit tests for `comparePassword`, `save()` rotation logic.
- Extract auth logic into `services/authService.js` and simplify `controllers/authController.js` to call service methods.
- Consolidate token verification and token extraction in `middleware/authMiddleware.js`.
- Reorganize folders: move route files under `routes/`, controllers under `controllers/`, services under `services/`, models under `models/` (already partially organized).

Notes
- We'll avoid large, risky refactors in a single commit. Changes will be small, incremental, and fully tested.
- After your confirmation I'll start with the backend audit and small safe refactors.
