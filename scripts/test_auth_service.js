// Simple smoke tests for services/authService.js
const auth = require('../services/authService');

async function run() {
  try {
    const payload = { id: 42, role: 'tester' };
    const access = auth.signAccessToken(payload, '1h');
    const decoded = auth.verifyAccessToken(access);
    if (!decoded || Number(decoded.id) !== 42) {
      console.error('authService access token verification failed', decoded);
      process.exit(2);
    }

    const refresh = auth.signRefreshToken({ id: 42 }, '7d');
    const decodedR = auth.verifyRefreshToken(refresh);
    if (!decodedR || Number(decodedR.id) !== 42) {
      console.error('authService refresh token verification failed', decodedR);
      process.exit(3);
    }

    console.log('authService tests passed');
    process.exit(0);
  } catch (err) {
    console.error('authService tests error', err && err.stack ? err.stack : err);
    process.exit(10);
  }
}

run();
