const { proposeColumnMapping } = require('../../src/services/columnMapping');

describe('columnMapping (AI/auto column mapping for Excel import)', () => {
  test('maps exact spec header names with exact confidence', () => {
    const mapping = proposeColumnMapping(['Farmer_Name', 'Level7_Name', 'Level7_ID', 'Surveyor_Mobile']);
    expect(mapping.Farmer_Name).toEqual({ field: 'Farmer_Name', confidence: 'exact' });
    expect(mapping.Level7_Name).toEqual({ field: 'Level7_Name', confidence: 'exact' });
    expect(mapping.Level7_ID).toEqual({ field: 'Level7_ID', confidence: 'exact' });
    expect(mapping.Surveyor_Mobile).toEqual({ field: 'Surveyor_Mobile', confidence: 'exact' });
  });

  test('maps common header-rename aliases (village, village_id)', () => {
    const mapping = proposeColumnMapping(['village_name', 'village_id']);
    expect(mapping.village_name.field).toBe('Level7_Name');
    expect(mapping.village_id.field).toBe('Level7_ID');
  });

  test('never maps Surveyor_Mobile onto Farmer_Mobile (no such field exists to map onto)', () => {
    const mapping = proposeColumnMapping(['Surveyor_Mobile']);
    expect(mapping.Surveyor_Mobile.field).toBe('Surveyor_Mobile');
    expect(mapping.Surveyor_Mobile.field).not.toBe('Farmer_Mobile');
  });

  test('does not double-assign the same app field to two source headers', () => {
    const mapping = proposeColumnMapping(['Farmer_Name', 'farmer name']);
    const assignedFields = Object.values(mapping).map((m) => m.field).filter(Boolean);
    const uniqueFields = new Set(assignedFields);
    expect(assignedFields.length).toBe(uniqueFields.size);
  });

  test('returns confidence "none" for a header with no plausible match', () => {
    const mapping = proposeColumnMapping(['Totally_Unrelated_Garbage_Column_Xyz']);
    expect(mapping.Totally_Unrelated_Garbage_Column_Xyz.confidence).toBe('none');
    expect(mapping.Totally_Unrelated_Garbage_Column_Xyz.field).toBeNull();
  });
});

describe('Farmer_Mobile mapping', () => {
  test('farmerMobile header maps to Farmer_Mobile (exact)', () => {
    const m = proposeColumnMapping(['farmerName', 'farmerMobile']);
    expect(m.farmerMobile).toEqual({ field: 'Farmer_Mobile', confidence: 'exact' });
  });

  test('surveyorMobile and villagersMobile never map to Farmer_Mobile', () => {
    const m = proposeColumnMapping(['farmerMobile', 'surveyorMobile', 'villagersMobile']);
    expect(m.surveyorMobile.field).toBe('Surveyor_Mobile');
    expect(m.villagersMobile.field).toBe('Source_Villager_Mobile');
    expect(m.farmerMobile.field).toBe('Farmer_Mobile');
  });

  test('without a farmer mobile column, surveyor/villager mobile are not mistaken for it', () => {
    const m = proposeColumnMapping(['surveyorMobile', 'villagersMobile']);
    expect(Object.values(m).some((x) => x.field === 'Farmer_Mobile')).toBe(false);
  });
});
