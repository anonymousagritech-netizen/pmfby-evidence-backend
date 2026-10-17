import { useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community';
import { Search } from 'lucide-react';

ModuleRegistry.registerModules([AllCommunityModule]);

// Brand-accented Quartz theme — deliberately NOT a from-scratch skin. The point of
// switching to AG Grid is its inherent spreadsheet structure (visible cell borders,
// real column headers, resize handles) — we only tint it with the app's navy instead
// of re-theming it into something unrecognizable.
const gridTheme = themeQuartz.withParams({
  accentColor: '#0f2a4a',
  headerBackgroundColor: '#eef3f9',
  headerTextColor: '#0f2a4a',
  headerFontWeight: 700,
  borderColor: '#d1d5db',
  rowHoverColor: '#eef3f9',
  wrapperBorderRadius: 10,
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  fontSize: 13.5,
  // "Proper grid border" — vertical AND horizontal cell borders so every cell reads
  // as a distinct boxed Excel cell, not just a borderless list with row separators.
  wrapperBorder: true,
  headerRowBorder: true,
  headerColumnBorder: true,
  rowBorder: true,
  columnBorder: true,
});

// Same external API as the old hand-rolled DataTable (columns/rows/searchKeys/
// serverPagination/emptyMessage) so every page that used it only needed its import
// swapped — the real upgrade is AG Grid's actual grid behavior underneath: resizable/
// sortable columns, visible gridlines, row-selection checkboxes (selectable + onSelectionChanged),
// and quick-filter search.
export default function DataGrid({
  columns,
  rows,
  searchPlaceholder = 'Search...',
  searchKeys,
  serverPagination, // { page, pageSize, total, onPageChange }
  emptyMessage = 'No data.',
  selectable = false,
  onSelectionChanged,
  height = 460,
  rowHeight,
}) {
  const [quickFilter, setQuickFilter] = useState('');
  const gridRef = useRef(null);

  const colDefs = useMemo(() => {
    const defs = columns.map((col) => ({
      field: col.key,
      headerName: col.label,
      sortable: col.sortable !== false,
      filter: true,
      resizable: true,
      flex: col.flex || 1,
      minWidth: col.minWidth || 110,
      cellRenderer: col.render ? (params) => col.render(params.data) : undefined,
      valueGetter: col.render ? undefined : (params) => params.data[col.key],
    }));
    if (selectable) {
      defs.unshift({
        field: '__select',
        headerName: '',
        checkboxSelection: true,
        headerCheckboxSelection: true,
        sortable: false,
        filter: false,
        resizable: false,
        width: 44,
        pinned: 'left',
      });
    }
    return defs;
  }, [columns, selectable]);

  const total = serverPagination ? serverPagination.total : rows.length;
  const totalPages = serverPagination ? Math.max(1, Math.ceil(total / serverPagination.pageSize)) : 1;

  return (
    <div>
      <div className="data-toolbar">
        {searchKeys && !serverPagination && (
          <div style={{ position: 'relative', maxWidth: 260 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--neutral-500)' }} />
            <input
              type="search"
              placeholder={searchPlaceholder}
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              style={{ paddingLeft: 30 }}
            />
          </div>
        )}
        <div className="spacer" />
        <span className="result-count">{total} record{total === 1 ? '' : 's'}</span>
      </div>

      <div style={{ height, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          theme={gridTheme}
          rowData={rows}
          columnDefs={colDefs}
          rowHeight={rowHeight}
          quickFilterText={quickFilter}
          rowSelection={selectable ? { mode: 'multiRow', checkboxes: true, headerCheckbox: true } : undefined}
          onSelectionChanged={onSelectionChanged ? (e) => onSelectionChanged(e.api.getSelectedRows()) : undefined}
          pagination={!serverPagination}
          paginationPageSize={20}
          paginationPageSizeSelector={[10, 20, 50, 100]}
          overlayNoRowsTemplate={`<span class="help-text">${emptyMessage}</span>`}
          animateRows={false}
          suppressCellFocus
        />
      </div>

      {serverPagination && (
        <div className="pagination">
          <button type="button" onClick={() => serverPagination.onPageChange(1)} disabled={serverPagination.page <= 1}>«</button>
          <button type="button" onClick={() => serverPagination.onPageChange(serverPagination.page - 1)} disabled={serverPagination.page <= 1}>‹</button>
          <span className="page-info">Page {serverPagination.page} of {totalPages}</span>
          <button type="button" onClick={() => serverPagination.onPageChange(serverPagination.page + 1)} disabled={serverPagination.page >= totalPages}>›</button>
          <button type="button" onClick={() => serverPagination.onPageChange(totalPages)} disabled={serverPagination.page >= totalPages}>»</button>
        </div>
      )}
    </div>
  );
}
