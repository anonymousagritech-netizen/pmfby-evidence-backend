// Shared status/priority badge, used across Farmers, Evidence, ZIP Archives, Auto-Assign.
export function StatusBadge({ status }) {
  if (!status) return null;
  const key = String(status).toLowerCase();
  return <span className={`badge ${key}`}>{status.replace(/_/g, ' ')}</span>;
}

export function PriorityBadge({ priority }) {
  if (!priority) return null;
  const key = String(priority).toLowerCase();
  return <span className={`badge priority-${key}`}>{priority}</span>;
}
