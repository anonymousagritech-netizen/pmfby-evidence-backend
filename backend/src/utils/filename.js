// Filename sanitization + collision-safe de-dupe for ZIP archive naming.
// Spec naming: FarmerName_Contact_Village_Date_Time.zip
const UNSAFE_CHARS = /[\/\\:*?"<>|]/g;

function sanitizeFilenamePart(part) {
  if (part === null || part === undefined || part === '') return 'Unknown';
  return String(part)
    .replace(UNSAFE_CHARS, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Unknown';
}

function buildZipFilename({ farmerName, village, date, time }) {
  const parts = [
    sanitizeFilenamePart(farmerName),
    'Contact',
    sanitizeFilenamePart(village),
    sanitizeFilenamePart(date),
    sanitizeFilenamePart(time),
  ];
  return `${parts.join('_')}.zip`;
}

// Given a desired filename and a set/array of filenames that already exist, return a
// collision-free name by appending _1, _2, ... before the extension.
function dedupeFilename(desiredName, existingNames) {
  const existing = new Set(existingNames);
  if (!existing.has(desiredName)) return desiredName;
  const dotIndex = desiredName.lastIndexOf('.');
  const base = dotIndex === -1 ? desiredName : desiredName.slice(0, dotIndex);
  const ext = dotIndex === -1 ? '' : desiredName.slice(dotIndex);
  let i = 1;
  let candidate = `${base}_${i}${ext}`;
  while (existing.has(candidate)) {
    i += 1;
    candidate = `${base}_${i}${ext}`;
  }
  return candidate;
}

module.exports = { sanitizeFilenamePart, buildZipFilename, dedupeFilename };
