const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { recordAudit } = require('../services/auditLog');
const { runAutoAssignPure } = require('../services/autoAssignService');
const villageLookup = require('../services/villageLookupService');

const router = express.Router();
router.use(authenticate);

// Pulls active, non-manually-overridden cases for the given district(s) plus each
// eligible surveyor's home districts, in the shape autoAssignService expects.
async function loadCasesAndSurveyors(districtIds) {
  const { rows: caseRows } = await pool.query(
    `SELECT sc.id, sc.district_id, sc.level7_id AS village_id, sc.level7_name AS village_name,
            sc.farmer_intimation_date AS intimation_date, sc.farmer_id,
            fa.user_id AS manual_surveyor_id, fa.manual_override
     FROM survey_cases sc
     LEFT JOIN farmer_assignments fa ON fa.farmer_id = sc.farmer_id AND fa.active = true
     WHERE sc.deleted_at IS NULL
       AND sc.district_id = ANY($1)
       AND sc.farmer_intimation_date IS NOT NULL
       AND sc.contact_status NOT IN ('completed', 'denied')`,
    [districtIds]
  );
  const cases = caseRows.map((r) => ({
    id: r.id,
    districtId: r.district_id,
    villageId: r.village_id,
    villageName: r.village_name,
    intimationDate: r.intimation_date,
    manualOverride: !!r.manual_override,
    manualSurveyorId: r.manual_surveyor_id,
  }));

  const { rows: surveyorRows } = await pool.query(
    `SELECT u.id, u.home_district_ids FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE r.key = $1 AND u.is_active = true AND u.deleted_at IS NULL`,
    [ROLES.SURVEYOR]
  );
  const surveyorsByDistrict = new Map();
  for (const d of districtIds) surveyorsByDistrict.set(d, []);
  for (const s of surveyorRows) {
    for (const d of s.home_district_ids || []) {
      if (surveyorsByDistrict.has(d)) surveyorsByDistrict.get(d).push(s.id);
    }
  }
  return { cases, surveyorsByDistrict };
}

function validateParams(body) {
  const { districtIds, reportDate, tatDays, minCases, p1CutoffDays, p2CutoffDays } = body;
  if (!Array.isArray(districtIds) || districtIds.length === 0) return 'districtIds (non-empty array) required';
  if (!reportDate || isNaN(new Date(reportDate).getTime())) return 'valid reportDate required';
  if (!Number.isFinite(tatDays) || tatDays <= 0) return 'tatDays (positive number) required';
  return null;
}

// Shared by preview and commit so results are guaranteed identical between the two.
async function computeRun(req) {
  const { districtIds, reportDate, tatDays, minCases = 40, p1CutoffDays = 5, p2CutoffDays = 7 } = req.body;
  const { cases, surveyorsByDistrict } = await loadCasesAndSurveyors(districtIds);
  const result = runAutoAssignPure({
    cases, surveyorsByDistrict, reportDate, tatDays, minCases, p1CutoffDays, p2CutoffDays,
  });
  const params = { districtIds, reportDate, tatDays, minCases, p1CutoffDays, p2CutoffDays };
  return { result, params };
}

// Dry run: compute the assignment, persist it as a 'preview' run for traceability, but
// write nothing to farmer_assignments.
router.post('/preview', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const err = validateParams(req.body);
    if (err) return res.status(400).json({ error: err });
    const { result, params } = await computeRun(req);
    const summary = {
      totalCases: result.totalCases,
      totalAssigned: result.totalAssigned,
      totalUnassigned: result.totalUnassigned,
      perSurveyor: result.perSurveyor,
      underMinimumSurveyors: result.underMinimumSurveyors,
    };
    const { rows } = await pool.query(
      `INSERT INTO assignment_runs (run_by, mode, params, summary) VALUES ($1,'preview',$2,$3) RETURNING id, created_at`,
      [req.user.id, JSON.stringify(params), JSON.stringify(summary)]
    );
    await recordAudit(null, {
      userId: req.user.id, action: 'auto_assign_preview', resourceType: 'assignment_runs', resourceId: rows[0].id, metadata: params,
    });
    res.json({ runId: rows[0].id, createdAt: rows[0].created_at, ...summary, unassignedCaseIds: result.unassignedCaseIds });
  } catch (e) { next(e); }
});

// Commit: same computation, but actually writes farmer_assignments for every case that
// got a placement (reusing the existing one-active-assignment-per-farmer invariant).
router.post('/commit', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const err = validateParams(req.body);
    if (err) return res.status(400).json({ error: err });
    const { result, params } = await computeRun(req);

    const response = await withTransaction(async (client) => {
      // placements: Map<caseId, surveyorId> keyed by survey_case id; resolve to farmer_id.
      for (const [caseId, surveyorId] of result.placements.entries()) {
        const { rows: caseRows } = await client.query('SELECT farmer_id FROM survey_cases WHERE id = $1', [caseId]);
        if (!caseRows[0]) continue;
        const farmerId = caseRows[0].farmer_id;
        await client.query(
          `UPDATE farmer_assignments SET active = false, unassigned_at = now()
           WHERE farmer_id = $1 AND active = true AND manual_override = false`,
          [farmerId]
        );
        // Skip if an active manual-override assignment already covers this farmer.
        const { rows: activeRows } = await client.query(
          `SELECT id FROM farmer_assignments WHERE farmer_id = $1 AND active = true LIMIT 1`,
          [farmerId]
        );
        if (activeRows[0]) continue;
        await client.query(
          `INSERT INTO farmer_assignments (farmer_id, user_id, assigned_by, manual_override)
           VALUES ($1,$2,$3,false)`,
          [farmerId, surveyorId, req.user.id]
        );
      }
      const summary = {
        totalCases: result.totalCases,
        totalAssigned: result.totalAssigned,
        totalUnassigned: result.totalUnassigned,
        perSurveyor: result.perSurveyor,
        underMinimumSurveyors: result.underMinimumSurveyors,
      };
      const { rows } = await client.query(
        `INSERT INTO assignment_runs (run_by, mode, params, summary) VALUES ($1,'commit',$2,$3) RETURNING id, created_at`,
        [req.user.id, JSON.stringify(params), JSON.stringify(summary)]
      );
      await recordAudit(client, {
        userId: req.user.id, action: 'auto_assign_commit', resourceType: 'assignment_runs', resourceId: rows[0].id, metadata: params,
      });
      return { runId: rows[0].id, createdAt: rows[0].created_at, ...summary };
    });
    res.json(response);
  } catch (e) { next(e); }
});

router.get('/runs', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ar.*, u.name AS run_by_name FROM assignment_runs ar
       LEFT JOIN users u ON u.id = ar.run_by ORDER BY ar.created_at DESC LIMIT 50`
    );
    res.json({ runs: rows });
  } catch (e) { next(e); }
});

// Village centroid/name lookup for validation (exact + fuzzy) during import review.
router.get('/villages/lookup', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { village, district } = req.query;
    if (!village) return res.status(400).json({ error: 'village query param required' });
    const result = await villageLookup.findVillage(village, district);
    res.json(result);
  } catch (e) { next(e); }
});

// Nearby villages for a given village (cross-district fallback sourcing).
router.get('/villages/nearby', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { village, district, limit, excludeDistrict } = req.query;
    if (!village) return res.status(400).json({ error: 'village query param required' });
    const nearby = await villageLookup.findNearby({
      village, districtName: district, limit: limit ? parseInt(limit, 10) : 20, excludeDistrict,
    });
    res.json({ nearby });
  } catch (e) { next(e); }
});

module.exports = router;
