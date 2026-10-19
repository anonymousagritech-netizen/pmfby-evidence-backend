const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { ROLES } = require('../middleware/rbac');
const { getCaseForUserOrNull, getCaseIfSurveyorAssigned } = require('../services/resourceScope');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();
router.use(authenticate);

// NOTE: literal routes below (/discrepancy-flags, /reports/docket-conflicts) are
// registered BEFORE the dynamic '/:id' route so Express doesn't swallow them as a
// (malformed) case id.
router.get('/discrepancy-flags', async (req, res, next) => {
  if (![ROLES.SUPER_ADMIN, ROLES.MANAGER].includes(req.user.role_key)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT df.*, sc.district_id, sc.state_id FROM discrepancy_flags df
       JOIN survey_cases sc ON sc.id = df.case_id ORDER BY df.created_at DESC`
    );
    const visible = req.user.role_key === ROLES.SUPER_ADMIN ? rows : rows.filter((r) => (
      (req.user.scope_district_id && r.district_id === req.user.scope_district_id)
      || (!req.user.scope_district_id && req.user.scope_state_id && r.state_id === req.user.scope_state_id)
    ));
    res.json({ flags: visible });
  } catch (err) {
    next(err);
  }
});

router.patch('/discrepancy-flags/:flagId/review', async (req, res, next) => {
  if (![ROLES.SUPER_ADMIN, ROLES.MANAGER].includes(req.user.role_key)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { resolutionNotes } = req.body;
    const { rows } = await pool.query(
      `UPDATE discrepancy_flags SET status = 'reviewed', reviewed_by = $2, reviewed_at = now(), resolution_notes = $3
       WHERE id = $1 RETURNING *`,
      [req.params.flagId, req.user.id, resolutionNotes || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ flag: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Manager-visible data-integrity warning: conflicting multiple survey_cases rows for the
// same source Docket_ID2 across different source surveyors (e.g. stale attempts left
// behind after reassignment).
router.get('/reports/docket-conflicts', async (req, res, next) => {
  if (![ROLES.SUPER_ADMIN, ROLES.MANAGER].includes(req.user.role_key)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM docket_conflict_warnings ORDER BY case_row_count DESC LIMIT 200');
    res.json({ conflicts: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(req.params.id, req.user.id);
    else caseRow = await getCaseForUserOrNull(req.params.id, req.user);
    if (!caseRow) return res.status(404).json({ error: 'Case not found or not accessible' });
    res.json({ case: caseRow });
  } catch (err) {
    next(err);
  }
});

// Mandatory outcome resolution loop. Valid outcomes: denied | postponed | wrong_number |
// dispute_incident | completed. Postponed keeps the case open (new target date);
// completed fully closes it; denied/wrong_number/dispute_incident close THIS attempt but
// the case can be reopened for a new attempt later. This single write is read by both
// the surveyor's own mobile tabs and the admin/manager dashboard — single source of truth.
const VALID_OUTCOMES = ['denied', 'postponed', 'wrong_number', 'dispute_incident', 'completed'];

router.post('/:id/resolve-outcome', async (req, res, next) => {
  try {
    const { outcome, reason, postponedUntil, farmerAgreedToPostpone, callEventId } = req.body;
    if (!VALID_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of ${VALID_OUTCOMES.join(', ')}` });
    }
    if (outcome === 'postponed') {
      // Two distinct facts must be captured, not just the new date — a farmer can be
      // marked postponed procedurally without truly agreeing to the date. See the
      // Excel activity export's "Farmer Agreed" column.
      if (typeof farmerAgreedToPostpone !== 'boolean') {
        return res.status(400).json({ error: 'farmerAgreedToPostpone (true/false) is required when outcome=postponed' });
      }
      if (farmerAgreedToPostpone && !postponedUntil) {
        return res.status(400).json({ error: 'postponedUntil is required when outcome=postponed and farmerAgreedToPostpone=true' });
      }
    }

    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) {
      caseRow = await getCaseIfSurveyorAssigned(req.params.id, req.user.id);
    } else {
      caseRow = await getCaseForUserOrNull(req.params.id, req.user);
    }
    if (!caseRow) return res.status(404).json({ error: 'Case not found or not accessible' });

    const isClosing = outcome !== 'postponed';
    if (isClosing) {
      const { rows: unresolved } = await pool.query(
        `SELECT id FROM emergency_incidents WHERE case_id = $1 AND requires_manager_review = true
           AND resolved_at IS NULL LIMIT 1`,
        [caseRow.id]
      );
      if (unresolved[0]) {
        return res.status(409).json({
          error: 'This case has an unresolved emergency/forceful-survey incident. A manager must review and resolve it before the case can be closed.',
        });
      }
    }
    const agreedToPostpone = outcome === 'postponed' ? farmerAgreedToPostpone : null;
    const effectivePostponedUntil = outcome === 'postponed' && farmerAgreedToPostpone ? postponedUntil : null;

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE survey_cases SET contact_status = $2, postponed_until = $3,
           closed_at = CASE WHEN $4 THEN now() ELSE NULL END,
           closed_reason = $5, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [caseRow.id, outcome, effectivePostponedUntil, isClosing, reason || null]
      );

      // Write the per-attempt record too — this is what the Excel activity export reads
      // from (one row per call_event/attempt). Prefer the caller-supplied callEventId
      // (the attempt this outcome resolution actually belongs to); fall back to the
      // most recent call_event for this case so older app builds that don't send
      // callEventId yet still get a row recorded.
      let targetCallEventId = callEventId || null;
      if (!targetCallEventId) {
        const { rows: latest } = await client.query(
          'SELECT id FROM call_events WHERE case_id = $1 ORDER BY initiated_at DESC LIMIT 1',
          [caseRow.id]
        );
        targetCallEventId = latest[0]?.id || null;
      }
      if (targetCallEventId) {
        await client.query(
          `UPDATE call_events SET resolved_outcome = $2, farmer_agreed_to_postpone = $3, postponed_until = $4
           WHERE id = $1`,
          [targetCallEventId, outcome, agreedToPostpone, effectivePostponedUntil]
        );
      }

      await recordAudit(client, {
        userId: req.user.id, action: 'resolve_outcome', resourceType: 'survey_cases',
        resourceId: caseRow.id, metadata: { outcome, reason, postponedUntil: effectivePostponedUntil, farmerAgreedToPostpone: agreedToPostpone },
      });
      return rows[0];
    });

    res.json({ case: updated });
  } catch (err) {
    next(err);
  }
});

