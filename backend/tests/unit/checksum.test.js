const fs = require('fs');
const os = require('os');
const path = require('path');
const { sha256Buffer, sha256File } = require('../../src/utils/checksum');

describe('checksum', () => {
  test('sha256Buffer is deterministic', () => {
    const a = sha256Buffer(Buffer.from('hello world'));
    const b = sha256Buffer(Buffer.from('hello world'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  test('sha256Buffer differs for different content', () => {
    const a = sha256Buffer(Buffer.from('hello'));
    const b = sha256Buffer(Buffer.from('world'));
    expect(a).not.toBe(b);
  });

  test('sha256File matches sha256Buffer for the same bytes', async () => {
    const tmpPath = path.join(os.tmpdir(), `checksum-test-${Date.now()}.txt`);
    const content = Buffer.from('evidence file contents');
    fs.writeFileSync(tmpPath, content);
    const fileHash = await sha256File(tmpPath);
    expect(fileHash).toBe(sha256Buffer(content));
    fs.unlinkSync(tmpPath);
  });
});
