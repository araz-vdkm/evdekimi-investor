import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { parse } from 'csv-parse/sync';
import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import crypto from 'crypto';
import { initializeApp as initializeAdminApp, cert, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { findVillasForInvestorCode, villasToLegacyRawObjects } from './src/lib/villaSheet';
const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));






const DB_PATH = path.join(process.cwd(), 'data', 'google-mappings.json');
const BOOKINGS_DB_PATH = path.join(process.cwd(), 'data', 'evdekimi-bookings.json');

async function syncEvdekimiBookings() {
  console.log('Starting scheduled Evdekimi API sync...');
  try {
    const apiKey = process.env.EVDEKIMI_API_KEY;
    if (!apiKey) {
      console.warn('No Evdekimi API key available, skipping sync.');
      return;
    }
    
    // Fetch a generous range: 6 months past, 1 year future
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    
    const fromDateObj = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const toDateObj = new Date(now.getFullYear(), now.getMonth() + 4, 0);
    
    const fromDate = `${fromDateObj.getFullYear()}-${pad(fromDateObj.getMonth() + 1)}-01`;
    const toDate = `${toDateObj.getFullYear()}-${pad(toDateObj.getMonth() + 1)}-${pad(toDateObj.getDate())}`;

    const url = `https://evdekimi.hospara.workers.dev/v1/reservations?from=${fromDate}&to=${toDate}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('Invalid JSON from Evdekimi API during sync:', text.substring(0, 100));
      return;
    }

    if (!response.ok) {
      console.error('Evdekimi API sync failed:', data.error || 'Unknown error');
      return;
    }
    
    if (!fs.existsSync(path.dirname(BOOKINGS_DB_PATH))) {
      fs.mkdirSync(path.dirname(BOOKINGS_DB_PATH), { recursive: true });
    }
    
    fs.writeFileSync(BOOKINGS_DB_PATH, JSON.stringify({
      lastUpdated: new Date().toISOString(),
      data: data
    }, null, 2));
    
    console.log(`Evdekimi API sync complete. Saved ${Array.isArray(data?.reservations) ? data.reservations.length : (Array.isArray(data) ? data.length : 'data')} reservations.`);
  } catch (err) {
    console.error('Error during scheduled Evdekimi API sync:', err);
  }
}

// Initial sync
setTimeout(syncEvdekimiBookings, 1000);
// Every 2 hours
setInterval(syncEvdekimiBookings, 2 * 60 * 60 * 1000);

if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({}));
}

function getInternalDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function saveToInternalDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}


function formatPrivateKey(key: string | undefined): string {
  if (!key) return '';
  let parsed = key.replace(/^"|"$/g, '');
  return parsed.replace(/\\n/g, '\n');
}

const SESSION_COOKIE = 'evdekimi_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return crypto.createHash('sha256').update(String(process.env.GOOGLE_PRIVATE_KEY || 'evdekimi-local-session')).digest('hex');
}

function signSession(payload: { username: string; investorCode: string; isAdmin: boolean; isPlatformAdmin?: boolean; googleEmail?: string }) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + SESSION_MAX_AGE_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token?: string) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data || data.exp < Date.now()) return null;
    return data as { username: string; investorCode: string; isAdmin: boolean; isPlatformAdmin?: boolean; googleEmail?: string; exp: number };
  } catch {
    return null;
  }
}

function parseCookies(req: express.Request): Record<string, string> {
  const header = String(req.headers.cookie || '');
  const out: Record<string, string> = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  });
  return out;
}

function getRequestSession(req: express.Request) {
  return verifySession(parseCookies(req)[SESSION_COOKIE]);
}

function sessionCookieSuffix(req?: express.Request) {
  const secure = !!(req && (req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')));
  return `HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;
}

function setSessionCookie(res: express.Response, payload: { username: string; investorCode: string; isAdmin: boolean; isPlatformAdmin?: boolean; googleEmail?: string }, req?: express.Request) {
  const token = signSession(payload);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${sessionCookieSuffix(req)}; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`);
}

function clearSessionCookie(res: express.Response, req?: express.Request) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${sessionCookieSuffix(req)}; Max-Age=0`);
}

function getAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  if (!clientEmail || !privateKey.includes('PRIVATE KEY')) {
    throw new Error('Server Firebase credentials are not configured');
  }
  return initializeAdminApp({
    credential: cert({
      projectId: firebaseConfig.projectId,
      clientEmail,
      privateKey,
    }),
  });
}

function getAdminDb() {
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  return getAdminFirestore(getAdminApp(), dbId);
}

function getAccountLinksCollection() {
  return getAdminDb().collection('account_links');
}

