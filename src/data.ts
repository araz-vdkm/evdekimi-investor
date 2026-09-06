import { Property, Booking } from './types';

export const EXCHANGE_RATE_IDR_USD = 16200;

export const PROPERTIES: Property[] = [
  {
    id: 'prop_001',
    name: 'Villa Uluwatu Breezes',
    ownerEmail: 'roman@anglei.org',
    commercialModel: 'PM_FEE',
    pmFeePercentage: 0.20,
    basePrice: 4500000,
  },
  {
    id: 'prop_002',
    name: 'Canggu Zen Retreat',
    ownerEmail: 'investor@example.com',
    commercialModel: 'FIXED_PAYOUT',
    fixedPayoutAmount: 2500,
    basePrice: 3800000,
  },
  {
    id: 'prop_003',
    name: 'Ubud Jungle Sanctuary',
    ownerEmail: 'roman@anglei.org',
    commercialModel: 'PM_FEE',
    pmFeePercentage: 0.25,
    basePrice: 5200000,
  }
];

export const MOCK_BOOKINGS: Booking[] = [
  {
    id: 'res_1',
    listingId: 'prop_001',
    source: 'airbnb',
    checkInDate: '2026-05-02',
    checkOutDate: '2026-05-08',
    nights: 6,
    status: 'confirmed',
    guest: { name: 'Michael Smith', nationality: 'USA' },
    financials: {
      accommodationFare: 31500000,
      cleaningFee: 750000,
      extraPersonFee: 0,
      otaCommission: 4725000,
      returns: 0,
    }
  },
  {
    id: 'res_2',
    listingId: 'prop_001',
    source: 'booking.com',
    checkInDate: '2026-05-10',
    checkOutDate: '2026-05-15',
    nights: 5,
    status: 'confirmed',
    guest: { name: 'Nova Artawan I', nationality: 'Indonesia' },
    financials: {
      accommodationFare: 22500000,
      cleaningFee: 750000,
      extraPersonFee: 1500000,
      otaCommission: 3375000,
      returns: 500000,
    }
  },
  {
    id: 'res_maint',
    listingId: 'prop_001',
    source: 'hostaway',
    checkInDate: '2026-05-18',
    checkOutDate: '2026-05-20',
    nights: 2,
    status: 'canceled', // Using canceled for maintenance as per previous logic or just for visual
    guest: { name: 'maintenance', nationality: 'SYSTEM' },
    financials: {
      accommodationFare: 0,
      cleaningFee: 0,
      extraPersonFee: 0,
      otaCommission: 0,
      returns: 0,
    }
  },
  {
    id: 'res_3',
    listingId: 'prop_001',
    source: 'airbnb',
    checkInDate: '2026-05-22',
    checkOutDate: '2026-05-27',
    nights: 5,
    status: 'confirmed',
    guest: { name: 'ARVIND PRITHIVIRAJ', nationality: 'India' },
    financials: {
      accommodationFare: 41600000,
      cleaningFee: 900000,
      extraPersonFee: 2000000,
      otaCommission: 6240000,
      returns: 0,
    }
  },
  {
    id: 'res_4',
    listingId: 'prop_001',
    source: 'airbnb',
    checkInDate: '2026-05-28',
    checkOutDate: '2026-05-31',
    nights: 3,
    status: 'confirmed',
    guest: { name: '다경 김', nationality: 'South Korea' },
    financials: {
      accommodationFare: 18000000,
      cleaningFee: 750000,
      extraPersonFee: 0,
      otaCommission: 2700000,
      returns: 0,
    }
  }
];
