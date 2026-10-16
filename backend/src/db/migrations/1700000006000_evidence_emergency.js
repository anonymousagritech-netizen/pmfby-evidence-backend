exports.up = (pgm) => {
  pgm.createTable('emergency_incidents', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', notNull: true, references: 'survey_cases', onDelete: 'CASCADE' },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    call_event_id: { type: 'uuid', references: 'call_events', onDelete: 'SET NULL' },
    // recording | completed | cancelled | uploaded | queued_offline
    status: { type: 'text', notNull: true, default: 'recording' },
    incident_type: { type: 'text', notNull: true, default: 'THREAT' }, // THREAT|ASSAULT|FORCED_FORM_FILLING|OTHER
    description: { type: 'text' },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    ended_at: { type: 'timestamptz' },
    duration_seconds: { type: 'numeric' },
    whatsapp_report_status: { type: 'text', notNull: true, default: 'NOT_REPORTED' },
    app_update_status: { type: 'text', notNull: true, default: 'UPDATED' },
    idempotency_key: { type: 'text', unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('emergency_incidents', 'case_id');
  pgm.createIndex('emergency_incidents', 'user_id');

  pgm.createTable('evidence_files', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', notNull: true, references: 'survey_cases', onDelete: 'CASCADE' },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    call_event_id: { type: 'uuid', references: 'call_events', onDelete: 'SET NULL' },
    message_event_id: { type: 'uuid', references: 'message_events', onDelete: 'SET NULL' },
    emergency_incident_id: { type: 'uuid', references: 'emergency_incidents', onDelete: 'SET NULL' },
    kind: { type: 'text', notNull: true }, // screenshot|voice_note|emergency_audio|emergency_video|other
    file_key: { type: 'text' },
    original_filename: { type: 'text' },
    checksum_sha256: { type: 'text' },
    encrypted: { type: 'boolean', notNull: true, default: true },
    upload_status: { type: 'text', notNull: true, default: 'pending' }, // pending|uploaded|failed
    size_bytes: { type: 'bigint' },
    idempotency_key: { type: 'text', unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
  });
  pgm.createIndex('evidence_files', 'case_id');
  pgm.createIndex('evidence_files', 'farmer_id');
  pgm.createIndex('evidence_files', 'call_event_id');
};

exports.down = (pgm) => {
  pgm.dropTable('evidence_files');
  pgm.dropTable('emergency_incidents');
};
