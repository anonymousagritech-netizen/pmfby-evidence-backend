const ExcelJS = require('exceljs');
const { parseAndGroupSurveyorFile, normalizeMobile, normalizeStatus } = require('../../src/services/surveyorImportService');

async function buildBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(['districtName', 'surveyorName', 'surveyorMobile', 'Status (Active/Inactive/Delete)']);
  for (const r of rows) sheet.addRow(r);
  return wb.xlsx.writeBuffer();
}

describe('surveyorImportService: normalization helpers', () => {
  test('normalizeMobile handles numeric Excel cells without scientific notation/decimals', () => {
    expect(normalizeMobile(9907435434)).toBe('9907435434');
    expect(normalizeMobile('9907435434')).toBe('9907435434');
    expect(normalizeMobile(null)).toBeNull();
  });

  test('normalizeStatus recognizes the three valid values case-insensitively, else null', () => {
    expect(normalizeStatus('Active')).toBe('Active');
    expect(normalizeStatus('inactive')).toBe('Inactive');
    expect(normalizeStatus('DELETE')).toBe('Delete');
    expect(normalizeStatus('Pending')).toBeNull();
    expect(normalizeStatus(null)).toBeNull();
  });
});

describe('surveyorImportService.parseAndGroupSurveyorFile', () => {
  test('dedupes by mobile and aggregates every district seen for that mobile', async () => {
    const buffer = await buildBuffer([
      ['Palwal', 'Ramesh', 9999999999, 'Active'],
      ['Faridabad', 'Ramesh', 9999999999, 'Active'],
      ['Palwal', 'Ramesh', 9999999999, 'Active'], // exact repeat, same district
    ]);
    const { totalRows, groups } = await parseAndGroupSurveyorFile(buffer);
    expect(totalRows).toBe(3);
    expect(groups).toHaveLength(1);
    expect(groups[0].mobile).toBe('9999999999');
    expect(groups[0].districts).toEqual(['Faridabad', 'Palwal']); // deduped + sorted
    expect(groups[0].rowCount).toBe(3);
  });

  test('conflicting status values across a mobile\'s rows are flagged, resolved to the LAST value in file order', async () => {
    const buffer = await buildBuffer([
      ['Palwal', 'Suresh', 8888888888, 'Active'],
      ['Palwal', 'Suresh', 8888888888, 'Inactive'],
      ['Palwal', 'Suresh', 8888888888, 'Delete'],
    ]);
    const { groups } = await parseAndGroupSurveyorFile(buffer);
    expect(groups[0].statusConflict).toBe(true);
    expect(groups[0].statusValuesSeen).toEqual(['Active', 'Inactive', 'Delete']);
    expect(groups[0].finalStatus).toBe('Delete'); // last one wins
  });

  test('a single consistent status across all rows is not flagged as a conflict', async () => {
    const buffer = await buildBuffer([
      ['Palwal', 'X', 7777777777, 'Active'],
      ['Palwal', 'X', 7777777777, 'Active'],
    ]);
    const { groups } = await parseAndGroupSurveyorFile(buffer);
    expect(groups[0].statusConflict).toBe(false);
    expect(groups[0].finalStatus).toBe('Active');
  });

  test('a mobile with no usable status value anywhere resolves to null (no action taken)', async () => {
    const buffer = await buildBuffer([
      ['Palwal', 'Y', 6666666666, null],
      ['Faridabad', 'Y', 6666666666, ''],
    ]);
    const { groups } = await parseAndGroupSurveyorFile(buffer);
    expect(groups[0].finalStatus).toBeNull();
    expect(groups[0].statusConflict).toBe(false);
  });

  test('rows with no mobile at all are skipped (not grouped under "null"/"undefined")', async () => {
    const buffer = await buildBuffer([
      ['Palwal', 'NoMobile', null, 'Active'],
      ['Palwal', 'HasMobile', 5555555555, 'Active'],
    ]);
    const { totalRows, groups } = await parseAndGroupSurveyorFile(buffer);
    expect(totalRows).toBe(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].mobile).toBe('5555555555');
  });
});
