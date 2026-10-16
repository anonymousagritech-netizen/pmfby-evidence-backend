const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate);

// List farmers, server-side RBAC-scoped:
// - surveyor: ONLY farmers with an active assignment to them.
// - manager: farmers whose latest case is within their geographic scope.
// - super_admin: all farmers.
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const params = [];
    let where = 'fr.deleted_at IS NULL';

    if (req.user.role_key === ROLES.SURVEYOR) {
      params.push(req.user.id);
      where += ` AND EXISTS (SELECT 1 FROM farmer_assignments fa WHERE fa.farmer_id = fr.id
                 AND fa.active = true AND fa.user_id = $${params.length})`;
    } else if (req.user.role_key === ROLES.MANAGER) {
      if (req.user.scope_district_id) {
        params.push(req.user.scope_district_id);
        where += ` AND fr.district_id = $${params.length}`;
      } else if (req.user.scope_state_id) {
        params.push(req.user.scope_state_id);
        where += ` AND fr.state_id = $${params.length}`;
      } else {
        where += ' AND false'; // manager with no scope sees nothing, fail closed
      }
    }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (fr.farmer_name ILIKE $${params.length} OR fr.village_name ILIKE $${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT fr.*, fa.user_id AS assigned_user_id
       FROM farmer_records fr
       LEFT JOIN farmer_assignments fa ON fa.farmer_id = fr.id AND fa.active = true
       WHERE ${where} ORDER BY fr.created_at DESC LIMIT 500`,
      params
    );
    res.json({ farmers: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM farmer_records WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    const farmer = rows[0];
    if (!farmer) return res.status(404).json({ error: 'Not found' });

    if (req.user.role_key === ROLES.SURVEYOR) {
      const { rows: assignRows } = await pool.query(
        `SELECT 1 FROM farmer_assignments WHERE farmer_id = $1 AND active = true AND user_id = $2`,
        [farmer.id, req.user.id]
      );
      if (!assignRows[0]) return res.status(403).json({ error: 'Not assigned to this farmer' });
    } else if (req.user.role_key === ROLES.MANAGER) {
      const inScope = (req.user.scope_district_id && farmer.district_id === req.user.scope_district_id)
        || (!req.user.scope_district_id && req.user.scope_state_id && farmer.state_id === req.user.scope_state_id);
      if (!inScope) return res.status(403).json({ error: 'Farmer outside your scope' });
    }

    const { rows: cases } = await pool.query(
      'SELECT * FROM survey_cases WHERE farmer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
      [farmer.id]
    );
    res.json({ farmer, cases });
  } catch (err) {
    next(err);
  }
});

// Explicit, validated farmer_mobile entry (never auto-filled from Surveyor_Mobile).
router.patch('/:id/mobile', async (req, res, next) => {
  try {
    const { farmerMobile } = req.body;
    if (!farmerMobile || !/^[0-9+\-\s]{6,15}$/.test(farmerMobile)) {
      return res.status(400).json({ error: 'A valid farmerMobile is required' });
    }
    if (req.user.role_key === ROLES.SURVEYOR) {
      const { rows: assignRows } = await pool.query(
        `SELECT 1 FROM farmer_assignments WHERE farmer_id = $1 AND active = true AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!assignRows[0]) return res.status(403).json({ error: 'Not assigned to this farmer' });
    }
    const { rows } = await pool.query(
      `UPDATE farmer_records SET farmer_mobile = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [req.params.id, farmerMobile]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ farmer: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
