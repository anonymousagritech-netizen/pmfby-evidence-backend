const ExcelJS = require('exceljs');
const { pool, withTransaction } = require('../db/pool');
const { proposeColumnMapping } = require('./columnMapping');
const { buildDedupeKey } = require('./farmerDedupe');
const importSessionStore = require('./importSessionStore');

// Columns that must always be treated as strings (preserve leading zeros / original
// source IDs — never coerced through Number()).
const STRING_ID_FIELDS = new Set([
  'Docket_ID2', 'Application_No', 'State_ID', 'District_ID',
  'Level4_ID', 'Level5_ID', 'Level6_ID', 'Level7_ID',
]);

const REQUIRED_FIELDS = ['Farmer_Name'];

function cellToValue(cell, field) {
  if (cell === null || cell === undefined) return null;
  let raw = cell;
  if (typeof cell === 'object' && cell.text !== undefined) raw = cell.text;
  if (typeof cell === 'object' && cell.result !== undefined) raw = cell.result;
  if (raw === null || raw === undefined || raw === '') return null;
  if (STRING_ID_FIELDS.has(field)) return String(raw).trim();
  return raw;
}

async function parseWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheet found in uploaded file');

  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value || '').trim();
  });

  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;
    const rowValues = {};
    let hasAnyValue = false;
    headers.forEach((header, colNumber) => {
      if (!header) return;
      const cell = row.getCell(colNumber);
      const value = cell.value;
      rowValues[header] = value;
      if (value !== null && value !== undefined && value !== '') hasAnyValue = true;
    });
    if (hasAnyValue) rows.push({ rowNumber, values: rowValues });
  }

  return { headers: headers.filter(Boolean), rows };
}

// Step 1: upload + parse + propose mapping. Returns a preview for the admin to confirm
// or override before anything is committed to the database.
async function createImportPreview({ buffer, originalFilename, uploadedBy }) {
  const { headers, rows } = await parseWorkbookBuffer(buffer);
  const mapping = proposeColumnMapping(headers);
  const sessionId = importSessionStore.createSession({
    headers, rows, originalFilename, uploadedBy,
  });
  const previewRows = rows.slice(0, 10).map((r) => r.values);
  return { sessionId, headers, proposedMapping: mapping, previewRows, totalRows: rows.length };
}

function mapRowToFields(rowValues, confirmedMapping, headers) {
  const fields = {};
  for (const header of headers) {
    const target = confirmedMapping[header];
    if (!target) continue;
    fields[target] = cellToValue(rowValues[header], target);
  }
  return fields;
}

function validateFields(fields) {
  const errors = [];
  for (const required of REQUIRED_FIELDS) {
    if (!fields[required]) errors.push(`Missing required field: ${required}`);
  }
  return errors;
}

async function findOrCreateFarmer(client, fields) {
  const dedupeKey = buildDedupeKey({
    farmerName: fields.Farmer_Name,
    villageId: fields.Level7_ID,
    villageName: fields.Level7_Name,
    farmerMobile: null, // never sourced from import — see spec: no guaranteed farmer-mobile column
  });

  const existing = await client.query(
    'SELECT id FROM farmer_records WHERE dedupe_key = $1 AND deleted_at IS NULL LIMIT 1',
    [dedupeKey]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO farmer_records (farmer_name, village_name, village_id, district_name,
       district_id, state_name, state_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      fields.Farmer_Name, fields.Level7_Name, fields.Level7_ID, fields.District_Name,
      fields.District_ID, fields.State_Name, fields.State_ID, dedupeKey,
    ]
  );
  return inserted.rows[0].id;
}

const CASE_COLUMNS = [
  ['docket_id2', 'Docket_ID2'], ['season_name', 'Season_Name'], ['scheme_name', 'Scheme_Name'],
  ['application_no', 'Application_No'], ['type_of_incidence', 'Type_Of_Incidence'],
  ['date_of_incidence', 'Date_Of_Incidence'], ['crop_status_at_incidence', 'Crop_Status_At_Incidence'],
  ['farmer_intimation_date', 'Farmer_Intimation_Date'], ['sowing_date', 'Sowing_Date'],
  ['farm_area', 'Farm_Area'], ['crop_name', 'Crop_Name'], ['land_survey_number', 'Land_Survey_Number'],
  ['land_division_number', 'Land_Division_Number'], ['insurance_company', 'Insurance_Company'],
  ['application_source', 'Application_Source'], ['state_name', 'State_Name'], ['state_id', 'State_ID'],
  ['district_name', 'District_Name'], ['district_id', 'District_ID'], ['level4_name', 'Level4_Name'],
  ['level4_id', 'Level4_ID'], ['level5_name', 'Level5_Name'], ['level5_id', 'Level5_ID'],
  ['level6_name', 'Level6_Name'], ['level6_id', 'Level6_ID'], ['level7_name', 'Level7_Name'],
  ['level7_id', 'Level7_ID'], ['survey_status', 'Survey_Status'],
  ['intimation_assign_deadline', 'Intimation_Assign_Deadline'],
  ['survey_agency_name', 'Survey_Agency_Name'], ['survey_assigned_on', 'Survey_Assigned_On'],
  ['surveyor_name', 'Surveyor_Name'], ['surveyor_mobile', 'Surveyor_Mobile'],
];

function toDbValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value;
  return value;
}

async function upsertCase(client, farmerId, fields, importRowRef) {
  const docketId2 = toDbValue(fields.Docket_ID2);
  const applicationNo = toDbValue(fields.Application_No);

  let existing = null;
  if (docketId2 && applicationNo) {
    const found = await client.query(
      `SELECT * FROM survey_cases WHERE docket_id2 = $1 AND application_no = $2
         AND deleted_at IS NULL LIMIT 1`,
      [docketId2, applicationNo]
    );
    existing = found.rows[0] || null;
  }

  const values = CASE_COLUMNS.map(([, srcField]) => toDbValue(fields[srcField]));

  if (!existing) {
    const columnNames = CASE_COLUMNS.map(([col]) => col);
    const placeholders = columnNames.map((_, i) => `$${i + 3}`).join(', ');
    await client.query(
      `INSERT INTO survey_cases (farmer_id, import_row_ref, ${columnNames.join(', ')})
       VALUES ($1, $2, ${placeholders})`,
      [farmerId, importRowRef, ...values]
    );
    return { status: 'inserted', changedFields: [] };
  }

  const changedFields = [];
  const setClauses = [];
  const params = [existing.id];
  let paramIndex = 2;
  for (const [col, srcField] of CASE_COLUMNS) {
    const newValue = toDbValue(fields[srcField]);
    const oldValue = existing[col];
    const oldComparable = oldValue instanceof Date ? oldValue.toISOString().slice(0, 10) : oldValue;
    const newComparable = newValue instanceof Date ? newValue.toISOString().slice(0, 10) : newValue;
    if (String(oldComparable ?? '') !== String(newComparable ?? '')) {
      changedFields.push(col);
      setClauses.push(`${col} = $${paramIndex}`);
      params.push(newValue);
      paramIndex += 1;
    }
  }

  if (changedFields.length === 0) {
    return { status: 'unchanged', changedFields: [] };
  }

  setClauses.push('updated_at = now()');
  await client.query(
    `UPDATE survey_cases SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  );
  return { status: 'updated', changedFields };
}

// Step 2: commit the (possibly admin-overridden) mapping. Performs dedupe + upsert in a
// single DB transaction per row-batch, and persists an import_batches summary row.
async function commitImport({ sessionId, confirmedMapping, uploadedBy }) {
  const session = importSessionStore.getSession(sessionId);
  if (!session) throw new Error('Import session not found or expired. Please re-upload.');

  const summary = { inserted: 0, updated: 0, unchanged: 0, skipped: 0, errored: 0 };
  const rowLog = [];

  await withTransaction(async (client) => {
    for (const row of session.rows) {
      try {
        const fields = mapRowToFields(row.values, confirmedMapping, session.headers);
        const errors = validateFields(fields);
        if (errors.length > 0) {
          summary.errored += 1;
          rowLog.push({ row: row.rowNumber, status: 'error', error: errors.join('; ') });
          continue;
        }
        const farmerId = await findOrCreateFarmer(client, fields);
        const result = await upsertCase(client, farmerId, fields, `row:${row.rowNumber}`);
        summary[result.status === 'inserted' ? 'inserted'
          : result.status === 'updated' ? 'updated' : 'unchanged'] += 1;
        rowLog.push({ row: row.rowNumber, status: result.status, changedFields: result.changedFields });
      } catch (err) {
        summary.errored += 1;
        rowLog.push({ row: row.rowNumber, status: 'error', error: err.message });
      }
    }

    await client.query(
      `INSERT INTO import_batches (uploaded_by, original_filename, column_mapping,
         inserted_count, updated_count, unchanged_count, skipped_count, error_count, row_log)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        uploadedBy, session.originalFilename, JSON.stringify(confirmedMapping),
        summary.inserted, summary.updated, summary.unchanged, summary.skipped, summary.errored,
        JSON.stringify(rowLog),
      ]
    );
  });

  importSessionStore.deleteSession(sessionId);
  return { summary, rowLog };
}

module.exports = {
  parseWorkbookBuffer,
  createImportPreview,
  commitImport,
};