function firestoreAccountLinksUrl(docId?: string) {
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${dbId}/documents/account_links`;
  return docId ? `${base}/${encodeURIComponent(docId)}` : base;
}

async function getDatastoreAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  if (!email || !privateKey.includes('PRIVATE KEY')) {
    throw new Error('Server Firebase credentials are not configured');
  }
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/datastore'],
  });
  const tokenResponse = await auth.getAccessToken();
  const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (!accessToken) throw new Error('Failed to authorize Firestore access');
  return accessToken;
}

function parseFirestoreFields(fields: any = {}) {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    const v: any = value;
    if (v?.stringValue != null) out[key] = v.stringValue;
    else if (v?.integerValue != null) out[key] = v.integerValue;
    else if (v?.nullValue !== undefined) out[key] = null;
    else if (v?.booleanValue != null) out[key] = v.booleanValue;
  }
  return out;
}

function toFirestoreFields(data: Record<string, any>) {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null) fields[key] = { nullValue: null };
    else fields[key] = { stringValue: String(value) };
  }
  return fields;
}

async function verifyFirebaseIdToken(idToken: string): Promise<{ email: string; uid: string }> {
  if (!idToken) {
    const err: any = new Error('Missing Firebase ID token');
    err.status = 401;
    throw err;
  }
  try {
    const decoded = await getAdminAuth(getAdminApp()).verifyIdToken(idToken);
    if (!decoded.email) {
      const err: any = new Error('Google account has no email');
      err.status = 400;
      throw err;
    }
    return { email: decoded.email.toLowerCase().trim(), uid: decoded.uid };
  } catch (adminErr: any) {
    if (adminErr.status) throw adminErr;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    const email = data?.users?.[0]?.email;
    const uid = data?.users?.[0]?.localId;
    if (!res.ok || !email) {
      const err: any = new Error(adminErr?.message || 'Invalid or expired Google sign-in');
      err.status = 401;
      throw err;
    }
    return { email: String(email).toLowerCase().trim(), uid: String(uid || '') };
  }
}

function normalizeInvestorCode(value?: string) {
  return String(value ?? '').trim().toUpperCase();
}

function expandInvestorCodes(value?: string) {
  return String(value || '')
    .split(',')
    .map((s) => normalizeInvestorCode(s))
    .filter(Boolean);
}

function canonicalInvestorCodeString(value?: string) {
  return expandInvestorCodes(value).join(', ');
}

function investorCodesOverlap(a?: string, b?: string) {
  const left = expandInvestorCodes(a);
  const right = expandInvestorCodes(b);
  return left.some((code) => right.includes(code));
}

function hasFirebaseCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  return !!(email && privateKey.includes('PRIVATE KEY'));
}

function normalizeSheetHeader(value?: string) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanInvestorSheetValue(value?: string) {
  const text = String(value ?? '').trim();
  return text === '#N/A' ? '' : text;
}

/** CSV export appends Russian descriptions to headers (e.g. "Investor Code Уникальный…"). */
function investorHeaderMatches(header: string, label: string) {
  return header === label || header.startsWith(`${label} `);
}

function findInvestorSheetHeaderRowIndex(rows: any[][]) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.some((cell) => investorHeaderMatches(normalizeSheetHeader(cell), 'investor code'))) {
      return i;
    }
  }
  return -1;
}

function isLikelyInvestorCode(value?: string) {
  const parts = expandInvestorCodes(value);
  if (parts.length === 0) return false;
  return parts.every((code) => /^[A-Z0-9]{2,20}$/.test(code));
}

function isLikelyInvestorRow(row: any[], opts: { codeIdx: number; idIdx: number }) {
  const investorCode = String(row[opts.codeIdx] || '').trim();
  if (!isLikelyInvestorCode(investorCode)) return false;
  if (opts.idIdx !== -1) {
    const investorId = String(row[opts.idIdx] || '').trim();
    if (investorId && !/^\d+$/.test(investorId)) return false;
  }
  return true;
}

type InvestorSheetLayout = {
  headerRowIdx: number;
  idIdx: number;
  nameIdx: number;
  codeIdx: number;
  userIdx: number;
  passIdx: number;
  roleIdx: number;
  emailIdx: number;
  phoneIdx: number;
  currencyIdx: number;
  bankIdx: number;
  acctIdx: number;
  benefIdx: number;
  swiftIdx: number;
  countryIdx: number;
};

type ParsedInvestorRecord = {
  investorId: string;
  investorName: string;
  investorCode: string;
  legacyUsername: string;
  email: string;
  phone: string;
  payoutCurrency: string;
  bankName: string;
  accountNumber: string;
  beneficiaryName: string;
  swift: string;
  country: string;
  sheetRowIndex: number;
};

function resolveInvestorSheetLayout(rows: any[][]): InvestorSheetLayout | null {
  if (!rows || rows.length < 2) return null;
  const headerRowIdx = findInvestorSheetHeaderRowIndex(rows);
  if (headerRowIdx < 0) return null;

  const headers = (rows[headerRowIdx] || []).map(normalizeSheetHeader);
  const codeIdx = headers.findIndex((h) => investorHeaderMatches(h, 'investor code'));
  if (codeIdx === -1) return null;

  const findIdx = (pred: (h: string) => boolean, fallback = -1) => {
    const idx = headers.findIndex(pred);
    return idx !== -1 ? idx : fallback;
  };

  return {
    headerRowIdx,
    idIdx: findIdx((h) => investorHeaderMatches(h, 'investor id')),
    nameIdx: findIdx((h) => investorHeaderMatches(h, 'investor name')),
    codeIdx,
    userIdx: findIdx(
      (h) => investorHeaderMatches(h, 'user name') || h === 'username',
      findIdx((h) => h.includes('user'), 3)
    ),
    passIdx: findIdx((h) => h.includes('pass'), 4),
    roleIdx: findIdx((h) => h.includes('role') || h.includes('admin')),
    emailIdx: findIdx(
      (h) => investorHeaderMatches(h, 'contact email') || h.includes('contact email') || h.includes('email')
    ),
    phoneIdx: findIdx(
      (h) => investorHeaderMatches(h, 'contact number') || h.includes('contact number') || h.includes('phone')
    ),
    currencyIdx: findIdx(
      (h) =>
        investorHeaderMatches(h, 'payout currency') ||
        h.includes('payout currency') ||
        (h.includes('currency') && !h.includes('contact'))
    ),
    bankIdx: findIdx((h) => h.includes('bank name')),
    acctIdx: findIdx((h) => h.includes('account number')),
    benefIdx: findIdx((h) => h.includes('beneficiary name')),
    swiftIdx: findIdx((h) => h.includes('swift')),
    countryIdx: findIdx((h) => h.includes('country')),
  };
}

function mapInvestorRow(row: any[], layout: InvestorSheetLayout, sheetRowIndex: number): ParsedInvestorRecord | null {
  if (!isLikelyInvestorRow(row, { codeIdx: layout.codeIdx, idIdx: layout.idIdx })) {
    return null;
  }
  const get = (idx: number) => (idx !== -1 ? cleanInvestorSheetValue(row[idx]) : '');
  return {
    investorId: get(layout.idIdx),
    investorName: get(layout.nameIdx),
    investorCode: get(layout.codeIdx),
    legacyUsername: get(layout.userIdx),
    email: get(layout.emailIdx),
    phone: get(layout.phoneIdx),
    payoutCurrency: get(layout.currencyIdx) || 'IDR',
    bankName: get(layout.bankIdx),
    accountNumber: get(layout.acctIdx),
    beneficiaryName: get(layout.benefIdx),
    swift: get(layout.swiftIdx),
    country: get(layout.countryIdx),
    sheetRowIndex,
  };
}

function iterateInvestorSheetRows(rows: any[][], layout: InvestorSheetLayout) {
  const items: Array<{ row: any[]; index: number }> = [];
  for (let i = layout.headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (mapInvestorRow(row, layout, i)) {
      items.push({ row, index: i });
    }
  }
  return items;
}

function parseAllInvestorRecords(rows: any[][]) {
  const layout = resolveInvestorSheetLayout(rows);
  if (!layout) return [];
  return iterateInvestorSheetRows(rows, layout)
    .map(({ row, index }) => mapInvestorRow(row, layout, index)!)
    .filter(Boolean);
}

function parseInvestorSheetRows(rows: any[][]) {
  return parseAllInvestorRecords(rows).map((inv) => ({
    investorName: inv.investorName,
    investorCode: inv.investorCode,
    legacyUsername: inv.legacyUsername,
  }));
}

function findInvestorByUsernamePassword(rows: any[][], username: string, password: string) {
  const layout = resolveInvestorSheetLayout(rows);
  if (!layout) return null;
  for (const { row, index } of iterateInvestorSheetRows(rows, layout)) {
    const userField = layout.userIdx !== -1 ? String(row[layout.userIdx] || '').trim() : '';
    const passField = layout.passIdx !== -1 ? String(row[layout.passIdx] || '') : '';
    const codeField = layout.codeIdx !== -1 ? String(row[layout.codeIdx] || '').trim() : '';
    const codeParts = codeField ? codeField.split(',').map((c) => c.trim()) : [];
    const matchUser = userField === username || codeParts.includes(username);
    if (matchUser && passField === password) {
      return mapInvestorRow(row, layout, index);
    }
  }
  return null;
}

function findInvestorByLegacyCredentials(rows: any[][], investorCode: string, legacyPassword: string) {
  const layout = resolveInvestorSheetLayout(rows);
  if (!layout) return null;
  for (const { row, index } of iterateInvestorSheetRows(rows, layout)) {
    const userField = layout.userIdx !== -1 ? String(row[layout.userIdx] || '').trim() : '';
    const passField = layout.passIdx !== -1 ? String(row[layout.passIdx] || '') : '';
    const codeField = layout.codeIdx !== -1 ? String(row[layout.codeIdx] || '').trim() : '';
    const matchesCode =
      (codeField && investorCodesOverlap(codeField, investorCode)) ||
      userField === investorCode;
    if (matchesCode && passField === legacyPassword) {
      return mapInvestorRow(row, layout, index);
    }
  }
  return null;
}

function findInvestorByLinkedCode(rows: any[][], linkedCode: string) {
  const layout = resolveInvestorSheetLayout(rows);
  if (!layout) return null;
  const linkedCodes = expandInvestorCodes(linkedCode);
  for (const { row, index } of iterateInvestorSheetRows(rows, layout)) {
    const investor = mapInvestorRow(row, layout, index);
    if (!investor) continue;
    const sheetCodes = expandInvestorCodes(investor.investorCode);
    if (linkedCodes.some((code) => sheetCodes.includes(code))) return investor;
    if (linkedCodes.includes(normalizeInvestorCode(investor.legacyUsername))) return investor;
  }
  return null;
}

function findInvestorByUsername(rows: any[][], username: string) {
  const layout = resolveInvestorSheetLayout(rows);
  if (!layout) return null;
  for (const { row, index } of iterateInvestorSheetRows(rows, layout)) {
    const userField = layout.userIdx !== -1 ? String(row[layout.userIdx] || '').trim() : '';
    if (userField === username) {
      return mapInvestorRow(row, layout, index);
    }
  }
  return null;
}

function resolveInvestorIsAdmin(
  investor: ParsedInvestorRecord,
  row: any[],
  layout: InvestorSheetLayout,
  opts: { googleEmail?: string; mappingEmail?: string } = {}
) {
  if (layout.roleIdx !== -1 && String(row[layout.roleIdx] || '').toLowerCase() === 'admin') {
    return true;
  }
  const contactEmail = String(opts.mappingEmail || investor.email || '').toLowerCase().trim();
  if (contactEmail === 'roman@evdekimi.com') return true;
  if (String(opts.googleEmail || '').toLowerCase().trim() === 'roman@evdekimi.com') return true;
  if (investor.legacyUsername === 'roman@evdekimi.com') return true;
  if (investor.investorName.toLowerCase().includes('admin')) return true;
  return false;
}

function parsePlatformAdminEmails(): string[] {
  return String(process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const PLATFORM_ADMIN_EMAILS = parsePlatformAdminEmails();

function isPlatformAdminEmail(email?: string | null): boolean {
  const normalized = String(email || '').toLowerCase().trim();
  if (!normalized) return false;
  return PLATFORM_ADMIN_EMAILS.includes(normalized);
}

function buildAuthUserPayload(
  investor: ParsedInvestorRecord,
  opts: { isAdmin: boolean; emailOverride?: string; villas?: any[] }
) {
  return {
    username: investor.legacyUsername,
    isAdmin: opts.isAdmin,
    // Legacy admin/utility accounts often log in with their email *as* the
    // username, with the sheet's separate Email column left blank — so we
    // check legacyUsername too (mirrors resolveInvestorIsAdmin's roman@ check).
    isPlatformAdmin:
      isPlatformAdminEmail(opts.emailOverride || investor.email) ||
      isPlatformAdminEmail(investor.legacyUsername),
    code: investor.investorCode,
    investorName: investor.investorName,
    email: opts.emailOverride || investor.email,
    phone: investor.phone,
    payoutCurrency: investor.payoutCurrency,
    bankName: investor.bankName,
    accountNumber: investor.accountNumber,
    beneficiaryName: investor.beneficiaryName,
    swift: investor.swift,
    country: investor.country,
    villas: opts.villas || [],
  };
}

async function fetchUserVillasForInvestorCode(code: string) {
  if (!code) return [];
  try {
    const villaRows = await fetchSheetCSV('Villas');
    if (!villaRows || villaRows.length === 0) return [];
    const villas = findVillasForInvestorCode(villaRows, code);
    return villasToLegacyRawObjects(villas);
  } catch (e) {
    console.error('Failed to fetch Villas sheet', e);
    return [];
  }
}

type AccountLinkRecord = ReturnType<typeof firestoreLinkToJson>;

function buildLinksByCode(links: AccountLinkRecord[]) {
  const byCode = new Map<string, AccountLinkRecord[]>();
  for (const link of links) {
    for (const code of expandInvestorCodes(link.investorCode)) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code)!.push(link);
    }
  }
  return byCode;
}

function findLinksForInvestor(investorCode: string, linksByCode: Map<string, AccountLinkRecord[]>) {
  const matched: AccountLinkRecord[] = [];
  const seenEmails = new Set<string>();
  for (const code of expandInvestorCodes(investorCode)) {
    for (const link of linksByCode.get(code) || []) {
      const email = String(link.email || '').toLowerCase();
      if (!seenEmails.has(email)) {
        seenEmails.add(email);
        matched.push(link);
      }
    }
  }
  return matched;
}

type AdminMappingUser = {
  investorName: string;
  investorCode: string;
  legacyUsername: string;
  googleAccount: string | null;
  provider: string | null;
  status: 'LINKED' | 'NOT_LINKED' | 'ERROR' | 'MAPPING_INCONSISTENT';
  linkedAt: string | null;
  googleEmail: string | null;
  matchedAccountLinksCount?: number;
  matchedGoogleEmail?: string | null;
};

type OrphanMapping = {
  investorCode: string;
  googleAccount: string;
  provider: string;
  linkedAt: string | null;
  legacyUsername: string | null;
};

function buildAdminAccountMappings(
  investors: ReturnType<typeof parseInvestorSheetRows>,
  links: AccountLinkRecord[],
  firebaseError: string | null
) {
  const linksByCode = buildLinksByCode(links);
  const matchedLinkEmails = new Set<string>();
  const users: AdminMappingUser[] = [];
  const includeDiagnostics = process.env.NODE_ENV !== 'production';

  for (const inv of investors) {
    let status: AdminMappingUser['status'];
    let matchedLinks: AccountLinkRecord[] = [];

    if (firebaseError) {
      status = 'ERROR';
    } else {
      matchedLinks = findLinksForInvestor(inv.investorCode, linksByCode);
      if (matchedLinks.length === 0) status = 'NOT_LINKED';
      else if (matchedLinks.length === 1) status = 'LINKED';
      else status = 'MAPPING_INCONSISTENT';
    }

    const link = matchedLinks[0];
    if (link) matchedLinkEmails.add(String(link.email).toLowerCase());

    const row: AdminMappingUser = {
      investorName: inv.investorName || '—',
      investorCode: inv.investorCode || '—',
      legacyUsername: inv.legacyUsername || '—',
      googleAccount: link?.email || null,
      provider: link ? (link.provider || 'google') : null,
      status,
      linkedAt: link?.createdAt || null,
      googleEmail: link?.email || null,
    };
    if (includeDiagnostics) {
      row.matchedAccountLinksCount = matchedLinks.length;
      row.matchedGoogleEmail = link?.email || null;
    }
    users.push(row);
  }

  const orphanMappings: OrphanMapping[] = [];
  if (!firebaseError) {
    for (const link of links) {
      const email = String(link.email || '').toLowerCase();
      if (matchedLinkEmails.has(email)) continue;
      const hasInvestor = investors.some((inv) => investorCodesOverlap(inv.investorCode, link.investorCode));
      if (!hasInvestor) {
        orphanMappings.push({
          investorCode: link.investorCode || '—',
          googleAccount: link.email,
          provider: link.provider || 'google',
          linkedAt: link.createdAt || null,
          legacyUsername: link.legacyUsername || null,
        });
      }
    }
  }

  const linked = users.filter((u) => u.status === 'LINKED').length;
  const notLinked = users.filter((u) => u.status === 'NOT_LINKED').length;
  const inconsistentInvestors = users.filter((u) => u.status === 'MAPPING_INCONSISTENT').length;

  return {
    users,
    orphanMappings,
    summary: {
      total: investors.length,
      linked,
      notLinked,
      mappingIssues: inconsistentInvestors + orphanMappings.length,
    },
    firebase: {
      configured: hasFirebaseCredentials(),
      error: firebaseError,
    },
    diagnostics: includeDiagnostics
      ? {
          investorsLoaded: investors.length,
          accountLinksLoaded: links.length,
          joinKey: 'investorCode',
          orphanMappingsCount: orphanMappings.length,
        }
      : undefined,
  };
}

async function listAccountLinkDocsSafe(): Promise<{ docs: Array<{ id: string; data: () => any }>; error: string | null }> {
  if (!hasFirebaseCredentials()) {
    return { docs: [], error: 'Server Firebase credentials are not configured' };
  }
  try {
    const docs = await listAccountLinkDocs();
    return { docs, error: null };
  } catch (err: any) {
    return { docs: [], error: err.message || 'Failed to list account links' };
  }
}

function firestoreLinkToJson(docSnap: { id: string; data: () => any }) {
  const data = docSnap.data() || {};
  return {
    email: data.email || docSnap.id,
    provider: data.provider || 'google',
    investorCode: data.investorCode || '',
    createdAt: data.createdAt || null,
    firebaseUid: data.firebaseUid || null,
    legacyUsername: data.legacyUsername || null,
  };
}

const UNLINKED_GOOGLE_MESSAGE = 'This Google account is not linked to an EVDEKIMI account. Please sign in with your existing EVDEKIMI login, then connect Google from your profile.';
const GOOGLE_ALREADY_LINKED_MESSAGE = 'This Google account is already linked to another EVDEKIMI account.';

async function fetchAccountLinkWithBearer(email: string, bearer: string) {
  const response = await fetch(firestoreAccountLinksUrl(email), {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (response.status === 404) return null;
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error?.message || 'Failed to read account link');
  }
  return { id: email, data: () => parseFirestoreFields(json.fields) };
}

async function createAccountLinkWithBearer(email: string, payload: Record<string, any>, bearer: string) {
  const response = await fetch(`${firestoreAccountLinksUrl(email)}?currentDocument.exists=false`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(payload) }),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

async function getAccountLinkDoc(email: string, userIdToken?: string): Promise<{ id: string; data: () => any } | null> {
  try {
    const snap = await getAccountLinksCollection().doc(email).get();
    if (!snap.exists) return null;
    return snap;
  } catch (err: any) {
    console.warn('Admin SDK account_links get failed:', err.message);
  }
  try {
    return await fetchAccountLinkWithBearer(email, await getDatastoreAccessToken());
  } catch (err: any) {
    console.warn('Service-account account_links get failed:', err.message);
  }
  if (userIdToken) {
    return await fetchAccountLinkWithBearer(email, userIdToken);
  }
  throw new Error('Unable to read account_links. Configure GOOGLE_PRIVATE_KEY with Firestore access.');
}

async function listAccountLinkDocs(): Promise<Array<{ id: string; data: () => any }>> {
  try {
    const snap = await getAccountLinksCollection().get();
    return snap.docs;
  } catch (err: any) {
    console.warn('Admin SDK account_links list failed, trying REST:', err.message);
  }
  try {
    const token = await getDatastoreAccessToken();
    const response = await fetch(firestoreAccountLinksUrl(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error?.message || 'Failed to list linked accounts');
    }
    return (json.documents || []).map((doc: any) => {
      const id = decodeURIComponent(String(doc.name || '').split('/').pop() || '');
      const data = parseFirestoreFields(doc.fields);
      return { id, data: () => data };
    });
  } catch (err: any) {
    throw new Error(err.message || 'Failed to list linked accounts. Configure GOOGLE_PRIVATE_KEY with Firestore Datastore access on the named database.');
  }
}

async function createOrKeepAccountLink(opts: {
  googleEmail: string;
  firebaseUid?: string;
  investorCode: string;
  legacyUsername?: string;
  userIdToken?: string;
}) {
  const existing = await getAccountLinkDoc(opts.googleEmail, opts.userIdToken);
  if (existing) {
    const data = existing.data() || {};
    if (investorCodesOverlap(data.investorCode, opts.investorCode) || String(data.investorCode || '') === String(opts.investorCode)) {
      return { alreadyLinked: true, email: opts.googleEmail, investorCode: data.investorCode };
    }
    const conflict: any = new Error(GOOGLE_ALREADY_LINKED_MESSAGE);
    conflict.status = 409;
    throw conflict;
  }

  const payload: Record<string, any> = {
    investorCode: canonicalInvestorCodeString(opts.investorCode),
    email: opts.googleEmail,
    provider: 'google',
    createdAt: new Date().toISOString(),
  };
  if (opts.firebaseUid) payload.firebaseUid = opts.firebaseUid;
  if (opts.legacyUsername) payload.legacyUsername = opts.legacyUsername;

  const handleExistsRace = async () => {
    const raced = await getAccountLinkDoc(opts.googleEmail, opts.userIdToken);
    const data = raced?.data() || {};
    if (investorCodesOverlap(data.investorCode, opts.investorCode) || String(data.investorCode || '') === String(opts.investorCode)) {
      return { alreadyLinked: true, email: opts.googleEmail, investorCode: data.investorCode };
    }
    const conflict: any = new Error(GOOGLE_ALREADY_LINKED_MESSAGE);
    conflict.status = 409;
    throw conflict;
  };

  try {
    await getAccountLinksCollection().doc(opts.googleEmail).create(payload);
    return { alreadyLinked: false, email: opts.googleEmail, investorCode: opts.investorCode };
  } catch (err: any) {
    if (err?.code === 6 || /already exists/i.test(String(err?.message || ''))) {
      return await handleExistsRace();
    }
    console.warn('Admin SDK account_links create failed:', err.message);
  }

  try {
    const result = await createAccountLinkWithBearer(opts.googleEmail, payload, await getDatastoreAccessToken());
    if (result.status === 409 || (result.status === 400 && /ALREADY_EXISTS|FAILED_PRECONDITION|already exists/i.test(JSON.stringify(result.json)))) {
      return await handleExistsRace();
    }
    if (!result.ok) {
      throw new Error(result.json.error?.message || 'Failed to save Google account link');
    }
    return { alreadyLinked: false, email: opts.googleEmail, investorCode: opts.investorCode };
  } catch (err: any) {
    if (err.status === 409) throw err;
    console.warn('Service-account account_links create failed:', err.message);
  }

  if (!opts.userIdToken) {
    throw new Error('Failed to save Google account link. Configure GOOGLE_PRIVATE_KEY with Firestore access.');
  }

  const userResult = await createAccountLinkWithBearer(opts.googleEmail, payload, opts.userIdToken);
  if (userResult.status === 409 || (userResult.status === 400 && /ALREADY_EXISTS|FAILED_PRECONDITION|already exists/i.test(JSON.stringify(userResult.json)))) {
    return await handleExistsRace();
  }
  if (!userResult.ok) {
    throw new Error(userResult.json.error?.message || 'Failed to save Google account link');
  }

  return { alreadyLinked: false, email: opts.googleEmail, investorCode: opts.investorCode };
}

async function deleteAccountLinkDoc(email: string, userIdToken?: string): Promise<{ deleted: boolean }> {
  const normalizedEmail = String(email).toLowerCase().trim();
  try {
    await getAccountLinksCollection().doc(normalizedEmail).delete();
    return { deleted: true };
  } catch (err: any) {
    console.warn('Admin SDK account_links delete failed, trying REST:', err.message);
  }
  try {
    const token = await getDatastoreAccessToken();
    const response = await fetch(firestoreAccountLinksUrl(normalizedEmail), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return { deleted: false };
    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      throw new Error(json.error?.message || 'Failed to unlink Google account');
    }
    return { deleted: true };
  } catch (err: any) {
    if (!userIdToken) throw err;
    console.warn('Service-account account_links delete failed, trying user token:', err.message);
  }
  if (userIdToken) {
    const response = await fetch(firestoreAccountLinksUrl(normalizedEmail), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userIdToken}` },
    });
    if (response.status === 404) return { deleted: false };
    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      throw new Error(json.error?.message || 'Failed to unlink Google account');
    }
    return { deleted: true };
  }
  throw new Error('Failed to unlink Google account. Configure GOOGLE_PRIVATE_KEY with Firestore access or sign in with Google.');
}

