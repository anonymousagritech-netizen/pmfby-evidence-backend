// Builds an .xlsx workbook summarizing an auto-assign run (preview or commit) — same
// spirit as the reference HTML tool's downloadExcel(), rebuilt server-side against
// real data: one sheet of every assigned case, one per-surveyor summary sheet, and an
// Unassigned sheet when applicable. Uses ExcelJS (already a dependency for the Excel
// IMPORT side of this app — see importService.js — so no new package was needed).
const ExcelJS = require('exceljs');

function fmtDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

async function buildAutoAssignWorkbook({ casesWithPriority, placements, perSurveyor, unassignedCaseIds, surveyorContacts }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PMFBY Evidence — Auto-Assign';
  wb.created = new Date();

  const contactFor = (id) => surveyorContacts.get(id) || { name: id, mobile: '' };

  // Sheet 1: every assigned case, one row per case. Column named "ASSIGN" to match the
  // source Excel's manual-assignment column the agency fills in today — this view is
  // meant to replace that manual step, so keeping the familiar column name/spirit
  // means the admin can compare this output 1:1 against what they used to do by hand.
  const casesSheet = wb.addWorksheet('Assigned Cases');
  casesSheet.columns = [
    { header: 'Docket ID', key: 'docketId2', width: 22 },
    { header: 'Farmer Name', key: 'farmerName', width: 24 },
    { header: 'District', key: 'districtName', width: 18 },
    { header: 'Village', key: 'villageName', width: 22 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Days Remaining', key: 'daysRemaining', width: 14 },
    { header: 'TAT Deadline', key: 'deadline', width: 14 },
    { header: 'ASSIGN', key: 'assign', width: 24 },
    { header: 'Surveyor Mobile', key: 'surveyorMobile', width: 16 },
  ];
  for (const c of casesWithPriority) {
    const surveyorId = placements.get(c.id);
    if (!surveyorId) continue; // unassigned cases get their own sheet below
    const contact = contactFor(surveyorId);
    casesSheet.addRow({
      docketId2: c.docketId2 || '',
      farmerName: c.farmerName || '',
      districtName: c.districtName || c.districtId || '',
      villageName: c.villageName || '',
      priority: c.priority,
      daysRemaining: c.daysRemaining,
      deadline: fmtDate(c.deadline),
      assign: contact.name,
      surveyorMobile: contact.mobile,
    });
  }
  casesSheet.getRow(1).font = { bold: true };

  // Sheet 2: per-surveyor load summary.
  const summarySheet = wb.addWorksheet('Surveyor Summary');
  summarySheet.columns = [
    { header: 'Surveyor', key: 'name', width: 24 },
    { header: 'Mobile', key: 'mobile', width: 16 },
    { header: 'Districts', key: 'districtCount', width: 10 },
    { header: 'Villages', key: 'villageCount', width: 10 },
    { header: 'Total Cases', key: 'totalCases', width: 12 },
    { header: 'P1', key: 'p1', width: 8 },
    { header: 'P2', key: 'p2', width: 8 },
    { header: 'P3', key: 'p3', width: 8 },
    { header: 'Under Minimum?', key: 'underMinimum', width: 15 },
  ];
  for (const s of perSurveyor) {
    const contact = contactFor(s.surveyorId);
    summarySheet.addRow({
      name: contact.name,
      mobile: contact.mobile,
      districtCount: s.districtCount,
      villageCount: s.villageCount,
      totalCases: s.totalCases,
      p1: s.p1,
      p2: s.p2,
      p3: s.p3,
      underMinimum: s.underMinimum ? 'Yes' : '',
    });
  }
  summarySheet.getRow(1).font = { bold: true };

  // Sheet 3 (only when non-empty): cases the algorithm couldn't place (no eligible
  // surveyor in that district yet) — flagged for the admin rather than silently lost.
  if (unassignedCaseIds.length > 0) {
    const unassignedSheet = wb.addWorksheet('Unassigned');
    unassignedSheet.columns = [
      { header: 'Docket ID', key: 'docketId2', width: 22 },
      { header: 'Farmer Name', key: 'farmerName', width: 24 },
      { header: 'District', key: 'districtName', width: 18 },
      { header: 'Village', key: 'villageName', width: 22 },
      { header: 'Reason', key: 'reason', width: 30 },
    ];
    const unassignedSet = new Set(unassignedCaseIds);
    for (const c of casesWithPriority) {
      if (!unassignedSet.has(c.id)) continue;
      unassignedSheet.addRow({
        docketId2: c.docketId2 || '',
        farmerName: c.farmerName || '',
        districtName: c.districtName || c.districtId || '',
        villageName: c.villageName || '',
        reason: 'No surveyor with home-district eligibility in this district',
      });
    }
    unassignedSheet.getRow(1).font = { bold: true };
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { buildAutoAssignWorkbook };
