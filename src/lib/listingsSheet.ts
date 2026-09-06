import {
  cleanSheetValue,
  findHeaderRowIndex,
  getCell,
  normalizeSheetHeader,
} from './sheetCommon';
import {
  investorCodesOverlap,
  type ParsedVillaRecord,
} from './villaSheet';

export const KNOWN_LISTING_PLATFORMS = [
  'Airbnb',
  'Booking.com',
  'VRBo',
  'Expedia',
  'Guesty booking engine',
  'Trip.com',
] as const;

export type ListingPlatform = (typeof KNOWN_LISTING_PLATFORMS)[number];

export type ListingRecord = {
  villaName: string;
  platform: ListingPlatform | string;
  platformKey: string;
  url: string;
};

export type ListingsSheetLayout = {
  headerRowIdx: number;
  villaNameIdx: number;
  platformColumns: Array<{ idx: number; label: string; key: string }>;
  headers: string[];
};

export type VillaMatchType =
  | 'EXACT_MATCH'
  | 'NORMALIZED_MATCH'
  | 'ALIAS_MATCH'
  | 'AMBIGUOUS'
  | 'NO_MATCH';

export type VillaNameMatchResult = {
  listingVillaName: string;
  matchType: VillaMatchType;
  matchedVillaName: string | null;
  candidates: string[];
};

/**
 * Approved explicit Listings → Villas aliases only.
 * Do NOT expand into general fuzzy matching.
 */
export const LISTING_VILLA_ALIASES: Record<string, string> = {
  'Garden Heights (ex.Hanging)': 'Garden Hights Villa',
  'Sacred Jungle Apartment 1': 'SJ Apart 1 (Mezanine)',
  'Sacred Jungle Apartment 2': 'SJ Apart 2 (Mezanine)',
  'Sacred Jungle Apartment 3': 'SJ Apart 3 (Mezanine)',
  'Sacred Jungle Apartment 4': 'SJ Apart 4',
  'Sacred Jungle Apartment 5': 'SJ Apart 5',
  'Sacred Jungle Apartment 6': 'SJ Apart 6',
  'Sacred Jungle Apartment 7': 'SJ Apart 7',
  'Sacred Jungle Apartment 8': 'SJ Apart 8',
  'Sacred Jungle Apartment 9': 'SJ Apart 9 (2BDr)',
  'Sacred Jungle Villa 1': 'SJ 1 Villa 1',
  'Sacred Jungle Villa 2': 'SJ 1 Villa 2',
  'Sacred Jungle Villa 3': 'SJ 1 Villa 3',
};

function resolveApprovedAlias(listingVillaName: string): string | null {
  const direct = LISTING_VILLA_ALIASES[listingVillaName];
  if (direct) return direct;
  const lower = String(listingVillaName || '').trim().toLowerCase();
  for (const [from, to] of Object.entries(LISTING_VILLA_ALIASES)) {
    if (from.toLowerCase() === lower) return to;
  }
  return null;
}

export type InvestorListingsResult = {
  investorCode: string;
  ownedVillas: ParsedVillaRecord[];
  listings: ListingRecord[];
  matches: VillaNameMatchResult[];
  excluded: VillaNameMatchResult[];
};

function platformKeyFromHeader(header: string) {
  return normalizeSheetHeader(header).replace(/\s+/g, ' ');
}

function displayPlatformLabel(header: string): string {
  const key = platformKeyFromHeader(header);
  const known = KNOWN_LISTING_PLATFORMS.find((p) => platformKeyFromHeader(p) === key);
  return known || header.trim();
}

