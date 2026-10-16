// "Field Reality & Fraud-Risk Handling" additions: geotagging, person-contacted capture,
// discrepancy flags (fraud/data-mismatch, manager-judged), confidential integrity concerns
// (bribe/corruption reporting, super-admin-only, immutable), and emergency-review gating.
exports.up = (pgm) => {
  pgm.addColumns('call_events', {
    // Geotag of the surveyor's actual visit/call location, captured on every visit-based
    // outcome where device location is available. Protects surveyor from false
    // "didn't visit" complaints as much as it protects the farmer.
    geo_lat: { type: 'numeric' },
    geo_lon: { type: 'numeric' },
    geo_accuracy_m: { type: 'numeric' },
    geo_captured_at: { type: 'timestamptz' },
    // Who was actually spoken to / met — never assume it was the applicant themselves.
    person_contacted_type: { type: 'text' }, // farmer | family_member | neighbor | other
    person_contacted_name: { type: 'text' },
    person_contacted_relation: { type: 'text' },
  });

  pgm.addColumns('emergency_incidents', {
    requires_manager_review: { type: 'boolean', notNull: true, default: true },
    resolved_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    resolved_at: { type: 'timestamptz' },
    resolution_notes: { type: 'text' },
  });

  // Fraud/data-mismatch flag — distinct from the personal-safety Emergency/Dispute flow.
  // Routes to the manager's review queue; manager/admin judges, surveyor never auto-rejects.
  pgm.createTable('discrepancy_flags', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', notNull: true, references: 'survey_cases', onDelete: 'CASCADE' },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    raised_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    reason: { type: 'text', notNull: true }, // crop_mismatch | land_mismatch | duplicate_claim | other
    description: { type: 'text', notNull: true },
    evidence_file_id: { type: 'uuid', references: 'evidence_files', onDelete: 'SET NULL' },
    status: { type: 'text', notNull: true, default: 'pending' }, // pending | reviewed
    reviewed_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    reviewed_at: { type: 'timestamptz' },
    resolution_notes: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('discrepancy_flags', 'case_id');
  pgm.createIndex('discrepancy_flags', 'status');

  // Confidential bribe/inducement reporting — NOT a safety incident. Visible only to
  // super_admin. No UPDATE/DELETE route exists for this table anywhere in the app
  // (enforced server-side in routes/integrityConcerns.js) -- immutable once submitted.
  pgm.createTable('integrity_concerns', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', references: 'survey_cases', onDelete: 'SET NULL' },
    farmer_id: { type: 'uuid', references: 'farmer_records', onDelete: 'SET NULL' },
    reported_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    description: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Surfaces stale/conflicting attempts on the same source Docket_ID2 (e.g. after
  // reassignment leaves attempts from a prior surveyor) as a manager-visible warning.
  pgm.createView('docket_conflict_warnings', {}, `
    SELECT docket_id2,
           count(*) AS case_row_count,
           count(DISTINCT surveyor_mobile) AS distinct_source_surveyors,
           array_agg(DISTINCT id) AS case_ids
    FROM survey_cases
    WHERE docket_id2 IS NOT NULL AND deleted_at IS NULL
    GROUP BY docket_id2
    HAVING count(*) > 1 AND count(DISTINCT surveyor_mobile) > 1
  `);
};

exports.down = (pgm) => {
  pgm.dropView('docket_conflict_warnings');
  pgm.dropTable('integrity_concerns');
  pgm.dropTable('discrepancy_flags');
  pgm.dropColumns('emergency_incidents', ['requires_manager_review', 'resolved_by', 'resolved_at', 'resolution_notes']);
  pgm.dropColumns('call_events', [
    'geo_lat', 'geo_lon', 'geo_accuracy_m', 'geo_captured_at',
    'person_contacted_type', 'person_contacted_name', 'person_contacted_relation',
  ]);
};
