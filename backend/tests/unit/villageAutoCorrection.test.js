jest.mock('../../src/services/villageLookupService');
const villageLookup = require('../../src/services/villageLookupService');
const { applyVillageAutoCorrection } = require('../../src/services/importService');

describe('importService.applyVillageAutoCorrection', () => {
  afterEach(() => jest.resetAllMocks());

  test('leaves fields untouched when no Level7_Name present', async () => {
    const { fields, note } = await applyVillageAutoCorrection({ Farmer_Name: 'X' });
    expect(fields).toEqual({ Farmer_Name: 'X' });
    expect(note).toBeNull();
  });

  test('leaves fields untouched on an exact match (nothing to correct)', async () => {
    villageLookup.findVillage.mockResolvedValue({ match: { village: 'Kothapet', district_h: 'CHITTOOR' }, confidence: 1, method: 'exact' });
    const { fields, note } = await applyVillageAutoCorrection({ Level7_Name: 'Kothapet', District_Name: 'Chittoor' });
    expect(fields.Level7_Name).toBe('Kothapet');
    expect(note).toBeNull();
  });

  test('auto-corrects a high-confidence fuzzy match', async () => {
    villageLookup.findVillage.mockResolvedValue({ match: { village: 'Kothapeta', district_h: 'CHITTOOR' }, confidence: 0.95, method: 'fuzzy' });
    const { fields, note } = await applyVillageAutoCorrection({ Level7_Name: 'Kothapeta Typo', District_Name: 'Chittoor' });
    expect(fields.Level7_Name).toBe('Kothapeta');
    expect(note.type).toBe('auto_corrected_village');
    expect(note.from).toBe('Kothapeta Typo');
    expect(note.to).toBe('Kothapeta');
  });

  test('flags a mid-confidence match for review without changing the value', async () => {
    villageLookup.findVillage.mockResolvedValue({ match: { village: 'SomeVillage', district_h: 'X' }, confidence: 0.85, method: 'fuzzy' });
    const { fields, note } = await applyVillageAutoCorrection({ Level7_Name: 'SomeVilige', District_Name: 'X' });
    expect(fields.Level7_Name).toBe('SomeVilige'); // unchanged
    expect(note.type).toBe('village_needs_review');
    expect(note.suggestion).toBe('SomeVillage');
  });

  test('does nothing when confidence is too low or no match found', async () => {
    villageLookup.findVillage.mockResolvedValue({ match: null, confidence: 0, method: 'none' });
    const { fields, note } = await applyVillageAutoCorrection({ Level7_Name: 'Unrecognizable Place' });
    expect(fields.Level7_Name).toBe('Unrecognizable Place');
    expect(note).toBeNull();
  });

  test('degrades silently (never blocks import) if the lookup dataset is unavailable', async () => {
    villageLookup.findVillage.mockRejectedValue(new Error('dataset not loaded'));
    const { fields, note } = await applyVillageAutoCorrection({ Level7_Name: 'AnyVillage' });
    expect(fields.Level7_Name).toBe('AnyVillage');
    expect(note).toBeNull();
  });
});
