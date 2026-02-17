const jwt = require('jsonwebtoken');

function getAccessSecret() {
  if (!process.env.JWT_SECRET) console.warn('Warning: JWT_SECRET is not set. Using development fallback secret.');
  return process.env.JWT_SECRET || 'dev_jwt_secret';
}

function getRefreshSecret() {
  return process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev_refresh_secret';
}

function signAccessToken(payload = {}, expiresIn) {
  const exp = expiresIn || process.env.ACCESS_EXPIRES_IN || '1h';
  return jwt.sign(payload, getAccessSecret(), { expiresIn: exp });
}

function signRefreshToken(payload = {}, expiresIn) {
  const exp = expiresIn || process.env.REFRESH_EXPIRES_IN || '7d';
  return jwt.sign(payload, getRefreshSecret(), { expiresIn: exp });
}

function verifyAccessToken(token) {
  return jwt.verify(token, getAccessSecret());
}

function verifyRefreshToken(token) {
  return jwt.verify(token, getRefreshSecret());
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