function requireSession(req: express.Request, res: express.Response) {
  const session = getRequestSession(req);
  if (!session) {
    res.status(401).json({ error: 'Please sign in again to continue.' });
    return null;
  }
  return session;
}

function requireAdminSession(req: express.Request, res: express.Response) {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!session.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return session;
}

function requirePlatformAdminSession(req: express.Request, res: express.Response) {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!session.isPlatformAdmin) {
    res.status(403).json({ error: 'Platform admin access required' });
    return null;
  }
  return session;
}

const SPREADSHEET_ID = '1uCYeAKqtmWoWkcx5mG_fojXcwcu5hr2ibOB3kllynYA';
const CANONICAL_SHEETS: Record<string, string> = {
  investors: 'Investors',
  villas: 'Villas',
  bookings: 'Bookings',
  summary: 'Summary',
  expenses: 'Expenses',
  currency: 'Currency',
};

function canonicalSheetName(name: string): string {
  return CANONICAL_SHEETS[String(name || '').toLowerCase()] || name;
}

function columnIndexToA1(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function isUsableGoogleAccessToken(token?: string): boolean {
  if (!token) return false;
  if (token === 'mock_token' || token === 'mock_apple_token' || token.startsWith('mock_')) return false;
  return true;
}

async function fetchSheetValues(
  sheetName: string,
  accessToken?: string,
  options: { allowCsvFallback?: boolean } = {}
): Promise<{ values: any[][]; source: 'google_sheets' | 'csv' }> {
  const tab = canonicalSheetName(sheetName);
  const allowCsvFallback = options.allowCsvFallback !== false;
  const token = isUsableGoogleAccessToken(accessToken) ? accessToken : undefined;

  if (token) {
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: token });
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: tab,
      });
      if (response.data.values) {
        return { values: response.data.values, source: 'google_sheets' };
      }
    } catch (err: any) {
      console.warn(`Failed to fetch sheet ${tab} with user OAuth token:`, err.message);
      if (!allowCsvFallback) {
        throw new Error(`Google Sheets API read failed for ${tab}: ${err.message}`);
      }
    }
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (email && privateKey && privateKey.includes('PRIVATE KEY')) {
    try {
      const formattedKey = formatPrivateKey(privateKey);
      const auth = new google.auth.JWT({
        email: email,
        key: formattedKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const sheets = google.sheets({ version: 'v4', auth });
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: tab,
      });
      if (response.data.values) {
        return { values: response.data.values, source: 'google_sheets' };
      }
    } catch (err: any) {
      console.warn(`Failed to fetch sheet ${tab} with service account:`, err.message);
      if (!allowCsvFallback) {
        throw new Error(`Google Sheets API read failed for ${tab}: ${err.message}`);
      }
    }
  }

  if (!allowCsvFallback) {
    throw new Error('Google Sheets API access is required for this request. Sign in with Google and grant spreadsheet access.');
  }

  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${tab}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch sheet ${tab}: ${response.statusText}`);
  }
  const text = await response.text();
  const records = parse(text, {
    skip_empty_lines: true
  });
  return { values: records, source: 'csv' };
}

async function fetchSheetCSV(sheetName: string, accessToken?: string): Promise<any[][]> {
  const result = await fetchSheetValues(sheetName, accessToken, { allowCsvFallback: true });
  return result.values;
}

// ---------------------------------------------------------------------------
// Accounting workbook (admin) — every tab with displayed values AND formulas.
// Stage 1 of replacing Google Sheets: read-only mirror of the whole workbook
// so the Accounting screen can show/edit it locally and export it. Formulas
// need the Sheets API (the public CSV export flattens them), so when only the
// CSV fallback is available we still return values and flag formulas as
// unavailable rather than failing the whole load.
// ---------------------------------------------------------------------------

const ACCOUNTING_TABS = ['Villas', 'Investors', 'Listings', 'Bookings', 'Expenses', 'Summary', 'Currency'] as const;

function getServiceAccountSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKey || !privateKey.includes('PRIVATE KEY')) return null;
  const auth = new google.auth.JWT({
    email,
    key: formatPrivateKey(privateKey),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

interface AccountingTab {
  name: string;
  /** Displayed (formatted) cell values, row-major, ragged rows allowed. */
  values: string[][];
  /** Formula string ("=A1+B1") per cell, or null for non-formula cells. Same
   *  shape as `values`. Empty array when formulas were unavailable. */
  formulas: (string | null)[][];
  /** How many cells in this tab actually carry a formula. Zero is a real and
   *  common answer: a tab whose values arrive via one QUERY/IMPORTRANGE, or
   *  that holds pasted values, has no per-cell formulas to show. */
  formulaCount: number;
  rowCount: number;
  columnCount: number;
}

async function fetchAccountingWorkbook(): Promise<{
  tabs: AccountingTab[];
  formulasAvailable: boolean;
  source: 'google_sheets' | 'csv';
  missingTabs: string[];
}> {
  const sheets = getServiceAccountSheetsClient();

  if (sheets) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' });
    const existing = new Set((meta.data.sheets || []).map((s) => s.properties?.title || ''));
    const present = ACCOUNTING_TABS.filter((t) => existing.has(t));
    const missingTabs = ACCOUNTING_TABS.filter((t) => !existing.has(t));

    const [formatted, formulaRender] = await Promise.all([
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: present.map((t) => `'${t}'`),
        valueRenderOption: 'FORMATTED_VALUE',
      }),
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: present.map((t) => `'${t}'`),
        valueRenderOption: 'FORMULA',
      }),
    ]);

    const tabs: AccountingTab[] = present.map((name, i) => {
      const values = ((formatted.data.valueRanges?.[i]?.values || []) as any[][]).map((r) => r.map((c) => String(c ?? '')));
      const raw = (formulaRender.data.valueRanges?.[i]?.values || []) as any[][];
      const formulas: (string | null)[][] = values.map((row, rIdx) =>
        row.map((_, cIdx) => {
          const cell = raw[rIdx]?.[cIdx];
          return typeof cell === 'string' && cell.startsWith('=') ? cell : null;
        })
      );
      const columnCount = values.reduce((max, r) => Math.max(max, r.length), 0);
      const formulaCount = formulas.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
      return { name, values, formulas, formulaCount, rowCount: values.length, columnCount };
    });

    return { tabs, formulasAvailable: true, source: 'google_sheets', missingTabs };
  }

  // No service account — values only, via the existing CSV fallback.
  const tabs: AccountingTab[] = [];
  const missingTabs: string[] = [];
  for (const name of ACCOUNTING_TABS) {
    try {
      const result = await fetchSheetValues(name, undefined, { allowCsvFallback: true });
      const values = (result.values || []).map((r: any[]) => r.map((c) => String(c ?? '')));
      const columnCount = values.reduce((max: number, r: string[]) => Math.max(max, r.length), 0);
      tabs.push({ name, values, formulas: [], formulaCount: 0, rowCount: values.length, columnCount });
    } catch {
      missingTabs.push(name);
    }
  }
  return { tabs, formulasAvailable: false, source: 'csv', missingTabs };
}

async function updateInvestorRow(username: string, updates: any): Promise<{ success: boolean; message: string; source: 'google_sheets' }> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey || !privateKey.includes('PRIVATE KEY')) {
    throw new Error('Server Google Sheets credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.');
  }

  let sheets;
  try {
    const formattedKey = formatPrivateKey(privateKey);
    const auth = new google.auth.JWT({
      email: email,
      key: formattedKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheets = google.sheets({ version: 'v4', auth });
  } catch (err: any) {
    console.error('Failed to auth with service account:', err.message);
    throw new Error(`Google Sheets authentication failed: ${err.message}`);
  }

  try {
    // 1. Get all values in the 'investors' sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Investors',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      throw new Error('No data found in investors sheet');
    }

    const layout = resolveInvestorSheetLayout(rows);
    if (!layout) {
      throw new Error('Unable to locate Investors sheet header row');
    }

    const rowIndex = rows.findIndex(
      (row, idx) =>
        idx > layout.headerRowIdx &&
        isLikelyInvestorRow(row, { codeIdx: layout.codeIdx, idIdx: layout.idIdx }) &&
        layout.userIdx !== -1 &&
        row[layout.userIdx] === username
    );
    if (rowIndex === -1) {
      throw new Error(`Investor row not found for username: ${username}`);
    }

    const updatedRow = [...rows[rowIndex]];
    const maxIdx = Math.max(
      layout.userIdx,
      layout.nameIdx,
      layout.emailIdx,
      layout.phoneIdx,
      layout.currencyIdx,
      layout.bankIdx,
      layout.acctIdx,
      layout.benefIdx,
      layout.swiftIdx,
      layout.countryIdx
    );
    while (updatedRow.length <= maxIdx) {
      updatedRow.push('');
    }

    if (layout.nameIdx !== -1 && updates.investorName !== undefined) updatedRow[layout.nameIdx] = updates.investorName;
    if (layout.emailIdx !== -1 && updates.email !== undefined) updatedRow[layout.emailIdx] = updates.email;
    if (layout.phoneIdx !== -1 && updates.phone !== undefined) updatedRow[layout.phoneIdx] = updates.phone;
    if (layout.currencyIdx !== -1 && updates.payoutCurrency !== undefined) updatedRow[layout.currencyIdx] = updates.payoutCurrency;
    if (layout.bankIdx !== -1 && updates.bankName !== undefined) updatedRow[layout.bankIdx] = updates.bankName;
    if (layout.acctIdx !== -1 && updates.accountNumber !== undefined) updatedRow[layout.acctIdx] = updates.accountNumber;
    if (layout.benefIdx !== -1 && updates.beneficiaryName !== undefined) updatedRow[layout.benefIdx] = updates.beneficiaryName;
    if (layout.swiftIdx !== -1 && updates.swift !== undefined) updatedRow[layout.swiftIdx] = updates.swift;
    if (layout.countryIdx !== -1 && updates.country !== undefined) updatedRow[layout.countryIdx] = updates.country;

    const lastCol = columnIndexToA1(updatedRow.length - 1);
    const range = `Investors!A${rowIndex + 1}:${lastCol}${rowIndex + 1}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [updatedRow],
      },
    });

    return { success: true, message: 'Google Sheet updated successfully', source: 'google_sheets' };
  } catch (err: any) {
    console.error('Failed to update Google Sheet:', err);
    throw new Error(`Google Sheets update failed: ${err.message}`);
  }
}

