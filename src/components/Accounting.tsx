import React, { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Download, RefreshCcw, Save, Search, Sigma, Trash2, Undo2, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  buildSheetEvaluator,
  compileFormula,
  columnIndexToLetter,
  formatFormulaValue,
  isFormulaError,
  toExcelFormula,
  validateFormula,
  FORMULA_FUNCTIONS,
  type SheetFormulaSpec,
} from '../lib/formulaEngine';

/**
 * Accounting — the in-app replacement for the Google Sheets workbook.
 *
 * Loads every tab on demand, shows it as an editable grid, and lets an admin
 * define **column formulas of their own** that are computed here (by
 * src/lib/formulaEngine.ts — a real parser, never `eval`). A formula is
 * attached to a column and applies to every data row, which is what makes it
 * durable: there is no per-cell formula to accidentally break, and the
 * definition is one editable object rather than 350 copies.
 *
 * Formulas imported from Google Sheets are shown read-only for reference
 * where they exist. Note that a tab fed by a single QUERY/IMPORTRANGE has no
 * per-cell formulas at all — its numbers are the result of one import, so
 * there is nothing per-cell to display. That is exactly the case for
 * defining the calculation here instead.
 *
 * Not yet persisted: edits and formulas live in this browser tab until the
 * Firestore storage stage is connected, so Save is deliberately disabled.
 */

interface AccountingTab {
  name: string;
  values: string[][];
  formulas: (string | null)[][];
  formulaCount: number;
  rowCount: number;
  columnCount: number;
}

interface WorkbookResponse {
  tabs: AccountingTab[];
  formulasAvailable: boolean;
  source: 'google_sheets' | 'csv';
  missingTabs: string[];
  spreadsheetId: string;
  loadedAt: string;
}

/** A formula the user defined in the app, per tab and column. */
interface ColumnFormula {
  source: string;
  firstRow: number;
}

type FormulaMap = Record<string, Record<number, ColumnFormula>>;

const ROWS_PER_PAGE = 100;

/** Object.entries() on a numeric-keyed Record widens the value to unknown,
 *  so go through this instead of casting at every call site. */
function formulaEntries(map: Record<number, ColumnFormula>): Array<[number, ColumnFormula]> {
  return Object.keys(map).map((k) => [Number(k), map[Number(k)]]);
}

function editKey(tab: string, row: number, col: number) {
  return `${tab}|${row}|${col}`;
}

function toXlsxCell(display: string, formula: string | null): XLSX.CellObject {
  const text = String(display ?? '').trim();
  const f = formula ? formula.replace(/^=/, '') : undefined;
  if (text === '') return f ? { t: 's', v: '', f } : { t: 's', v: '' };
  const pct = text.match(/^(-?[\d,]+(?:\.\d+)?)\s*%$/);
  if (pct) {
    const n = parseFloat(pct[1].replace(/,/g, ''));
    if (Number.isFinite(n)) return { t: 'n', v: n / 100, z: '0.00%', ...(f ? { f } : {}) };
  }
  if (/^-?[\d,]+(?:\.\d+)?$/.test(text)) {
    const n = parseFloat(text.replace(/,/g, ''));
    if (Number.isFinite(n)) return { t: 'n', v: n, ...(f ? { f } : {}) };
  }
  return f ? { t: 's', v: text, f } : { t: 's', v: text };
}

/** These sheets carry a title line, a header line and a description line
 *  before the data starts. Find the header row (mostly text, several filled
 *  cells) and the first data row (two or more cells that read as numbers). */
function detectLayout(values: string[][], columnCount: number) {
  const isNumeric = (s: string) => /^[\s]*[-(]?\s*(Rp|IDR|\$|€)?\s*[\d][\d,. ]*\)?\s*%?$/.test(String(s || '').trim()) && /\d/.test(s || '');

  let firstDataRow = 1;
  for (let r = 0; r < Math.min(values.length, 40); r++) {
    const row = values[r] || [];
    const numeric = row.filter((c) => isNumeric(c)).length;
    if (numeric >= 2) {
      firstDataRow = r + 1;
      break;
    }
  }

  let headerRow = -1;
  for (let r = 0; r < Math.min(values.length, firstDataRow); r++) {
    const row = values[r] || [];
    const filled = row.filter((c) => String(c || '').trim() !== '');
    const texty = filled.filter((c) => !isNumeric(c));
    if (filled.length >= 3 && texty.length >= filled.length - 1) headerRow = r;
  }

  const headers: string[] = Array.from({ length: columnCount }, (_, c) => {
    const raw = headerRow >= 0 ? String(values[headerRow]?.[c] ?? '').trim() : '';
    return raw;
  });

  return { headerRow, firstDataRow, headers };
}

