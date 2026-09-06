import { Booking, Property } from '../types';
import { EXCHANGE_RATE_IDR_USD } from '../data';
import { startOfMonth, endOfMonth, eachDayOfInterval, format } from 'date-fns';

export function getDaysInMonth(month: number, year: number) {
  const start = startOfMonth(new Date(year, month));
  const end = endOfMonth(start);
  return eachDayOfInterval({ start, end });
}

export function formatCurrency(value: number, currency: string): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (currency === 'EUR' || currency === 'EURO') {
    return new Intl.NumberFormat('en-DE', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (currency === 'USDT') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD', // use USD format for USDT
      maximumFractionDigits: 0,
    }).format(value).replace('$', 'USDT ');
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value).replace('Rp', 'Rp ');
}

export function convertValue(value: number, from: string, to: string): number {
  if (from === to) return value;
  if (from === 'IDR' && to === 'USD') return value / EXCHANGE_RATE_IDR_USD;
  return value * EXCHANGE_RATE_IDR_USD;
}

export function calculateKPIs(bookings: Booking[], property: Property, daysInMonth: number) {
  const totalNights = bookings.length ? 30 : 0; // Simplified for mock
  const nightsRented = bookings.reduce((acc, b) => {
    const start = new Date(b.checkInDate).getTime();
    const end = new Date(b.checkOutDate).getTime();
    return acc + Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  }, 0);

  const grossRevenue = bookings.reduce((acc, b) => acc + b.financials.accommodationFare + b.financials.cleaningFee + b.financials.extraPersonFee, 0);
  const totalOtaComm = bookings.reduce((acc, b) => acc + b.financials.otaCommission, 0);
  const totalReturns = bookings.reduce((acc, b) => acc + b.financials.returns, 0);
  
  const operatingIncome = grossRevenue - totalOtaComm - totalReturns;
  const occupancyRate = (nightsRented / daysInMonth) * 100;
  const avgPricePerNight = nightsRented > 0 ? (grossRevenue / nightsRented) : 0;

  // Commercial Model
  let pmCommission = 0;
  if (property.commercialModel === 'PM_FEE') {
    pmCommission = grossRevenue * (property.pmFeePercentage || 0.20);
  } else if (property.commercialModel === 'FIXED_PAYOUT') {
    // Fixed payout usually means PM keeps the rest, or vice-versa. 
    // PDF says: "Displays PM Commission as N/A and instead renders the agreed fixed USD contract amount directly"
  }

  return {
    nightsRented,
    grossRevenue,
    operatingIncome,
    occupancyRate,
    avgPricePerNight,
    pmCommission,
    totalOtaComm,
    totalReturns
  };
}

/**
 * Reads a fetch Response as JSON, tolerating a body that isn't JSON at all.
 *
 * Requests can be answered by something between the browser and our server —
 * Cloud Run's frontend returns a bare "Rate exceeded." for a throttled
 * request, proxies return HTML error pages. Calling res.json() on those
 * throws a SyntaxError ("Unexpected token 'R'..."), which surfaces to the
 * user as a parse error and hides the real problem. This returns the parsed
 * object when the body is JSON, and otherwise an { error } carrying the
 * status and whatever text came back, so callers can show something true.
 */
export async function readJsonResponse(res: Response): Promise<any> {
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      const snippet = text.trim().slice(0, 200);
      if (res.ok) return { error: `Unexpected non-JSON response (${res.status})` };
      return { error: snippet || `Request failed (${res.status})` };
    }
  }
  return res.ok ? {} : { error: `Request failed (${res.status})` };
}
