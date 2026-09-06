import {
  findHeaderRowIndex,
  getCell,
  isDescriptionText,
  normalizeSheetHeader,
  parseMoney,
} from './sheetCommon';

export type ExpensesSheetLayout = {
  headerRowIdx: number;
  idIdx: number;
  complexIdx: number;
  nameIdx: number;
  dateIdx: number;
  categoryIdx: number;
  subcategoryIdx: number;
  descriptionIdx: number;
  amountIdx: number;
  headers: string[];
};

export type ParsedExpenseRecord = {
  id: string;
  villaName: string;
  date: string;
  category: string;
  subcategory: string;
  description: string;
  amount: number;
};

export function resolveExpensesSheetLayout(rows: any[][]): ExpensesSheetLayout | null {
  if (!rows || rows.length < 2) return null;
  const headerRowIdx = findHeaderRowIndex(rows, ['villa name', 'date']);
  if (headerRowIdx < 0) return null;
  return buildExpensesLayout(rows, headerRowIdx);
}

function buildExpensesLayout(rows: any[][], headerRowIdx: number) {
  const headers = (rows[headerRowIdx] || []).map(normalizeSheetHeader);
  const findIdx = (pred: (h: string) => boolean, fallback = -1) => {
    const idx = headers.findIndex(pred);
    return idx !== -1 ? idx : fallback;
  };

  const nameIdx = findIdx((h) => h.includes('villa name'));
  if (nameIdx === -1) return null;

  return {
    headerRowIdx,
    idIdx: findIdx((h) => h.includes('expense id')),
    complexIdx: findIdx((h) => h.includes('complex')),
    nameIdx,
    dateIdx: findIdx((h) => h === 'date' || h.startsWith('date ')),
    categoryIdx: findIdx((h) => h.includes('category')),
    subcategoryIdx: findIdx((h) => h.includes('subcategory') || h.includes('sub category')),
    descriptionIdx: findIdx((h) => h.includes('description')),
    amountIdx: findIdx((h) => h.includes('amount')),
    headers,
  };
}

function isLikelyExpenseRow(row: any[], layout: ExpensesSheetLayout) {
  const villaName = getCell(row, layout.nameIdx);
  const date = getCell(row, layout.dateIdx);
  if (!villaName || !date || isDescriptionText(villaName) || isDescriptionText(date)) return false;
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return false;
  return true;
}

export function parseExpensesSheetRows(rows: any[][]): ParsedExpenseRecord[] {
  const layout = resolveExpensesSheetLayout(rows);
  if (!layout) return [];

  const expenses: ParsedExpenseRecord[] = [];
  for (let i = layout.headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!isLikelyExpenseRow(row, layout)) continue;

    expenses.push({
      id: getCell(row, layout.idIdx) || `exp_${i}`,
      villaName: getCell(row, layout.nameIdx),
      date: getCell(row, layout.dateIdx),
      category: getCell(row, layout.categoryIdx),
      subcategory: getCell(row, layout.subcategoryIdx),
      description: getCell(row, layout.descriptionIdx),
      amount: parseMoney(getCell(row, layout.amountIdx)),
    });
  }

  return expenses;
}
