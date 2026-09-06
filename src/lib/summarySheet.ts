import {
  cleanSheetValue,
  findHeaderRowIndex,
  getCell,
  isDescriptionText,
  normalizeSheetHeader,
  parseIntValue,
  parseMoney,
  parseDecimal,
} from './sheetCommon';

export type SummarySheetLayout = {
  headerRowIdx: number;
  complexIdx: number;
  nameIdx: number;
  codeIdx: number;
  yearIdx: number;
  monthIdx: number;
  grossRevenueIdx: number;
  feeTotalIdx: number;
  finalHostPayoutIdx: number;
  pmFeeIdx: number;
  operatingIncomeIdx: number;
  staffSalaryIdx: number;
  utilitiesIdx: number;
  maintenanceIdx: number;
  otherIdx: number;
  operatingExpensesIdx: number;
  taxIdx: number;
  netOperatingProfitIdx: number;
  finalDecisionIdx: number;
  bookedNightsIdx: number;
  occupancyIdx: number;
  adrIdx: number;
  headers: string[];
};

export type ParsedSummaryRecord = {
  villaName: string;
  investorCode: string;
  year: number;
  month: number;
  grossRevenue: number;
  feeTotal: number;
  finalHostPayout: number;
  pmFee: number;
  operatingIncome: number;
  staffSalary: number;
  utilities: number;
  maintenance: number;
  other: number;
  operatingExpenses: number;
  tax: number;
  netOperatingProfit: number;
  finalDecisionToTransfer: number;
  bookedNights: number;
  occupancy: number;
  adr: number;
};

export function resolveSummarySheetLayout(rows: any[][]): SummarySheetLayout | null {
  if (!rows || rows.length < 2) return null;
  const headerRowIdx = findHeaderRowIndex(rows, ['villa name', 'gross revenue']);
  if (headerRowIdx < 0) return null;

  const headers = (rows[headerRowIdx] || []).map(normalizeSheetHeader);
  const findIdx = (pred: (h: string) => boolean, fallback = -1) => {
    const idx = headers.findIndex(pred);
    return idx !== -1 ? idx : fallback;
  };
  // Summary may list "PM Fee, IDR" twice (col J then K). Property Management Fee is Column K.
  const findLastIdx = (pred: (h: string) => boolean, fallback = -1) => {
    for (let i = headers.length - 1; i >= 0; i--) {
      if (pred(headers[i])) return i;
    }
    return fallback;
  };

  const nameIdx = findIdx((h) => h.includes('villa name'));
  if (nameIdx === -1) return null;

  return {
    headerRowIdx,
    complexIdx: findIdx((h) => h.includes('complex')),
    nameIdx,
    codeIdx: findIdx((h) => h.includes('investor code')),
    yearIdx: findIdx((h) => h === 'year' || h.startsWith('year ')),
    monthIdx: findIdx((h) => h === 'month' || h.startsWith('month ')),
    grossRevenueIdx: findIdx((h) => h.includes('gross revenue')),
    feeTotalIdx: findIdx((h) => h.includes('fee total')),
    finalHostPayoutIdx: findIdx((h) => h.includes('final host pay out') || h.includes('final host payout')),
    pmFeeIdx: findLastIdx((h) => h.includes('pm fee')),
    operatingIncomeIdx: findIdx((h) => h.includes('operating income')),
    staffSalaryIdx: findIdx((h) => h.includes('staff salary')),
    utilitiesIdx: findIdx((h) => h.includes('utilities')),
    maintenanceIdx: findIdx((h) => h.includes('maintenance')),
    otherIdx: findIdx((h) => h === 'other' || h.startsWith('other,')),
    operatingExpensesIdx: findIdx((h) => h.includes('operating expenses')),
    taxIdx: findIdx((h) => h.includes('tax')),
    netOperatingProfitIdx: findIdx((h) => h.includes('net operating profit')),
    finalDecisionIdx: findIdx((h) => h.includes('final decision') || h.includes('final deci')),
    bookedNightsIdx: findIdx((h) => h.includes('booked nights')),
    occupancyIdx: findIdx((h) => h.includes('occupancy')),
    adrIdx: findIdx((h) => h === 'adr' || h.startsWith('adr,')),
    headers,
  };
}

function isLikelySummaryRow(row: any[], layout: SummarySheetLayout) {
  const villaName = getCell(row, layout.nameIdx);
  if (!villaName || isDescriptionText(villaName)) return false;

  const year = getCell(row, layout.yearIdx);
  const month = getCell(row, layout.monthIdx);
  if (!year || !month) return false;
  if (!/^\d{4}$/.test(year)) return false;
  if (!/^\d{1,2}$/.test(month)) return false;
  return true;
}

function getNumeric(row: any[], idx: number) {
  return parseMoney(getCell(row, idx));
}

export function parseSummarySheetRows(rows: any[][]): ParsedSummaryRecord[] {
  const layout = resolveSummarySheetLayout(rows);
  if (!layout) return [];

  const summaries: ParsedSummaryRecord[] = [];
  for (let i = layout.headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!isLikelySummaryRow(row, layout)) continue;

    const pmFee =
      getNumeric(row, layout.pmFeeIdx) ||
      (layout.pmFeeIdx !== -1 ? 0 : getNumeric(row, 10));
    const tax =
      getNumeric(row, layout.taxIdx) ||
      (layout.taxIdx !== -1 ? 0 : getNumeric(row, 17));
    const finalDecisionToTransfer =
      getNumeric(row, layout.finalDecisionIdx) ||
      (layout.finalDecisionIdx !== -1 ? 0 : getNumeric(row, 19));

    summaries.push({
      villaName: getCell(row, layout.nameIdx),
      investorCode: getCell(row, layout.codeIdx),
      year: parseIntValue(getCell(row, layout.yearIdx)),
      month: parseIntValue(getCell(row, layout.monthIdx)),
      grossRevenue: getNumeric(row, layout.grossRevenueIdx),
      feeTotal: getNumeric(row, layout.feeTotalIdx),
      finalHostPayout: getNumeric(row, layout.finalHostPayoutIdx),
      pmFee,
      operatingIncome: getNumeric(row, layout.operatingIncomeIdx),
      staffSalary: getNumeric(row, layout.staffSalaryIdx),
      utilities: getNumeric(row, layout.utilitiesIdx),
      maintenance: getNumeric(row, layout.maintenanceIdx),
      other: getNumeric(row, layout.otherIdx),
      operatingExpenses: getNumeric(row, layout.operatingExpensesIdx),
      tax,
      netOperatingProfit: getNumeric(row, layout.netOperatingProfitIdx),
      finalDecisionToTransfer,
      bookedNights: parseIntValue(getCell(row, layout.bookedNightsIdx)),
      occupancy: parseDecimal(getCell(row, layout.occupancyIdx)),
      adr: getNumeric(row, layout.adrIdx),
    });
  }

  return summaries;
}
