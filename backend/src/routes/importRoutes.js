const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { createImportPreview, commitImport, buildImportTemplateWorkbook } = require('../services/importService');
const { pool } = require('../db/pool');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));

// Downloadable blank/example .xlsx matching exactly the real-world column headers this
// importer recognizes (kept in sync with importService.js's own column list — the
// generator and the importer read the same source of truth, so this can't drift out of
// sync with what the importer actually expects).
router.get('/template', async (req, res, next) => {
  try {
    const buffer = await buildImportTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="case-import-template.xlsx"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// Step 1: upload Excel, get back a proposed column mapping + data preview. Nothing is
// committed to the DB yet.
router.post('/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required (multipart field "file")' });
    const result = await createImportPreview({
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      uploadedBy: req.user.id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Step 2: admin confirms (or overrides) the mapping -> commit. Upserts by
// (Docket_ID2, Application_No); dedupes farmers by name+village+mobile heuristic.
router.post('/commit', async (req, res, next) => {
  try {
    const { sessionId, confirmedMapping } = req.body;
    if (!sessionId || !confirmedMapping) {
      return res.status(400).json({ error: 'sessionId and confirmedMapping required' });
    }
    const result = await commitImport({ sessionId, confirmedMapping, uploadedBy: req.user.id });
    res.json(result);
  } catch (err) {
    if (/session not found/i.test(err.message)) return res.status(410).json({ error: err.message });
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, original_filename, inserted_count, updated_count, unchanged_count,
              skipped_count, error_count, created_at
       FROM import_batches ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ batches: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