function normalizeSettingsSource(value: unknown): 'SHEETS' | 'API' | 'FIREBASE' {
  if (value === true) return 'SHEETS';
  if (value === false) return 'API';
  if (value === 'SHEETS' || value === 'API' || value === 'FIREBASE') return value;
  const err: any = new Error(`Invalid source value: ${String(value)}`);
  err.status = 400;
  throw err;
}

function resolveSettingsPath(): string {
  if (process.env.APP_SETTINGS_PATH) return process.env.APP_SETTINGS_PATH;
  return path.join(process.cwd(), 'data', 'app-settings.json');
}

function ensureSettingsStore(): string {
  const settingsPath = resolveSettingsPath();
  const dir = path.dirname(settingsPath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({}));
  }
  fs.accessSync(dir, fs.constants.W_OK);
  return settingsPath;
}

function readSettingsFile(settingsPath: string): Record<string, string | boolean> {
  try {
    if (!fs.existsSync(settingsPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err: any) {
    console.warn('Failed to read settings file:', err.message);
    return {};
  }
}

function validateSettingsBody(body: unknown): Record<string, 'SHEETS' | 'API' | 'FIREBASE'> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err: any = new Error('Settings body must be a JSON object');
    err.status = 400;
    throw err;
  }
  const out: Record<string, 'SHEETS' | 'API' | 'FIREBASE'> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(key)) {
      const err: any = new Error(`Invalid settings key: ${key}`);
      err.status = 400;
      throw err;
    }
    out[key] = normalizeSettingsSource(value);
  }
  return out;
}


