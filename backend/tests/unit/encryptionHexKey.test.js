// Regression: the deployed EVIDENCE_ENCRYPTION_KEY is 64 hex chars. The old parser only accepted
// base64, so every evidence/recording upload threw and nothing was ever stored.
process.env.EVIDENCE_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');

const { encryptBuffer, decryptBuffer } = require('../../src/utils/encryption');

describe('encryption with a 64-char hex key', () => {
  test('round-trips data', () => {
    const plain = Buffer.from('call recording bytes \u0000\u0001');
    expect(decryptBuffer(encryptBuffer(plain)).equals(plain)).toBe(true);
  });
});
