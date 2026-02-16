Redis eviction policy and production guidance

Why this matters
- BullMQ (and any durable queue) must not silently lose keys from Redis due to eviction. If Redis evicts job keys the queue can lose jobs and corrupt state.

Desired setting
- `maxmemory-policy = noeviction` for Redis instances used by BullMQ. This prevents Redis from evicting keys when memory is full.

Quick verification (run from your app host or dev machine with `redis-cli`) :

```bash
# check
redis-cli -u "$REDIS_URL" CONFIG GET maxmemory-policy

# if you have admin/CONFIG privileges you can set (warning: managed providers may disallow)
redis-cli -u "$REDIS_URL" CONFIG SET maxmemory-policy noeviction
```

Provider guidance

- RedisLabs / Managed Redis (Cloud providers)
  - Many managed Redis providers restrict `CONFIG SET` on shared plans. If you cannot run `CONFIG SET`, open a support ticket or use the provider console to:
    - Create a dedicated Redis instance for queues (not shared with large payloads)
    - Choose a plan that allows changing `maxmemory-policy` or uses `noeviction` by default
    - Ask support to set `maxmemory-policy=noeviction` for your instance
  - If provider cannot change policy, request a dedicated instance or move to a plan that supports the setting.

- AWS ElastiCache (Redis)
  - Edit or create a Parameter Group and set `maxmemory-policy` = `noeviction`, then attach the parameter group to your Redis cluster and reboot nodes.
  - Example (AWS CLI):
    - create a param group: `aws elasticache create-cache-parameter-group --cache-parameter-group-name my-bullmq-params --cache-parameter-group-family redis6.x --description "params for bullmq"`
    - modify: `aws elasticache modify-cache-parameter-group --cache-parameter-group-name my-bullmq-params --parameter-name-values "ParameterName=maxmemory-policy,ParameterValue=noeviction"`
    - attach by updating the replication group / cluster to use the parameter group and reboot.

- DigitalOcean Managed Redis
  - Use the database control panel to set parameter or request support; if not possible, provision a new DB with the required parameter.

- Azure Cache for Redis
  - Use Redis configuration in the Azure portal or via ARM templates to set `maxmemory-policy`.

If you manage Redis with IaC (recommended)
- For AWS: create a custom parameter group and attach it to the Redis cluster. Ensure `noeviction` is set.

App-side mitigations if you cannot change provider policy
- Move large blobs out of Redis — store large payloads in S3 (or object storage) and keep only references in jobs.
- Use a dedicated small Redis instance for BullMQ only; move other caches to a separate instance.
- Add runtime detection and fail-on-start (we added a check in `services/redis.js`) so deployments fail fast when policy is incorrect.
- Monitor `evicted_keys`, `used_memory`, `used_memory_rss`, and set alerts.

Commands & scripts added
- `scripts/check_redis_policy.js` — queries current policy and can attempt to set it if `REDIS_ALLOW_SET=true`.
- `services/redis.js` — now performs a runtime check and will exit if `REDIS_ENFORCE_NOEVICTION=true` and policy is wrong.

Recommended next steps
1. Run `node scripts/check_redis_policy.js` from your environment to verify current policy.
2. If you can `CONFIG SET`, run it or set via provider console.
3. If you cannot change policy, request provider support or create a dedicated Redis instance for queues.
4. Ensure monitoring and alerts for `evicted_keys` and memory usage are in place before cutting over.

Contact templates
- Use this text when opening a support ticket with your managed Redis provider:

"Please set `maxmemory-policy` to `noeviction` for our Redis instance (ID: <instance-id>) used by our BullMQ queues. Currently it's set to <current-policy>, which risks evicting queue keys and losing jobs. If you cannot set this on our current plan, please advise the minimal plan or steps required to enable `noeviction`."
