// Auto-assign feature: village-based greedy balancing of survey_cases to surveyors.
// Adds surveyor "home districts" (which districts a surveyor is eligible to be assigned
// cases in) and an audit trail of each auto-assign run (params + resulting summary),
// separate from the generic audit_logs table because runs carry a large structured
// payload (per-surveyor breakdown) that's awkward to squeeze into audit_logs.metadata
// alone, though we also still write a normal audit_logs row per run for consistency
// with the rest of the app's audit trail.
exports.up = (pgm) => {
  pgm.addColumns('users', {
    // Districts (by district_id, matching survey_cases.district_id) a surveyor is
    // eligible to receive auto-assigned cases in. Empty/null = not eligible for
    // auto-assign (manual assignment still works regardless).
    home_district_ids: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
  });

  // Marks a case's assignment as a manual override so the auto-assign algorithm
  // never redistributes it. Set by the existing manual assign route; auto-assign
  // commit also sets it false for the cases it places (so a later re-run can move them).
  pgm.addColumns('farmer_assignments', {
    manual_override: { type: 'boolean', notNull: true, default: false },
  });

  pgm.createTable('assignment_runs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    run_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    mode: { type: 'text', notNull: true }, // 'preview' | 'commit'
    params: { type: 'jsonb', notNull: true }, // reportDate, tatDays, minCases, p1CutoffDays, p2CutoffDays, districtIds
    summary: { type: 'jsonb', notNull: true }, // totals + per-surveyor breakdown + under-minimum flags
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('assignment_runs', 'run_by');
  pgm.createIndex('assignment_runs', 'mode');
};

exports.down = (pgm) => {
  pgm.dropTable('assignment_runs');
  pgm.dropColumns('farmer_assignments', ['manual_override']);
  pgm.dropColumns('users', ['home_district_ids']);
};
