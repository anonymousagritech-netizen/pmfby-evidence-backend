const { sanitizeFilenamePart, buildZipFilename, dedupeFilename } = require('../../src/utils/filename');

describe('filename sanitization', () => {
  test('replaces unsafe characters', () => {
    expect(sanitizeFilenamePart('Ram/Lal\\Singh:*?"<>|')).toBe('Ram_Lal_Singh');
  });

  test('collapses whitespace and trims underscores', () => {
    expect(sanitizeFilenamePart('  Ram   Lal  ')).toBe('Ram_Lal');
  });

  test('falls back to Unknown for empty input', () => {
    expect(sanitizeFilenamePart('')).toBe('Unknown');
    expect(sanitizeFilenamePart(null)).toBe('Unknown');
  });

  test('builds the spec-mandated zip filename pattern', () => {
    const name = buildZipFilename({ farmerName: 'Ram Lal', village: 'Kaithal', date: '2026-10-16', time: '14-30-00' });
    expect(name).toBe('Ram_Lal_Contact_Kaithal_2026-10-16_14-30-00.zip');
  });

  test('sanitizes unsafe chars inside the built filename', () => {
    const name = buildZipFilename({ farmerName: 'Ram/Lal', village: 'A:B', date: '2026-10-16', time: '10-00-00' });
    expect(name).toBe('Ram_Lal_Contact_A_B_2026-10-16_10-00-00.zip');
  });
});

describe('filename dedupe', () => {
  test('returns the name unchanged when there is no collision', () => {
    expect(dedupeFilename('a.zip', ['b.zip'])).toBe('a.zip');
  });

  test('appends _1 on first collision', () => {
    expect(dedupeFilename('a.zip', ['a.zip'])).toBe('a_1.zip');
  });

  test('appends _2 when _1 is also taken', () => {
    expect(dedupeFilename('a.zip', ['a.zip', 'a_1.zip'])).toBe('a_2.zip');
  });
});