export function isUsableListingUrl(value?: string): boolean {
  const text = cleanSheetValue(value);
  if (!text) return false;
  try {
    const withProtocol =
      text.startsWith('http://') || text.startsWith('https://') ? text : `https://${text}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || host === 'localhost') return host === 'localhost';
    // Require a real hostname with a dot (rejects tokens like "not-a-url").
    if (!host.includes('.')) return false;
    if (host.startsWith('.') || host.endsWith('.')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Hosts verified locally to render the real OTA page inside ListingViewer.
 * Based on actual iframe behavior — not platform-name assumptions.
 * Do NOT treat this as a general “OTA family” matcher.
 */
const IFRAME_EMBEDDABLE_HOST_SUFFIXES = ['booking.com', 'guestybookings.com'] as const;

/**
 * True only when this exact listing URL is known to embed in our Live Listing Viewer.
 * Redirect remains available separately for every usable URL.
 */
export function canEmbedListingInViewer(value?: string): boolean {
  if (!isUsableListingUrl(value)) return false;
  try {
    const parsed = new URL(normalizeListingUrl(String(value)));
    const host = parsed.hostname.toLowerCase();
    return IFRAME_EMBEDDABLE_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

export function normalizeListingUrl(value: string): string {
  const text = cleanSheetValue(value);
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text}`;
}

export function resolveListingsSheetLayout(rows: any[][]): ListingsSheetLayout | null {
  if (!rows || rows.length < 2) return null;

  // Prefer Villa Name + Airbnb (canonical OTA column), fall back to Villa Name + Booking.com.
  let headerRowIdx = findHeaderRowIndex(rows, ['villa name', 'airbnb']);
  if (headerRowIdx < 0) headerRowIdx = findHeaderRowIndex(rows, ['villa name', 'booking.com']);
  if (headerRowIdx < 0) return null;

  const rawHeaders = rows[headerRowIdx] || [];
  const headers = rawHeaders.map(normalizeSheetHeader);
  const villaNameIdx = headers.findIndex((h) => h.includes('villa name'));
  if (villaNameIdx === -1) return null;

  const knownKeys = new Set(KNOWN_LISTING_PLATFORMS.map((p) => platformKeyFromHeader(p)));
  const platformColumns: ListingsSheetLayout['platformColumns'] = [];

  headers.forEach((header, idx) => {
    if (idx === villaNameIdx || !header) return;
    const key = platformKeyFromHeader(rawHeaders[idx]);
    if (!knownKeys.has(key)) return;
    platformColumns.push({
      idx,
      label: displayPlatformLabel(String(rawHeaders[idx] ?? '')),
      key,
    });
  });

  if (platformColumns.length === 0) return null;

  return { headerRowIdx, villaNameIdx, platformColumns, headers };
}

function isLikelyListingsDataRow(row: any[], layout: ListingsSheetLayout) {
  const villaName = getCell(row, layout.villaNameIdx);
  if (!villaName) return false;
  if (villaName.toLowerCase() === 'villa name') return false;
  return true;
}

export function parseListingsSheetRows(rows: any[][]): ListingRecord[] {
  const layout = resolveListingsSheetLayout(rows);
  if (!layout) return [];

  const listings: ListingRecord[] = [];
  for (let i = layout.headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!isLikelyListingsDataRow(row, layout)) continue;

    const villaName = getCell(row, layout.villaNameIdx);
    for (const platform of layout.platformColumns) {
      const rawUrl = getCell(row, platform.idx);
      if (!isUsableListingUrl(rawUrl)) continue;
      listings.push({
        villaName,
        platform: platform.label,
        platformKey: platform.key,
        url: normalizeListingUrl(rawUrl),
      });
    }
  }

  return listings;
}

export function uniqueListingVillaNames(listings: ListingRecord[]) {
  return Array.from(new Set(listings.map((l) => l.villaName).filter(Boolean)));
}

/**
 * Safe, deterministic villa-name normalization for ownership matching.
 * Does NOT apply free-form fuzzy matching or invented aliases.
 */
export function normalizeVillaNameForMatch(value?: string): string {
  let text = String(value ?? '').toLowerCase().trim();
  if (!text) return '';

  // Drop parenthetical annotations: "(ex.Hanging)", "(1BDr)", "(Mezanine)"
  text = text.replace(/\([^)]*\)/g, ' ');

  // Normalize apartment abbreviations to a single token.
  text = text
    .replace(/\bappartments?\b/g, 'apart')
    .replace(/\bapartments?\b/g, 'apart')
    .replace(/\baparts?\b/g, 'apart')
    .replace(/\baprt\.?\b/g, 'apart')
    .replace(/\bapart\.?\b/g, 'apart');

  // Punctuation → space, collapse whitespace.
  text = text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Strip a trailing "villa(s)" token so "Hijau" can match "Hijau Villa".
  text = text.replace(/\bvillas?\b$/g, '').trim();

  return text;
}

