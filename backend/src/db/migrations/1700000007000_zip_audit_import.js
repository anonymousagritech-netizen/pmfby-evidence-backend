exports.up = (pgm) => {
  // One ZIP per contact attempt. A "contact attempt" is anchored to a call_event;
  // message_events / evidence_files / emergency_incidents tied to the same call_event
  // (or, if no call was made, directly to the case) are bundled together.
  pgm.createTable('zip_archives', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', notNull: true, references: 'survey_cases', onDelete: 'CASCADE' },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    call_event_id: { type: 'uuid', references: 'call_events', onDelete: 'SET NULL' },
    requested_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    status: { type: 'text', notNull: true, default: 'pending' }, // pending|processing|ready|failed
    file_key: { type: 'text' },
    filename: { type: 'text' },
    checksum_sha256: { type: 'text' },
    error_message: { type: 'text' },
    size_bytes: { type: 'bigint' },
    ready_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('zip_archives', 'case_id');
  pgm.createIndex('zip_archives', 'call_event_id');

  pgm.createTable('audit_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    action: { type: 'text', notNull: true },
    resource_type: { type: 'text', notNull: true },
    resource_id: { type: 'text' },
    metadata: { type: 'jsonb' },
    ip_address: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_logs', 'user_id');
  pgm.createIndex('audit_logs', 'resource_type');

  // Persisted import summaries (new/updated/unchanged/errored counts + row-level log),
  // supporting the daily re-upload/upsert workflow and admin-visible import history.
  pgm.createTable('import_batches', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    uploaded_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    original_filename: { type: 'text' },
    column_mapping: { type: 'jsonb' },
    inserted_count: { type: 'integer', notNull: true, default: 0 },
    updated_count: { type: 'integer', notNull: true, default: 0 },
    unchanged_count: { type: 'integer', notNull: true, default: 0 },
    skipped_count: { type: 'integer', notNull: true, default: 0 },
    error_count: { type: 'integer', notNull: true, default: 0 },
    row_log: { type: 'jsonb' }, // array of {row, status, changedFields?, error?}
    status: { type: 'text', notNull: true, default: 'committed' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('import_batches');
  pgm.dropTable('audit_logs');
  pgm.dropTable('zip_archives');
};
