const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { recordAudit } = require('../services/auditLog');
const { formatDateIST, formatDateTimeIST } = require('../utils/dateFormat');

const router = express.Router();
router.use(authenticate);

// ── helpers ──────────────────────────────────────────────────────────────────

/** Verify the farmer is assigned to this surveyor (or caller is admin/manager). */
async function assertFarmerAccess(farmerId, user) {
  if (user.role_key === ROLES.SURVEYOR) {
    const { rows } = await pool.query(
      `SELECT 1 FROM farmer_assignments WHERE farmer_id = $1 AND user_id = $2 AND active = true`,
      [farmerId, user.id]
    );
    if (!rows[0]) return false;
  }
  return true;
}

// ── GET /api/contact-sessions/farmer/:farmerId ────────────────────────────────
// Returns sessions + grouped cases (batched by intimation_batch_date) for a farmer.
// The mobile app uses this to build the FarmerDetailScreen batch list.
router.get('/farmer/:farmerId', async (req, res, next) => {
  try {
    const { farmerId } = req.params;
    // NOTE: farmer list already filters by farmer_assignments, so any farmerId the app
    // sends was obtained from a scope-filtered list. Read-only — no assertFarmerAccess check.

    // All cases for this farmer, with their latest session (if any).
    const { rows: cases } = await pool.query(`
      SELECT
        sc.id, sc.docket_id2, sc.land_survey_number, sc.farmer_intimation_date,
        sc.contact_status, sc.attempt_count, sc.postponed_until,
        sc.farm_area, sc.crop_name, sc.insurance_company,
        ccs.contact_session_id AS latest_session_id
      FROM survey_cases sc
      LEFT JOIN LATERAL (
        SELECT contact_session_id FROM case_contact_sessions
        WHERE case_id = sc.id
        ORDER BY created_at DESC LIMIT 1
      ) ccs ON true
      WHERE sc.farmer_id = $1 AND sc.deleted_at IS NULL
      ORDER BY sc.farmer_intimation_date DESC NULLS LAST, sc.docket_id2
    `, [farmerId]);

    // Existing sessions for this farmer, with message-event summary attached.
    const { rows: sessions } = await pool.query(`
      SELECT cs.*, u.name AS surveyor_name,
             COUNT(me.id)::int                        AS sms_count,
             (SELECT COUNT(*)::int FROM evidence_files ef
               WHERE ef.contact_session_id = cs.id AND ef.deleted_at IS NULL) AS evidence_count,
             MAX(me.created_at)                       AS last_sms_at,
             (array_agg(me.status ORDER BY me.created_at DESC))[1] AS last_sms_status,
             (array_agg(me.rendered_text ORDER BY me.created_at DESC))[1] AS last_sms_text
      FROM contact_sessions cs
      JOIN users u ON u.id = cs.user_id
      LEFT JOIN message_events me ON me.contact_session_id = cs.id
      WHERE cs.farmer_id = $1
      GROUP BY cs.id, u.name
      ORDER BY cs.contacted_at DESC
    `, [farmerId]);

    // Group cases by intimation_batch_date.
    const batchMap = new Map();
    for (const c of cases) {
      const key = c.farmer_intimation_date ? c.farmer_intimation_date.toISOString().slice(0, 10) : 'unknown';
      if (!batchMap.has(key)) batchMap.set(key, { intimationDate: key, cases: [] });
      batchMap.get(key).cases.push(c);
    }
    const batches = Array.from(batchMap.values()).map(b => ({
      ...b,
      caseCount: b.cases.length,
      docketIds: b.cases.map(c => c.docket_id2).filter(Boolean),
      // Latest session for this batch (includes contact_type + sms summary)
      latestSession: sessions.find(s =>
        s.intimation_batch_date && s.intimation_batch_date.toISOString().slice(0, 10) === b.intimationDate
      ) || null,
    }));

    res.json({ batches, sessions, totalCases: cases.length });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/contact-sessions ────────────────────────────────────────────────
// Creates a contact session for a farmer + intimation batch.
// Body: { farmerId, intimationBatchDate, contactType, notes? }
// Returns: { session, cases, docketIdsText } — mobile uses docketIdsText for SMS render.
router.post('/', async (req, res, next) => {
  try {
    const { farmerId, intimationBatchDate, contactType = 'call', notes } = req.body;
    if (!farmerId) return res.status(400).json({ error: 'farmerId required' });
    if (!['call', 'sms', 'call_and_sms'].includes(contactType)) {
      return res.status(400).json({ error: 'contactType must be call, sms, or call_and_sms' });
    }
    if (req.user.role_key !== ROLES.SURVEYOR) {
      return res.status(403).json({ error: 'Only surveyors create contact sessions' });
    }
    if (!(await assertFarmerAccess(farmerId, req.user))) {
      return res.status(403).json({ error: 'Farmer not assigned to you' });
    }

    // Fetch all cases in this batch (same farmer + same intimation_date, or all if no date).
    let caseQuery;
    let caseParams;
    if (intimationBatchDate) {
      caseQuery = `SELECT * FROM survey_cases WHERE farmer_id = $1
                   AND farmer_intimation_date::date = $2::date AND deleted_at IS NULL
                   ORDER BY docket_id2`;
      caseParams = [farmerId, intimationBatchDate];
    } else {
      // No date filter — all open cases (fallback for farmers with no intimation date).
      caseQuery = `SELECT * FROM survey_cases WHERE farmer_id = $1
                   AND deleted_at IS NULL AND contact_status NOT IN ('completed')
                   ORDER BY docket_id2`;
      caseParams = [farmerId];
    }
    const { rows: cases } = await pool.query(caseQuery, caseParams);
    if (cases.length === 0) return res.status(404).json({ error: 'No cases found for this batch' });

    const docketIds = cases.map(c => c.docket_id2).filter(Boolean);
    const docketIdsText = docketIds.join(', ');

    const { rows: [session] } = await pool.query(`
      INSERT INTO contact_sessions
        (farmer_id, user_id, intimation_batch_date, contact_type, notes, docket_ids_text, case_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [farmerId, req.user.id, intimationBatchDate || null, contactType, notes || null, docketIdsText, cases.length]);

    // Link all cases to this session.
    if (cases.length > 0) {
      const vals = cases.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
      const params = cases.flatMap(c => [c.id, session.id]);
      await pool.query(
        `INSERT INTO case_contact_sessions (case_id, contact_session_id) VALUES ${vals} ON CONFLICT DO NOTHING`,
        params
      );
    }

    // Bump attempt_count on all cases in this batch.
    await pool.query(
      `UPDATE survey_cases SET attempt_count = attempt_count + 1, updated_at = now()
       WHERE id = ANY($1::uuid[])`,
      [cases.map(c => c.id)]
    );

    await recordAudit(null, {
      userId: req.user.id, action: 'create_contact_session',
      resourceType: 'contact_sessions', resourceId: session.id,
    });

    res.status(201).json({ session, cases, docketIdsText, caseCount: cases.length });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/contact-sessions/:id/outcome ───────────────────────────────────
// Sets outcome on the session AND propagates contact_status to all linked cases.
// Body: { outcome, surveyScheduledDate?, notes? }
router.patch('/:id/outcome', async (req, res, next) => {
  try {
    const { outcome, surveyScheduledDate, notes } = req.body;
    const VALID = ['agreed', 'denied', 'postponed', 'not_answered', 'wrong_number', 'completed'];
    if (!outcome || !VALID.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of: ${VALID.join(', ')}` });
    }

    const { rows: [session] } = await pool.query(
      `SELECT * FROM contact_sessions WHERE id = $1`, [req.params.id]
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (req.user.role_key === ROLES.SURVEYOR && session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your session' });
    }

    // Map session outcome → survey_cases.contact_status.
    const statusMap = {
      agreed: 'pending_contact',        // agreed to survey — still open until completed
      denied: 'denied',
      postponed: 'postponed',
      not_answered: 'pending_contact',   // try again
      wrong_number: 'wrong_number',
      completed: 'completed',
    };
    const newCaseStatus = statusMap[outcome];

    await pool.query(`
      UPDATE contact_sessions
      SET outcome = $2, survey_scheduled_date = $3, notes = COALESCE($4, notes), updated_at = now()
      WHERE id = $1
    `, [req.params.id, outcome, surveyScheduledDate || null, notes || null]);

    // Propagate to all linked cases.
    const { rows: linked } = await pool.query(
      `SELECT case_id FROM case_contact_sessions WHERE contact_session_id = $1`, [req.params.id]
    );
    const caseIds = linked.map(r => r.case_id);
    if (caseIds.length > 0) {
      const extra = surveyScheduledDate ? `, postponed_until = $3, survey_schedule_date = $3` : '';
      const params = surveyScheduledDate
        ? [newCaseStatus, caseIds, surveyScheduledDate]
        : [newCaseStatus, caseIds];
      await pool.query(
        `UPDATE survey_cases SET contact_status = $1, updated_at = now()${extra}
         WHERE id = ANY($2::uuid[])`,
        params
      );
    }

    await recordAudit(null, {
      userId: req.user.id, action: 'set_session_outcome',
      resourceType: 'contact_sessions', resourceId: req.params.id,
    });

    const { rows: [updated] } = await pool.query(
      `SELECT * FROM contact_sessions WHERE id = $1`, [req.params.id]
    );
    res.json({ session: updated, updatedCaseCount: caseIds.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/contact-sessions/:id ─────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { rows: [session] } = await pool.query(
      `SELECT cs.*, u.name AS surveyor_name, fr.farmer_name, fr.farmer_mobile
       FROM contact_sessions cs
       JOIN users u ON u.id = cs.user_id
       JOIN farmer_records fr ON fr.id = cs.farmer_id
       WHERE cs.id = $1`, [req.params.id]
    );
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (!(await assertFarmerAccess(session.farmer_id, req.user))) {
      return res.status(403).json({ error: 'Not assigned' });
    }
    const { rows: cases } = await pool.query(`
      SELECT sc.id, sc.docket_id2, sc.land_survey_number, sc.contact_status,
             sc.farm_area, sc.crop_name, sc.farmer_intimation_date
      FROM case_contact_sessions ccs
      JOIN survey_cases sc ON sc.id = ccs.case_id
      WHERE ccs.contact_session_id = $1 ORDER BY sc.docket_id2
    `, [req.params.id]);
    res.json({ session, cases });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
