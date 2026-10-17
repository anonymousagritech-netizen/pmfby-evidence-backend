import { useMemo, useState } from 'react';

// Lightweight data-grid: client-side sort + search + pagination over a `rows` array
// already in memory (used where the backend still returns a capped list), OR, when
// `serverPagination` is passed ({ page, pageSize, total, onPageChange }), purely
// presentational pagination controls driven by the caller's own server-paginated fetch
// (used for Farmers and Audit Logs, which support real page/pageSize/total from the API).
// No external table library — kept deliberately small for bundle size on Render's free
// static tier, per the brief.
export default function DataTable({
  columns, // [{ key, label, sortable, render }]
  rows,
  searchPlaceholder = 'Search...',
  searchKeys, // array of row keys to client-filter against; omit to disable search
  pageSize = 20,
  serverPagination, // { page, pageSize, total, onPageChange } — disables client pagination/search
  emptyMessage = 'No data.',
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (serverPagination || !searchKeys || !search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
  }, [rows, search, searchKeys, serverPagination]);

  const sorted = useMemo(() => {
    if (serverPagination || !sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir, serverPagination]);

  const effectivePage = serverPagination ? serverPagination.page : page;
  const effectivePageSize = serverPagination ? serverPagination.pageSize : pageSize;
  const total = serverPagination ? serverPagination.total : sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
  const pageRows = serverPagination ? rows : sorted.slice((page - 1) * pageSize, page * pageSize);

  function toggleSort(key) {
    if (serverPagination) return;
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function goToPage(p) {
    const clamped = Math.min(Math.max(1, p), totalPages);
    if (serverPagination) serverPagination.onPageChange(clamped);
    else setPage(clamped);
  }

  return (
    <div>
      <div className="data-toolbar">
        {searchKeys && !serverPagination && (
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        )}
        <div className="spacer" />
        <span className="result-count">{total} record{total === 1 ? '' : 's'}</span>
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.sortable && !serverPagination ? 'sortable' : undefined}
                onClick={col.sortable ? () => toggleSort(col.key) : undefined}
              >
                {col.label}
                {col.sortable && !serverPagination && sortKey === col.key && (
                  <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 && (
            <tr><td colSpan={columns.length} className="help-text">{emptyMessage}</td></tr>
          )}
          {pageRows.map((row, i) => (
            <tr key={row.id ?? i}>
              {columns.map((col) => (
                <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pagination">
        <button type="button" onClick={() => goToPage(1)} disabled={effectivePage <= 1}>«</button>
        <button type="button" onClick={() => goToPage(effectivePage - 1)} disabled={effectivePage <= 1}>‹</button>
        <span className="page-info">Page {effectivePage} of {totalPages}</span>
        <button type="button" onClick={() => goToPage(effectivePage + 1)} disabled={effectivePage >= totalPages}>›</button>
        <button type="button" onClick={() => goToPage(totalPages)} disabled={effectivePage >= totalPages}>»</button>
      </div>
    </div>
  );
}