// Flag for Review: Suspected Discrepancy. Fraud/data-mismatch flag, distinct from the
// personal-safety Emergency/Dispute flow. Manager/admin judges — surveyor never auto-rejects.
router.post('/:id/discrepancy-flags', async (req, res, next) => {
  try {
    const { reason, description, evidenceFileId } = req.body;
    const validReasons = ['crop_mismatch', 'land_mismatch', 'duplicate_claim', 'other'];
    if (!validReasons.includes(reason)) return res.status(400).json({ error: `reason must be one of ${validReasons.join(', ')}` });
    if (!description) return res.status(400).json({ error: 'description is required' });
    if (!evidenceFileId) return res.status(400).json({ error: 'A photo evidence_file is mandatory for a discrepancy flag' });

    let caseRow;
    if (req.user.role_key === ROLES.SURVEYOR) caseRow = await getCaseIfSurveyorAssigned(req.params.id, req.user.id);
    else caseRow = await getCaseForUserOrNull(req.params.id, req.user);
    if (!caseRow) return res.status(404).json({ error: 'Case not found or not accessible' });

    const { rows } = await pool.query(
      `INSERT INTO discrepancy_flags (case_id, farmer_id, raised_by, reason, description, evidence_file_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [caseRow.id, caseRow.farmer_id, req.user.id, reason, description, evidenceFileId]
    );
    await recordAudit(null, { userId: req.user.id, action: 'raise_discrepancy_flag', resourceType: 'discrepancy_flags', resourceId: rows[0].id });
    res.status(201).json({ flag: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
