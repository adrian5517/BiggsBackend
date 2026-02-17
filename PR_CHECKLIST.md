PR Checklist — Auth refactor (refactor/auth-and-mvc)

- [ ] Confirm `reports_full_backup.jsonl` removed from branch history
- [ ] Run `scripts/migrate_refresh_tokens_to_hash.js` in staging (requires `PG_CONN`)
  - command: `node scripts/migrate_refresh_tokens_to_hash.js`
- [ ] Set `USE_HASHED_REFRESH_TOKENS=true` in backend env after migration
- [ ] Set `ENABLE_COOKIE_AUTH=true` in backend env to enable httpOnly cookie flows
- [ ] Set `NEXT_PUBLIC_USE_COOKIE_REFRESH=1` in frontend env and rebuild frontend
- [ ] Run integration test against staging DB:
  - `node scripts/test_users_model_rotation_integration.js`
- [ ] Exercise login -> refresh -> logout flows from frontend (staging)
- [ ] Monitor `tmp/auth_refresh.log` and `tmp/auth_results.log` for `revoked_or_missing` events
- [ ] When stable, prepare release notes and merge PR

Notes:
- Migration is idempotent and skips tokens that already appear hashed.
- Keep a DB backup or snapshot before running migration.
