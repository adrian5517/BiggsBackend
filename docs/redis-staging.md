Redis staging: local test setup

Overview
- Local docker compose and recommended redis.conf for staging and functional testing.

Run (PowerShell)

Set environment variable REDIS_PASSWORD, then run:

    $env:REDIS_PASSWORD = "YourStrongPasswordHere"
    docker compose -f docker-compose.redis.yml up -d

Verify

From host (if you have redis-cli installed):

    redis-cli -a $env:REDIS_PASSWORD ping

Or via docker:

    docker exec -it redis-staging redis-cli -a $env:REDIS_PASSWORD ping

Expected response: PONG

Connection string (for your app env):

    REDIS_URL=redis://:YourStrongPasswordHere@localhost:6379/0

BullMQ notes
- Use lazyConnect: true and sensible retry/backoff settings in your BullMQ options.
- If you want to test cluster mode locally, consider bitnami/redis-cluster or provider test instances.

Quick checklist
- Ensure maxmemory-policy noeviction in redis/redis-staging.conf.
- For production, use a managed provider with TLS, AUTH, backups, and automatic failover.
