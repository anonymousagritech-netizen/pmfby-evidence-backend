exports.up = (pgm) => {
  pgm.createTable('message_templates', {
    id: 'id',
    code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    channel: { type: 'text', notNull: true, default: 'sms' }, // sms | internal
    body_template: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('message_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    case_id: { type: 'uuid', notNull: true, references: 'survey_cases', onDelete: 'CASCADE' },
    farmer_id: { type: 'uuid', notNull: true, references: 'farmer_records', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    call_event_id: { type: 'uuid', references: 'call_events', onDelete: 'SET NULL' },
    template_id: { type: 'integer', notNull: true, references: 'message_templates', onDelete: 'RESTRICT' },
    rendered_text: { type: 'text', notNull: true },
    attempt_no: { type: 'integer', notNull: true },
    phone_number: { type: 'text' },
    // drafted | opened_composer  -- never 'sent'/'delivered': opening the SMS composer via
    // Linking is not delivery confirmation.
    status: { type: 'text', notNull: true, default: 'drafted' },
    idempotency_key: { type: 'text', unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('message_events', 'case_id');
  pgm.createIndex('message_events', 'farmer_id');
};

exports.down = (pgm) => {
  pgm.dropTable('message_events');
  pgm.dropTable('message_templates');
};