export function Accounting() {
  const [workbook, setWorkbook] = useState<WorkbookResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Summary');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [formulaMap, setFormulaMap] = useState<FormulaMap>({});
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  // Formula editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftCol, setDraftCol] = useState<number>(-1);
  const [draftSource, setDraftSource] = useState('');
  const [draftFirstRow, setDraftFirstRow] = useState<number>(1);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/accounting/workbook', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 || res.status === 401) {
          throw new Error(
            `${body.error || 'Access denied'} — your sign-in session doesn't carry platform-admin rights. Sign out and sign in again to refresh it.`
          );
        }
        throw new Error(body.error || `Failed to load workbook (${res.status})`);
      }
      const data = (await res.json()) as WorkbookResponse;
      setWorkbook(data);
      setEdits({});
      setPage(0);
      if (!data.tabs.some((t) => t.name === activeTab) && data.tabs.length > 0) {
        setActiveTab(data.tabs[0].name);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load workbook');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const tab = useMemo(() => workbook?.tabs.find((t) => t.name === activeTab) || null, [workbook, activeTab]);
  const layout = useMemo(() => (tab ? detectLayout(tab.values, tab.columnCount) : null), [tab]);
  const tabFormulas = formulaMap[activeTab] || {};

  /** The tab's grid with the user's cell edits applied — the input the
   *  formula evaluator runs over, so a formula always sees current values. */
  const effectiveGrid = useMemo(() => {
    if (!tab) return [] as string[][];
    return tab.values.map((row, r) =>
      Array.from({ length: tab.columnCount }, (_, c) => {
        const k = editKey(tab.name, r, c);
        return k in edits ? edits[k] : (row[c] ?? '');
      })
    );
  }, [tab, edits]);

  const evaluator = useMemo(() => {
    if (!tab) return null;
    const specs: SheetFormulaSpec[] = formulaEntries(tabFormulas).map(([col, f]) => ({
      col,
      source: f.source,
      firstRow: f.firstRow,
    }));
    return buildSheetEvaluator({
      grid: effectiveGrid,
      rowCount: tab.rowCount,
      colCount: tab.columnCount,
      formulas: specs,
    });
  }, [tab, effectiveGrid, tabFormulas]);

  /** Displayed value for a cell: a system formula wins, then an edit, then
   *  whatever the sheet had. */
  const displayValue = useCallback(
    (r: number, c: number): { text: string; computed: boolean; error: boolean; title?: string } => {
      if (!tab) return { text: '', computed: false, error: false };
      const spec = tabFormulas[c];
      if (spec && r + 1 >= spec.firstRow && evaluator) {
        const v = evaluator.valueAt(r, c);
        const compileError = evaluator.compileErrors.get(c);
        if (compileError) return { text: '#ERROR', computed: true, error: true, title: compileError };
        return {
          text: formatFormulaValue(v),
          computed: true,
          error: isFormulaError(v),
          title: isFormulaError(v) ? `${spec.source} → ${v.message}` : spec.source,
        };
      }
      const k = editKey(tab.name, r, c);
      const text = k in edits ? edits[k] : (tab.values[r]?.[c] ?? '');
      return { text, computed: false, error: false };
    },
    [tab, tabFormulas, evaluator, edits]
  );

  const editCount = Object.keys(edits).length;
  const formulaCountDefined = Object.keys(tabFormulas).length;

  const visibleRowIndexes = useMemo(() => {
    if (!tab) return [] as number[];
    const all = tab.values.map((_, i) => i);
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => {
      for (let c = 0; c < tab.columnCount; c++) {
        if (displayValue(r, c).text.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [tab, search, displayValue]);

  const pageCount = Math.max(1, Math.ceil(visibleRowIndexes.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visibleRowIndexes.slice(safePage * ROWS_PER_PAGE, (safePage + 1) * ROWS_PER_PAGE);

  /** First imported Google formula per column — reference only. */
  const importedFormulaByCol = useMemo(() => {
    const out = new Map<number, { row: number; formula: string }>();
    if (!tab || tab.formulas.length === 0) return out;
    for (let c = 0; c < tab.columnCount; c++) {
      for (let r = 0; r < tab.formulas.length; r++) {
        const f = tab.formulas[r]?.[c];
        if (f) {
          out.set(c, { row: r + 1, formula: f });
          break;
        }
      }
    }
    return out;
  }, [tab]);

  const handleCellChange = (r: number, c: number, original: string, next: string) => {
    if (!tab) return;
    const k = editKey(tab.name, r, c);
    setEdits((prev) => {
      const copy = { ...prev };
      if (next === original) delete copy[k];
      else copy[k] = next;
      return copy;
    });
  };

  // --- formula editor -------------------------------------------------------

  const openEditor = (col: number) => {
    if (!tab || !layout) return;
    const existing = tabFormulas[col];
    setDraftCol(col);
    setDraftSource(existing?.source ?? '');
    setDraftFirstRow(existing?.firstRow ?? layout.firstDataRow);
    setEditorOpen(true);
  };

  const draftError = useMemo(() => (draftSource.trim() ? validateFormula(draftSource) : null), [draftSource]);

  /** Live preview: run the draft against the real grid on the first few
   *  applicable rows, so a mistake is visible before it's applied. */
  const draftPreview = useMemo(() => {
    if (!tab || draftCol < 0 || !draftSource.trim() || draftError) return [];
    const specs: SheetFormulaSpec[] = [
      ...formulaEntries(tabFormulas)
        .filter(([col]) => col !== draftCol)
        .map(([col, f]) => ({ col, source: f.source, firstRow: f.firstRow })),
      { col: draftCol, source: draftSource, firstRow: draftFirstRow },
    ];
    let preview: { row: number; before: string; after: string; isError: boolean; message?: string }[] = [];
    try {
      const ev = buildSheetEvaluator({
        grid: effectiveGrid,
        rowCount: tab.rowCount,
        colCount: tab.columnCount,
        formulas: specs,
      });
      for (let r = draftFirstRow - 1; r < tab.rowCount && preview.length < 6; r++) {
        if (r < 0) continue;
        const v = ev.valueAt(r, draftCol);
        preview.push({
          row: r + 1,
          before: tab.values[r]?.[draftCol] ?? '',
          after: formatFormulaValue(v),
          isError: isFormulaError(v),
          message: isFormulaError(v) ? v.message : undefined,
        });
      }
    } catch {
      return [];
    }
    return preview;
  }, [tab, draftCol, draftSource, draftFirstRow, draftError, tabFormulas, effectiveGrid]);

  const applyDraft = () => {
    if (!tab || draftCol < 0 || draftError || !draftSource.trim()) return;
    setFormulaMap((prev) => ({
      ...prev,
      [tab.name]: { ...(prev[tab.name] || {}), [draftCol]: { source: draftSource.trim(), firstRow: draftFirstRow } },
    }));
    setEditorOpen(false);
    setDraftCol(-1);
    setDraftSource('');
  };

  const removeFormula = (col: number) => {
    if (!tab) return;
    setFormulaMap((prev) => {
      const forTab = { ...(prev[tab.name] || {}) };
      delete forTab[col];
      return { ...prev, [tab.name]: forTab };
    });
    if (draftCol === col) {
      setEditorOpen(false);
      setDraftCol(-1);
    }
  };

  // --- export ---------------------------------------------------------------

  const handleExport = () => {
    if (!workbook) return;
    const wb = XLSX.utils.book_new();

    workbook.tabs.forEach((t) => {
      const specsObj: Record<number, ColumnFormula> = formulaMap[t.name] || {};
      const grid = t.values.map((row, r) =>
        Array.from({ length: t.columnCount }, (_, c) => {
          const k = editKey(t.name, r, c);
          return k in edits ? edits[k] : (row[c] ?? '');
        })
      );
      const specs: SheetFormulaSpec[] = formulaEntries(specsObj).map(([col, f]) => ({
        col,
        source: f.source,
        firstRow: f.firstRow,
      }));
      const ev = buildSheetEvaluator({ grid, rowCount: t.rowCount, colCount: t.columnCount, formulas: specs });

      // System formulas become real Excel formulas, bound to each row.
      const compiledByCol = new Map<number, ReturnType<typeof compileFormula>>();
      specs.forEach((s) => {
        try {
          compiledByCol.set(s.col, compileFormula(s.source));
        } catch {
          /* invalid formulas export as their computed value only */
        }
      });

      const aoa: XLSX.CellObject[][] = grid.map((row, r) =>
        Array.from({ length: t.columnCount }, (_, c) => {
          const spec = specsObj[c];
          if (spec && r + 1 >= spec.firstRow) {
            const value = ev.valueAt(r, c);
            const compiled = compiledByCol.get(c);
            const excel = compiled ? toExcelFormula(compiled, r + 1) : null;
            if (isFormulaError(value)) return { t: 's', v: formatFormulaValue(value), ...(excel ? { f: excel.slice(1) } : {}) };
            if (typeof value === 'number') return { t: 'n', v: value, ...(excel ? { f: excel.slice(1) } : {}) };
            if (typeof value === 'boolean') return { t: 'b', v: value, ...(excel ? { f: excel.slice(1) } : {}) };
            return toXlsxCell(String(value), excel);
          }
          return toXlsxCell(row[c] ?? '', t.formulas[r]?.[c] ?? null);
        })
      );

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, t.name.slice(0, 31));
    });

    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    XLSX.writeFile(wb, `evdekimi-accounting-${stamp}.xlsx`);
  };

  const loadedAtLabel = workbook
    ? new Date(workbook.loadedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const columnLabel = (c: number) => {
    const header = layout?.headers[c] || '';
    const letter = columnIndexToLetter(c);
    return header ? `${letter} · ${header.length > 28 ? header.slice(0, 28) + '…' : header}` : letter;
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-brand-muted/10 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-3">
        <button
          onClick={handleLoad}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-brand-navy text-white hover:bg-brand-navy/90 disabled:opacity-60 disabled:cursor-wait transition-all"
        >
          <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Loading…' : workbook ? 'Reload from Google Sheets' : 'Load from Google Sheets'}
        </button>

        <button
          onClick={() => {
            if (!tab) return;
            const firstDefined = Object.keys(tabFormulas)[0];
            openEditor(firstDefined !== undefined ? Number(firstDefined) : 0);
          }}
          disabled={!tab}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-brand-muted/20 text-brand-navy hover:bg-brand-navy/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <Sigma className="w-4 h-4" />
          Formulas
          {formulaCountDefined > 0 && (
            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">{formulaCountDefined}</span>
          )}
        </button>

        <button
          onClick={handleExport}
          disabled={!workbook}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-brand-muted/20 text-brand-navy hover:bg-brand-navy/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          title={workbook ? 'Download the whole workbook as .xlsx — your edits and your formulas included' : 'Load the workbook first'}
        >
          <Download className="w-4 h-4" />
          Export to Excel
        </button>

        <button
          disabled
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-brand-muted/20 text-brand-muted/60 cursor-not-allowed"
          title="Saving will be enabled once the Firebase storage is connected (next stage)"
        >
          <Save className="w-4 h-4" />
          Save
          <span className="text-[10px] font-normal ml-1">soon</span>
        </button>

        <button
          onClick={() => setEdits({})}
          disabled={editCount === 0}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-brand-muted hover:text-brand-navy hover:bg-brand-navy/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <Undo2 className="w-4 h-4" />
          Discard edits
        </button>

        <div className="ml-auto text-[11px] text-brand-muted text-right leading-relaxed">
          {workbook ? (
            <>
              <div>
                Loaded {loadedAtLabel} · {workbook.source === 'google_sheets' ? 'Google Sheets API' : 'CSV export'}
              </div>
              <div className={editCount > 0 ? 'text-amber-600 font-bold' : ''}>
                {editCount === 0 ? 'No unsaved edits' : `${editCount} unsaved edit${editCount === 1 ? '' : 's'} (this browser tab only)`}
              </div>
            </>
          ) : (
            <div>Nothing loaded yet — press “Load from Google Sheets”.</div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {workbook && workbook.missingTabs.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl px-4 py-3 text-xs">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Tabs not found in the spreadsheet: {workbook.missingTabs.join(', ')}.</span>
        </div>
      )}

      {/* Formula editor */}
      {editorOpen && tab && layout && (
        <div className="bg-white border border-brand-muted/15 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-brand-navy flex items-center gap-2">
                <Sigma className="w-4 h-4" />
                Column formulas — {tab.name}
              </h3>
              <p className="text-[11px] text-brand-muted mt-0.5">
                A formula belongs to a column and fills every data row. Write <code className="font-mono">G</code> for this row's
                column G, <code className="font-mono">G7</code> for that exact cell, <code className="font-mono">G6:G20</code> for a range.
              </p>
            </div>
            <button onClick={() => setEditorOpen(false)} className="text-brand-muted hover:text-brand-navy p-1">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* existing formulas */}
          {formulaCountDefined > 0 && (
            <div className="space-y-1.5">
              {formulaEntries(tabFormulas)
                .sort((a, b) => a[0] - b[0])
                .map(([c, f]) => {
                  const col = c;
                  const compileError = evaluator?.compileErrors.get(c);
                  return (
                    <div
                      key={col}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-xs ${
                        compileError ? 'border-red-200 bg-red-50' : 'border-brand-muted/15 bg-brand-navy/[0.02]'
                      }`}
                    >
                      <span className="font-bold text-brand-navy w-40 flex-shrink-0 truncate">{columnLabel(c)}</span>
                      <code className="font-mono text-brand-navy/80 flex-1 min-w-0 truncate">{f.source}</code>
                      <span className="text-brand-muted flex-shrink-0">from row {f.firstRow}</span>
                      {compileError && <span className="text-red-600 flex-shrink-0">{compileError}</span>}
                      <button onClick={() => openEditor(c)} className="text-blue-600 hover:underline flex-shrink-0 font-medium">
                        Edit
                      </button>
                      <button onClick={() => removeFormula(c)} className="text-red-600 hover:text-red-700 flex-shrink-0" title="Remove formula">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
            </div>
          )}

          {/* draft */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 pt-2 border-t border-brand-muted/10">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <label className="text-[11px] text-brand-muted font-bold uppercase tracking-wide flex-1 min-w-[200px]">
                  Column
                  <select
                    value={draftCol}
                    onChange={(e) => setDraftCol(Number(e.target.value))}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg border border-brand-muted/20 text-xs text-brand-navy font-normal normal-case tracking-normal focus:outline-none focus:border-brand-navy/40"
                  >
                    {Array.from({ length: tab.columnCount }, (_, c) => (
                      <option key={c} value={c}>
                        {columnLabel(c)}
                        {tabFormulas[c] ? ' (has formula)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-brand-muted font-bold uppercase tracking-wide w-32">
                  Apply from row
                  <input
                    type="number"
                    min={1}
                    max={tab.rowCount}
                    value={draftFirstRow}
                    onChange={(e) => setDraftFirstRow(Math.max(1, Math.min(tab.rowCount, Number(e.target.value) || 1)))}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg border border-brand-muted/20 text-xs text-brand-navy font-normal focus:outline-none focus:border-brand-navy/40"
                  />
                </label>
              </div>

              <label className="block text-[11px] text-brand-muted font-bold uppercase tracking-wide">
                Formula
                <input
                  value={draftSource}
                  onChange={(e) => setDraftSource(e.target.value)}
                  placeholder="= G - H"
                  spellCheck={false}
                  className={`mt-1 w-full px-3 py-2 rounded-lg border font-mono text-sm text-brand-navy font-normal focus:outline-none ${
                    draftError ? 'border-red-300 bg-red-50 focus:border-red-400' : 'border-brand-muted/20 focus:border-brand-navy/40'
                  }`}
                />
              </label>

              {draftError && (
                <p className="text-[11px] text-red-600 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  {draftError}
                </p>
              )}

              {importedFormulaByCol.get(draftCol) && (
                <p className="text-[11px] text-brand-muted">
                  Google Sheets has this in {columnIndexToLetter(draftCol)}
                  {importedFormulaByCol.get(draftCol)!.row}:{' '}
                  <code className="font-mono text-brand-navy/70">{importedFormulaByCol.get(draftCol)!.formula}</code>
                </p>
              )}

              <details className="text-[11px] text-brand-muted">
                <summary className="cursor-pointer hover:text-brand-navy">Available functions</summary>
                <p className="mt-1 font-mono leading-relaxed">{FORMULA_FUNCTIONS.join(', ')}</p>
                <p className="mt-1">
                  Operators: + − * / ^ % and comparisons = &lt;&gt; &lt; &lt;= &gt; &gt;=. Text in double quotes.
                </p>
              </details>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={applyDraft}
                  disabled={!draftSource.trim() || !!draftError || draftCol < 0}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-brand-navy text-white hover:bg-brand-navy/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {tabFormulas[draftCol] ? 'Update formula' : 'Apply formula'}
                </button>
                <button
                  onClick={() => setEditorOpen(false)}
                  className="px-3 py-2 rounded-xl text-sm font-medium text-brand-muted hover:text-brand-navy hover:bg-brand-navy/5"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* live preview */}
            <div className="bg-brand-navy/[0.02] border border-brand-muted/15 rounded-xl p-3">
              <div className="text-[10px] text-brand-muted uppercase font-bold tracking-wide mb-2">Preview — first rows</div>
              {draftPreview.length === 0 ? (
                <p className="text-[11px] text-brand-muted italic">
                  {draftSource.trim() ? 'Nothing to preview yet.' : 'Type a formula to see the result on real rows.'}
                </p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-brand-muted">
                      <th className="text-left font-bold pb-1">Row</th>
                      <th className="text-right font-bold pb-1">Now</th>
                      <th className="text-right font-bold pb-1">Formula</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftPreview.map((p) => (
                      <tr key={p.row} className="border-t border-brand-muted/10">
                        <td className="py-1 text-brand-muted font-mono">{p.row}</td>
                        <td className="py-1 text-right text-brand-muted truncate max-w-[90px]">{p.before || '—'}</td>
                        <td
                          className={`py-1 text-right font-bold ${p.isError ? 'text-red-600' : 'text-brand-navy'}`}
                          title={p.message}
                        >
                          {p.after}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {workbook && (
        <div className="bg-white border border-brand-muted/10 rounded-2xl shadow-sm overflow-hidden">
          {/* Tab strip */}
          <div className="flex items-center gap-1 px-3 pt-3 border-b border-brand-muted/10 overflow-x-auto">
            {workbook.tabs.map((t) => {
              const tabEdits = Object.keys(edits).filter((k) => k.startsWith(`${t.name}|`)).length;
              const defined = Object.keys(formulaMap[t.name] || {}).length;
              const active = t.name === activeTab;
              return (
                <button
                  key={t.name}
                  onClick={() => {
                    setActiveTab(t.name);
                    setPage(0);
                    setSearch('');
                    setEditorOpen(false);
                  }}
                  className={`px-3 py-2 rounded-t-lg text-xs font-bold whitespace-nowrap border-b-2 transition-all ${
                    active
                      ? 'text-brand-navy border-brand-navy bg-brand-navy/5'
                      : 'text-brand-muted border-transparent hover:text-brand-navy hover:bg-brand-navy/5'
                  }`}
                >
                  {t.name}
                  <span className="ml-1.5 text-[10px] font-normal text-brand-muted">{t.rowCount}</span>
                  {defined > 0 && <span className="ml-1.5 text-[10px] font-mono text-blue-600">ƒ{defined}</span>}
                  {tabEdits > 0 && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle" />}
                </button>
              );
            })}
          </div>

          {tab && layout && (
            <>
              <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-brand-muted/10 text-[11px] text-brand-muted">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted" />
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                    placeholder={`Search in ${tab.name}…`}
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-brand-muted/20 text-xs text-brand-navy w-52 focus:outline-none focus:border-brand-navy/40"
                  />
                </div>
                <span>
                  {visibleRowIndexes.length} of {tab.rowCount} rows · {tab.columnCount} columns · data from row{' '}
                  {layout.firstDataRow}
                </span>
                <span>
                  {formulaCountDefined > 0 ? (
                    <span className="text-blue-700 font-bold">{formulaCountDefined} own formula column{formulaCountDefined === 1 ? '' : 's'}</span>
                  ) : (
                    <span>no own formulas yet</span>
                  )}
                  {' · '}
                  {tab.formulaCount > 0
                    ? `${tab.formulaCount} imported cell formula${tab.formulaCount === 1 ? '' : 's'}`
                    : workbook.formulasAvailable
                      ? 'no per-cell formulas in Google Sheets (values arrive as one import or were pasted)'
                      : 'imported formulas unavailable'}
                </span>
                <span className="text-brand-muted/70">Click a column header to add a formula.</span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="px-2 py-1 rounded border border-brand-muted/20 disabled:opacity-40"
                  >
                    ‹
                  </button>
                  <span>
                    Page {safePage + 1} / {pageCount}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={safePage >= pageCount - 1}
                    className="px-2 py-1 rounded border border-brand-muted/20 disabled:opacity-40"
                  >
                    ›
                  </button>
                </div>
              </div>

              <div className="overflow-auto max-h-[70vh]">
                <table className="border-collapse text-xs min-w-full">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-50 border-b border-r border-brand-muted/15 w-12 min-w-[3rem] px-2 py-1.5 text-[10px] text-brand-muted font-bold text-center">
                        #
                      </th>
                      {Array.from({ length: tab.columnCount }, (_, c) => {
                        const own = tabFormulas[c];
                        const imported = importedFormulaByCol.get(c);
                        const title = own
                          ? `Your formula: ${own.source} (from row ${own.firstRow}) — click to edit`
                          : imported
                            ? `Google Sheets formula in ${columnIndexToLetter(c)}${imported.row}: ${imported.formula} — click to define your own`
                            : `${layout.headers[c] || columnIndexToLetter(c)} — click to add a formula`;
                        return (
                          <th
                            key={c}
                            title={title}
                            onClick={() => openEditor(c)}
                            className={`border-b border-r border-brand-muted/15 px-2 py-1.5 text-[10px] font-bold text-center min-w-[7rem] cursor-pointer transition-colors ${
                              own ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-slate-50 text-brand-muted hover:bg-slate-100'
                            }`}
                          >
                            {columnIndexToLetter(c)}
                            {own ? (
                              <span className="ml-1 font-mono font-normal text-blue-600">ƒ</span>
                            ) : imported ? (
                              <span className="ml-1 font-mono font-normal text-slate-400">ƒ</span>
                            ) : null}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr key={r} className="hover:bg-brand-navy/[0.02]">
                        <td className="sticky left-0 z-10 bg-slate-50 border-b border-r border-brand-muted/15 px-2 py-1 text-[10px] text-brand-muted text-center font-mono">
                          {r + 1}
                        </td>
                        {Array.from({ length: tab.columnCount }, (_, c) => {
                          const original = tab.values[r]?.[c] ?? '';
                          const cell = displayValue(r, c);
                          const importedFormula = tab.formulas[r]?.[c] ?? null;
                          const edited = editKey(tab.name, r, c) in edits;

                          // A column formula of ours owns this cell.
                          if (cell.computed) {
                            return (
                              <td
                                key={c}
                                title={cell.title}
                                className={`border-b border-r border-brand-muted/10 px-2 py-1 whitespace-nowrap ${
                                  cell.error ? 'bg-red-50 text-red-700 font-medium' : 'bg-blue-50/60 text-brand-navy'
                                }`}
                              >
                                <span className={`font-mono text-[9px] mr-1 ${cell.error ? 'text-red-400' : 'text-blue-400'}`}>ƒ</span>
                                {cell.text}
                              </td>
                            );
                          }

                          // A formula imported from Google Sheets — reference only.
                          if (importedFormula) {
                            return (
                              <td
                                key={c}
                                title={importedFormula}
                                className="border-b border-r border-brand-muted/10 px-2 py-1 bg-slate-50/70 text-slate-700 whitespace-nowrap"
                              >
                                <span className="font-mono text-[9px] text-slate-400 mr-1">ƒ</span>
                                {cell.text}
                              </td>
                            );
                          }

                          return (
                            <td key={c} className={`border-b border-r border-brand-muted/10 p-0 ${edited ? 'bg-amber-50' : ''}`}>
                              <input
                                value={cell.text}
                                onChange={(e) => handleCellChange(r, c, original, e.target.value)}
                                title={edited ? `Edited (was: ${original || '—'})` : undefined}
                                className={`w-full min-w-[7rem] px-2 py-1 bg-transparent text-brand-navy focus:outline-none focus:bg-blue-50 focus:ring-1 focus:ring-inset focus:ring-blue-300 ${
                                  edited ? 'font-semibold text-amber-800' : ''
                                }`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {pageRows.length === 0 && (
                      <tr>
                        <td colSpan={tab.columnCount + 1} className="px-4 py-8 text-center text-brand-muted text-xs">
                          {tab.rowCount === 0 ? 'This tab is empty.' : 'No rows match your search.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <p className="text-[11px] text-brand-muted text-center px-4">
        Formulas you define here are computed in the app and exported as real Excel formulas. Neither edits nor formulas are
        stored yet — Save turns on once the Firebase storage is connected.
      </p>
    </div>
  );
}
