// S3-compatible storage interface, local-disk implementation. Swap this class out for a
// real S3/MinIO-backed implementation later without touching callers (they only ever use
// putObject/getObject/deleteObject/exists against a "key" string).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const env = require('../config/env');
const { encryptBuffer, decryptBuffer } = require('../utils/encryption');
const { pool } = require('../db/pool');

class LocalDiskStorage {
  constructor(root = env.storageRoot) {
    this.root = path.resolve(root);
  }

  _resolve(key) {
    // Prevent path traversal outside the storage root.
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root)) {
      throw new Error('Invalid storage key (path traversal attempt)');
    }
    return resolved;
  }

  async putObject(key, buffer, { encrypt = true } = {}) {
    const fullPath = this._resolve(key);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    const payload = encrypt ? encryptBuffer(buffer) : buffer;
    await fsp.writeFile(fullPath, payload);
    return { key, size: payload.length };
  }

  async getObject(key, { encrypted = true } = {}) {
    const fullPath = this._resolve(key);
    const payload = await fsp.readFile(fullPath);
    return encrypted ? decryptBuffer(payload) : payload;
  }

  async exists(key) {
    try {
      await fsp.access(this._resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key) {
    const fullPath = this._resolve(key);
    try {
      await fsp.unlink(fullPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  absolutePath(key) {
    return this._resolve(key);
  }
}

// Durable storage for hosts with an ephemeral filesystem (Render): the already-encrypted bytes live
// in Postgres, so evidence survives restarts and redeploys. The table is created on first use.
class DbStorage {
  async _ready() {
    if (!this._init) {
      this._init = pool.query(
        `CREATE TABLE IF NOT EXISTS stored_objects (
           key text PRIMARY KEY,
           data bytea NOT NULL,
           size_bytes integer NOT NULL,
           created_at timestamptz NOT NULL DEFAULT now()
         )`
      ).catch((err) => { this._init = null; throw err; });
    }
    return this._init;
  }

  async putObject(key, buffer, { encrypt = true } = {}) {
    await this._ready();
    const payload = encrypt ? encryptBuffer(buffer) : buffer;
    await pool.query(
      `INSERT INTO stored_objects (key, data, size_bytes) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, size_bytes = EXCLUDED.size_bytes`,
      [key, payload, payload.length]
    );
    return { key, size: payload.length };
  }

  async getObject(key, { encrypted = true } = {}) {
    await this._ready();
    const { rows } = await pool.query('SELECT data FROM stored_objects WHERE key = $1', [key]);
    if (!rows[0]) throw Object.assign(new Error(`Stored object not found: ${key}`), { code: 'ENOENT' });
    return encrypted ? decryptBuffer(rows[0].data) : rows[0].data;
  }

  async exists(key) {
    await this._ready();
    const { rows } = await pool.query('SELECT 1 FROM stored_objects WHERE key = $1', [key]);
    return rows.length > 0;
  }

  async deleteObject(key) {
    await this._ready();
    await pool.query('DELETE FROM stored_objects WHERE key = $1', [key]);
  }
}

// Tests and local development keep the disk implementation; production defaults to Postgres.
const useDisk = process.env.STORAGE_BACKEND === 'disk' || env.nodeEnv === 'test' || env.nodeEnv === 'development';

module.exports = { LocalDiskStorage, DbStorage, storage: useDisk ? new LocalDiskStorage() : new DbStorage() };
