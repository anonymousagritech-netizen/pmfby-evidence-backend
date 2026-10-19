exports.up = (pgm) => {
  // contact_sessions: one record per "surveyor contacts this farmer for a batch of cases".
  // A batch = farmer + intimation_batch_date (all cases with the same farmer_intimation_date).
  // One session covers N cases — calling/SMSing the same farmer multiple times for the same
  // batch is pointless; the session captures ONE contact event and its evidence is shared
  // across all cases in the batch.
  pgm.createTable('contact_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    // The farmer_intimation_date shared by all cases in this batch.
    intimation_batch_date: { type: 'date' },
    contacted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // 'call', 'sms', 'call_and_sms'
    contact_type: { type: 'text', notNull: true, default: 'call' },
    // Outcome for ALL cases in the session (one contact = one outcome).
    // Mirrors contact_status values: 'pending', 'agreed', 'denied', 'postponed',
    // 'not_answered', 'wrong_number', 'completed'
    outcome: { type: 'text' },
    survey_scheduled_date: { type: 'date' },
    notes: { type: 'text' },
    // Denormalised comma-separated docket_id2 list for quick SMS rendering.
    docket_ids_text: { type: 'text' },
    // Count of cases in this session (denormalised for display).
    case_count: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('contact_sessions', 'farmer_id');
  pgm.createIndex('contact_sessions', 'user_id');
  pgm.createIndex('contact_sessions', ['farmer_id', 'intimation_batch_date']);

  // Junction: links every survey_case in the batch to the session.
  pgm.createTable('case_contact_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', notNull: true, references: 'survey_cases', onDelete: 'CASCADE' },
    contact_session_id: { type: 'uuid', notNull: true, references: 'contact_sessions', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('case_contact_sessions', 'contact_session_id');
  pgm.createIndex('case_contact_sessions', 'case_id');
  pgm.createIndex('case_contact_sessions', ['case_id', 'contact_session_id'], {
    unique: true,
    name: 'case_contact_sessions_unique',
  });

  // Add session_id FK to message_events and evidence_files so they can be linked to the
  // session instead of (or in addition to) a single case.
  pgm.addColumns('message_events', {
    contact_session_id: { type: 'uuid', references: 'contact_sessions', onDelete: 'SET NULL' },
  });
  pgm.addColumns('evidence_files', {
    contact_session_id: { type: 'uuid', references: 'contact_sessions', onDelete: 'SET NULL' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('evidence_files', ['contact_session_id']);
  pgm.dropColumns('message_events', ['contact_session_id']);
  pgm.dropTable('case_contact_sessions');
  pgm.dropTable('contact_sessions');
};
