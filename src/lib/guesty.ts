import { Property, Booking, GuestySyncStatus } from '../types';
import { MOCK_BOOKINGS, PROPERTIES } from '../data';

class GuestyService {
  private static instance: GuestyService;
  private token: string | null = null;
  private tokenExpiresAt: number | null = null;
  private requestCount: number = 0;
  private lastRequestTime: number = Date.now();

  private constructor() {}

  public static getInstance(): GuestyService {
    if (!GuestyService.instance) {
      GuestyService.instance = new GuestyService();
    }
    return GuestyService.instance;
  }

  private async checkRateLimit() {
    const now = Date.now();
    if (now - this.lastRequestTime > 24 * 60 * 60 * 1000) {
      this.requestCount = 0;
    }
    
    if (this.requestCount >= 5) {
      throw new Error('Guesty API Rate Limit Exceeded (5 requests/24h)');
    }
    
    this.requestCount++;
    this.lastRequestTime = now;
  }

  public async authenticate(): Promise<string> {
    await this.checkRateLimit();
    
    if (this.token && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    // Mock POST /oauth2/token
    console.log('POST https://open-api.guesty.com/oauth2/token');
    this.token = `mock_token_${Math.random().toString(36).substring(7)}`;
    this.tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
    
    return this.token;
  }

  public async getReservations(listingId?: string): Promise<Booking[]> {
    await this.authenticate();
    console.log(`GET https://open-api.guesty.com/v1/reservations?listingId=${listingId || 'all'}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    return listingId 
      ? MOCK_BOOKINGS.filter(b => b.listingId === listingId)
      : MOCK_BOOKINGS;
  }

  public async getListings(): Promise<Property[]> {
    await this.authenticate();
    console.log('GET https://open-api.guesty.com/v1/listings');
    return PROPERTIES;
  }
}

export const guestyApi = GuestyService.getInstance();
