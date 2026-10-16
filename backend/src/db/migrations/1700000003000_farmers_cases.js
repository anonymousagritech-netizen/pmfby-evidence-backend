exports.up = (pgm) => {
  // farmer_records: identity-level entity. Dedup heuristic (name+village+mobile) lives in
  // application code (see services/farmerDedupe.js) — Docket_ID2/Application_No are
  // source/case identifiers, NOT assumed-unique farmer identity.
  pgm.createTable('farmer_records', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    farmer_name: { type: 'text', notNull: true },
    village_name: { type: 'text' }, // Level7_Name
    village_id: { type: 'text' }, // Level7_ID (string, preserve leading zeros)
    district_name: { type: 'text' },
    district_id: { type: 'text' },
    state_name: { type: 'text' },
    state_id: { type: 'text' },
    // NOT populated from Surveyor_Mobile at import time. Nullable until explicitly
    // validated/entered later via UI mapping. Never invented.
    farmer_mobile: { type: 'text' },
    dedupe_key: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
  });
  pgm.createIndex('farmer_records', 'dedupe_key');
  pgm.createIndex('farmer_records', 'village_id');

  // survey_cases: one row per imported Excel record (1 farmer : many cases).
  pgm.createTable('survey_cases', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    docket_id2: { type: 'text' },
    season_name: { type: 'text' },
    scheme_name: { type: 'text' },
    application_no: { type: 'text' },
    type_of_incidence: { type: 'text' },
    date_of_incidence: { type: 'date' },
    crop_status_at_incidence: { type: 'text' },
    farmer_intimation_date: { type: 'date' },
    sowing_date: { type: 'date' },
    farm_area: { type: 'numeric' },
    crop_name: { type: 'text' },
    land_survey_number: { type: 'text' },
    land_division_number: { type: 'text' },
    insurance_company: { type: 'text' },
    application_source: { type: 'text' },
    state_name: { type: 'text' },
    state_id: { type: 'text' },
    district_name: { type: 'text' },
    district_id: { type: 'text' },
    level4_name: { type: 'text' },
    level4_id: { type: 'text' },
    level5_name: { type: 'text' },
    level5_id: { type: 'text' },
    level6_name: { type: 'text' },
    level6_id: { type: 'text' },
    level7_name: { type: 'text' },
    level7_id: { type: 'text' },
    survey_status: { type: 'text' },
    intimation_assign_deadline: { type: 'date' },
    survey_agency_name: { type: 'text' },
    survey_assigned_on: { type: 'date' },
    // Source surveyor identified in import file — NOT the farmer's contact number.
    surveyor_name: { type: 'text' },
    surveyor_mobile: { type: 'text' },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    forceful_survey_flag: { type: 'boolean', notNull: true, default: false },
    import_row_ref: { type: 'text' }, // original row number/import batch, for traceability
    // Outcome-resolution state machine (mandatory outcome loop). One of:
    // pending_contact (never contacted / unresolved), postponed (open, new target date),
    // denied, wrong_number, dispute_incident (closed-but-unsuccessful -> escalated),
    // completed (closed-successful). Drives surveyor's 4 mobile tabs and the admin/manager
    // live view off the SAME column (single source of truth, no separate sync step).
    contact_status: { type: 'text', notNull: true, default: 'pending_contact' },
    postponed_until: { type: 'date' },
    closed_at: { type: 'timestamptz' },
    closed_reason: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
  });
  pgm.createIndex('survey_cases', 'farmer_id');
  pgm.createIndex('survey_cases', 'district_id');
  pgm.createIndex('survey_cases', 'docket_id2');
  pgm.createIndex('survey_cases', 'contact_status');
  // Daily re-upload upsert key: match incoming Excel rows to existing cases by
  // (Docket_ID2, Application_No) so a re-import UPDATEs instead of duplicating.
  pgm.createIndex('survey_cases', ['docket_id2', 'application_no'], {
    unique: true,
    where: 'docket_id2 IS NOT NULL AND application_no IS NOT NULL AND deleted_at IS NULL',
    name: 'survey_cases_docket_application_upsert_key',
  });

  pgm.createTable('farmer_assignments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    assigned_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    assigned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    unassigned_at: { type: 'timestamptz' },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('farmer_assignments', 'farmer_id');
  pgm.createIndex('farmer_assignments', 'user_id');
  // Only one active assignment per farmer at a time.
  pgm.createIndex('farmer_assignments', 'farmer_id', {
    unique: true,
    where: 'active = true',
    name: 'farmer_assignments_one_active_per_farmer',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('farmer_assignments');
  pgm.dropTable('survey_cases');
  pgm.dropTable('farmer_records');
};