function resolveCockpitThresholdsPath(): string {
  if (process.env.COCKPIT_THRESHOLDS_PATH) return process.env.COCKPIT_THRESHOLDS_PATH;
  return path.join(process.cwd(), 'data', 'cockpit-thresholds.json');
}

function ensureCockpitThresholdsStore(): string {
  const storePath = resolveCockpitThresholdsPath();
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({}));
  }
  fs.accessSync(dir, fs.constants.W_OK);
  return storePath;
}

function readCockpitThresholdsFile(storePath: string): Record<string, any> {
  try {
    if (!fs.existsSync(storePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err: any) {
    console.warn('Failed to read cockpit thresholds file:', err.message);
    return {};
  }
}

// Bounds mirror the tunable constants in src/lib/attentionEngine.ts. Keep the
// field names in sync with what Cockpit.tsx's thresholds panel sends.
const COCKPIT_THRESHOLD_FIELDS: Record<string, { min: number; max: number }> = {
  minComplexGroupSize: { min: 1, max: 20 },
  minAttentionImpactIdr: { min: 0, max: 500_000_000 },
  severityHighIdr: { min: 0, max: 1_000_000_000 },
  severityCriticalIdr: { min: 0, max: 2_000_000_000 },
  minGapRatio: { min: 0, max: 1 },
  weightOccupancy: { min: 0, max: 1 },
  weightAdr: { min: 0, max: 1 },
  weightMargin: { min: 0, max: 1 },
  weightExpenses: { min: 0, max: 1 },
  weightTrend: { min: 0, max: 1 },
  channelDormantLookbackMonths: { min: 1, max: 12 },
};

function validateCockpitThresholdsBody(body: unknown): Record<string, number> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err: any = new Error('Thresholds body must be a JSON object');
    err.status = 400;
    throw err;
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const bounds = COCKPIT_THRESHOLD_FIELDS[key];
    if (!bounds) {
      const err: any = new Error(`Unknown threshold field: ${key}`);
      err.status = 400;
      throw err;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num < bounds.min || num > bounds.max) {
      const err: any = new Error(`Threshold "${key}" must be a number between ${bounds.min} and ${bounds.max}`);
      err.status = 400;
      throw err;
    }
    out[key] = num;
  }
  return out;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 7000;

  app.use(express.json());

  
  app.post('/api/auth/verify-legacy', async (req, res) => {
    try {
      const { investorCode, legacyPassword } = req.body;
      if (!investorCode || !legacyPassword) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      const rows = await fetchSheetCSV('Investors');
      if (!rows || rows.length === 0) return res.status(401).json({ error: 'No data' });

      const investor = findInvestorByLegacyCredentials(rows, investorCode, legacyPassword);
      if (!investor) {
        return res.status(401).json({ error: 'Invalid legacy credentials' });
      }

      res.json({ success: true, verifiedCode: canonicalInvestorCodeString(investor.investorCode) });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      
      const rows = await fetchSheetCSV('Investors');
      
      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: 'No data found in investors sheet' });
      }

      const layout = resolveInvestorSheetLayout(rows);
      if (!layout) {
        return res.status(500).json({ error: 'Unable to locate Investors sheet header row' });
      }

      const investor = findInvestorByUsernamePassword(rows, username, password);
      if (investor) {
        const db = getInternalDB();
        let mapping: any = null;
        for (const key in db) {
          if (db[key].username === username) {
            mapping = db[key];
            break;
          }
        }

        const row = rows[investor.sheetRowIndex] || [];
        const isAdmin = resolveInvestorIsAdmin(investor, row, layout, { mappingEmail: mapping?.email });
        const userVillas = await fetchUserVillasForInvestorCode(investor.investorCode);
        const userPayload = buildAuthUserPayload(investor, {
          isAdmin,
          emailOverride: (mapping && mapping.email) || investor.email,
          villas: userVillas,
        });

        setSessionCookie(res, {
          username: investor.legacyUsername,
          investorCode: canonicalInvestorCodeString(investor.investorCode),
          isAdmin,
          isPlatformAdmin: userPayload.isPlatformAdmin,
        }, req);
        res.json({ user: userPayload });
      } else {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/auth/google-login', async (req, res) => {
    try {
      const { firebaseIdToken } = req.body;
      const identity = await verifyFirebaseIdToken(firebaseIdToken);
      const email = identity.email;

      const rows = await fetchSheetCSV('Investors');
      
      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: 'No data found in Investors sheet' });
      }

      const layout = resolveInvestorSheetLayout(rows);
      if (!layout) {
        return res.status(500).json({ error: 'Unable to locate Investors sheet header row' });
      }

      const db = getInternalDB();
      const mapping = db[email];
      
      let oauthLink = null;
      try {
        const linkDoc = await getAccountLinkDoc(email, firebaseIdToken);
        if (linkDoc) {
          const linkData = linkDoc.data() || {};
          if (linkData.investorCode) {
            oauthLink = { investorCode: linkData.investorCode };
          }
        }
      } catch (err: any) {
        console.error('Failed to look up account_links:', err.message);
        return res.status(500).json({ error: 'Unable to look up Google account mapping' });
      }

      let investor: ParsedInvestorRecord | null = null;
      if (oauthLink && oauthLink.investorCode) {
        investor = findInvestorByLinkedCode(rows, String(oauthLink.investorCode).trim());
      } else if (mapping && mapping.username) {
        investor = findInvestorByUsername(rows, mapping.username);
      }

      if (investor) {
        const row = rows[investor.sheetRowIndex] || [];
        const isAdmin = resolveInvestorIsAdmin(investor, row, layout, {
          googleEmail: email,
          mappingEmail: mapping?.email,
        });
        const userVillas = await fetchUserVillasForInvestorCode(investor.investorCode);
        const userPayload = buildAuthUserPayload(investor, {
          isAdmin,
          emailOverride: (mapping && mapping.email) || investor.email,
          villas: userVillas,
        });

        setSessionCookie(res, {
          username: investor.legacyUsername,
          investorCode: canonicalInvestorCodeString(investor.investorCode),
          isAdmin,
          isPlatformAdmin: userPayload.isPlatformAdmin,
          googleEmail: email,
        }, req);
        res.json({ user: userPayload });
      } else {
        res.status(404).json({ error: UNLINKED_GOOGLE_MESSAGE });
      }
    } catch (error: any) {
      const status = error.status || 500;
      if (status >= 500) console.error('Google login error:', error);
      res.status(status).json({ error: error.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res, req);
    res.json({ success: true });
  });

  app.get('/api/auth/link-status', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      // The session's own view of who this is — the client stores its user
      // object in localStorage, which can outlive/disagree with the cookie, so
      // it reconciles against these on load.
      const sessionFlags = {
        username: session.username,
        isAdmin: !!session.isAdmin,
        isPlatformAdmin: !!session.isPlatformAdmin,
      };
      if (session.googleEmail) {
        return res.json({ linked: true, email: session.googleEmail, investorCode: session.investorCode, ...sessionFlags });
      }
      const docs = await listAccountLinkDocs();
      const match = docs.find((d) => investorCodesOverlap(d.data()?.investorCode, session.investorCode));
      if (!match) {
        return res.json({ linked: false, ...sessionFlags });
      }
      const data = match.data() || {};
      res.json({
        linked: true,
        email: data.email || match.id,
        investorCode: data.investorCode || '',
        createdAt: data.createdAt || null,
        ...sessionFlags,
      });
    } catch (err: any) {
      console.warn('link-status list unavailable:', err.message);
      res.json({ linked: false, isAdmin: !!session.isAdmin, isPlatformAdmin: !!session.isPlatformAdmin });
    }
  });

  app.post('/api/auth/unlink-google', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      const firebaseIdToken = req.body?.firebaseIdToken;
      let verifiedIdentity: { email: string; uid: string } | null = null;
      if (firebaseIdToken) {
        verifiedIdentity = await verifyFirebaseIdToken(firebaseIdToken);
      }

      let emailToDelete: string | null = null;

      if (session.googleEmail) {
        emailToDelete = String(session.googleEmail).toLowerCase().trim();
      }

      if (!emailToDelete) {
        try {
          const docs = await listAccountLinkDocs();
          const match = docs.find((d) => investorCodesOverlap(d.data()?.investorCode, session.investorCode));
          if (match) {
            const data = match.data() || {};
            emailToDelete = String(data.email || match.id).toLowerCase().trim();
          }
        } catch (listErr: any) {
          console.warn('unlink-google list failed:', listErr.message);
        }
      }

      if (!emailToDelete) {
        return res.json({ success: true, unlinked: false });
      }

      if (verifiedIdentity && verifiedIdentity.email !== emailToDelete) {
        return res.status(403).json({ error: 'Google account does not match the linked account for this session.' });
      }

      let linkDoc: { id: string; data: () => any } | null = null;
      try {
        linkDoc = await getAccountLinkDoc(emailToDelete, firebaseIdToken || undefined);
      } catch (readErr: any) {
        console.warn('unlink-google account_links read failed:', readErr.message);
        if (firebaseIdToken) {
          try {
            linkDoc = await fetchAccountLinkWithBearer(emailToDelete, firebaseIdToken);
          } catch (userReadErr: any) {
            console.warn('unlink-google user-token read failed:', userReadErr.message);
          }
        }
      }

      if (linkDoc) {
        const data = linkDoc.data() || {};
        if (
          !investorCodesOverlap(data.investorCode, session.investorCode) &&
          String(data.investorCode || '') !== String(session.investorCode)
        ) {
          return res.status(403).json({ error: 'This Google account is not linked to the signed-in EVDEKIMI account.' });
        }
        emailToDelete = String(data.email || emailToDelete).toLowerCase().trim();
      } else if (emailToDelete && session.googleEmail && !firebaseIdToken) {
        return res.status(503).json({
          error: 'Unable to disconnect Google account. Please refresh after signing in with Google, then try again.',
        });
      } else {
        return res.json({ success: true, unlinked: false });
      }

      const result = await deleteAccountLinkDoc(emailToDelete, firebaseIdToken || undefined);
      res.json({ success: true, unlinked: result.deleted });
    } catch (err: any) {
      console.error('unlink-google error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Failed to remove Google account link' });
    }
  });

  app.post('/api/auth/link-google', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      if (!session.investorCode) {
        return res.status(400).json({ error: 'This EVDEKIMI account has no investor code to link.' });
      }
      const identity = await verifyFirebaseIdToken(req.body?.firebaseIdToken);
      const result = await createOrKeepAccountLink({
        googleEmail: identity.email,
        firebaseUid: identity.uid,
        investorCode: session.investorCode,
        legacyUsername: session.username,
        userIdToken: req.body?.firebaseIdToken,
      });
      setSessionCookie(res, {
        username: session.username,
        investorCode: session.investorCode,
        isAdmin: session.isAdmin,
        // Carry platform-admin through: re-issuing the cookie without it used
        // to silently strip admin rights on Google link, so every
        // /api/admin/* call started failing while the UI still showed the
        // admin tabs (they come from the client's stored user object).
        isPlatformAdmin: session.isPlatformAdmin || isPlatformAdminEmail(result.email),
        googleEmail: result.email,
      }, req);
      res.json({
        success: true,
        alreadyLinked: result.alreadyLinked,
        email: result.email,
        investorCode: result.investorCode,
        message: result.alreadyLinked
          ? 'This Google account is already connected to your EVDEKIMI account.'
          : 'Google account connected successfully.',
      });
    } catch (err: any) {
      console.error('link-google error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Failed to link Google account' });
    }
  });

  app.post('/api/auth/link-google-legacy', async (req, res) => {
    try {
      const { investorCode, legacyPassword, firebaseIdToken } = req.body || {};
      if (!investorCode || !legacyPassword) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      const rows = await fetchSheetCSV('Investors');
      if (!rows || rows.length === 0) return res.status(401).json({ error: 'No data' });

      const layout = resolveInvestorSheetLayout(rows);
      if (!layout) {
        return res.status(500).json({ error: 'Unable to locate Investors sheet header row' });
      }

      const investor = findInvestorByLegacyCredentials(rows, investorCode, legacyPassword);
      if (!investor) {
        return res.status(401).json({ error: 'Invalid legacy credentials' });
      }

      const verifiedCode = canonicalInvestorCodeString(investor.investorCode);
      const identity = await verifyFirebaseIdToken(firebaseIdToken);
      const result = await createOrKeepAccountLink({
        googleEmail: identity.email,
        firebaseUid: identity.uid,
        investorCode: verifiedCode,
        legacyUsername: investor.legacyUsername,
        userIdToken: firebaseIdToken,
      });

      const row = rows[investor.sheetRowIndex] || [];
      const isAdmin = resolveInvestorIsAdmin(investor, row, layout, {
        googleEmail: identity.email,
      });

      setSessionCookie(res, {
        username: investor.legacyUsername,
        investorCode: verifiedCode,
        isAdmin,
        // Same as link-google: recompute rather than drop it (see note there).
        isPlatformAdmin:
          isPlatformAdminEmail(identity.email) ||
          isPlatformAdminEmail(investor.email) ||
          isPlatformAdminEmail(investor.legacyUsername),
        googleEmail: result.email,
      }, req);

      res.json({
        success: true,
        alreadyLinked: result.alreadyLinked,
        email: result.email,
        investorCode: result.investorCode,
        verifiedCode,
        message: result.alreadyLinked
          ? 'This Google account is already connected to this EVDEKIMI account.'
          : 'Google account connected successfully.',
      });
    } catch (err: any) {
      console.error('link-google-legacy error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Failed to link Google account' });
    }
  });

  app.get('/api/admin/account-links', async (req, res) => {
    if (!requireAdminSession(req, res)) return;
    try {
      let investors: ReturnType<typeof parseInvestorSheetRows> = [];
      try {
        const rows = await fetchSheetCSV('Investors');
        investors = parseInvestorSheetRows(rows);
      } catch (sheetErr: any) {
        console.error('admin account-links investors load failed:', sheetErr);
        return res.status(500).json({ error: sheetErr.message || 'Failed to load investors' });
      }

      const { docs, error: firebaseError } = await listAccountLinkDocsSafe();
      const links = docs.map((d) => firestoreLinkToJson(d));
      const result = buildAdminAccountMappings(investors, links, firebaseError);
      res.json(result);
    } catch (err: any) {
      console.error('admin account-links error:', err);
      res.status(500).json({ error: err.message || 'Failed to load linked accounts' });
    }
  });

  app.delete('/api/admin/account-links/:email', async (req, res) => {
    if (!requireAdminSession(req, res)) return;
    try {
      const email = decodeURIComponent(String(req.params.email || '')).toLowerCase().trim();
      if (!email) return res.status(400).json({ error: 'Email is required' });
      await deleteAccountLinkDoc(email);
      res.json({ success: true });
    } catch (err: any) {
      console.error('admin unlink error:', err);
      res.status(500).json({ error: err.message || 'Failed to unlink Google account' });
    }
  });

  // WhatsApp Cloud API Integration
  app.post('/api/whatsapp/send', async (req, res) => {
    try {
      const { message } = req.body;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const recipientPhone = process.env.WHATSAPP_SALES_PHONE;

      if (!phoneNumberId || !accessToken || !recipientPhone) {
        console.warn('WhatsApp API credentials not configured. Simulating success.');
        return res.json({ success: true, simulated: true });
      }

      const response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'text',
          text: { body: message }
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Failed to send WhatsApp message');

      res.json({ success: true, data });
    } catch (error: any) {
      console.error('WhatsApp send error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  
  let settingsPath: string;
  try {
    settingsPath = ensureSettingsStore();
  } catch (err: any) {
    console.error('Settings store is not writable:', err.message);
    settingsPath = resolveSettingsPath();
  }

  app.get('/api/admin/settings', (req, res) => {
    try {
      res.json(readSettingsFile(settingsPath));
    } catch (e: any) {
      console.error('admin settings read error:', e);
      res.status(500).json({ error: 'Failed to read settings' });
    }
  });

  app.post('/api/admin/settings', (req, res) => {
    try {
      settingsPath = ensureSettingsStore();
      const current = readSettingsFile(settingsPath);
      const incoming = validateSettingsBody(req.body);
      const updated = { ...current, ...incoming };
      fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
      res.json({ success: true, settings: updated });
    } catch (e: any) {
      console.error('admin settings save error:', e);
      res.status(e.status || 500).json({ error: e.message || 'Failed to save settings' });
    }
  });


  let cockpitThresholdsPath = resolveCockpitThresholdsPath();
  try {
    cockpitThresholdsPath = ensureCockpitThresholdsStore();
  } catch (err: any) {
    console.error('Cockpit thresholds store is not writable:', err.message);
  }

  app.get('/api/admin/cockpit/thresholds', (req, res) => {
    if (!requirePlatformAdminSession(req, res)) return;
    try {
      res.json(readCockpitThresholdsFile(cockpitThresholdsPath));
    } catch (e: any) {
      console.error('cockpit thresholds read error:', e);
      res.status(500).json({ error: 'Failed to read thresholds' });
    }
  });

  app.post('/api/admin/cockpit/thresholds', (req, res) => {
    if (!requirePlatformAdminSession(req, res)) return;
    try {
      cockpitThresholdsPath = ensureCockpitThresholdsStore();
      const current = readCockpitThresholdsFile(cockpitThresholdsPath);
      const incoming = validateCockpitThresholdsBody(req.body);
      const updated = { ...current, ...incoming };
      fs.writeFileSync(cockpitThresholdsPath, JSON.stringify(updated, null, 2));
      res.json({ success: true, thresholds: updated });
    } catch (e: any) {
      console.error('cockpit thresholds save error:', e);
      res.status(e.status || 500).json({ error: e.message || 'Failed to save thresholds' });
    }
  });

  app.get('/api/admin/accounting/workbook', async (req, res) => {
    if (!requirePlatformAdminSession(req, res)) return;
    try {
      const workbook = await fetchAccountingWorkbook();
      res.json({ ...workbook, spreadsheetId: SPREADSHEET_ID, loadedAt: new Date().toISOString() });
    } catch (error: any) {
      console.error('Accounting workbook fetch error:', error);
      res.status(500).json({ error: error.message || 'Failed to load workbook' });
    }
  });

  app.get('/api/sheet/:name'
, async (req, res) => {
    try {
      const sheetName = req.params.name;
      const result = await fetchSheetValues(sheetName, undefined, { allowCsvFallback: true });
      res.json({ values: result.values || [], source: result.source, spreadsheetId: SPREADSHEET_ID });
    } catch (error: any) {
      console.error(`Fetch error for sheet ${req.params.name}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/investor/profile', async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      const updates = req.body?.updates;
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Profile updates are required' });
      }

      const sheetResult = await updateInvestorRow(session.username, updates);
      if (!sheetResult.success || sheetResult.source !== 'google_sheets') {
        return res.status(502).json({ error: sheetResult.message || 'Google Sheets update did not complete', source: sheetResult.source });
      }

      if (updates.email) {
        const db = getInternalDB();
        db[updates.email.toLowerCase().trim()] = { 
          username: session.username,
          ...updates 
        };
        saveToInternalDB(db);
      }

      res.json({ success: true, message: sheetResult.message, source: sheetResult.source });
    } catch (error: any) {
      console.error('Profile update error:', error);
      const message = error.message || 'Failed to update profile';
      if (String(message).includes('authorization required')) {
        return res.status(401).json({ error: message, source: 'unauthorized' });
      }
      res.status(500).json({ error: message });
    }
  });


  app.get('/api/evdekimi/reservations', async (req, res) => {
    try {
      if (fs.existsSync(BOOKINGS_DB_PATH)) {
        const fileContent = fs.readFileSync(BOOKINGS_DB_PATH, 'utf-8');
        const parsed = JSON.parse(fileContent);
        return res.json(parsed.data);
      }
      
      // Fallback if not fetched yet
      return res.status(503).json({ error: "Bookings database is currently synchronizing. Please try again in a moment." });
    } catch (error) {
      console.error('Evdekimi local DB error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
