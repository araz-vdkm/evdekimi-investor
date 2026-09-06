export function normalizeSheetHeader(value?: string) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function expandInvestorCodes(value?: string) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function investorCodesOverlap(a?: string, b?: string) {
  const left = expandInvestorCodes(a);
  const right = expandInvestorCodes(b);
  return left.some((code) => right.includes(code));
}

function findVillaSheetHeaderRowIndex(rows: any[][]) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.some((cell) => normalizeSheetHeader(cell).includes('investor code'))) {
      return i;
    }
  }
  return -1;
}

export type VillaSheetLayout = {
  headerRowIdx: number;
  idIdx: number;
  complexIdx: number;
  nameIdx: number;
  investorNameIdx: number;
  codeIdx: number;
  typeAgreementIdx: number;
  pmFeeRateIdx: number;
  flatPayoutIdx: number;
  taxTypeIdx: number;
  taxValueIdx: number;
  statusIdx: number;
  headers: string[];
};

export function resolveVillaSheetLayout(rows: any[][]): VillaSheetLayout | null {
  if (!rows || rows.length < 2) return null;
  const headerRowIdx = findVillaSheetHeaderRowIndex(rows);
  if (headerRowIdx < 0) return null;

  const headers = (rows[headerRowIdx] || []).map(normalizeSheetHeader);
  const findIdx = (pred: (h: string) => boolean, fallback = -1) => {
    const idx = headers.findIndex(pred);
    return idx !== -1 ? idx : fallback;
  };

  const codeIdx = findIdx((h) => h.includes('investor code'));
  if (codeIdx === -1) return null;

  return {
    headerRowIdx,
    idIdx: findIdx((h) => h === 'villa id' || h.includes('villa id')),
    complexIdx: findIdx((h) => h.includes('complex')),
    nameIdx: findIdx((h) => h === 'villa name' || h.includes('villa name')),
    investorNameIdx: findIdx((h) => h.includes('investor name')),
    codeIdx,
    typeAgreementIdx: findIdx((h) => h.includes('type agreement') || h.includes('agreement')),
    pmFeeRateIdx: findIdx((h) => h.includes('pm fee rate') || h.includes('fee rate')),
    flatPayoutIdx: findIdx((h) => h.includes('flat payout')),
    taxTypeIdx: findIdx((h) => h.includes('tax type')),
    taxValueIdx: findIdx((h) => h.includes('tax value') || h === 'tax value'),
    statusIdx: findIdx((h) => h === 'status' || h.includes('status')),
    headers,
  };
}

function cleanSheetValue(value?: string) {
  const text = String(value ?? '').trim();
  return text === '#N/A' ? '' : text;
}

function getCell(row: any[], idx: number) {
  return idx !== -1 ? cleanSheetValue(row[idx]) : '';
}

function isLikelyVillaRow(row: any[], layout: VillaSheetLayout) {
  const name = getCell(row, layout.nameIdx);
  if (!name || name.toLowerCase().includes('unit name')) return false;
  if (layout.idIdx !== -1) {
    const id = getCell(row, layout.idIdx);
    if (id && !/^\d+$/.test(id)) return false;
  }
  return true;
}

export type ParsedVillaRecord = {
  id: string;
  name: string;
  complex: string;
  investorName: string;
  investorCode: string;
  typeAgreement: string;
  pmFeeRate: number;
  flatPayoutAmount: number;
  taxType: string;
  taxValue: number;
  status: string;
  raw: Record<string, string>;
};

function parseNumber(value: string) {
  return parseFloat(String(value || '0').replace(',', '.').replace(/[^0-9.-]+/g, '')) || 0;
}

export function parseVillaSheetRows(rows: any[][]): ParsedVillaRecord[] {
  const layout = resolveVillaSheetLayout(rows);
  if (!layout) return [];

  const villas: ParsedVillaRecord[] = [];
  for (let i = layout.headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!isLikelyVillaRow(row, layout)) continue;

    const raw: Record<string, string> = {};
    layout.headers.forEach((header, idx) => {
      if (header) raw[header] = cleanSheetValue(row[idx]);
    });

    let pmFeeRate = parseNumber(getCell(row, layout.pmFeeRateIdx));
    if (pmFeeRate > 1) pmFeeRate = pmFeeRate / 100;

    let taxValue = parseNumber(getCell(row, layout.taxValueIdx));
    const taxType = getCell(row, layout.taxTypeIdx) || 'Fixed';
    if (taxValue > 1 && taxType.toLowerCase().includes('%')) taxValue = taxValue / 100;

    villas.push({
      id: getCell(row, layout.idIdx) || `v_${i}`,
      name: getCell(row, layout.nameIdx),
      complex: getCell(row, layout.complexIdx),
      investorName: getCell(row, layout.investorNameIdx),
      investorCode: getCell(row, layout.codeIdx),
      typeAgreement: getCell(row, layout.typeAgreementIdx) || 'Revenue Share',
      pmFeeRate,
      flatPayoutAmount: parseNumber(getCell(row, layout.flatPayoutIdx)),
      taxType,
      taxValue,
      status: getCell(row, layout.statusIdx) || 'Active',
      raw,
    });
  }

  return villas.filter((villa) => villa.name);
}

export function findVillasForInvestorCode(rows: any[][], investorCode: string) {
  if (!investorCode) return [];
  return parseVillaSheetRows(rows).filter((villa) => investorCodesOverlap(villa.investorCode, investorCode));
}

export function villasToLegacyRawObjects(villas: ParsedVillaRecord[]) {
  return villas.map((villa) => ({ ...villa.raw }));
}
