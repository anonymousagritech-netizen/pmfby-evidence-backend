const express = require('express');
const ExcelJS = require('exceljs');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { formatDateTimeIST } = require('../utils/dateFormat');

const router = express.Router();
router.use(authenticate);

// Evidence export — one row per survey_case (docket).
// Shows the contact session that covered this docket, its contacted_at, outcome,
// scheduled date, and the SMS/screenshot evidence — same session evidence appears on
// all rows that belong to that session (all dockets in the same farmer-batch).
router.get('/activity-export', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        sc.id AS case_id,
        sc.docket_id2,
        sc.land_survey_number,
        sc.farmer_intimation_date,
        sc.contact_status,
        sc.farm_area,
        sc.crop_name,
        fr.farmer_name,
        fr.farmer_mobile,
        fr.village_name,
        u.name AS surveyor_name,
        -- Latest contact session for this case
        cs.id AS session_id,
        cs.contacted_at,
        cs.contact_type,
        cs.outcome AS session_outcome,
        cs.survey_scheduled_date,
        cs.docket_ids_text AS batch_docket_ids,
        cs.case_count AS batch_case_count,
        -- Latest message event for this session (or legacy case-level)
        me.id AS message_event_id,
        me.status AS message_status,
        me.rendered_text,
        -- Screenshot evidence
        ef.id AS evidence_file_id
      FROM survey_cases sc
      JOIN farmer_records fr ON fr.id = sc.farmer_id
      LEFT JOIN farmer_assignments fa ON fa.farmer_id = sc.farmer_id AND fa.active = true
      LEFT JOIN users u ON u.id = fa.user_id
      -- Latest session this case belongs to
      LEFT JOIN LATERAL (
        SELECT cs2.* FROM case_contact_sessions ccs
        JOIN contact_sessions cs2 ON cs2.id = ccs.contact_session_id
        WHERE ccs.case_id = sc.id
        ORDER BY cs2.contacted_at DESC LIMIT 1
      ) cs ON true
      -- Latest SMS for this session (or case if no session)
      LEFT JOIN LATERAL (
        SELECT me2.* FROM message_events me2
        WHERE (cs.id IS NOT NULL AND me2.contact_session_id = cs.id)
           OR (cs.id IS NULL AND me2.case_id = sc.id)
        ORDER BY me2.created_at DESC LIMIT 1
      ) me ON true
      -- Screenshot evidence
      LEFT JOIN evidence_files ef ON ef.message_event_id = me.id
        AND ef.kind = 'screenshot' AND ef.deleted_at IS NULL
      WHERE sc.deleted_at IS NULL
      ORDER BY sc.farmer_intimation_date DESC NULLS LAST, fr.farmer_name, sc.docket_id2
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'PMFBY Evidence — Docket Evidence Export';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Evidence');
    sheet.columns = [
      { header: 'Docket ID', key: 'docketId', width: 26 },
      { header: 'Land Survey No.', key: 'landSurveyNo', width: 18 },
      { header: 'Farmer Name', key: 'farmerName', width: 22 },
      { header: 'Farmer Mobile', key: 'farmerMobile', width: 16 },
      { header: 'Village', key: 'villageName', width: 18 },
      { header: 'Intimation Date', key: 'intimationDate', width: 16 },
      { header: 'Surveyor', key: 'surveyorName', width: 20 },
      { header: 'Contacted At', key: 'contactedAt', width: 22 },
      { header: 'Contact Type', key: 'contactType', width: 14 },
      { header: 'Outcome', key: 'outcome', width: 16 },
      { header: 'Survey Scheduled Date', key: 'surveyDate', width: 22 },
      { header: 'Case Status', key: 'caseStatus', width: 16 },
      { header: 'Batch Size (dockets)', key: 'batchSize', width: 16 },
      { header: 'All Batch Dockets', key: 'batchDockets', width: 60 },
      { header: 'SMS Sent', key: 'smsSent', width: 12 },
      { header: 'SMS Status', key: 'smsStatus', width: 16 },
      { header: 'Screenshot Link', key: 'screenshotLink', width: 50 },
    ];

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    for (const row of rows) {
      sheet.addRow({
        docketId: row.docket_id2 || '',
        landSurveyNo: row.land_survey_number || '',
        farmerName: row.farmer_name || '',
        farmerMobile: row.farmer_mobile || '',
        villageName: row.village_name || '',
        intimationDate: row.farmer_intimation_date ? formatDateTimeIST(row.farmer_intimation_date) : '',
        surveyorName: row.surveyor_name || '',
        contactedAt: row.contacted_at ? formatDateTimeIST(row.contacted_at) : '',
        contactType: row.contact_type || '',
        outcome: row.session_outcome || '',
        surveyDate: row.survey_scheduled_date ? formatDateTimeIST(row.survey_scheduled_date) : '',
        caseStatus: row.contact_status || '',
        batchSize: row.batch_case_count || '',
        batchDockets: row.batch_docket_ids || '',
        smsSent: row.message_event_id ? 'Yes' : 'No',
        smsStatus: row.message_status || '',
        screenshotLink: row.evidence_file_id ? `${baseUrl}/evidence/${row.evidence_file_id}/download` : '',
      });
    }
    sheet.getRow(1).font = { bold: true };
    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="docket-evidence-export.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// Per-surveyor history: disputes (dispute_incident outcomes), fraud-flags-raised
// (discrepancy_flags), and emergencies count. Query-time aggregation over existing
// tables — no dedicated aggregation table needed for this pass.
router.get('/surveyor-history', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id AS user_id, u.name,
        (SELECT count(*) FROM survey_cases sc JOIN farmer_assignments fa ON fa.farmer_id = sc.farmer_id
           WHERE fa.user_id = u.id AND sc.contact_status = 'dispute_incident') AS disputes_count,
        (SELECT count(*) FROM discrepancy_flags df WHERE df.raised_by = u.id) AS fraud_flags_raised_count,
        (SELECT count(*) FROM emergency_incidents ei WHERE ei.user_id = u.id) AS emergencies_count
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.key = 'surveyor' AND u.deleted_at IS NULL
      ORDER BY u.name
    `);
    res.json({ surveyorHistory: rows });
  } catch (err) {
    next(err);
  }
});

// Dashboard summary: case counts by contact_status and by a derived priority bucket
// (same priority definition as autoAssignService — intimation + default 10-day TAT vs
// "today" — this is informational-only on the dashboard, not tied to any specific
// auto-assign run's actual TAT/cutoff parameters), plus emergency/discrepancy counts.
// super_admin sees org-wide; manager is scoped to their state/district like elsewhere.
router.get('/dashboard-summary', async (req, res, next) => {
  try {
    // Build a WHERE fragment + params usable against a bare `survey_cases` table
    // (no alias) and a version usable against it aliased as `sc` (for the two queries
    // joined with emergency_incidents/discrepancy_flags below).
    let bareWhere = '1=1';
    let scWhere = '1=1';
    const params = [];
    if (req.user.role_key === ROLES.MANAGER) {
      if (req.user.scope_district_id) {
        params.push(req.user.scope_district_id);
        bareWhere = `district_id = $${params.length}`;
        scWhere = `sc.district_id = $${params.length}`;
      } else if (req.user.scope_state_id) {
        params.push(req.user.scope_state_id);
        bareWhere = `state_id = $${params.length}`;
        scWhere = `sc.state_id = $${params.length}`;
      } else {
        bareWhere = 'false';
        scWhere = 'false';
      }
    } else if (req.user.role_key === ROLES.SURVEYOR) {
      params.push(req.user.id);
      const sub = `farmer_id IN (SELECT farmer_id FROM farmer_assignments WHERE user_id = $${params.length} AND active = true)`;
      bareWhere = sub;
      scWhere = `sc.${sub}`;
    }

    const { rows: statusRows } = await pool.query(
      `SELECT contact_status, count(*)::int AS count FROM survey_cases
       WHERE deleted_at IS NULL AND ${bareWhere} GROUP BY contact_status`,
      params
    );

    const { rows: priorityRows } = await pool.query(
      `SELECT
         CASE
           WHEN farmer_intimation_date IS NULL THEN 'unknown'
           WHEN (farmer_intimation_date + interval '10 day')::date - CURRENT_DATE <= 5 THEN 'P1'
           WHEN (farmer_intimation_date + interval '10 day')::date - CURRENT_DATE <= 7 THEN 'P2'
           ELSE 'P3'
         END AS priority,
         count(*)::int AS count
       FROM survey_cases
       WHERE deleted_at IS NULL AND contact_status NOT IN ('completed', 'denied') AND ${bareWhere}
       GROUP BY priority`,
      params
    );

    const { rows: totalRows } = await pool.query(
      `SELECT count(*)::int AS total FROM survey_cases WHERE deleted_at IS NULL AND ${bareWhere}`,
      params
    );

    const { rows: emergencyRows } = await pool.query(
      `SELECT count(*)::int AS count FROM emergency_incidents ei
       JOIN survey_cases sc ON sc.id = ei.case_id
       WHERE ei.requires_manager_review = true AND ei.resolved_at IS NULL AND ${scWhere}`,
      params
    );

    const { rows: discrepancyRows } = await pool.query(
      `SELECT count(*)::int AS count FROM discrepancy_flags df
       JOIN survey_cases sc ON sc.id = df.case_id
       WHERE df.status = 'pending' AND ${scWhere}`,
      params
    );

    res.json({
      totalCases: totalRows[0]?.total || 0,
      byStatus: statusRows,
      byPriority: priorityRows,
      pendingEmergencyReviews: emergencyRows[0]?.count || 0,
      pendingDiscrepancyFlags: discrepancyRows[0]?.count || 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
