import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Building,
  Receipt,
  Wrench,
  Calendar as CalendarIcon, 
  ChevronDown, 
  CreditCard, 
  DollarSign, 
  Globe, 
  Download, 
  RefreshCcw, 
  LayoutDashboard, 
  UserCircle,
  TrendingUp,
  Percent,
  Clock,
  CheckCircle2,
  AlertCircle,
  Menu,
  X,
  LogOut,
  Edit,
  Save,
  MessageCircle,
  PieChart as PieChartIcon,
  Check,
  Table2,
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { PROPERTIES } from './data';
import { Property, Booking, Currency, GuestySyncStatus } from './types';
import { guestyApi } from './lib/guesty';
import { formatCurrency, calculateKPIs, readJsonResponse } from './lib/utils';
import { useAuth } from './components/AuthProvider';
import { ChatBox } from './components/ChatBox';
import { LoginPopup } from './components/LoginPopup';
import { LineCalendar } from './components/LineCalendar';
import { EvdekimiLogo } from './components/EvdekimiLogo';
import { AdminIntegrations } from './components/AdminIntegrations';
import { InvestorsMapping } from './components/InvestorsMapping';
import { PropertyMultiSelect } from './components/PropertyMultiSelect';
import { WeatherWidget } from './components/WeatherWidget';
import { DataManager } from './components/DataManager';
import { AdminAccounts } from './components/AdminAccounts';
import { db } from './lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { parseVillaSheetRows, investorCodesOverlap } from './lib/villaSheet';
import { parseSummarySheetRows } from './lib/summarySheet';
import { parseExpensesSheetRows } from './lib/expensesSheet';
import { parseBookingsSheetRows, parsedBookingsToAppBookings } from './lib/bookingsSheet';
import {
  getListingsForInvestor,
  parseListingsSheetRows,
  type ListingRecord,
} from './lib/listingsSheet';
import { PropertyListings } from './components/PropertyListings';
import { Cockpit } from './components/Cockpit';
import { Accounting } from './components/Accounting';

/** Calendar YYYY-MM from a YYYY-MM-DD string. Does not convert through UTC. */
function calendarMonthKey(dateStr: unknown): string | null {
  if (dateStr == null || dateStr === '') return null;
  const s = String(dateStr).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(parseInt(m[2], 10)).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isPastMonthKey(k: string, currentYear: number, currentMonth0: number): boolean {
  const [ys, ms] = k.split('-');
  const y = parseInt(ys, 10);
  const month1 = parseInt(ms, 10);
  return y < currentYear || (y === currentYear && month1 < currentMonth0 + 1);
}

/**
 * Resolve reservation source for a YYYY-MM key.
 * Explicit admin selection always wins. Months without a stored value still
 * default to past → SHEETS and current/future → API. FIREBASE is unchanged.
 */
function resolveReservationSource(
  explicitSetting: unknown,
  isPast: boolean
): 'SHEETS' | 'API' | 'FIREBASE' {
  let source: any = explicitSetting;
  if (source === undefined) source = isPast ? 'SHEETS' : 'API';
  if (source === true) source = 'SHEETS';
  if (source === false) source = 'API';
  if (source === 'FIREBASE') return 'FIREBASE';
  if (source === 'API') return 'API';
  return 'SHEETS';
}

function monthContext(year: number, month0: number, now = new Date()) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const mStr = String(month0 + 1).padStart(2, '0');
  const key = `${year}-${mStr}`;
  const isPast = year < currentYear || (year === currentYear && month0 + 1 < currentMonth + 1);
  return {
    key,
    isPast,
    monthStart: new Date(year, month0, 1),
    monthEnd: new Date(year, month0 + 1, 0, 23, 59, 59, 999),
  };
}

function bookingMatchesReservationSource(
  b: Booking,
  source: 'SHEETS' | 'API' | 'FIREBASE'
): boolean {
  if (source === 'API') return !!b.isFromApi;
  return !b.isFromApi;
}

function isCarryOverIntoMonth(
  checkInDate: Date,
  checkOutDate: Date,
  monthStart: Date
): boolean {
  return checkInDate < monthStart && checkOutDate > monthStart;
}

