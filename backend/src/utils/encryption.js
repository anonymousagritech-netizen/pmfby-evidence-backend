// App-level AES-256-GCM encryption for evidence files at rest.
// Key source: EVIDENCE_ENCRYPTION_KEY env var, base64-encoded 32 bytes. This is a
// "secure key store" abstraction stand-in for this pass — see RISKS.md for the real
// secure-storage follow-up needed in production (e.g. KMS/HSM-backed key, mobile
// expo-secure-store for any client-held keys).
const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const key = Buffer.from(env.evidenceEncryptionKey, 'base64');
  if (key.length !== 32) {
    throw new Error('EVIDENCE_ENCRYPTION_KEY must decode to exactly 32 bytes (base64).');
  }
  return key;
}

// Returns a single buffer: [iv(12)][authTag(16)][ciphertext]
function encryptBuffer(plainBuffer) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decryptBuffer(envelope) {
  const key = getKey();
  const iv = envelope.subarray(0, IV_LENGTH);
  const authTag = envelope.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = envelope.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { encryptBuffer, decryptBuffer };
