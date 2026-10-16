process.env.EVIDENCE_ENCRYPTION_KEY = process.env.EVIDENCE_ENCRYPTION_KEY
  || require('crypto').randomBytes(32).toString('base64');

const { encryptBuffer, decryptBuffer } = require('../../src/utils/encryption');

describe('AES-256-GCM encryption util', () => {
  test('round-trips arbitrary binary data', () => {
    const plain = Buffer.from('a very secret evidence payload \u0000\u0001\u0002', 'utf8');
    const envelope = encryptBuffer(plain);
    const decrypted = decryptBuffer(envelope);
    expect(decrypted.equals(plain)).toBe(true);
  });

  test('envelope is not equal to the plaintext (actually encrypted)', () => {
    const plain = Buffer.from('plaintext-marker');
    const envelope = encryptBuffer(plain);
    expect(envelope.includes(plain)).toBe(false);
  });

  test('tampering with the envelope fails authentication (GCM auth tag)', () => {
    const plain = Buffer.from('integrity-protected payload');
    const envelope = encryptBuffer(plain);
    const tampered = Buffer.from(envelope);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptBuffer(tampered)).toThrow();
  });

  test('produces a different envelope each time (random IV)', () => {
    const plain = Buffer.from('same input');
    const e1 = encryptBuffer(plain);
    const e2 = encryptBuffer(plain);
    expect(e1.equals(e2)).toBe(false);
  });
});
