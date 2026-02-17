const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../services/pg');
const fs = require('fs');
const path = require('path');

function getJwtSecret() {
  if (!process.env.JWT_SECRET) console.warn('Warning: JWT_SECRET is not set. Using fallback.');
  return process.env.JWT_SECRET || 'dev_jwt_secret';
}

class User {
  constructor(data = {}, isNew = false) {
    this._isNew = isNew;
    Object.assign(this, data);
    if (this.id && !this._id) this._id = String(this.id);
  }

  select() { return this; }

  async comparePassword(candidate) {
    if (!this.password) return false;
    return bcrypt.compare(candidate, this.password);
  }

  generateAccessToken() {
    return jwt.sign({ id: this._id || String(this.id), role: this.role }, getJwtSecret(), { expiresIn: '7d' });
  }

  async save() {
    if (this._isNew) {
      const hash = await bcrypt.hash(this.password, 10);
      const sql = `INSERT INTO users(username, email, password, role, profile_picture, refresh_tokens, created_at, updated_at)
                   VALUES($1,$2,$3,$4,$5,$6,now(),now()) RETURNING *`;
      const params = [this.username, this.email, hash, this.role || 'user', this.profilePicture || null, this.refreshTokens || []];
      const res = await query(sql, params);
      const row = res.rows[0];
      Object.assign(this, row);
      if (this.id && !this._id) this._id = String(this.id);
      // Log save result for debugging refresh token persistence
      try {
        const tmpDir = path.join(__dirname, '..', 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const logPath = path.join(tmpDir, 'users_save.log');
        const line = JSON.stringify({ ts: new Date().toISOString(), action: 'insert', userId: this.id || this._id, refreshTokensCount: (this.refreshTokens||[]).length }) + '\n';
        fs.appendFileSync(logPath, line);
      } catch (e) {}
      return this;
    }

    const sets = [];
    const params = [];
    let idx = 1;
    if (this.username) { sets.push(`username = $${idx++}`); params.push(this.username); }
    if (this.email) { sets.push(`email = $${idx++}`); params.push(this.email); }
    if (this.password) {
      // If the password already looks like a bcrypt hash (starts with $2),
      // assume it's already hashed and don't re-hash it. This prevents
      // double-hashing when a user object loaded from the DB is saved
      // after modifying other fields (e.g. refreshTokens).
      if (typeof this.password === 'string' && this.password.startsWith('$2')) {
        sets.push(`password = $${idx++}`);
        params.push(this.password);
      } else {
        const h = await bcrypt.hash(this.password, 10);
        sets.push(`password = $${idx++}`);
        params.push(h);
      }
    }
    if (this.role) { sets.push(`role = $${idx++}`); params.push(this.role); }
    if (this.profilePicture) { sets.push(`profile_picture = $${idx++}`); params.push(this.profilePicture); }
    if (this.refreshTokens) { sets.push(`refresh_tokens = $${idx++}`); params.push(this.refreshTokens); }
    if (!sets.length) return this;
    params.push(this.id || this._id);
    const sql = `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING *`;
    const res = await query(sql, params);
    Object.assign(this, res.rows[0]);
    if (this.id && !this._id) this._id = String(this.id);
    // Log save result for debugging refresh token persistence
    try {
      const tmpDir = path.join(__dirname, '..', 'tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const logPath = path.join(tmpDir, 'users_save.log');
      const line = JSON.stringify({ ts: new Date().toISOString(), action: 'update', userId: this.id || this._id, refreshTokensCount: (this.refreshTokens||[]).length }) + '\n';
      fs.appendFileSync(logPath, line);
    } catch (e) {}
    return this;
  }

  static async findOne(cond) {
    if (!cond || Object.keys(cond).length === 0) return null;
    if (cond.$or && Array.isArray(cond.$or)) {
      const or = cond.$or;
      const clauses = [];
      const params = [];
      let idx = 1;
      for (const c of or) {
        if (c.email) { clauses.push(`email = $${idx}`); params.push(c.email); idx++; }
        if (c.username) { clauses.push(`username = $${idx}`); params.push(c.username); idx++; }
      }
      if (!clauses.length) return null;
      const sql = `SELECT * FROM users WHERE ${clauses.join(' OR ')} LIMIT 1`;
      const res = await query(sql, params);
      if (!res.rows.length) return null;
      return new User(res.rows[0], false);
    }

    if (cond.refreshTokens) {
      const sql = `SELECT * FROM users WHERE $1 = ANY(refresh_tokens) LIMIT 1`;
      const res = await query(sql, [cond.refreshTokens]);
      if (!res.rows.length) return null;
      return new User(res.rows[0], false);
    }

    const keys = Object.keys(cond);
    const key = keys[0];
    const val = cond[key];
    const sql = `SELECT * FROM users WHERE ${key} = $1 LIMIT 1`;
    const res = await query(sql, [val]);
    if (!res.rows.length) return null;
    return new User(res.rows[0], false);
  }

  static async findById(id) {
    const sql = `SELECT * FROM users WHERE id = $1 LIMIT 1`;
    const res = await query(sql, [Number(id)]);
    if (!res.rows.length) return null;
    return new User(res.rows[0], false);
  }

  static async findByIdAndUpdate(id, update, options = {}) {
    const existing = await User.findById(id);
    if (!existing) return null;
    Object.assign(existing, update.$set || update);
    await existing.save();
    return existing;
  }

  static async find() {
    const res = await query('SELECT * FROM users');
    return res.rows.map((r) => new User(r, false));
  }

  /**
   * Atomically rotate a refresh token in Postgres for a specific user.
   * Returns the updated User instance on success, or null if candidate
   * token was not present for that user.
   */
  static async rotateRefreshToken(userId, candidate, newToken) {
    try {
      const sql = `UPDATE users
                   SET refresh_tokens = (
                     SELECT array_agg(CASE WHEN t = $2 THEN $3 ELSE t END)
                     FROM unnest(refresh_tokens) t
                   ), updated_at = now()
                   WHERE id = $1 AND $2 = ANY(refresh_tokens)
                   RETURNING *`;
      const res = await query(sql, [Number(userId), candidate, newToken]);
      if (!res.rows.length) return null;
      const user = new User(res.rows[0], false);
      // debug log
      try {
        const tmpDir = require('path').join(__dirname, '..', 'tmp');
        if (!require('fs').existsSync(tmpDir)) require('fs').mkdirSync(tmpDir, { recursive: true });
        const logPath = require('path').join(tmpDir, 'users_save.log');
        const line = JSON.stringify({ ts: new Date().toISOString(), action: 'rotate', userId: user.id || user._id, refreshTokensCount: (user.refreshTokens||[]).length }) + '\n';
        require('fs').appendFileSync(logPath, line);
      } catch (e) {}
      return user;
    } catch (e) {
      // If the DB isn't available or the query fails, return null to allow
      // callers to fallback to other strategies. Do not throw to avoid
      // breaking refresh flows during troubleshooting.
      return null;
    }
  }

  /** Add a refresh token if it's not already present (returns updated user or null). */
  static async addRefreshToken(userId, token) {
    try {
      const sql = `UPDATE users
                   SET refresh_tokens = CASE WHEN $2 = ANY(refresh_tokens) THEN refresh_tokens ELSE array_append(refresh_tokens, $2) END,
                       updated_at = now()
                   WHERE id = $1
                   RETURNING *`;
      const res = await query(sql, [Number(userId), token]);
      if (!res.rows.length) return null;
      return new User(res.rows[0], false);
    } catch (e) {
      return null;
    }
  }

  /** Remove a refresh token for the given user (returns updated user or null). */
  static async removeRefreshToken(userId, token) {
    try {
      const sql = `UPDATE users
                   SET refresh_tokens = array_remove(refresh_tokens, $2), updated_at = now()
                   WHERE id = $1
                   RETURNING *`;
      const res = await query(sql, [Number(userId), token]);
      if (!res.rows.length) return null;
      return new User(res.rows[0], false);
    } catch (e) {
      return null;
    }
  }
}

function createUser(doc) { return new User(doc, true); }

// Expose static helpers on the factory function for compatibility with existing code
createUser.findOne = User.findOne.bind(User);
createUser.findById = User.findById.bind(User);
createUser.findByIdAndUpdate = User.findByIdAndUpdate.bind(User);
createUser.find = User.find.bind(User);

module.exports = createUser;

