"use strict";

/**
 * Lightweight utilities operating on user objects (pure functions).
 * These helpers intentionally avoid database calls so they can be
 * unit-tested in isolation and later integrated into the real model.
 */

/** Ensure user.refreshTokens exists and add token if missing. */
function addRefreshToken(user, token) {
  if (!user) throw new Error('user required');
  if (!Array.isArray(user.refreshTokens)) user.refreshTokens = [];
  if (!user.refreshTokens.includes(token)) user.refreshTokens.push(token);
  return user;
}

/**
 * Atomically rotate a refresh token: if `candidate` exists in
 * `user.refreshTokens` replace it with `newToken` and return success.
 * If candidate is missing, return { success: false }.
 */
function rotateRefreshToken(user, candidate, newToken) {
  if (!user) throw new Error('user required');
  const tokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
  const idx = tokens.indexOf(candidate);
  if (idx === -1) return { success: false };
  // replace in-place to simulate an atomic DB update
  user.refreshTokens[idx] = newToken;
  return { success: true, replaced: candidate };
}

/** Remove a refresh token from the user's list. */
function removeRefreshToken(user, token) {
  if (!user) throw new Error('user required');
  const tokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
  const idx = tokens.indexOf(token);
  if (idx === -1) return { removed: false };
  user.refreshTokens.splice(idx, 1);
  return { removed: true };
}

module.exports = {
  addRefreshToken,
  rotateRefreshToken,
  removeRefreshToken,
};
