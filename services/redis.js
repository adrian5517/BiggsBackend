const IORedis = require('ioredis');

function createRedisInstance() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379/0';
  const client = new IORedis(url, {
    lazyConnect: true,
    // allow long-running commands and reconnect logic
    maxRetriesPerRequest: null,
  });

  client.on('error', (err) => {
    console.error('[redis] error', err && err.message ? err.message : err);
  });

  client.on('connect', () => {
    console.log('[redis] connect');
  });

  client.on('ready', () => {
    console.log('[redis] ready');
    // Perform a runtime check of the eviction policy to warn or enforce
    (async () => {
      try {
        // CONFIG GET returns an array like ['maxmemory-policy', 'volatile-lru']
        const cfg = await client.config('GET', 'maxmemory-policy');
        const policy = Array.isArray(cfg) && cfg.length >= 2 ? String(cfg[1]) : null;
        if (!policy) {
          console.warn('[redis] could not determine maxmemory-policy');
          return;
        }
        if (policy !== 'noeviction') {
          console.error(`IMPORTANT! Eviction policy is ${policy}. It should be "noeviction" for BullMQ reliability.`);
          // If the operator set enforcement, exit so deploy fails fast
          if (process.env.REDIS_ENFORCE_NOEVICTION === 'true') {
            console.error('[redis] REDIS_ENFORCE_NOEVICTION=true — exiting to avoid unreliable queue behavior');
            // give logs a moment to flush
            setTimeout(() => process.exit(1), 250);
          }
        } else {
          console.log('[redis] maxmemory-policy = noeviction (OK)');
        }
      } catch (err) {
        console.warn('[redis] failed to read CONFIG maxmemory-policy:', err && err.message ? err.message : err);
      }
    })();
  });

  return client;
}

function getConnectionOptions() {
  // BullMQ accepts an object passed to ioredis; passing { url } is supported.
  const url = process.env.REDIS_URL || 'redis://localhost:6379/0';
  return { url, lazyConnect: true };
}

module.exports = {
  createRedisInstance,
  getConnectionOptions,
};
