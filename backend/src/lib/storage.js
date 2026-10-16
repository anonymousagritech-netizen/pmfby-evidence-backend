// S3-compatible storage interface, local-disk implementation. Swap this class out for a
// real S3/MinIO-backed implementation later without touching callers (they only ever use
// putObject/getObject/deleteObject/exists against a "key" string).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const env = require('../config/env');
const { encryptBuffer, decryptBuffer } = require('../utils/encryption');

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

module.exports = { LocalDiskStorage, storage: new LocalDiskStorage() };
