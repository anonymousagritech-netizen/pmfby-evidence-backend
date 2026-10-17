// Super-Admin-only, audited upload of the village centroid NDJSON straight onto the
// running backend's disk — see ROADMAP.md "Village centroid file on Render" for why
// this (option c from that discussion) was chosen over a Render persistent disk
// (requires a paid plan) or routing it through the evidence-file object-storage
// abstraction (that abstraction transparently AES-256-GCM-encrypts everything, which
// is pointless overhead for public geographic reference data, and would mean decrypting
// 150MB back out every time villageLookupService wants to read it).
//
// Streams straight to disk via multer.diskStorage (never buffered fully in memory —
// important at 150MB on a free-tier instance) and replaces the existing file atomically
// (write to a temp path, then rename) so a failed upload never corrupts the file the
// app already has loaded.
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { recordAudit } = require('../services/auditLog');
const villageLookup = require('../services/villageLookupService');

const router = express.Router();
router.use(authenticate);

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TARGET_FILE = path.join(DATA_DIR, 'village_centroids.ndjson');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      cb(null, DATA_DIR);
    },
    filename: (req, file, cb) => cb(null, `village_centroids.upload-${Date.now()}.tmp`),
  }),
  limits: { fileSize: 400 * 1024 * 1024 }, // generous headroom over the ~150MB current file
});

router.post('/upload', requireRole(ROLES.SUPER_ADMIN), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file (multipart field "file") required' });

    // Basic sanity check: NDJSON, so the first non-empty line should parse as JSON and
    // look like a village record, before we commit to replacing the live file.
    const sampleBuf = fs.readFileSync(req.file.path, { encoding: 'utf8', flag: 'r' }).slice(0, 2000);
    const firstLine = sampleBuf.split('\n').find((l) => l.trim());
    let parsedOk = false;
    try {
      const parsed = JSON.parse(firstLine);
      parsedOk = typeof parsed === 'object' && 'village' in parsed && 'lat' in parsed && 'lon' in parsed;
    } catch (e) { parsedOk = false; }

    if (!parsedOk) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File does not look like the expected village centroid NDJSON (expected lines with village/lat/lon fields)' });
    }

    fs.renameSync(req.file.path, TARGET_FILE);
    // Force a reload on next lookup rather than serving the stale in-memory copy.
    villageLookup.resetCache();

    const stat = fs.statSync(TARGET_FILE);
    await recordAudit(null, {
      userId: req.user.id,
      action: 'upload_village_centroids',
      resourceType: 'village_centroids',
      metadata: { sizeBytes: stat.size, originalFilename: req.file.originalname },
    });
    res.json({ ok: true, sizeBytes: stat.size });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* best effort cleanup */ }
    }
    next(err);
  }
});

router.get('/status', requireRole(ROLES.SUPER_ADMIN, ROLES.MANAGER), async (req, res, next) => {
  try {
    const loaded = await villageLookup.isLoaded();
    let sizeBytes = null;
    if (fs.existsSync(TARGET_FILE)) sizeBytes = fs.statSync(TARGET_FILE).size;
    res.json({ loaded, sizeBytes, path: TARGET_FILE });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
