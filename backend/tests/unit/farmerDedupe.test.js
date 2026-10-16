const { buildDedupeKey } = require('../../src/services/farmerDedupe');

describe('farmerDedupe', () => {
  test('same name+village+mobile produces the same key regardless of case/whitespace', () => {
    const a = buildDedupeKey({ farmerName: 'Ram Lal', villageId: '001', villageName: 'Kaithal', farmerMobile: null });
    const b = buildDedupeKey({ farmerName: '  ram   lal ', villageId: '001', villageName: 'Different', farmerMobile: null });
    expect(a).toBe(b); // villageId takes priority over villageName when both given
  });

  test('different village produces a different key', () => {
    const a = buildDedupeKey({ farmerName: 'Ram Lal', villageId: '001', farmerMobile: null });
    const b = buildDedupeKey({ farmerName: 'Ram Lal', villageId: '002', farmerMobile: null });
    expect(a).not.toBe(b);
  });

  test('different farmer name produces a different key even in the same village', () => {
    const a = buildDedupeKey({ farmerName: 'Ram Lal', villageId: '001', farmerMobile: null });
    const b = buildDedupeKey({ farmerName: 'Shyam Lal', villageId: '001', farmerMobile: null });
    expect(a).not.toBe(b);
  });

  test('falls back to villageName when villageId is absent', () => {
    const a = buildDedupeKey({ farmerName: 'Ram Lal', villageName: 'Kaithal', farmerMobile: null });
    const b = buildDedupeKey({ farmerName: 'ram lal', villageName: 'kaithal', farmerMobile: null });
    expect(a).toBe(b);
  });
});