function extractParentheticalCandidates(value: string): string[] {
  const matches = String(value || '').match(/\(([^)]+)\)/g) || [];
  return matches
    .map((m) => m.slice(1, -1).trim())
    .filter((inner) => {
      const lower = inner.toLowerCase();
      // Ignore annotation-only parentheticals.
      if (/^ex\b/.test(lower)) return false;
      if (/\d\s*bdr/.test(lower)) return false;
      if (lower.includes('mezanine') || lower.includes('mezzanine')) return false;
      return /[a-z]/i.test(inner);
    });
}

export function villaNameMatchCandidates(listingVillaName: string): string[] {
  const candidates = new Set<string>();
  const full = normalizeVillaNameForMatch(listingVillaName);
  if (full) candidates.add(full);

  // Variant without parentheticals (already handled in normalize, but keep explicit).
  const withoutParens = normalizeVillaNameForMatch(String(listingVillaName).replace(/\([^)]*\)/g, ' '));
  if (withoutParens) candidates.add(withoutParens);

  // Parenthetical content may contain the canonical villa name
  // e.g. "Orchid villa 1 (Nyaman Villa 1)".
  for (const inner of extractParentheticalCandidates(listingVillaName)) {
    const norm = normalizeVillaNameForMatch(inner);
    if (norm) candidates.add(norm);
  }

  return Array.from(candidates);
}

export function matchListingVillaToOwnedVilla(
  listingVillaName: string,
  ownedVillaNames: string[]
): VillaNameMatchResult {
  const owned = ownedVillaNames.filter(Boolean);
  const exact = owned.filter(
    (name) => name.trim().toLowerCase() === String(listingVillaName || '').trim().toLowerCase()
  );
  if (exact.length === 1) {
    return {
      listingVillaName,
      matchType: 'EXACT_MATCH',
      matchedVillaName: exact[0],
      candidates: exact,
    };
  }
  if (exact.length > 1) {
    return {
      listingVillaName,
      matchType: 'AMBIGUOUS',
      matchedVillaName: null,
      candidates: exact,
    };
  }

  const listingCandidates = villaNameMatchCandidates(listingVillaName);
  const normalizedHits = owned.filter((ownedName) => {
    const ownedCandidates = villaNameMatchCandidates(ownedName);
    return listingCandidates.some((lc) => ownedCandidates.includes(lc));
  });

  if (normalizedHits.length === 1) {
    return {
      listingVillaName,
      matchType: 'NORMALIZED_MATCH',
      matchedVillaName: normalizedHits[0],
      candidates: normalizedHits,
    };
  }
  if (normalizedHits.length > 1) {
    return {
      listingVillaName,
      matchType: 'AMBIGUOUS',
      matchedVillaName: null,
      candidates: normalizedHits,
    };
  }

  // Approved explicit aliases only (after exact/normalized, never as fuzzy expansion).
  const aliasTarget = resolveApprovedAlias(listingVillaName);
  if (aliasTarget) {
    const aliasHits = owned.filter(
      (name) => name.trim().toLowerCase() === aliasTarget.trim().toLowerCase()
    );
    if (aliasHits.length === 1) {
      return {
        listingVillaName,
        matchType: 'ALIAS_MATCH',
        matchedVillaName: aliasHits[0],
        candidates: aliasHits,
      };
    }
    if (aliasHits.length > 1) {
      return {
        listingVillaName,
        matchType: 'AMBIGUOUS',
        matchedVillaName: null,
        candidates: aliasHits,
      };
    }
  }

  return {
    listingVillaName,
    matchType: 'NO_MATCH',
    matchedVillaName: null,
    candidates: [],
  };
}

export function getOwnedVillasForInvestorCode(
  villas: ParsedVillaRecord[],
  investorCode: string
): ParsedVillaRecord[] {
  if (!investorCode) return [];
  return villas.filter((villa) => investorCodesOverlap(villa.investorCode, investorCode));
}