export default function App() {
  const { user, loading, login, logout } = useAuth();
  const isAdmin = !!user?.isAdmin;
  // --- STATE ---
  const [viewport, setViewport] = useState<'investor' | 'admin'>('investor');
  const [adminTab, setAdminTab] = useState<'dashboard' | 'integrations' | 'mapping' | 'data' | 'accounts'>('dashboard');
  const [activeMenu, setActiveMenu] = useState<'dashboard' | 'bookings' | 'expenses' | 'profile' | 'cockpit' | 'accounting'>('dashboard');
  const [currency, setCurrency] = useState<Currency>('IDR');
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [summaries, setSummaries] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [currencyData, setCurrencyData] = useState<any[]>([]);
  const [appSettings, setAppSettings] = useState<Record<string, boolean>>({});
  const [sheetsMonthsWithData, setSheetsMonthsWithData] = useState<Record<string, boolean>>({});
  const [villasList, setVillasList] = useState<any[]>([]);
  const [allListings, setAllListings] = useState<ListingRecord[]>([]);
  const [isSourceSwitching, setIsSourceSwitching] = useState(false);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const syncGenerationRef = useRef(0);
  const isSourceSwitchingRef = useRef(false);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);


  
  const [syncStatus, setSyncStatus] = useState<GuestySyncStatus>({
    lastSync: 'Never',
    status: 'idle',
    tokenExpiresAt: null,
  });
  const [firebaseReports, setFirebaseReports] = useState<any[]>([]);
  useEffect(() => {
    if (user) {
      getDocs(collection(db, 'monthly_reports')).then(snap => {
        setFirebaseReports(snap.docs.map(d => d.data()));
      }).catch(err => console.error("Firebase read error", err));
    }
  }, [user, syncStatus]); // re-fetch if synced

  const [activeListingIds, setActiveListingIds] = useState<string[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // --- PROFILE EDIT STATE ---
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    investorName: '',
    email: '',
    phone: '',
    payoutCurrency: 'IDR',
    bankName: '',
    accountNumber: '',
    beneficiaryName: '',
    swift: '',
    country: '',
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [linkedGoogleEmail, setLinkedGoogleEmail] = useState<string | null>(null);
  const [googleLinkNeedsReauth, setGoogleLinkNeedsReauth] = useState(false);
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
  const [confirmReconnect, setConfirmReconnect] = useState(false);
  const [isUnlinkingGoogle, setIsUnlinkingGoogle] = useState(false);

  const startEditingProfile = () => {
    if (user) {
      setProfileForm({
        investorName: user.investorName || user.username || '',
        email: user.email || '',
        phone: user.phone || '',
        payoutCurrency: user.payoutCurrency || 'IDR',
        bankName: user.bankName || '',
        accountNumber: user.accountNumber || '',
        beneficiaryName: user.beneficiaryName || '',
        swift: user.swift || '',
        country: user.country || '',
      });
      setProfileMessage(null);
      setIsEditingProfile(true);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    setProfileMessage(null);
    try {
      const response = await fetch('/api/investor/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          updates: profileForm
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to update profile');
      }

      const data = await response.json();
      if (data.source !== 'google_sheets') {
        throw new Error(data.error || 'Google Sheets did not accept the profile update');
      }
      
      const updatedUser = {
        ...user,
        ...profileForm
      };
      login(updatedUser);
      setIsEditingProfile(false);
      setProfileMessage({
        type: 'success',
        text: 'Profile updated successfully and recorded back to Google Sheets!'
      });
    } catch (err: any) {
      console.error('Save profile error:', err);
      setProfileMessage({ type: 'error', text: err.message || 'Error saving profile' });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleConnectGoogleAccount = async () => {
    setIsLinkingGoogle(true);
    try {
      const { auth, googleIdentityProvider } = await import('./lib/firebase');
      const { signInWithPopup } = await import('firebase/auth');
      const result = await signInWithPopup(auth, googleIdentityProvider);
      const firebaseIdToken = await result.user.getIdToken();
      const res = await fetch('/api/auth/link-google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ firebaseIdToken })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to connect Google account');
      }
      setLinkedGoogleEmail(data.email || result.user.email || null);
      setProfileMessage({
        type: 'success',
        text: data.message || (data.alreadyLinked
          ? 'This Google account is already connected to your EVDEKIMI account.'
          : `Google account (${data.email || result.user.email}) connected. You can now sign in with Google.`)
      });
    } catch (err: any) {
      console.error(err);
      setProfileMessage({
        type: 'error',
        text: err.message || 'Failed to connect Google account'
      });
    } finally {
      setIsLinkingGoogle(false);
    }
  };

  const handleDisconnectGoogleAccount = async () => {
    setIsUnlinkingGoogle(true);
    setProfileMessage(null);
    try {
      let firebaseIdToken: string | undefined;
      try {
        const { auth } = await import('./lib/firebase');
        if (auth.currentUser) {
          firebaseIdToken = await auth.currentUser.getIdToken();
        }
      } catch {
        // Firebase auth may already be signed out; server may still unlink via service account.
      }

      const res = await fetch('/api/auth/unlink-google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ firebaseIdToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Unable to disconnect Google account. Please try again.');
      }
      setConfirmReconnect(false);
      setLinkedGoogleEmail(null);
      if (data.unlinked !== false) {
        logout();
      }
    } catch (err: any) {
      console.error(err);
      setProfileMessage({
        type: 'error',
        text: err.message || 'Unable to disconnect Google account. Please try again.'
      });
    } finally {
      setIsUnlinkingGoogle(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setLinkedGoogleEmail(null);
      setGoogleLinkNeedsReauth(false);
      setConfirmReconnect(false);
      return;
    }
    let cancelled = false;
    fetch('/api/auth/link-status', { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          setLinkedGoogleEmail(null);
          setGoogleLinkNeedsReauth(true);
          return;
        }
        setGoogleLinkNeedsReauth(false);
        if (res.ok && data.linked && data.email) {
          setLinkedGoogleEmail(data.email);
        } else {
          setLinkedGoogleEmail(null);
        }
      })
      .catch(() => {
        if (!cancelled) setLinkedGoogleEmail(null);
      });
    return () => { cancelled = true; };
  }, [user]);

  // --- FILTERED DATA ---
  const filteredProperties = useMemo(() => {
    const list = villasList.length > 0 ? villasList : PROPERTIES;
    if (viewport === 'admin') return list;
    
    // If we have parsed villas, filter them by investor code
    if (villasList.length > 0) {
      return villasList.filter(v => {
        if (!v.investorCode || !user?.code) return false;
        return investorCodesOverlap(v.investorCode, user.code);
      });
    }

    // Fallback to user.villas
    if (user?.villas && user.villas.length > 0) {
      return user.villas.map((v: any, index: number) => {
         const keys = Object.keys(v);
         const findKey = (search: string) => keys.find(k => {
           const lower = k.toLowerCase();
           return lower.includes(search) && !lower.includes('complex') && !lower.includes('investor');
         });
         
         const idKey = findKey('villa id') || findKey('id') || findKey('property');
         const nameKey = findKey('villa name') || findKey('unit name') || findKey('villa');
         const locKey = findKey('location') || findKey('area');
         const complexKey = keys.find(k => k.toLowerCase().includes('complex'));
         
         return {
           id: idKey ? String(v[idKey]) : `mapped_prop_${index}`,
           name: nameKey ? String(v[nameKey]) : 'Unknown Villa',
           complex: complexKey ? String(v[complexKey]) : undefined,
           location: locKey ? String(v[locKey]) : 'Bali',
           type: 'Premium',
           status: 'active',
           ownerEmail: user.username,
           investorCode: user.code
         } as any;
      });
    }
    return PROPERTIES.filter(p => p.ownerEmail === user?.username);
  }, [viewport, villasList, user]);

  const investorListings = useMemo(() => {
    if (!user?.code || villasList.length === 0) return null;
    return getListingsForInvestor(String(user.code), villasList, allListings);
  }, [user?.code, villasList, allListings]);

  const activeProperties = useMemo(() => {
    if (activeListingIds.length === 0) return filteredProperties;
    return filteredProperties.filter(p => activeListingIds.includes(p.id) || activeListingIds.includes(p.name));
  }, [activeListingIds, filteredProperties]);

  const convertLocalValue = (val: number, from: Currency | string, to: Currency | string, month = selectedMonth, year = selectedYear) => {
    if (from === to) return val;
    let data = currencyData.find(c => c.month === month + 1 && c.year === year);
    
    // Fallback to most recent available rates if current month is missing
    let usdRate = data?.usdToIdr;
    let eurRate = data?.eurToIdr;
    
    if (!usdRate || !eurRate) {
      const sortedData = [...currencyData].sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });
      
      const getLatestValid = (key: 'usdToIdr' | 'eurToIdr') => {
        // Try past/current months first
        let valid = sortedData.find(c => c[key] && (c.year < year || (c.year === year && c.month <= month + 1)));
        // If not found, try any available month
        if (!valid) valid = sortedData.find(c => c[key]);
        return valid?.[key];
      };

      if (!usdRate) usdRate = getLatestValid('usdToIdr') || 16200;
      if (!eurRate) eurRate = getLatestValid('eurToIdr') || 17500;
    }

    const getRate = (curr: string) => {
      if (curr === 'USD' || curr === 'USDT') return usdRate;
      if (curr === 'EUR' || curr === 'EURO') return eurRate;
      return 1; // IDR
    };
    
    const fromRate = getRate(from);
    const toRate = getRate(to);
    
    return (val * fromRate) / toRate;
  };

  const fetchSheet = async (sheetName: string) => {
    const res = await fetch(`/api/sheet/${sheetName}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to load ${sheetName}`);
    }
    const data = await res.json();
    return data.values || [];
  };

  const handleSync = async (opts?: { fromSourceSwitch?: boolean; gen?: number }) => {
    const genAtStart = opts?.gen ?? syncGenerationRef.current;
    setSyncStatus(prev => ({ ...prev, status: 'syncing' }));
    try {

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const pad = (n: number) => String(n).padStart(2, '0');
      const fromDateObj = new Date(currentYear, currentMonth - 2, 1);
      const toDateObj = new Date(currentYear, currentMonth + 4, 0);
      const fromDate = `${fromDateObj.getFullYear()}-${pad(fromDateObj.getMonth() + 1)}-01`;
      const toDate = `${toDateObj.getFullYear()}-${pad(toDateObj.getMonth() + 1)}-${pad(toDateObj.getDate())}`;
      const evdekimiReq = fetch(`/api/evdekimi/reservations?from=${fromDate}&to=${toDate}`).then(r => r.ok ? r.json() : null).catch(() => null);
      // A failed settings fetch must not read as "the admin cleared every
      // per-month source". Absence of an answer and an empty answer are
      // different things: the first means keep what we already have, the
      // second means the admin really has no overrides. Collapsing both to {}
      // made every explicit choice disappear on the next 5-minute sync, and a
      // past month then fell back to SHEETS.
      const settingsReq: Promise<{ ok: boolean; settings?: Record<string, any> }> = fetch('/api/admin/settings', {
        credentials: 'include',
      })
        .then(async (r) => (r.ok ? { ok: true, settings: await readJsonResponse(r) } : { ok: false }))
        .catch(() => ({ ok: false }));

      const [bookingsRows, summaryRows, expensesRows, villasRows, currencyRows, listingsRows, evdekimiData, settingsData] = await Promise.all([
        fetchSheet('Bookings'),
        fetchSheet('Summary'),
        fetchSheet('Expenses'),
        fetchSheet('Villas'),
        fetchSheet('Currency'),
        fetchSheet('Listings').catch(() => []),
        evdekimiReq,
        settingsReq
      ]);


      // Parse Villas (title row + description row aware — same layout as Investors sheet)
      const parsedVillas = parseVillaSheetRows(villasRows);
      const parsedListings = parseListingsSheetRows(listingsRows);

      // Parse Bookings (title row + description row aware)
      const importedBookings: Booking[] = parsedBookingsToAppBookings(
        parseBookingsSheetRows(bookingsRows)
      ) as Booking[];

      // Parse Summary (title row + description row aware)
      const parsedSummaries = parseSummarySheetRows(summaryRows);

      // Parse Expenses (title row + description row aware)
      const parsedExpenses = parseExpensesSheetRows(expensesRows);

      let parsedCurrency: any[] = [];
      if (currencyRows && currencyRows.length > 1) {
        const parseRate = (val: any) => {
          if (!val) return null;
          const cleaned = String(val).replace(/[^0-9.-]+/g, '');
          const parsed = parseFloat(cleaned);
          return isNaN(parsed) ? null : parsed;
        };

        parsedCurrency = currencyRows.slice(1).map((row: any[]) => {
          return {
            year: parseInt(String(row[0]).trim()) || 0,
            month: parseInt(String(row[1]).trim()) || 0,
            usdToIdr: parseRate(row[2]),
            eurToIdr: parseRate(row[3])
          };
        }).filter(c => c.year > 0 && c.month > 0);
      }

      setVillasList(parsedVillas);
      setAllListings(parsedListings);

      function mapVillaName(apiName: string) {
        if (apiName.includes("Tropical T") || apiName.includes("TTB")) return "Tropical Tribe Villa";
        if (apiName.includes("HIJ")) return "Hijau Villa";
        if (apiName.includes("RMH")) return "Rumah Villa";
        if (apiName.includes("HTN")) return "Hutan Villa";
        if (apiName.includes("PUS")) return "Putri Salju";
        if (apiName.includes("GDH")) return "Garden Hights Villa";
        if (apiName.includes("SMR")) return "Semiramida";
        if (apiName.includes("TBG")) return "Tembaga Villa";
        if (apiName.includes("MNL")) return "Moonlight";
        
        const match = apiName.match(/(?:SRG|SEB|DGS|SCJ|OGV)[- ]*(?:A|V)?(?:0*)(\d+)/i);
        if (match) {
          const num = match[1];
          if (apiName.includes("SRG")) return `Sarang Apart. ${num}`;
          if (apiName.includes("SEB")) {
             if (num === '9') return 'Sebelas Aprt. 9 (2BDr)';
             if (num === '11') return 'Sebelas Aprt. 11 (3BDr)';
             return `Sebelas Aprt. ${num}`;
          }
          if (apiName.includes("SCJ") && apiName.includes("A")) {
             if (num === '1') return 'SJ Apart 1 (Mezanine)';
             if (num === '2') return 'SJ Apart 2 (Mezanine)';
             if (num === '3') return 'SJ Apart 3 (Mezanine)';
             if (num === '9') return 'SJ Apart 9 (2BDr)';
             return `SJ Apart ${num}`;
          }
          if (apiName.includes("SCJ") && apiName.includes("V")) {
             if (['4', '5', '6'].includes(num)) return `SJ 2 Villa ${num}`;
             return `SJ 1 Villa ${num}`;
          }
          if (apiName.includes("DGS") && apiName.includes("V")) return `DragonStone V${num}`;
          if (apiName.includes("DGS") && apiName.includes("A")) return `DragonStone A${num}`;
          if (apiName.includes("OGV")) {
             if (num === '1') return 'Nyaman Villa 1 (1BDr)';
             if (num === '2') return 'Nyaman Villa 2 (1BDr)';
             if (num === '3') return 'Nyaman Villa 3 (2BDr)';
             return `Nyaman Villa ${num}`;
          }
        }
        return apiName;
      }

        const nextSheetsMonthsWithData: Record<string, boolean> = {};
        importedBookings.forEach((b: any) => {
          // Skip ISO timestamps used as empty-row fallbacks (new Date().toISOString()).
          if (!b.checkInDate || String(b.checkInDate).includes('T')) return;
          const monthKey = calendarMonthKey(b.checkInDate);
          if (monthKey) nextSheetsMonthsWithData[monthKey] = true;
        });
        setSheetsMonthsWithData(nextSheetsMonthsWithData);

        let allBookings = importedBookings.filter((b: any) => {
          const k = calendarMonthKey(b.checkInDate);
          if (!k) return false;
          const currentViewSource = resolveReservationSource(
            settingsData?.[k],
            isPastMonthKey(k, currentYear, currentMonth)
          );
          return currentViewSource === 'SHEETS';
        });

        if (evdekimiData && Array.isArray(evdekimiData.reservations)) {
          const apiBookings = evdekimiData.reservations.filter((r: any) => {
            if ((r.status !== 'confirmed' && r.status !== 'completed') || !r.checkIn) return false;
            const k = calendarMonthKey(r.checkIn);
            if (!k) return false;
            const currentViewSource = resolveReservationSource(
              settingsData?.[k],
              isPastMonthKey(k, currentYear, currentMonth)
            );
            return currentViewSource !== 'SHEETS'; // Use API if not forced to Sheets (includes FIREBASE)
          }).map((r: any) => {
            const checkInD = new Date(r.checkIn);
            const checkOutD = new Date(r.checkOut);
            const calcNights = Math.max(0, Math.round((checkOutD.getTime() - checkInD.getTime()) / (1000 * 60 * 60 * 24)));
            return {
              id: r.confirmationCode || r._id || Math.random().toString(),
              listingId: mapVillaName(r.villa),
              source: r.source || 'API',
              checkInDate: r.checkIn,
              checkOutDate: r.checkOut,
              status: r.status,
              isFromApi: true,
              guest: {
                name: r.guestName || 'Unknown Guest',
                nationality: 'Unknown',
              },
              financials: {
                accommodationFare: r.totalPaid || 0,
                cleaningFee: 0,
                extraPersonFee: 0,
                otaCommission: 0,
                returns: 0,
              },
              finalHostPayout: r.totalPaid || 0,
              nights: r.nights || calcNights
            } as any;
          });
          allBookings = [...allBookings, ...apiBookings];
        }

      if (syncGenerationRef.current !== genAtStart) return false;
      if (isSourceSwitchingRef.current && !opts?.fromSourceSwitch) return false;

      setBookings(allBookings);
      setSummaries(parsedSummaries);
      setExpenses(parsedExpenses);
      setCurrencyData(parsedCurrency);
      if (settingsData?.ok) {
        setAppSettings(settingsData.settings || {});
      } else {
        console.warn('Keeping the current data-source settings: the server did not return them.');
      }

      setSyncStatus({
        lastSync: new Date().toLocaleTimeString(),
        status: 'success',
        tokenExpiresAt: null
      });
      return true;
    } catch (err: any) {
      if (syncGenerationRef.current !== genAtStart) return false;
      console.error(err);
      setSyncStatus(prev => ({ ...prev, status: 'error', error: err.message }));
      return false;
    }
  };

  useEffect(() => {
    if (user) {
      handleSync();
      const interval = setInterval(() => {
        handleSync();
      }, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [user]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(event.target as Node)) {
        setIsSourceMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSourceChange = async (nextSource: 'SHEETS' | 'API' | 'FIREBASE') => {
    const key = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
    const now = new Date();
    const isPast = selectedYear < now.getFullYear() || (selectedYear === now.getFullYear() && (selectedMonth + 1) < now.getMonth() + 1);
    const currentSource = resolveReservationSource(appSettings[key], isPast);
    if (currentSource === nextSource) return;

    const previousSettings = appSettings;
    const newSettings = { ...appSettings, [key]: nextSource };
    const gen = ++syncGenerationRef.current;
    isSourceSwitchingRef.current = true;
    setAppSettings(newSettings);
    setIsSourceSwitching(true);
    try {
      const saveRes = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newSettings)
      });
      if (!saveRes.ok) {
        throw new Error('Failed to save source setting');
      }
      await handleSync({ fromSourceSwitch: true, gen });
    } catch (err: any) {
      if (syncGenerationRef.current === gen) {
        setAppSettings(previousSettings);
        setSyncStatus(prev => ({ ...prev, status: 'error', error: err?.message || 'Source switch failed' }));
      }
    } finally {
      if (syncGenerationRef.current === gen) {
        isSourceSwitchingRef.current = false;
        setIsSourceSwitching(false);
      }
    }
  };


  // --- CALCULATIONS ---
  const activeBookings = useMemo(() => {
    const allowedNames = filteredProperties.map(p => p.name?.toLowerCase().trim());
    const now = new Date();
    const currentCtx = monthContext(selectedYear, selectedMonth, now);
    const prevAnchor = new Date(selectedYear, selectedMonth - 1, 1);
    const previousCtx = monthContext(prevAnchor.getFullYear(), prevAnchor.getMonth(), now);

    const currentViewSource = resolveReservationSource(appSettings[currentCtx.key], currentCtx.isPast);
    const previousViewSource = resolveReservationSource(appSettings[previousCtx.key], previousCtx.isPast);

    const seenIds = new Set<string>();
    const result: Booking[] = [];

    for (const b of bookings) {
      if (!b.checkInDate || !b.checkOutDate) continue;
      const checkInDate = new Date(`${b.checkInDate}T00:00:00.000Z`);
      const checkOutDate = new Date(`${b.checkOutDate}T00:00:00.000Z`);

      const isOverlapping =
        checkInDate <= currentCtx.monthEnd && checkOutDate > currentCtx.monthStart;
      const isCancelled =
        b.status?.toLowerCase() === 'cancelled' || b.status?.toLowerCase() === 'canceled';
      if (isCancelled || !isOverlapping) continue;

      const carryOver = isCarryOverIntoMonth(checkInDate, checkOutDate, currentCtx.monthStart);
      const sourceForBooking = carryOver ? previousViewSource : currentViewSource;
      if (!bookingMatchesReservationSource(b, sourceForBooking)) continue;

      const bNameNormalized = b.listingId?.toLowerCase().trim();
      const belongsToFiltered = allowedNames.includes(bNameNormalized);
      const isProp =
        activeListingIds.length === 0
          ? belongsToFiltered
          : activeListingIds.map(id => id.toLowerCase().trim()).includes(bNameNormalized);
      if (!isProp) continue;

      const dedupeKey = String(b.id || '');
      if (dedupeKey && seenIds.has(dedupeKey)) continue;
      if (dedupeKey) seenIds.add(dedupeKey);
      result.push(b);
    }

    return result;
  }, [bookings, selectedMonth, selectedYear, activeListingIds, filteredProperties, appSettings]);

  const activeExpenses = useMemo(() => {
    const allowedNames = filteredProperties.map(p => p.name?.toLowerCase().trim());
    return expenses.filter(e => {
      if (!e.date) return false;
      const date = new Date(e.date);
      const isMonth = date.getMonth() === selectedMonth;
      const isYear = date.getFullYear() === selectedYear;
      
      const eNameNormalized = e.villaName?.toLowerCase().trim();
      const belongsToFiltered = allowedNames.includes(eNameNormalized);
      const isProp = activeListingIds.length === 0
        ? belongsToFiltered
        : activeListingIds.map(id => id.toLowerCase().trim()).includes(eNameNormalized);
      const isNotTax = !e.category || (e.category.toLowerCase() !== 'tax' && e.category.toLowerCase() !== 'taxes');
      return isMonth && isYear && isProp && isNotTax;
    });
  }, [expenses, selectedMonth, selectedYear, activeListingIds, filteredProperties]);

  const expenseGroups = useMemo(() => {
    const groups: {
      category: string;
      amount: number;
      month: string;
      property: string;
      subcategories: { subcategory: string; amount: number; month: string; property: string }[]
    }[] = [];

    activeExpenses.forEach(e => {
      const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][selectedMonth];
      const prop = activeListingIds.length === 0 ? 'All Properties' : (activeListingIds.length > 1 ? 'Selected Properties' : e.villaName);
      
      let catGroup = groups.find(g => g.category === (e.category || 'Other') && g.property === prop);
      if (!catGroup) {
        catGroup = {
          category: e.category || 'Other',
          amount: 0,
          month: monthName,
          property: prop,
          subcategories: []
        };
        groups.push(catGroup);
      }
      
      catGroup.amount += e.amount;
      
      const subcatName = e.subcategory || '-';
      let subGroup = catGroup.subcategories.find(s => s.subcategory === subcatName);
      if (!subGroup) {
        subGroup = {
          subcategory: subcatName,
          amount: 0,
          month: monthName,
          property: prop
        };
        catGroup.subcategories.push(subGroup);
      }
      
      subGroup.amount += e.amount;
    });
    
    return groups;
  }, [activeExpenses, selectedMonth, activeListingIds]);

  const kpis = useMemo(() => {
    const selectedLower = activeListingIds.map(id => id.toLowerCase().trim());
    const villasToCalc = activeListingIds.length === 0
      ? filteredProperties
      : filteredProperties.filter(p => 
          selectedLower.includes(p.id?.toLowerCase().trim()) || 
          selectedLower.includes(p.name?.toLowerCase().trim())
        );
      
    let totalGrossRevenue = 0;
    let totalNetProfit = 0;
    let occupancySum = 0;
    let adrSum = 0;
    let totalStaffSalary = 0;
    let totalUtilities = 0;
    let totalMaintenance = 0;
    let totalOtherExpenses = 0;
    let totalFeeTotal = 0;
    let totalPmFee = 0;
    let totalTax = 0;
    let totalOperatingExpenses = 0;
    let count = 0;
    let occupancyCount = 0;

    const realCurrentDate = new Date();
    const isCurrentOrFutureMonth = selectedYear > realCurrentDate.getFullYear() || (selectedYear === realCurrentDate.getFullYear() && selectedMonth >= realCurrentDate.getMonth());
    
    const mStr = String(selectedMonth + 1).padStart(2, '0');
    const k = `${selectedYear}-${mStr}`;
    const isPast = selectedYear < realCurrentDate.getFullYear() || (selectedYear === realCurrentDate.getFullYear() && (selectedMonth + 1) < realCurrentDate.getMonth() + 1);
    const currentViewSource = resolveReservationSource(appSettings[k], isPast);
    const useFirebase = currentViewSource === 'FIREBASE';
    const useApiOccupancy = currentViewSource === 'API';


    villasToCalc.forEach(villa => {
      let vSummary = null;
      if (useFirebase) {
        vSummary = firebaseReports.find(s => 
          s.month === `${selectedYear}-${mStr}` && 
          s.propertyId?.toLowerCase().trim() === villa.name?.toLowerCase().trim()
        );
      } else {
        vSummary = summaries.find(s => 
          s.month === selectedMonth + 1 && 
          s.year === selectedYear && 
          s.villaName?.toLowerCase().trim() === villa.name?.toLowerCase().trim()
        );
      }

      let villaOccupancy = 0;
      let usedCalculatedOccupancy = false;

      if (vSummary) {
        totalGrossRevenue += vSummary.grossRevenue || 0;
        totalNetProfit += vSummary.finalDecisionToTransfer || 0;
        
        if (vSummary.occupancy && vSummary.occupancy > 0) {
          villaOccupancy = vSummary.occupancy;
        }
        
        adrSum += vSummary.adr || 0;
        totalStaffSalary += vSummary.staffSalary || 0;
        totalUtilities += vSummary.utilities || 0;
        totalMaintenance += vSummary.maintenance || 0;
        totalOtherExpenses += vSummary.other || 0;
        totalFeeTotal += vSummary.feeTotal || 0;
        totalPmFee += vSummary.pmFee || 0;
        totalTax += vSummary.tax || 0;
        totalOperatingExpenses += vSummary.operatingExpenses || 0;
        count++;
      }

      if (useApiOccupancy || (isCurrentOrFutureMonth && (!vSummary || !vSummary.occupancy || vSummary.occupancy === 0))) {
        const mStart = new Date(selectedYear, selectedMonth, 1).getTime();
        const mEnd = new Date(selectedYear, selectedMonth + 1, 1).getTime();
        const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
        
        let bookedNights = 0;
        const villaBookings = activeBookings.filter(b => b.listingId?.toLowerCase().trim() === villa.name?.toLowerCase().trim() && (b.status === 'confirmed' || b.status === 'completed'));
        
        villaBookings.forEach(b => {
          if (!b.checkInDate || !b.checkOutDate) return;
          const cIn = new Date(b.checkInDate).getTime();
          const cOut = new Date(b.checkOutDate).getTime();
          
          const overlapStart = Math.max(cIn, mStart);
          const overlapEnd = Math.min(cOut, mEnd);
          const overlapMs = Math.max(0, overlapEnd - overlapStart);
          bookedNights += overlapMs / (1000 * 60 * 60 * 24);
        });

        villaOccupancy = (bookedNights / daysInMonth) * 100;
        usedCalculatedOccupancy = true;
      }

      if (vSummary || usedCalculatedOccupancy) {
        occupancySum += villaOccupancy;
        occupancyCount++;
      }
    });

    return {
      grossRevenue: totalGrossRevenue,
      netProfit: totalNetProfit,
      occupancyRate: occupancyCount > 0 ? (occupancySum / occupancyCount) : 0,
      adr: count > 0 ? (adrSum / count) : 0,
      staffSalary: totalStaffSalary,
      utilities: totalUtilities,
      maintenance: totalMaintenance,
      otherExpenses: totalOtherExpenses,
      feeTotal: totalFeeTotal,
      pmFee: totalPmFee,
      tax: totalTax,
      operatingExpenses: totalOperatingExpenses,
    };
  }, [summaries, firebaseReports, appSettings, sheetsMonthsWithData, activeBookings, selectedMonth, selectedYear, activeListingIds, filteredProperties]);

  const monthlyChartData = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const selectedLower = activeListingIds.map(id => id.toLowerCase().trim());
    
    const data = months.map((m, index) => {
      const villasToCalc = activeListingIds.length === 0
        ? filteredProperties
        : filteredProperties.filter(p => 
            selectedLower.includes(p.id?.toLowerCase().trim()) || 
            selectedLower.includes(p.name?.toLowerCase().trim())
          );
        
      let gross = 0;
      let net = 0;
      let hasData = false;
      
      villasToCalc.forEach(villa => {
        const vSummary = summaries.find(s => 
          s.month === index + 1 && 
          s.year === selectedYear && 
          s.villaName?.toLowerCase().trim() === villa.name?.toLowerCase().trim()
        );
        if (vSummary) {
          hasData = true;
          gross += vSummary.grossRevenue || 0;
          net += vSummary.finalDecisionToTransfer || 0;
        }
      });

      return {
        name: m,
        gross: convertLocalValue(gross, 'IDR', currency, index, selectedYear),
        net: convertLocalValue(net, 'IDR', currency, index, selectedYear),
        hasData
      };
    });
    
    return data.filter(d => d.hasData);
  }, [summaries, selectedYear, activeListingIds, filteredProperties, currency, currencyData]);

  const currentExchangeRates = useMemo(() => {
    let data = currencyData.find(c => c.month === selectedMonth + 1 && c.year === selectedYear);
    
    let usdRate = data?.usdToIdr;
    let eurRate = data?.eurToIdr;
    
    if (!usdRate || !eurRate) {
      const sortedData = [...currencyData].sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });
      
      const getLatestValid = (key: 'usdToIdr' | 'eurToIdr') => {
        let valid = sortedData.find(c => c[key] && (c.year < selectedYear || (c.year === selectedYear && c.month <= selectedMonth + 1)));
        if (!valid) valid = sortedData.find(c => c[key]);
        return valid?.[key];
      };

      if (!usdRate) usdRate = getLatestValid('usdToIdr') || 16200;
      if (!eurRate) eurRate = getLatestValid('eurToIdr') || 17500;
    }
    
    return {
      usdToIdr: usdRate,
      eurToIdr: eurRate
    };
  }, [currencyData, selectedMonth, selectedYear]);

  // --- RENDER HELPERS ---
  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <RefreshCcw className="w-8 h-8 text-brand-navy animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPopup />;
  }

  const dashboardMonthKey = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
  const dashboardMonthIsPast = selectedYear < new Date().getFullYear() || (selectedYear === new Date().getFullYear() && (selectedMonth + 1) < new Date().getMonth() + 1);
  const currentDashboardSource = resolveReservationSource(appSettings[dashboardMonthKey], dashboardMonthIsPast);
  const dashboardMonthLabel = new Date(selectedYear, selectedMonth, 1).toLocaleString('default', { month: 'short' }).toUpperCase();
  const sourceAccent =
    currentDashboardSource === 'SHEETS' ? 'bg-green-500/20 text-green-400' :
    currentDashboardSource === 'FIREBASE' ? 'bg-orange-500/20 text-orange-400' :
    'bg-blue-500/20 text-blue-400';

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* HEADER */}
      <header className="bg-brand-navy text-white px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 sticky top-0 z-40 shadow-xl border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <EvdekimiLogo color="white" />
            <div className="flex flex-col justify-center -space-y-0.5">
              <span className="font-bold text-2xl tracking-tight leading-none">EVDEkimi</span>
              <span className="text-sm font-medium leading-none text-white/80">Real Estates</span>
            </div>
          </div>
          {user?.isAdmin && (
            <>
              <div className="h-8 w-[1px] bg-white/10 mx-2 hidden sm:block" />
              <div className="flex items-center gap-2 min-w-0 max-w-full overflow-x-auto custom-scrollbar">
                {[-2, -1, 0, 1, 2, 3].map(offset => {
                  const d = new Date();
                  d.setDate(1);
                  d.setMonth(d.getMonth() + offset);
                  const y = d.getFullYear();
                  const m = d.getMonth() + 1;
                  const key = `${y}-${String(m).padStart(2, '0')}`;
                  const monthName = d.toLocaleString('default', { month: 'short' }).toUpperCase();
                  const now = new Date();
                  const chipIsPast = y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1);
                  const chipSource = resolveReservationSource(appSettings[key], chipIsPast);
                  const chipSourceColor =
                    chipSource === 'SHEETS' ? 'bg-green-500/20 text-green-400 border-green-400/40' :
                    chipSource === 'FIREBASE' ? 'bg-orange-500/20 text-orange-400 border-orange-400/40' :
                    'bg-blue-500/20 text-blue-400 border-blue-400/40';
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedMonth(d.getMonth());
                        setSelectedYear(y);
                        setIsSourceMenuOpen(false);
                      }}
                      className={`px-2 py-1 text-[10px] font-bold rounded whitespace-nowrap border transition-colors hover:brightness-110 ${chipSourceColor}`}
                    >
                      {monthName}
                    </button>
                  );
                })}
              </div>
              <div className="relative shrink-0" ref={sourceDropdownRef}>
                <div className="flex items-center gap-2 bg-white/5 rounded-lg p-1 pr-2 border border-white/10">
                  <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest pl-1 hidden sm:inline">Source</span>
                  <span className="text-[10px] font-bold text-white/70 whitespace-nowrap">{dashboardMonthLabel} {selectedYear}</span>
                  <button
                    type="button"
                    onClick={() => setIsSourceMenuOpen(open => !open)}
                    className={`px-2 py-1 text-[10px] font-bold rounded flex items-center gap-1 transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-white/20 ${sourceAccent}`}
                    aria-haspopup="listbox"
                    aria-expanded={isSourceMenuOpen}
                  >
                    {currentDashboardSource}
                    <ChevronDown className={`w-3 h-3 transition-transform ${isSourceMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {isSourceMenuOpen && (
                  <div className="absolute top-full left-0 mt-2 min-w-[148px] bg-brand-navy border border-white/10 rounded-xl shadow-xl z-50 py-1">
                    {(['SHEETS', 'API', 'FIREBASE'] as const).map(src => {
                      const isActive = currentDashboardSource === src;
                      const optionAccent =
                        src === 'SHEETS' ? 'text-green-400' :
                        src === 'FIREBASE' ? 'text-orange-400' :
                        'text-blue-400';
                      return (
                        <button
                          key={src}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => {
                            setIsSourceMenuOpen(false);
                            handleSourceChange(src);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold tracking-wide hover:bg-white/10 transition-colors ${isActive ? optionAccent : 'text-white/70'}`}
                        >
                          <span>{src}</span>
                          {isActive && <Check className="w-3 h-3" strokeWidth={3} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
          <div className="h-8 w-[1px] bg-white/10 mx-2 hidden md:block" />
          {user?.isAdmin && (
            <div className="hidden md:flex flex-col">
              <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Database last synch {syncStatus.lastSync}</span>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${syncStatus.status === 'syncing' ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`} />
                <span className="text-xs font-normal">
                  {syncStatus.status === 'syncing' ? 'Loading' : 'Synchronized'}
                </span>
                <button onClick={handleSync} className="hover:rotate-180 transition-transform duration-500">
                  <RefreshCcw className="w-3 h-3 text-brand-muted" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Viewport Toggle */}
          <div className="flex bg-brand-slate rounded-xl p-1 shadow-inner border border-white/5 flex-1 md:flex-none">
            <button 
              onClick={() => {
                setViewport('investor');
                setAdminTab('dashboard');
              }}
              className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${viewport === 'investor' ? 'bg-brand-navy text-white shadow-lg' : 'text-brand-muted'}`}
            >
              <UserCircle className="w-4 h-4" />
              {user?.investorName || user?.username || 'Investor'}
            </button>
            {isAdmin && (
              <button 
                onClick={() => setViewport('admin')}
                className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${viewport === 'admin' ? 'bg-brand-navy text-white shadow-lg' : 'text-brand-muted'}`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Admin
              </button>
            )}
          </div>

          <button 
            onClick={() => setCurrency(currency === 'IDR' ? 'USD' : currency === 'USD' ? 'EUR' : 'IDR')}
            className="bg-brand-slate px-4 py-3 rounded-xl border border-white/5 text-xs font-bold flex items-center gap-2 hover:bg-brand-navy transition-all"
          >
            <Globe className="w-4 h-4 text-blue-400" />
            {currency}
          </button>
          <button 
            onClick={() => logout()}
            className="bg-brand-slate px-4 py-3 rounded-xl border border-white/5 text-xs font-bold flex items-center gap-2 hover:bg-brand-navy transition-all text-red-400"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {isSourceSwitching && (
          <div className="absolute inset-0 z-30 bg-brand-navy/45 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3 pointer-events-auto">
            <RefreshCcw className="w-8 h-8 text-white animate-spin" />
            <p className="text-sm font-bold text-white tracking-wide">Synchronizing data...</p>
          </div>
        )}
        {/* SIDEBAR */}
        <aside className="w-64 bg-brand-navy border-r border-white/5 pt-8 hidden md:flex flex-col flex-shrink-0">
          <nav className="flex-1 px-4 space-y-2">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'bookings', label: 'Bookings', icon: CalendarIcon },
              { id: 'expenses', label: 'Expenses', icon: CreditCard },
              { id: 'profile', label: 'Investor Profile', icon: UserCircle },
              ...(user?.isPlatformAdmin ? [{ id: 'cockpit', label: 'Cockpit', icon: AlertCircle }] : []),
              ...(user?.isPlatformAdmin ? [{ id: 'accounting', label: 'Accounting', icon: Table2 }] : []),
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setActiveMenu(item.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeMenu === item.id ? 'bg-white/10 text-white shadow-lg' : 'text-brand-muted hover:bg-white/5 hover:text-white/80'}`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* MAIN */}
        <main className="flex-1 p-6 space-y-6 max-w-[1600px] mx-auto w-full overflow-y-auto">
        
        {/* WELCOME MESSAGE */}
        {viewport === 'investor' && activeMenu === 'dashboard' && (
          <div className="bg-gradient-to-r from-brand-navy to-indigo-900 rounded-3xl p-8 text-white shadow-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-20 mix-blend-overlay bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&q=80')" }}></div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h1 className="text-3xl font-bold mb-2">Welcome back, {user?.investorName || user?.username || 'Investor'}!</h1>
                <p className="text-white/80 max-w-xl text-sm leading-relaxed">
                  Wishing you a warm and sunny day, just like here in Bali! 🌴
                </p>
              </div>
              <WeatherWidget />
            </div>
          </div>
        )}

        {/* PERSISTENT FILTERS BAR FOR DASHBOARD, BOOKINGS, AND EXPENSES */}
        {activeMenu !== 'profile' && (viewport !== 'admin' || adminTab === 'dashboard') && (
          <section className="flex flex-wrap items-center justify-between gap-4 bg-white/50 p-4 rounded-2xl border border-brand-muted/10 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="relative group">
                <select 
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="appearance-none bg-white border border-brand-muted/30 px-6 py-3 pr-10 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-navy/10 cursor-pointer shadow-sm"
                >
                  {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                    <option key={m} value={i}>{m}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted pointer-events-none" />
              </div>
              
              <div className="relative group">
                <select 
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="appearance-none bg-white border border-brand-muted/30 px-6 py-3 pr-10 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-navy/10 cursor-pointer shadow-sm"
                >
                  <option value={2026}>2026</option>
                  <option value={2025}>2025</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted pointer-events-none" />
              </div>

              <PropertyMultiSelect properties={filteredProperties} selectedIds={activeListingIds} onChange={setActiveListingIds} />
            </div>

            <div className="flex items-center gap-2 text-brand-muted text-xs font-bold uppercase tracking-widest bg-white/50 px-4 py-2 rounded-lg">
              <Clock className="w-3 h-3" />
              Exchange Rate: 1 USD = {(currentExchangeRates.usdToIdr || 16200).toLocaleString('id-ID')} IDR
              {currentExchangeRates.eurToIdr ? ` | 1 EUR = ${currentExchangeRates.eurToIdr.toLocaleString('id-ID')} IDR` : ''}
            </div>
          </section>
        )}

        {activeMenu === 'dashboard' && (
          <>
            {/* ADMIN SUB-NAV */}
            {viewport === 'admin' && (
              <div className="flex gap-8 border-b border-brand-muted/10 pb-1 mb-8 overflow-x-auto no-scrollbar">
                <button 
                  onClick={() => setAdminTab('dashboard')}
                  className={`pb-4 text-xs font-bold uppercase tracking-widest transition-all relative ${adminTab === 'dashboard' ? 'text-brand-navy' : 'text-brand-muted'}`}
                >
                  Performance Dashboard
                  {adminTab === 'dashboard' && <motion.div layoutId="adminTab" className="absolute bottom-0 left-0 w-full h-1 bg-brand-navy" />}
                </button>
                <button 
                  onClick={() => setAdminTab('integrations')}
                  className={`pb-4 text-xs font-bold uppercase tracking-widest transition-all relative ${adminTab === 'integrations' ? 'text-brand-navy' : 'text-brand-muted'}`}
                >
                  API Integrations
                  {adminTab === 'integrations' && <motion.div layoutId="adminTab" className="absolute bottom-0 left-0 w-full h-1 bg-brand-navy" />}
                </button>
                <button 
                  onClick={() => setAdminTab('mapping')}
                  className={`pb-4 text-xs font-bold uppercase tracking-widest transition-all relative ${adminTab === 'mapping' ? 'text-brand-navy' : 'text-brand-muted'}`}
                >
                  Investors & Properties
                  {adminTab === 'mapping' && <motion.div layoutId="adminTab" className="absolute bottom-0 left-0 w-full h-1 bg-brand-navy" />}
                </button>
                <button 
                  onClick={() => setAdminTab('data')}
                  className={`pb-4 text-xs font-bold uppercase tracking-widest transition-all relative ${adminTab === 'data' ? 'text-brand-navy' : 'text-brand-muted'}`}
                >
                  Data Management
                  {adminTab === 'data' && <motion.div layoutId="adminTab" className="absolute bottom-0 left-0 w-full h-1 bg-brand-navy" />}
                </button>
                <button 
                  onClick={() => setAdminTab('accounts')}
                  className={`pb-4 text-xs font-bold uppercase tracking-widest transition-all relative ${adminTab === 'accounts' ? 'text-brand-navy' : 'text-brand-muted'}`}
                >
                  Linked Accounts
                  {adminTab === 'accounts' && <motion.div layoutId="adminTab" className="absolute bottom-0 left-0 w-full h-1 bg-brand-navy" />}
                </button>
              </div>
            )}

            {adminTab === 'accounts' ? (
              <AdminAccounts />
            ) : adminTab === 'data' ? (
              <DataManager />
            ) : adminTab === 'dashboard' ? (
          <>

        {/* KPI GRID */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: 'Gross Revenue', value: kpis.grossRevenue, icon: TrendingUp, trend: 'Gross', color: 'text-emerald-600' },
            { label: 'Net Profit (Payout)', value: kpis.netProfit, icon: CreditCard, trend: currency, color: 'text-indigo-600' },
            { label: 'Occupancy Rate', value: `${kpis.occupancyRate.toFixed(2)}%`, icon: Percent, trend: 'Monthly', color: 'text-emerald-600' },
            { label: 'Avg. Price / Night', value: kpis.adr, icon: DollarSign, trend: 'ADR', color: 'text-emerald-600' },
          ].map((item, idx) => (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              key={item.label} 
              className="bg-white p-6 rounded-2xl shadow-sm border border-brand-muted/10 group hover:shadow-lg transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-brand-bg rounded-xl group-hover:scale-110 transition-transform">
                    <item.icon className="w-5 h-5 text-brand-navy" />
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-tighter ${item.color} bg-current/5 px-2 py-1 rounded`}>
                    {item.trend}
                  </span>
                </div>
                <h3 className="text-brand-muted text-[11px] font-bold uppercase tracking-[0.15em] mb-1">{item.label}</h3>
                <p className="text-2xl font-bold tracking-tight text-brand-navy">
                  {typeof item.value === 'string' ? item.value : formatCurrency(convertLocalValue(item.value, 'IDR', currency), currency)}
                </p>
              </div>
            </motion.div>
          ))}
        </section>

        {/* MAIN CHART & CALENDAR */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue Chart */}
          <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-brand-muted/10 h-[450px] flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="font-bold text-lg text-brand-navy">Revenue Analytics ({selectedYear})</h3>
                <p className="text-brand-muted text-xs">Tracking monthly gross performance vs net operating profit.</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-brand-bg rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Gross</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-brand-bg rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-indigo-500" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Net Profit</span>
                </div>
              </div>
            </div>
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyChartData}>
                  <defs>
                    <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis 
                    stroke="#94a3b8" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(value) => {
                      if (currency === 'IDR') return `${(value / 1000000).toFixed(1)}M`;
                      return value > 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
                    }}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#031428', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    formatter={(val: any, name: string) => [formatCurrency(val, currency), name]}
                  />
                  <Area type="monotone" name="Gross" dataKey="gross" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorGross)" />
                  <Area type="monotone" name="Net Profit" dataKey="net" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorNet)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Expense Pie Chart */}
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-brand-muted/10 h-[450px] flex flex-col relative overflow-hidden">
            <div className="mb-6">
              <h3 className="font-bold text-lg text-brand-navy flex items-center gap-2">
                <PieChartIcon className="w-5 h-5 text-indigo-500" />
                Expense Breakdown
              </h3>
              <p className="text-brand-muted text-xs">Categories from summary sheet</p>
            </div>

            <div className="flex-1 w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Staff Salaries', value: kpis.staffSalary },
                      { name: 'Utilities', value: kpis.utilities },
                      { name: 'Maintenance', value: kpis.maintenance },
                      { name: 'Others', value: kpis.otherExpenses },
                    ].filter(d => d.value > 0)}
                    cx="50%"
                    cy="45%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ value }) => formatCurrency(convertLocalValue(value, 'IDR', currency), currency)}
                    labelLine={true}
                  >
                    {[
                      { name: 'Staff Salaries', value: kpis.staffSalary },
                      { name: 'Utilities', value: kpis.utilities },
                      { name: 'Maintenance', value: kpis.maintenance },
                      { name: 'Others', value: kpis.otherExpenses },
                    ].filter(d => d.value > 0).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={['#10b981', '#3b82f6', '#f59e0b', '#64748b'][index % 4]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#031428', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    formatter={(val: any, name: string) => [formatCurrency(convertLocalValue(val, 'IDR', currency), currency), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-bold uppercase tracking-widest text-brand-muted">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-[#10b981]"></div> Staff</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-[#3b82f6]"></div> Utilities</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-[#f59e0b]"></div> Maint</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-[#64748b]"></div> Others</div>
            </div>
          </div>
        </div>

        {/* LINE CALENDAR WIDGET */}
        <LineCalendar 
          month={selectedMonth}
          year={selectedYear}
          bookings={activeBookings}
          properties={activeProperties}
          onBookingClick={setSelectedBooking}
        />
          </>
        ) : adminTab === 'integrations' ? (
          <AdminIntegrations />
        ) : (
          <InvestorsMapping />
        )}
          </>
        )}

        {activeMenu === 'bookings' && (
          <div className="flex-1 w-full max-w-[1552px] mx-auto px-4 sm:px-8 py-8">
             <div className="bg-white rounded-3xl border border-brand-muted/10 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-brand-muted/10 flex justify-between items-center">
                   <h2 className="text-xl font-bold text-brand-navy flex items-center gap-2">
                     <CalendarIcon className="w-5 h-5 text-emerald-400" />
                     Bookings Database
                   </h2>
                </div>
                <div className="overflow-x-auto">
                   <table className="w-full text-left text-sm">
                      <thead className="bg-brand-bg/50 text-brand-muted uppercase text-[10px] font-bold tracking-widest">
                         <tr>
                            <th className="px-6 py-4">Booking ID</th>
                            <th className="px-6 py-4">Guest</th>
                            <th className="px-6 py-4">Property</th>
                            <th className="px-6 py-4">Source</th>
                            <th className="px-6 py-4">Stay Period</th>
                            <th className="px-6 py-4 text-center">Nights</th>
                            <th className="px-6 py-4 text-right">Revenue</th>
                            <th className="px-6 py-4 text-center">Status</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-muted/10">
                         {activeBookings.length > 0 ? activeBookings.map((b, bIdx) => {
                           const checkInMonth = new Date(b.checkInDate).getMonth();
                           const checkOutMonth = new Date(b.checkOutDate).getMonth();
                           const isOverlappingMonth = checkInMonth !== selectedMonth || checkOutMonth !== selectedMonth;

                           return (
                             <tr 
                               key={b.id + '-' + b.source + '-' + bIdx} 
                               className={`transition-colors cursor-pointer ${isOverlappingMonth ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-brand-bg/30'}`} 
                               onClick={() => setSelectedBooking(b)}
                             >
                               <td className="px-6 py-4 font-mono text-xs">{b.id}</td>
                               <td className="px-6 py-4 font-bold text-brand-navy">{b.guest.name}</td>
                               <td className="px-6 py-4 text-brand-muted">{b.listingId}</td>
                               <td className="px-6 py-4 text-brand-muted">{b.source}</td>
                               <td className="px-6 py-4 whitespace-nowrap text-brand-muted">
                                 {new Date(b.checkInDate).toLocaleDateString()} - {new Date(b.checkOutDate).toLocaleDateString()}
                               </td>
                               <td className="px-6 py-4 text-center text-brand-muted">{b.nights}</td>
                               <td className="px-6 py-4 text-right font-bold text-brand-navy whitespace-nowrap">
                                 {b.isFromApi ? (
                                   <span className="text-brand-muted font-normal">-</span>
                                 ) : (
                                   formatCurrency(convertLocalValue(b.financials.accommodationFare, 'IDR', currency), currency)
                                 )}
                               </td>
                               <td className="px-6 py-4 text-center">
                                  <span className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-widest ${
                                    b.isFromApi && (b.status === 'confirmed' || b.status === 'completed')
                                      ? 'bg-yellow-100 text-yellow-800 border border-yellow-300 font-bold'
                                      : b.status === 'completed' || b.status === 'confirmed'
                                        ? 'bg-emerald-400/20 text-emerald-600'
                                        : b.status === 'canceled' || b.status === 'cancelled'
                                          ? 'bg-red-400/20 text-red-600'
                                          : 'bg-indigo-400/20 text-indigo-600'
                                  }`}>
                                    {b.status}
                                  </span>
                               </td>
                             </tr>
                           );
                         }) : (
                           <tr>
                             <td colSpan={8} className="px-6 py-12 text-center text-brand-muted">No bookings found for the selected period.</td>
                           </tr>
                         )}
                      </tbody>
                   </table>
                </div>
             </div>
          </div>
        )}

        {activeMenu === 'expenses' && (
          <div className="flex-1 w-full max-w-[1552px] mx-auto px-4 sm:px-8 py-8 space-y-6">
            {/* KPI GRID */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'OTA/Agent Commissions', value: kpis.feeTotal, icon: CreditCard, trend: 'Commissions', color: 'text-orange-500' },
                { label: 'Property Management Fee', value: kpis.pmFee, icon: Building, trend: 'Management', color: 'text-blue-500' },
                { label: 'Taxes', value: kpis.tax, icon: Receipt, trend: 'Taxes', color: 'text-red-500' },
                { label: 'Operating Expenses', value: kpis.operatingExpenses, icon: Wrench, trend: 'Operations', color: 'text-gray-500' },
              ].map((item, idx) => (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  key={item.label} 
                  className="bg-white p-6 rounded-2xl shadow-sm border border-brand-muted/10 group hover:shadow-lg transition-all flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-brand-muted">{item.label}</span>
                    <item.icon className={`w-5 h-5 ${item.color}`} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-2xl font-bold text-brand-navy">
                      {typeof item.value === 'string' ? item.value : formatCurrency(convertLocalValue(item.value, 'IDR', currency), currency)}
                    </span>
                    <span className="text-xs text-brand-muted mt-1">{item.trend}</span>
                  </div>
                </motion.div>
              ))}
            </section>
             <div className="bg-white rounded-3xl border border-brand-muted/10 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-brand-muted/10 flex justify-between items-center">
                   <h2 className="text-xl font-bold text-brand-navy flex items-center gap-2">
                     <CreditCard className="w-5 h-5 text-red-400" />
                     Operating Expenses
                   </h2>
                </div>
                <div className="overflow-x-auto">
                   <table className="w-full text-left text-sm">
                      <thead className="bg-brand-bg/50 text-brand-muted uppercase text-[10px] font-bold tracking-widest">
                         <tr>
                            <th className="px-6 py-4">Month</th>
                            <th className="px-6 py-4">Property</th>
                            <th className="px-6 py-4">Category</th>
                            <th className="px-6 py-4">Subcategory</th>
                            <th className="px-6 py-4 text-right">Amount</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-muted/10">
                         {expenseGroups.length > 0 ? (
                           <>
                             {expenseGroups.map((g, idx) => (
                               <React.Fragment key={`cat-${idx}`}>
                                 <tr className="bg-brand-bg/10 hover:bg-brand-bg/20 transition-colors">
                                   <td className="px-6 py-4 text-brand-muted">{g.month} {selectedYear}</td>
                                   <td className="px-6 py-4 text-brand-navy font-bold">{g.property}</td>
                                   <td className="px-6 py-4">
                                     <span className="px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-widest bg-brand-navy text-white">
                                       {g.category}
                                     </span>
                                   </td>
                                   <td className="px-6 py-4 text-brand-muted">-</td>
                                   <td className="px-6 py-4 text-right font-bold text-red-600">
                                     - {formatCurrency(convertLocalValue(g.amount, 'IDR', currency), currency)}
                                   </td>
                                 </tr>
                                 {g.subcategories.map((sub, sIdx) => (
                                   <tr key={`sub-${idx}-${sIdx}`} className="hover:bg-brand-bg/30 transition-colors">
                                     <td className="px-6 py-4 text-brand-muted"></td>
                                     <td className="px-6 py-4 text-brand-muted"></td>
                                     <td className="px-6 py-4 text-brand-muted"></td>
                                     <td className="px-6 py-4 text-brand-navy">{sub.subcategory}</td>
                                     <td className="px-6 py-4 text-right text-brand-muted">
                                       - {formatCurrency(convertLocalValue(sub.amount, 'IDR', currency), currency)}
                                     </td>
                                   </tr>
                                 ))}
                               </React.Fragment>
                             ))}
                             <tr className="bg-brand-bg/30 border-t-2 border-brand-muted/20">
                               <td colSpan={4} className="px-6 py-4 text-right font-bold text-brand-navy uppercase tracking-widest text-xs">Total Expenses</td>
                               <td className="px-6 py-4 text-right font-bold text-red-600">
                                 - {formatCurrency(convertLocalValue(expenseGroups.reduce((acc, g) => acc + g.amount, 0), 'IDR', currency), currency)}
                               </td>
                             </tr>
                           </>
                         ) : (
                           <tr>
                             <td colSpan={5} className="px-6 py-12 text-center text-brand-muted">No expenses found for the selected period.</td>
                           </tr>
                         )}
                      </tbody>
                   </table>
                </div>
             </div>
          </div>
        )}

        {activeMenu === 'profile' && (
          <div className="flex-1 w-full max-w-[1552px] mx-auto px-4 sm:px-8 py-8 space-y-8 animate-fade-in">
            {/* Header with actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-3xl border border-brand-muted/10 shadow-sm">
              <div>
                <h1 className="text-2xl font-bold text-brand-navy">Investor Profile</h1>
                <p className="text-sm text-brand-muted">Please contact our Sales Support Team if you need to update your profile details.</p>
              </div>
              <div className="flex items-center gap-3">
                {isEditingProfile && (
                  <>
                    <button 
                      onClick={() => setIsEditingProfile(false)}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold text-brand-navy bg-brand-navy/5 hover:bg-brand-navy/10 transition-colors"
                      disabled={isSavingProfile}
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleSaveProfile}
                      disabled={isSavingProfile}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-brand-navy hover:opacity-90 transition-opacity flex items-center gap-2 shadow-lg shadow-brand-navy/20 disabled:opacity-50"
                    >
                      {isSavingProfile ? (
                        <>
                          <RefreshCcw className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Changes
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Notification Banner */}
            {profileMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-2xl flex items-start gap-3 border ${
                  profileMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {profileMessage.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="text-sm font-semibold">{profileMessage.text}</p>
                  {profileMessage.type === 'success' && (
                    <p className="text-xs opacity-85 mt-1">Your new details are now saved. They will be reflected across your statements and reports automatically.</p>
                  )}
                </div>
              </motion.div>
            )}

            {/* Bank Transfer Details — full width, above Personal Profile */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-6 sm:p-8 rounded-3xl border border-brand-muted/10 shadow-sm"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-brand-navy">Bank Transfer Details</h2>
                  <p className="text-xs text-brand-muted">Used for automatic monthly payouts</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                <div>
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Bank Name</span>
                  {isEditingProfile ? (
                    <input
                      type="text"
                      value={profileForm.bankName}
                      onChange={(e) => setProfileForm({ ...profileForm, bankName: e.target.value })}
                      className="w-full mt-1 bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-brand-navy mt-1">{user?.bankName || 'N/A'}</p>
                  )}
                </div>
                <div>
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Account Number</span>
                  {isEditingProfile ? (
                    <input
                      type="text"
                      value={profileForm.accountNumber}
                      onChange={(e) => setProfileForm({ ...profileForm, accountNumber: e.target.value })}
                      className="w-full mt-1 bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    />
                  ) : (
                    <p className="text-sm font-mono font-bold text-brand-navy mt-1">{user?.accountNumber || 'N/A'}</p>
                  )}
                </div>
                <div>
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Beneficiary Name</span>
                  {isEditingProfile ? (
                    <input
                      type="text"
                      value={profileForm.beneficiaryName}
                      onChange={(e) => setProfileForm({ ...profileForm, beneficiaryName: e.target.value })}
                      className="w-full mt-1 bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-brand-navy mt-1">{user?.beneficiaryName || 'N/A'}</p>
                  )}
                </div>
                <div>
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Swift Code / Routing</span>
                  {isEditingProfile ? (
                    <input
                      type="text"
                      value={profileForm.swift}
                      onChange={(e) => setProfileForm({ ...profileForm, swift: e.target.value })}
                      className="w-full mt-1 bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    />
                  ) : (
                    <p className="text-sm font-mono font-bold text-brand-navy mt-1">{user?.swift || 'N/A'}</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Beneficiary Country</span>
                  {isEditingProfile ? (
                    <input
                      type="text"
                      value={profileForm.country}
                      onChange={(e) => setProfileForm({ ...profileForm, country: e.target.value })}
                      className="w-full mt-1 bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-brand-navy mt-1">{user?.country || 'N/A'}</p>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Personal Profile — full width */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-6 sm:p-8 rounded-3xl border border-brand-muted/10 shadow-sm"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-brand-navy/10 rounded-2xl flex items-center justify-center text-brand-navy">
                  <UserCircle className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-brand-navy">Personal Profile</h2>
                  <p className="text-xs text-brand-muted">Your registered identity details</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                <div>
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Investor Name</span>
                  {isEditingProfile ? (
                    <input
                      type="text"
                      value={profileForm.investorName}
                      onChange={(e) => setProfileForm({ ...profileForm, investorName: e.target.value })}
                      className="w-full mt-1 bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-brand-navy mt-1">{user?.investorName || user?.username || 'N/A'}</p>
                  )}
                </div>
                <div>
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Investor Code (Read-only)</span>
                  <p className="text-sm font-mono font-bold text-indigo-600 mt-1">{user?.code || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Contact Email</span>
                  {isEditingProfile ? (
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                      className="w-full mt-1 bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-brand-navy mt-1">{user?.email || 'N/A'}</p>
                  )}
                </div>
                <div>
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Contact Number</span>
                  {isEditingProfile ? (
                    <input
                      type="text"
                      value={profileForm.phone}
                      onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                      className="w-full mt-1 bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-brand-navy mt-1">{user?.phone || 'N/A'}</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <span className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">Preferred Payout Currency</span>
                  {isEditingProfile ? (
                    <select
                      value={profileForm.payoutCurrency}
                      onChange={(e) => setProfileForm({ ...profileForm, payoutCurrency: e.target.value as Currency })}
                      className="w-full mt-1 max-w-xs bg-brand-bg border border-brand-muted/20 px-3 py-2 rounded-xl text-sm font-semibold text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/10"
                    >
                      <option value="IDR">IDR</option>
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                      <option value="USDT">USDT</option>
                    </select>
                  ) : (
                    <p className="text-sm font-bold text-emerald-600 mt-1">{user?.payoutCurrency || 'IDR'}</p>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-brand-muted/10 bg-brand-bg/60 px-4 sm:px-5 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-white border border-brand-muted/10 flex items-center justify-center shrink-0">
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        <path fill="none" d="M0 0h48v48H0z"></path>
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-brand-navy">EVDEKIMI Google Login</span>
                      {linkedGoogleEmail ? (
                        <div className="flex items-center gap-1.5 mt-1 text-xs font-semibold text-emerald-600">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="truncate">Already connected: {linkedGoogleEmail}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-brand-muted mt-1">
                          Connect Google to sign in to EVDEKIMI without your legacy password.
                        </p>
                      )}
                      {googleLinkNeedsReauth && (
                        <p className="text-xs text-amber-700 mt-2">
                          Sign out and sign in again, then connect Google. Linking requires a fresh EVDEKIMI session.
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={linkedGoogleEmail ? () => setConfirmReconnect(true) : handleConnectGoogleAccount}
                    disabled={linkedGoogleEmail ? isUnlinkingGoogle : isLinkingGoogle}
                    className="flex items-center justify-center gap-2 text-xs font-bold px-4 py-2.5 bg-white hover:bg-brand-muted/10 text-brand-navy border border-brand-muted/20 rounded-xl transition-all active:scale-95 cursor-pointer shadow-sm shrink-0 disabled:opacity-50"
                  >
                    <span>
                      {linkedGoogleEmail
                        ? (isUnlinkingGoogle ? 'Disconnecting...' : 'Disconnect Google')
                        : (isLinkingGoogle ? 'Connecting...' : 'Connect Google')}
                    </span>
                  </button>
                </div>
              </div>
            </motion.div>

            <PropertyListings investorListings={investorListings} />

          </div>
        )}

        {activeMenu === 'cockpit' && user?.isPlatformAdmin && (
          <div className="flex-1 w-full max-w-[1552px] mx-auto px-4 sm:px-8 py-8 space-y-6 animate-fade-in">
            <div>
              <h1 className="text-2xl font-bold text-brand-navy">Management Cockpit</h1>
              <p className="text-sm text-brand-muted">What needs a decision this month — not another 20 charts.</p>
            </div>
            <Cockpit
              villas={villasList}
              summaries={summaries}
              bookings={bookings}
              allListings={allListings}
              month={selectedMonth}
              year={selectedYear}
              currency={currency}
            />
          </div>
        )}

        {activeMenu === 'accounting' && user?.isPlatformAdmin && (
          <div className="flex-1 w-full max-w-[1552px] mx-auto px-4 sm:px-8 py-8 space-y-6 animate-fade-in">
            <div>
              <h1 className="text-2xl font-bold text-brand-navy">Accounting</h1>
              <p className="text-sm text-brand-muted">The whole workbook, in the app — load, review, edit, export.</p>
            </div>
            <Accounting />
          </div>
        )}

      </main>
      </div>

      {/* FOOTER */}
      <footer className="px-8 py-10 border-t border-brand-muted/10 bg-white flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-6">
           <div className="text-[10px] text-brand-muted uppercase font-bold tracking-widest leading-loose">
             © 2026 EVDEkimi Real Estates Bali<br/>
             Property Management • Alpha Release v0.4.1
           </div>
        </div>
      </footer>

      {/* DETAIL MODAL */}
      <AnimatePresence>
        {selectedBooking && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-navy/60 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="bg-brand-navy p-6 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center">
                     <AlertCircle className="w-5 h-5 text-indigo-300" />
                  </div>
                  <div>
                    <h3 className="font-bold">Reservation Details</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] uppercase font-bold tracking-widest opacity-50">{selectedBooking.id}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold tracking-wider ${
                        selectedBooking.isFromApi && (selectedBooking.status === 'confirmed' || selectedBooking.status === 'completed')
                          ? 'bg-yellow-300 text-yellow-950 font-bold'
                          : selectedBooking.status === 'completed' || selectedBooking.status === 'confirmed'
                            ? 'bg-emerald-400/30 text-emerald-300'
                            : selectedBooking.status === 'canceled' || selectedBooking.status === 'cancelled'
                              ? 'bg-red-400/30 text-red-300'
                              : 'bg-indigo-400/30 text-indigo-200'
                      }`}>
                        {selectedBooking.status}
                      </span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedBooking(null)} className="hover:rotate-90 transition-transform">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-brand-bg rounded-xl">
                    <span className="block text-[10px] uppercase font-bold text-brand-muted mb-1">Guest Name</span>
                    <span className="font-bold text-brand-navy">{selectedBooking.guest.name}</span>
                  </div>
                  <div className="p-4 bg-brand-bg rounded-xl">
                    <span className="block text-[10px] uppercase font-bold text-brand-muted mb-1">Nationality</span>
                    <span className="font-bold text-brand-navy">{selectedBooking.guest.nationality}</span>
                  </div>
                  <div className="p-4 bg-brand-bg rounded-xl">
                    <span className="block text-[10px] uppercase font-bold text-brand-muted mb-1">Check-in</span>
                    <span className="font-bold text-brand-navy">{new Date(selectedBooking.checkInDate).toLocaleDateString()}</span>
                  </div>
                  <div className="p-4 bg-brand-bg rounded-xl">
                    <span className="block text-[10px] uppercase font-bold text-brand-muted mb-1">Check-out</span>
                    <span className="font-bold text-brand-navy">{new Date(selectedBooking.checkOutDate).toLocaleDateString()}</span>
                  </div>
                  <div className="p-4 bg-brand-bg rounded-xl">
                    <span className="block text-[10px] uppercase font-bold text-brand-muted mb-1">Source</span>
                    <span className="font-bold text-brand-navy">{selectedBooking.source}</span>
                  </div>
                  <div className="p-4 bg-brand-bg rounded-xl">
                    <span className="block text-[10px] uppercase font-bold text-brand-muted mb-1">Nights</span>
                    <span className="font-bold text-brand-navy">{selectedBooking.nights}</span>
                  </div>
                </div>

                <div className="space-y-3">
                   <h4 className="text-[10px] uppercase font-bold text-brand-muted tracking-widest">Financial Breakdown</h4>
                   <div className="divide-y divide-brand-muted/10 border-t border-b border-brand-muted/10">
                      {[
                        { 
                          l: 'Accommodation Fare', 
                          v: selectedBooking.isFromApi ? '-' : formatCurrency(convertLocalValue(selectedBooking.financials.accommodationFare, 'IDR', currency), currency) 
                        },
                        { 
                          l: 'OTA Commission', 
                          v: selectedBooking.isFromApi ? '-' : formatCurrency(convertLocalValue(-selectedBooking.financials.otaCommission, 'IDR', currency), currency) 
                        },
                      ].map(row => (
                        <div key={row.l} className="flex justify-between py-3 text-sm">
                           <span className="text-brand-muted font-normal">{row.l}</span>
                           <span className={`font-bold ${row.v === '-' ? 'text-brand-muted font-normal' : 'text-brand-navy'}`}>{row.v}</span>
                        </div>
                      ))}
                   </div>
                </div>

                <button 
                  onClick={() => setSelectedBooking(null)}
                  className="w-full py-4 bg-brand-navy text-white rounded-xl font-bold shadow-lg hover:shadow-indigo-500/20 transition-all"
                >
                  Close Inquiry
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmReconnect && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-navy/60 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-brand-muted/10">
                <h3 className="text-lg font-bold text-brand-navy">Disconnect Google Account?</h3>
                <p className="text-sm text-brand-muted mt-2">
                  Your Google account will be unlinked from this Legacy account. You will be returned to the login page.
                </p>
                {linkedGoogleEmail && (
                  <p className="text-xs text-brand-muted mt-3 font-mono">{linkedGoogleEmail}</p>
                )}
              </div>
              <div className="p-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmReconnect(false)}
                  disabled={isUnlinkingGoogle}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-brand-navy border border-brand-muted/20 hover:bg-brand-bg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectGoogleAccount}
                  disabled={isUnlinkingGoogle}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {isUnlinkingGoogle ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WHATSAPP CHATBOT COMPONENT */}
      <ChatBox />
    </div>
  );
}

