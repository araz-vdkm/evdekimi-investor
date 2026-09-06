import {
  findHeaderRowIndex,
  getCell,
  isDescriptionText,
  normalizeSheetHeader,
  parseIntValue,
  parseMoney,
} from './sheetCommon';

export type BookingsSheetLayout = {
  headerRowIdx: number;
  mcIdx: number;
  idIdx: number;
  guestNameIdx: number;
  nationalityIdx: number;
  complexIdx: number;
  villaNameIdx: number;
  checkInIdx: number;
  checkOutIdx: number;
  guestPaidIdx: number;
  nightsIdx: number;
  sourceIdx: number;
  feeTotalIdx: number;
  finalHostPayoutIdx: number;
  statusIdx: number;
  headers: string[];
};

export type ParsedBookingRecord = {
  id: string;
  listingId: string;
  source: string;
  checkInDate: string;
  checkOutDate: string;
  status: string;
  guestName: string;
  nationality: string;
  accommodationFare: number;
  otaCommission: number;
  nights: number;
  finalHostPayout: number;
};

export function resolveBookingsSheetLayout(rows: any[][]): BookingsSheetLayout | null {
  if (!rows || rows.length < 2) return null;
  const headerRowIdx = findHeaderRowIndex(rows, ['booking id', 'villa name']);
  if (headerRowIdx < 0) return null;

  const headers = (rows[headerRowIdx] || []).map(normalizeSheetHeader);
  const findIdx = (pred: (h: string) => boolean, fallback = -1) => {
    const idx = headers.findIndex(pred);
    return idx !== -1 ? idx : fallback;
  };

  const villaNameIdx = findIdx((h) => h.includes('villa name'));
  const idIdx = findIdx((h) => h.includes('booking id'));
  if (villaNameIdx === -1 || idIdx === -1) return null;

  return {
    headerRowIdx,
    mcIdx: findIdx((h) => h === 'mc' || h.includes('mc fs/bl')),
    idIdx,
    guestNameIdx: findIdx((h) => h.includes('guest name')),
    nationalityIdx: findIdx((h) => h.includes('nationality')),
    complexIdx: findIdx((h) => h.includes('complex')),
    villaNameIdx,
    checkInIdx: findIdx((h) => h.includes('check-in') || h.includes('check in')),
    checkOutIdx: findIdx((h) => h.includes('check-out') || h.includes('check out')),
    guestPaidIdx: findIdx((h) => h.includes('guest paid')),
    nightsIdx: findIdx((h) => h.includes('number of nights') || h.includes('nights')),
    sourceIdx: findIdx((h) => h === 'source' || h.startsWith('source ')),
    feeTotalIdx: findIdx((h) => h.includes('fee total')),
    finalHostPayoutIdx: findIdx((h) => h.includes('final host pay out') || h.includes('final host payout')),
    statusIdx: findIdx((h) => h === 'status' || h.startsWith('status ')),
    headers,
  };
}

function isLikelyBookingRow(row: any[], layout: BookingsSheetLayout) {
  const villaName = getCell(row, layout.villaNameIdx);
  const checkIn = getCell(row, layout.checkInIdx);
  const checkOut = getCell(row, layout.checkOutIdx);
  if (!villaName || !checkIn || !checkOut) return false;
  if (isDescriptionText(villaName) || isDescriptionText(checkIn) || isDescriptionText(checkOut)) return false;
  if (!/^\d{4}-\d{2}-\d{2}/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}/.test(checkOut)) return false;
  return true;
}

export function parseBookingsSheetRows(rows: any[][]): ParsedBookingRecord[] {
  const layout = resolveBookingsSheetLayout(rows);
  if (!layout) return [];

  const bookings: ParsedBookingRecord[] = [];
  for (let i = layout.headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!isLikelyBookingRow(row, layout)) continue;

    const checkInDate = getCell(row, layout.checkInIdx);
    const checkOutDate = getCell(row, layout.checkOutIdx);
    const nightsRaw = getCell(row, layout.nightsIdx);
    let nights = parseIntValue(nightsRaw);
    const calculatedNights = Math.max(
      0,
      Math.round(
        (new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24)
      )
    );
    if (!nights) nights = calculatedNights;

    const accommodationFare = parseMoney(getCell(row, layout.guestPaidIdx));
    const otaCommission = parseMoney(getCell(row, layout.feeTotalIdx));
    const finalHostPayout = parseMoney(getCell(row, layout.finalHostPayoutIdx)) || accommodationFare;

    bookings.push({
      id: getCell(row, layout.idIdx) || `g_bk_${i}`,
      listingId: getCell(row, layout.villaNameIdx),
      source: getCell(row, layout.sourceIdx) || 'Direct',
      checkInDate,
      checkOutDate,
      status: String(getCell(row, layout.statusIdx) || 'confirmed').toLowerCase(),
      guestName: getCell(row, layout.guestNameIdx) || 'Unknown Guest',
      nationality: getCell(row, layout.nationalityIdx) || 'Unknown',
      accommodationFare,
      otaCommission,
      nights,
      finalHostPayout,
    });
  }

  return bookings;
}

export function parsedBookingsToAppBookings(records: ParsedBookingRecord[]) {
  return records.map((record) => ({
    id: record.id,
    listingId: record.listingId,
    source: record.source,
    checkInDate: record.checkInDate,
    checkOutDate: record.checkOutDate,
    status: record.status,
    isFromApi: false,
    guest: {
      name: record.guestName,
      nationality: record.nationality,
    },
    financials: {
      accommodationFare: record.accommodationFare,
      cleaningFee: 0,
      extraPersonFee: 0,
      otaCommission: record.otaCommission,
      returns: 0,
    },
    finalHostPayout: record.finalHostPayout,
    nights: record.nights,
  }));
}