export function getListingsForInvestor(
  investorCode: string,
  villas: ParsedVillaRecord[],
  listings: ListingRecord[]
): InvestorListingsResult {
  const ownedVillas = getOwnedVillasForInvestorCode(villas, investorCode);
  const ownedNames = ownedVillas.map((v) => v.name);

  const listingVillaNames = uniqueListingVillaNames(listings);
  const matches: VillaNameMatchResult[] = [];
  const excluded: VillaNameMatchResult[] = [];
  const allowedListingNames = new Set<string>();

  for (const listingVillaName of listingVillaNames) {
    const match = matchListingVillaToOwnedVilla(listingVillaName, ownedNames);
    if (
      match.matchType === 'EXACT_MATCH' ||
      match.matchType === 'NORMALIZED_MATCH' ||
      match.matchType === 'ALIAS_MATCH'
    ) {
      matches.push(match);
      allowedListingNames.add(listingVillaName);
    } else {
      excluded.push(match);
    }
  }

  const scopedListings = listings.filter((listing) => allowedListingNames.has(listing.villaName));

  return {
    investorCode,
    ownedVillas,
    listings: scopedListings,
    matches,
    excluded,
  };
}

/**
 * Analyze Listings ↔ Villas name coverage across the full portfolio (not investor-scoped).
 */
export function analyzeListingsVillaNameMatches(
  listings: ListingRecord[],
  villas: ParsedVillaRecord[]
) {
  const allVillaNames = villas.map((v) => v.name);
  const listingVillaNames = uniqueListingVillaNames(listings);

  const results = listingVillaNames.map((name) => matchListingVillaToOwnedVilla(name, allVillaNames));

  return {
    listingVillaCount: listingVillaNames.length,
    listingRecordCount: listings.length,
    exact: results.filter((r) => r.matchType === 'EXACT_MATCH'),
    normalized: results.filter((r) => r.matchType === 'NORMALIZED_MATCH'),
    alias: results.filter((r) => r.matchType === 'ALIAS_MATCH'),
    ambiguous: results.filter((r) => r.matchType === 'AMBIGUOUS'),
    unmatched: results.filter((r) => r.matchType === 'NO_MATCH'),
    all: results,
  };
}

export type GroupedVillaListings = {
  villaName: string;
  listingVillaName: string;
  matchType: VillaMatchType;
  platforms: ListingRecord[];
};

/**
 * Group investor-scoped listings by resolved Villas name for profile UI.
 * Order follows ownedVillas (sheet order), not alphabetical.
 */
export function groupListingsByVilla(result: InvestorListingsResult): GroupedVillaListings[] {
  const byMatched = new Map<string, GroupedVillaListings>();

  for (const match of result.matches) {
    if (!match.matchedVillaName) continue;
    const platforms = result.listings.filter((l) => l.villaName === match.listingVillaName);
    if (platforms.length === 0) continue;
    const existing = byMatched.get(match.matchedVillaName);
    if (existing) {
      existing.platforms.push(...platforms);
    } else {
      byMatched.set(match.matchedVillaName, {
        villaName: match.matchedVillaName,
        listingVillaName: match.listingVillaName,
        matchType: match.matchType,
        platforms: [...platforms],
      });
    }
  }

  const ordered: GroupedVillaListings[] = [];
  const seen = new Set<string>();
  for (const villa of result.ownedVillas) {
    const group = byMatched.get(villa.name);
    if (!group || seen.has(villa.name)) continue;
    ordered.push(group);
    seen.add(villa.name);
  }
  for (const [name, group] of byMatched) {
    if (seen.has(name)) continue;
    ordered.push(group);
  }
  return ordered;
}

/** Display label for a villa's management / payout agreement. */
export function formatVillaPayoutCondition(villa: {
  typeAgreement?: string;
  pmFeeRate?: number;
}): string {
  if (String(villa.typeAgreement || '') === 'Revenue Share') {
    const pct = Math.round((Number(villa.pmFeeRate) || 0) * 100);
    return `${pct}% Payout`;
  }
  return 'Flat Payout';}
