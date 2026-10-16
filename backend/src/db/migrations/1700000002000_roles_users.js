exports.up = (pgm) => {
  pgm.createTable('roles', {
    id: 'id',
    key: { type: 'text', notNull: true, unique: true }, // super_admin | manager | surveyor
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    email: { type: 'text', notNull: true, unique: true },
    phone: { type: 'text' },
    password_hash: { type: 'text', notNull: true },
    role_id: { type: 'integer', notNull: true, references: 'roles', onDelete: 'RESTRICT' },
    // Geographic/org scoping for manager role. NULL state_id = org-wide (super admin only in practice).
    scope_state_id: { type: 'text' },
    scope_district_id: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
  });

  pgm.createIndex('users', 'role_id');
};

exports.down = (pgm) => {
  pgm.dropTable('users');
  pgm.dropTable('roles');
};
