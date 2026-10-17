// Village polygon boundary endpoints + the same upload-to-disk pattern already used for
// the centroid NDJSON (routes/villageData.js) — see ROADMAP.md for why (too large for
// git, Render free tier has no clean large-file-via-git story).
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { recordAudit } = require('../services/auditLog');
const boundaryLookup = require('../services/boundaryLookupService');

const router = express.Router();
router.use(authenticate);

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TARGET_FILE = path.join(DATA_DIR, 'village_boundaries.ndjson');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(DATA_DIR, { recursive: true }); cb(null, DATA_DIR); },
    filename: (req, file, cb) => cb(null, `village_boundaries.upload-${Date.now()}.tmp`),
  }),
  limits: { fileSize: 600 * 1024 * 1024 }, // headroom over the current ~200MB file
});

// Boundaries for every village in a district (map "load this whole district" view).
router.get('/by-district', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { district } = req.query;
    if (!district) return res.status(400).json({ error: 'district query param required' });
    const records = await boundaryLookup.getByDistrict(district);
    res.json({ boundaries: records });
  } catch (err) { next(err); }
});

// Boundaries for exactly the (district, village) pairs relevant to the current
// context — used by the Auto-Assign preview/commit map so the browser only ever
// downloads the villages actually touched by that run, never all-India data.
router.post('/by-villages', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const { villages } = req.body; // [{village, district}]
    if (!Array.isArray(villages) || villages.length === 0) {
      return res.status(400).json({ error: 'villages (non-empty array of {village, district}) required' });
    }
    const records = await boundaryLookup.getByVillageRefs(villages);
    res.json({ boundaries: records });
  } catch (err) { next(err); }
});

router.post('/upload', requireRole(ROLES.SUPER_ADMIN), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file (multipart field "file") required' });

    const sample = fs.readFileSync(req.file.path, { encoding: 'utf8' }).slice(0, 4000);
    const firstLine = sample.split('\n').find((l) => l.trim());
    let parsedOk = false;
    try {
      const parsed = JSON.parse(firstLine);
      parsedOk = typeof parsed === 'object' && 'village' in parsed && 'geometry' in parsed
        && parsed.geometry && (parsed.geometry.type === 'Polygon' || parsed.geometry.type === 'MultiPolygon');
    } catch (e) { parsedOk = false; }

    if (!parsedOk) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File does not look like the expected village boundary NDJSON (expected lines with village/geometry fields)' });
    }

    fs.renameSync(req.file.path, TARGET_FILE);
    boundaryLookup.resetCache();

    const stat = fs.statSync(TARGET_FILE);
    await recordAudit(null, {
      userId: req.user.id,
      action: 'upload_village_boundaries',
      resourceType: 'village_boundaries',
      metadata: { sizeBytes: stat.size, originalFilename: req.file.originalname },
    });
    res.json({ ok: true, sizeBytes: stat.size });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* best effort */ }
    }
    next(err);
  }
});

router.get('/status', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const loaded = await boundaryLookup.isLoaded();
    let sizeBytes = null;
    if (fs.existsSync(TARGET_FILE)) sizeBytes = fs.statSync(TARGET_FILE).size;
    res.json({ loaded, sizeBytes, path: TARGET_FILE });
  } catch (err) { next(err); }
});

module.exports = router;
