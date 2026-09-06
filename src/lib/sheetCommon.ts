export function normalizeSheetHeader(value?: string) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function cleanSheetValue(value?: string) {
  const text = String(value ?? '').trim();
  return text === '#N/A' ? '' : text;
}

export function getCell(row: any[], idx: number) {
  return idx !== -1 ? cleanSheetValue(row[idx]) : '';
}

export function parseMoney(value: string) {
  return parseFloat(String(value ?? '').replace(/[^0-9.-]+/g, '')) || 0;
}

export function parseDecimal(value: string) {
  return parseFloat(String(value ?? '').replace(',', '.').replace(/[^0-9.-]+/g, '')) || 0;
}

/** @deprecated use parseMoney or parseDecimal */
export function parseNumber(value: string) {
  return parseMoney(value);
}

export function parseIntValue(value: string) {
  return parseInt(String(value || '0').replace(/[^0-9-]+/g, ''), 10) || 0;
}

export function findHeaderRowIndex(rows: any[][], markers: string[]) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const headers = row.map(normalizeSheetHeader);
    const matches = markers.every((marker) =>
      headers.some((h) => h.includes(marker.toLowerCase()))
    );
    if (matches) return i;
  }
  return -1;
}

export function isDescriptionText(value: string) {
  const lower = value.toLowerCase();
  return (
    lower.includes('unit name') ||
    lower.includes('точное название') ||
    lower.includes('авто-номер') ||
    lower.includes('текст') ||
    lower.includes('дата (гггг') ||
    lower.includes('формула')
  );
}
