// Single place to turn a timestamp (JS Date, ISO string, or epoch) into the human-readable,
// India-local date string used in SMS templates and anywhere else a date is shown to a user.
// Fixes the bug where `String(someDate)` leaked a raw JS Date.toString() dump — including
// "GMT+0000 (Coordinated Universal Time)" — straight into a sent SMS. The app is India-only,
// so every date is rendered in Asia/Kolkata (IST, UTC+5:30) regardless of server timezone.
const IST_TIME_ZONE = 'Asia/Kolkata';

/**
 * Formats a date-like value as "13 Oct 2026" (day, short month, year) in IST.
 * Returns null for null/undefined/invalid input so callers can decide how to treat "missing".
 */
function formatDateIST(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Formats a date-like value as "13 Oct 2026, 02:30 PM" in IST. */
function formatDateTimeIST(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const datePart = formatDateIST(date);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return `${datePart}, ${timePart}`;
}

module.exports = { formatDateIST, formatDateTimeIST, IST_TIME_ZONE };
