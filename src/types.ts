/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Currency = 'IDR' | 'USD' | 'EUR' | 'USDT';

export type CommercialModel = 'PM_FEE' | 'FIXED_PAYOUT';

export interface Property {
  id: string;
  name: string;
  ownerEmail: string;
  commercialModel: CommercialModel;
  fixedPayoutAmount?: number; // In USD
  pmFeePercentage?: number; // 0.20 to 0.25
  basePrice: number; // Avg base price for calculations
}

export interface GuestProfile {
  name: string;
  nationality: string;
}

export interface Booking {
  id: string;
  listingId: string;
  source: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  status: 'confirmed' | 'reserved' | 'canceled' | 'inquiry';
  guest: GuestProfile;
  financials: {
    accommodationFare: number;
    cleaningFee: number;
    extraPersonFee: number;
    otaCommission: number;
    returns: number;
  };
  isFromApi?: boolean;
  finalHostPayout?: number;
}

export interface LedgerItem {
  label: string;
  value: number;
  type: 'income' | 'opex' | 'outlay';
  isPercentage?: boolean;
}

export interface GuestySyncStatus {
  lastSync: string;
  status: 'idle' | 'syncing' | 'error';
  tokenExpiresAt: number | null;
}
