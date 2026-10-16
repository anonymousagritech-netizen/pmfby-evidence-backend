exports.up = (pgm) => {
  pgm.createTable('call_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', notNull: true, references: 'survey_cases', onDelete: 'CASCADE' },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    phone_number: { type: 'text', notNull: true },
    attempt_no: { type: 'integer', notNull: true },
    initiated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // answered | not_answered | busy | switched_off | unreachable | invalid_number | pending
    outcome: { type: 'text', notNull: true, default: 'pending' },
    // Always 'user_entered' in this pass — Linking.openURL('tel:') gives no call-state
    // callback on stock Android, so duration/outcome are never claimed as verified/API-sourced.
    outcome_source: { type: 'text', notNull: true, default: 'user_entered' },
    outcome_recorded_at: { type: 'timestamptz' },
    idempotency_key: { type: 'text', unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('call_events', 'case_id');
  pgm.createIndex('call_events', 'farmer_id');
  pgm.createIndex('call_events', 'user_id');

  // Explicitly-initiated voice-note fallback (NOT automatic cellular call recording —
  // see RISKS.md). Also doubles as storage for missed-call voice-message playback events.
  pgm.createTable('call_recordings', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    call_event_id: { type: 'uuid', references: 'call_events', onDelete: 'CASCADE' },
    case_id: { type: 'uuid', notNull: true, references: 'survey_cases', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    kind: { type: 'text', notNull: true, default: 'voice_note' }, // voice_note | voice_message_playback
    file_key: { type: 'text' },
    checksum_sha256: { type: 'text' },
    duration_seconds: { type: 'numeric' },
    consent_acknowledged: { type: 'boolean', notNull: true, default: false },
    encrypted: { type: 'boolean', notNull: true, default: true },
    voice_template_id: { type: 'integer' }, // set when kind = voice_message_playback
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('call_recordings', 'case_id');
};

exports.down = (pgm) => {
  pgm.dropTable('call_recordings');
  pgm.dropTable('call_events');
};
