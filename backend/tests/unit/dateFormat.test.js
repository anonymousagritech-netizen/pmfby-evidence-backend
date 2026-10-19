const { formatDateIST, formatDateTimeIST } = require('../../src/utils/dateFormat');

describe('formatDateIST', () => {
  it('formats a Date as a clean IST day/month/year string, not a toString dump', () => {
    // 2026-10-13T00:00:00Z -> 13 Oct 2026 in IST (+5:30), well clear of midnight rollover
    const d = new Date('2026-10-13T00:00:00.000Z');
    expect(formatDateIST(d)).toBe('13 Oct 2026');
    expect(formatDateIST(d)).not.toMatch(/GMT|Coordinated Universal/);
  });

  it('rolls a late-UTC timestamp forward into the next IST day', () => {
    // 20:00 UTC + 5:30 = 01:30 next day in IST
    const d = new Date('2026-10-13T20:00:00.000Z');
    expect(formatDateIST(d)).toBe('14 Oct 2026');
  });

  it('accepts an ISO string', () => {
    expect(formatDateIST('2026-01-01T00:00:00.000Z')).toBe('01 Jan 2026');
  });

  it('returns null for missing or invalid input', () => {
    expect(formatDateIST(null)).toBeNull();
    expect(formatDateIST(undefined)).toBeNull();
    expect(formatDateIST('')).toBeNull();
    expect(formatDateIST('not-a-date')).toBeNull();
  });
});

describe('formatDateTimeIST', () => {
  it('formats date and time together in IST', () => {
    const d = new Date('2026-10-13T09:00:00.000Z'); // 14:30 IST
    expect(formatDateTimeIST(d)).toMatch(/^13 Oct 2026, 02:30 ?[PpAa][Mm]$/);
  });

  it('returns null for missing input', () => {
    expect(formatDateTimeIST(null)).toBeNull();
  });
});
