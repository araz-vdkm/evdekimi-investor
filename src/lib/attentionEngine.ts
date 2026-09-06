/**
 * Management Cockpit — attention / health-score / benchmark engine.
 *
 * Pure functions only (no network, no React) so this can be unit-tested with
 * synthetic data. Everything here is a rules-based heuristic, not a
 * statistical model — see the confidence notes below. Thresholds are
 * intentionally grouped as named constants so they're easy to tune once we
 * see how they behave against real portfolio data.
 */

import type { ParsedSummaryRecord } from './summarySheet';
import type { ParsedVillaRecord } from './villaSheet';
import type { Booking } from '../types';
import type { ListingRecord } from './listingsSheet';
import { analyzeListingsVillaNameMatches } from './listingsSheet';

// ---------------------------------------------------------------------------
// Tunable thresholds — adjust these as the real data comes in, not the logic.
// ---------------------------------------------------------------------------

/** A "complex" (villa cluster) needs at least this many villas with data this
 *  month before we trust its own benchmark; otherwise we fall back to the
 *  whole-portfolio benchmark. */
export const MIN_COMPLEX_GROUP_SIZE = 3;

/** Health Score sub-score weights (must sum to 1 when all are available). */
export const HEALTH_SCORE_WEIGHTS: Record<'occupancy' | 'adr' | 'margin' | 'expenses' | 'trend', number> = {
  occupancy: 0.25,
  adr: 0.2,
  margin: 0.2,
  expenses: 0.2,
  trend: 0.15,
};

/** Below this absolute Rupiah impact, we don't bother surfacing an attention
 *  item — it's noise, not a decision. */
export const MIN_ATTENTION_IMPACT_IDR = 3_000_000;

/** Impact magnitude tiers (absolute Rupiah) that decide CRITICAL/HIGH/MEDIUM. */
export const SEVERITY_THRESHOLDS_IDR = {
  critical: 25_000_000,
  high: 10_000_000,
} as const;

/** Minimum relative gap vs benchmark before a metric counts as "off" at all. */
export const MIN_GAP_RATIO = 0.1; // 10%

/**
 * Same thresholds as above, bundled into one object so a UI-configured
 * override can flow through the engine's functions without changing the
 * module-level constants (which stay as the shipped defaults). Field names
 * intentionally match what the /api/admin/cockpit/thresholds endpoint
 * accepts, so a fetched override object can be passed straight through.
 */
export interface CockpitThresholds {
  minComplexGroupSize: number;
  minAttentionImpactIdr: number;
  severityHighIdr: number;
  severityCriticalIdr: number;
  minGapRatio: number;
  weightOccupancy: number;
  weightAdr: number;
  weightMargin: number;
  weightExpenses: number;
  weightTrend: number;
  /** A channel only counts as "gone dormant" for a villa if that villa
   *  actually got a booking from it within this many months before the
   *  target month. Without this gate, a villa listed on several OTAs but
   *  naturally booking through only one or two of them each month would get
   *  flagged for every OTA it didn't happen to book through that month —
   *  that's normal low-volume variance, not a problem. */
  channelDormantLookbackMonths: number;
}

export const DEFAULT_THRESHOLDS: CockpitThresholds = {
  minComplexGroupSize: MIN_COMPLEX_GROUP_SIZE,
  minAttentionImpactIdr: MIN_ATTENTION_IMPACT_IDR,
  severityHighIdr: SEVERITY_THRESHOLDS_IDR.high,
  severityCriticalIdr: SEVERITY_THRESHOLDS_IDR.critical,
  minGapRatio: MIN_GAP_RATIO,
  weightOccupancy: HEALTH_SCORE_WEIGHTS.occupancy,
  weightAdr: HEALTH_SCORE_WEIGHTS.adr,
  weightMargin: HEALTH_SCORE_WEIGHTS.margin,
  weightExpenses: HEALTH_SCORE_WEIGHTS.expenses,
  weightTrend: HEALTH_SCORE_WEIGHTS.trend,
  channelDormantLookbackMonths: 3,
};

/** Merges a partial override (e.g. from the saved thresholds JSON) onto the
 *  shipped defaults. Missing/undefined fields fall back to the default. */
export function mergeThresholds(overrides?: Partial<CockpitThresholds> | null): CockpitThresholds {
  if (!overrides) return DEFAULT_THRESHOLDS;
  return { ...DEFAULT_THRESHOLDS, ...overrides };
}

function weightsFromThresholds(
  thresholds: CockpitThresholds
): Record<'occupancy' | 'adr' | 'margin' | 'expenses' | 'trend', number> {
  return {
    occupancy: thresholds.weightOccupancy,
    adr: thresholds.weightAdr,
    margin: thresholds.weightMargin,
    expenses: thresholds.weightExpenses,
    trend: thresholds.weightTrend,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM';
export type Confidence = 'low' | 'medium';
export type Grade = 'Excellent' | 'Good' | 'Warning' | 'Poor' | 'No data';
export type Quadrant = 'STAR' | 'REVENUE_OPPORTUNITY' | 'DISTRIBUTION_PROBLEM' | 'UNDERPERFORMER';

export interface VillaMetrics {
  villaName: string;
  complex: string;
  investorCode: string;
  grossRevenue: number;
  operatingExpenses: number;
  netOperatingProfit: number;
  /** Fraction 0-1 (normalized regardless of how the sheet stored it). */
  occupancyPct: number;
  adr: number;
  bookedNights: number;
  daysInMonth: number;
}

export interface Benchmark {
  occupancyPct: number;
  adr: number;
  /** netOperatingProfit / grossRevenue */
  noiMargin: number;
  /** operatingExpenses / grossRevenue */
  expenseRatio: number;
  sampleSize: number;
}

export interface Benchmarks {
  portfolio: Benchmark;
  byComplex: Record<string, Benchmark>;
}

export interface SubScore {
  label: string;
  actual: number;
  benchmark: number;
  score: number; // 0-100
  grade: Grade;
}

export interface HealthScoreResult {
  villaName: string;
  complex: string;
  score: number; // 0-100
  grade: Grade;
  confidence: Confidence;
  subscores: {
    occupancy: SubScore;
    adr: SubScore;
    margin: SubScore;
    expenses: SubScore;
    trend?: SubScore;
  };
}

export interface AttentionItem {
  villaName: string;
  severity: Severity;
  metric: 'occupancy' | 'adr' | 'expenses' | 'channel_missing' | 'channel_dormant';
  title: string;
  /** Negative = estimated loss, positive = estimated upside. In IDR.
   *  Undefined for qualitative channel/OTA items — per-villa per-channel
   *  sample sizes in one month are too thin to size a reliable Rupiah
   *  estimate, so those are flagged without a number rather than a
   *  fabricated one. */
  estimatedImpactIdr?: number;
  confidence: Confidence;
  recommendation: string;
  /** Optional extra context line, e.g. a concrete empty-date range. */
  detail?: string;
}

export interface ChannelMetrics {
  channelKey: string;
  channelLabel: string;
  grossRevenue: number;
  bookingCount: number;
}

export interface BookingGap {
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  /** YYYY-MM-DD, inclusive. */
  endDate: string;
  nights: number;
}

/** Optional extra inputs for buildAttentionItems: passing `bookings` (plus
 *  `year`/`month`) enables concrete gap-date enrichment and the OTA/channel
 *  signals; passing `villaPlatformMap` (from buildVillaPlatformMap) enables
 *  the channel signals specifically. Everything here is optional so existing
 *  callers keep working unchanged. */
export interface AttentionContext {
  thresholds?: Partial<CockpitThresholds>;
  bookings?: Booking[];
  /** 1-12, matches buildVillaMetrics's month convention. */
  month?: number;
  year?: number;
  villaPlatformMap?: Map<string, Map<string, string>>;
}

export interface QuadrantResult {
  villaName: string;
  complex: string;
  quadrant: Quadrant;
  occupancyPct: number;
  adr: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

/** Sheets sometimes store occupancy as "65" (percent) and sometimes as "0.65"
 *  (fraction) depending on how the cell was formatted/exported. Normalize to
 *  a 0-1 fraction the same defensive way villaSheet.ts already does for
 *  pmFeeRate. */
function normalizeOccupancy(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 1 ? raw / 100 : raw;
}

function normalizeVillaKey(name: string): string {
  return String(name || '').toLowerCase().trim();
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function gradeFromScore(score: number): Grade {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Warning';
  return 'Poor';
}

/** Maps actual-vs-benchmark ratio to a 0-100 score. At ratio 1.0 (on
 *  benchmark) the score is 60 ("Good", not "perfect" — a villa exactly at
 *  the portfolio median isn't the standout, it's simply fine). Every 10%
 *  above/below benchmark moves the score ~10pts, clamped to [0,100].
 *  `higherIsBetter=false` inverts the direction (used for expense ratio). */
function scoreFromRatio(actual: number, benchmark: number, higherIsBetter: boolean): number {
  if (benchmark <= 0) return actual > 0 ? 70 : 50; // no real benchmark to compare against
  const ratio = actual / benchmark;
  const delta = (ratio - 1) * 100;
  const signed = higherIsBetter ? delta : -delta;
  return Math.max(0, Math.min(100, Math.round(60 + signed)));
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Joins Summary rows (for one year/month) with Villas rows (for `complex`)
 *  by villa name. Villas with no matching Summary row for the month are
 *  skipped — there's nothing to score them on. */
export function buildVillaMetrics(
  summaries: ParsedSummaryRecord[],
  villas: ParsedVillaRecord[],
  year: number,
  month: number
): VillaMetrics[] {
  const complexByName = new Map<string, string>();
  villas.forEach((v) => complexByName.set(normalizeVillaKey(v.name), v.complex || 'Unassigned'));

  const dim = daysInMonth(year, month);

  return summaries
    .filter((s) => s.year === year && s.month === month && s.villaName)
    .map((s) => {
      const key = normalizeVillaKey(s.villaName);
      const occupancyPct = normalizeOccupancy(s.occupancy);
      const bookedNights = s.bookedNights || Math.round(occupancyPct * dim);
      const adr = s.adr > 0 ? s.adr : bookedNights > 0 ? s.grossRevenue / bookedNights : 0;
      return {
        villaName: s.villaName,
        complex: complexByName.get(key) || 'Unassigned',
        investorCode: s.investorCode,
        grossRevenue: s.grossRevenue,
        operatingExpenses: s.operatingExpenses,
        netOperatingProfit: s.netOperatingProfit,
        occupancyPct,
        adr,
        bookedNights,
        daysInMonth: dim,
      } as VillaMetrics;
    })
    .filter((m) => m.grossRevenue > 0 || m.occupancyPct > 0);
}

function benchmarkFromGroup(group: VillaMetrics[]): Benchmark {
  return {
    occupancyPct: median(group.map((m) => m.occupancyPct)),
    adr: median(group.map((m) => m.adr)),
    noiMargin: median(group.map((m) => (m.grossRevenue > 0 ? m.netOperatingProfit / m.grossRevenue : 0))),
    expenseRatio: median(group.map((m) => (m.grossRevenue > 0 ? m.operatingExpenses / m.grossRevenue : 0))),
    sampleSize: group.length,
  };
}

export function computeBenchmarks(
  metrics: VillaMetrics[],
  thresholds: CockpitThresholds = DEFAULT_THRESHOLDS
): Benchmarks {
  const portfolio = benchmarkFromGroup(metrics);

  const byComplexGroups = new Map<string, VillaMetrics[]>();
  metrics.forEach((m) => {
    const arr = byComplexGroups.get(m.complex) || [];
    arr.push(m);
    byComplexGroups.set(m.complex, arr);
  });

  const byComplex: Record<string, Benchmark> = {};
  byComplexGroups.forEach((group, complex) => {
    if (group.length >= thresholds.minComplexGroupSize) {
      byComplex[complex] = benchmarkFromGroup(group);
    }
  });

  return { portfolio, byComplex };
}

/** Picks the complex-level benchmark when there's enough sibling villas,
 *  otherwise falls back to the portfolio benchmark. Also reports whether the
 *  fallback happened, since that affects confidence. */
export function resolveBenchmark(
  villa: VillaMetrics,
  benchmarks: Benchmarks
): { benchmark: Benchmark; usedComplex: boolean } {
  const complexBenchmark = benchmarks.byComplex[villa.complex];
  if (complexBenchmark) return { benchmark: complexBenchmark, usedComplex: true };
  return { benchmark: benchmarks.portfolio, usedComplex: false };
}

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

export function computeHealthScore(
  villa: VillaMetrics,
  benchmarks: Benchmarks,
  prevMonthVilla?: VillaMetrics,
  thresholds: CockpitThresholds = DEFAULT_THRESHOLDS
): HealthScoreResult {
  const { benchmark, usedComplex } = resolveBenchmark(villa, benchmarks);

  const occupancyScore = scoreFromRatio(villa.occupancyPct, benchmark.occupancyPct, true);
  const adrScore = scoreFromRatio(villa.adr, benchmark.adr, true);
  const villaMargin = villa.grossRevenue > 0 ? villa.netOperatingProfit / villa.grossRevenue : 0;
  const marginScore = scoreFromRatio(villaMargin, benchmark.noiMargin, true);
  const villaExpenseRatio = villa.grossRevenue > 0 ? villa.operatingExpenses / villa.grossRevenue : 0;
  const expensesScore = scoreFromRatio(villaExpenseRatio, benchmark.expenseRatio, false);

  const subscores: HealthScoreResult['subscores'] = {
    occupancy: {
      label: 'Occupancy',
      actual: villa.occupancyPct,
      benchmark: benchmark.occupancyPct,
      score: occupancyScore,
      grade: gradeFromScore(occupancyScore),
    },
    adr: {
      label: 'ADR',
      actual: villa.adr,
      benchmark: benchmark.adr,
      score: adrScore,
      grade: gradeFromScore(adrScore),
    },
    margin: {
      label: 'NOI margin',
      actual: villaMargin,
      benchmark: benchmark.noiMargin,
      score: marginScore,
      grade: gradeFromScore(marginScore),
    },
    expenses: {
      label: 'Expenses',
      actual: villaExpenseRatio,
      benchmark: benchmark.expenseRatio,
      score: expensesScore,
      grade: gradeFromScore(expensesScore),
    },
  };

  const weights = weightsFromThresholds(thresholds);
  let trendScore: number | undefined;
  if (prevMonthVilla && prevMonthVilla.grossRevenue > 0) {
    trendScore = scoreFromRatio(villa.grossRevenue, prevMonthVilla.grossRevenue, true);
    subscores.trend = {
      label: 'Booking trend',
      actual: villa.grossRevenue,
      benchmark: prevMonthVilla.grossRevenue,
      score: trendScore,
      grade: gradeFromScore(trendScore),
    };
  } else {
    // No trend available this month — redistribute its weight proportionally
    // across the other four so weights still sum to 1.
    const remaining = 1 - weights.trend;
    (Object.keys(weights) as Array<keyof typeof weights>).forEach((key) => {
      if (key !== 'trend') weights[key] = weights[key] / remaining;
    });
    weights.trend = 0;
  }

  const weightedScore =
    subscores.occupancy.score * weights.occupancy +
    subscores.adr.score * weights.adr +
    subscores.margin.score * weights.margin +
    subscores.expenses.score * weights.expenses +
    (trendScore ?? 0) * weights.trend;

  const score = Math.round(weightedScore);

  return {
    villaName: villa.villaName,
    complex: villa.complex,
    score,
    grade: gradeFromScore(score),
    // We only ever call this "medium" confidence — with a few months of
    // history and rules-based benchmarks, "high confidence" would overstate
    // what this actually is.
    confidence: usedComplex && trendScore !== undefined ? 'medium' : 'low',
    subscores,
  };
}

export function buildHealthScores(
  metrics: VillaMetrics[],
  benchmarks: Benchmarks,
  prevMonthMetrics?: VillaMetrics[],
  thresholds: CockpitThresholds = DEFAULT_THRESHOLDS
): HealthScoreResult[] {
  const prevByName = new Map<string, VillaMetrics>();
  (prevMonthMetrics || []).forEach((m) => prevByName.set(normalizeVillaKey(m.villaName), m));

  return metrics
    .map((v) => computeHealthScore(v, benchmarks, prevByName.get(normalizeVillaKey(v.villaName)), thresholds))
    .sort((a, b) => a.score - b.score); // worst first — that's what needs attention
}

// ---------------------------------------------------------------------------
// Attention items (Revenue Leakage & Opportunity)
// ---------------------------------------------------------------------------

function severityFromImpact(absImpact: number, thresholds: CockpitThresholds): Severity | null {
  if (absImpact < thresholds.minAttentionImpactIdr) return null;
  if (absImpact >= thresholds.severityCriticalIdr) return 'CRITICAL';
  if (absImpact >= thresholds.severityHighIdr) return 'HIGH';
  return 'MEDIUM';
}

export function buildAttentionItems(
  metrics: VillaMetrics[],
  benchmarks: Benchmarks,
  context: AttentionContext = {}
): AttentionItem[] {
  const thresholds = mergeThresholds(context.thresholds);
  const items: AttentionItem[] = [];

  metrics.forEach((villa) => {
    const { benchmark, usedComplex } = resolveBenchmark(villa, benchmarks);
    const confidence: Confidence = usedComplex ? 'medium' : 'low';

    // Occupancy gap -> estimated lost revenue from empty nights.
    if (benchmark.occupancyPct > 0) {
      const gapRatio = (benchmark.occupancyPct - villa.occupancyPct) / benchmark.occupancyPct;
      if (gapRatio >= thresholds.minGapRatio) {
        const missingNights = Math.round((benchmark.occupancyPct - villa.occupancyPct) * villa.daysInMonth);
        const adrForCalc = villa.adr > 0 ? villa.adr : benchmark.adr;
        const impact = -Math.round(missingNights * adrForCalc);
        const severity = severityFromImpact(Math.abs(impact), thresholds);
        if (severity) {
          let detail: string | undefined;
          if (context.bookings && context.year && context.month) {
            const gap = findLargestBookingGap(context.bookings, villa.villaName, context.year, context.month);
            if (gap && gap.nights >= 2) {
              detail =
                gap.startDate === gap.endDate
                  ? `Longest empty stretch: ${gap.startDate} (1 night)`
                  : `Longest empty stretch: ${gap.startDate} to ${gap.endDate} (${gap.nights} nights)`;
            }
          }
          items.push({
            villaName: villa.villaName,
            severity,
            metric: 'occupancy',
            title: `Occupancy ${Math.round(gapRatio * 100)}% below benchmark`,
            estimatedImpactIdr: impact,
            confidence,
            recommendation: 'Review pricing on empty dates and OTA availability/visibility.',
            detail,
          });
        }
      }
    }

    // ADR gap -> estimated pricing upside, only when occupancy is healthy
    // (if occupancy is already low, raising price is not the obvious move).
    if (benchmark.adr > 0 && villa.occupancyPct >= benchmark.occupancyPct * 0.85) {
      const gapRatio = (benchmark.adr - villa.adr) / benchmark.adr;
      if (gapRatio >= thresholds.minGapRatio) {
        const impact = Math.round((benchmark.adr - villa.adr) * villa.bookedNights);
        const severity = severityFromImpact(Math.abs(impact), thresholds);
        if (severity) {
          items.push({
            villaName: villa.villaName,
            severity,
            metric: 'adr',
            title: `ADR ${Math.round(gapRatio * 100)}% below comparable properties`,
            estimatedImpactIdr: impact,
            confidence,
            recommendation: 'Occupancy is healthy — test a price increase before the next booking window.',
          });
        }
      }
    }

    // Expense ratio anomaly -> potential saving.
    if (benchmark.expenseRatio > 0 && villa.grossRevenue > 0) {
      const villaExpenseRatio = villa.operatingExpenses / villa.grossRevenue;
      const gapRatio = (villaExpenseRatio - benchmark.expenseRatio) / benchmark.expenseRatio;
      if (gapRatio >= thresholds.minGapRatio) {
        const impact = Math.round((villaExpenseRatio - benchmark.expenseRatio) * villa.grossRevenue);
        const severity = severityFromImpact(Math.abs(impact), thresholds);
        if (severity) {
          items.push({
            villaName: villa.villaName,
            severity,
            metric: 'expenses',
            title: `Expenses ${Math.round(gapRatio * 100)}% above average`,
            estimatedImpactIdr: impact,
            confidence,
            recommendation: 'Check maintenance/utilities line items against the villa\u2019s expense log this month.',
          });
        }
      }
    }
  });

  // OTA/channel signals — qualitative, no sized Rupiah estimate (see
  // AttentionItem.estimatedImpactIdr comment for why).
  if (context.bookings && context.year && context.month) {
    const bookings = context.bookings;
    const year = context.year;
    const month = context.month;

    const portfolioChannels = buildPortfolioChannelMetrics(bookings, year, month);
    const portfolioTotal = portfolioChannels.reduce((sum, c) => sum + c.grossRevenue, 0);
    // "Direct" isn't an OTA/channel a villa can be "listed on", so it's
    // excluded from being the trigger for the missing/dormant checks below —
    // it still counts toward the revenue-share denominator above.
    const topChannel = portfolioChannels.find((c) => c.channelKey !== 'direct') || null;
    const topShare = topChannel && portfolioTotal > 0 ? topChannel.grossRevenue / portfolioTotal : 0;

    // "Dormant" only means something if the channel used to work for this
    // villa and then stopped — a villa that simply never books much through
    // a given OTA isn't malfunctioning there, it's just normal low-volume
    // variance. This index lets us check "did this villa+channel produce a
    // booking recently" in O(1) instead of rescanning all bookings per check.
    const channelActivityIndex = buildChannelActivityIndex(bookings);
    const lookbackMonths = thresholds.channelDormantLookbackMonths;

    metrics.forEach((villa) => {
      const platforms = context.villaPlatformMap?.get(villa.villaName);
      if (!platforms || platforms.size === 0) return; // no Listings-sheet match — nothing to check

      const villaChannels = buildVillaChannelMetrics(bookings, villa.villaName, year, month);
      const hasAnyBookingThisMonth = villaChannels.size > 0;

      if (topChannel) {
        if (!platforms.has(topChannel.channelKey)) {
          items.push({
            villaName: villa.villaName,
            severity: topShare >= 0.4 ? 'HIGH' : 'MEDIUM',
            metric: 'channel_missing',
            title: `Not listed on ${topChannel.channelLabel}, the portfolio's top channel`,
            confidence: 'low',
            recommendation: `${topChannel.channelLabel} drove ${Math.round(topShare * 100)}% of tracked booking revenue this month across the portfolio — consider adding a listing there.`,
          });
        } else if (hasAnyBookingThisMonth && !villaChannels.has(topChannel.channelKey)) {
          const lastActive = findLastChannelActivity(
            channelActivityIndex,
            villa.villaName,
            topChannel.channelKey,
            year,
            month,
            lookbackMonths
          );
          if (lastActive) {
            items.push({
              villaName: villa.villaName,
              severity: 'HIGH',
              metric: 'channel_dormant',
              title: `Listed on ${topChannel.channelLabel} but zero bookings this month`,
              confidence: 'low',
              recommendation: `${topChannel.channelLabel} is the portfolio's top channel — check that this listing is live, priced, and calendar-synced.`,
              detail: `Last booking via ${topChannel.channelLabel}: ${lastActive.year}-${String(lastActive.month).padStart(2, '0')}`,
            });
          }
        }
      }

      platforms.forEach((label, platformKey) => {
        if (topChannel && platformKey === topChannel.channelKey) return; // already handled above
        if (!hasAnyBookingThisMonth || villaChannels.has(platformKey)) return;
        // Only flag as dormant if this exact villa+channel pair actually
        // produced a booking within the lookback window — otherwise this
        // channel just isn't a meaningful source for this villa, and its
        // absence this month is not informative.
        const lastActive = findLastChannelActivity(channelActivityIndex, villa.villaName, platformKey, year, month, lookbackMonths);
        if (!lastActive) return;
        items.push({
          villaName: villa.villaName,
          severity: 'MEDIUM',
          metric: 'channel_dormant',
          title: `Listed on ${label} but zero bookings this month`,
          confidence: 'low',
          recommendation: 'Villa has other bookings this month, so check that this specific listing is live, priced, and synced (not paused or delisted).',
          detail: `Last booking via ${label}: ${lastActive.year}-${String(lastActive.month).padStart(2, '0')}`,
        });
      });
    });
  }

  const severityRank: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  return items.sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    return Math.abs(b.estimatedImpactIdr ?? 0) - Math.abs(a.estimatedImpactIdr ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Portfolio quadrants (Stars / Revenue Opportunity / Distribution Problem / Underperformers)
// ---------------------------------------------------------------------------

export function classifyQuadrants(metrics: VillaMetrics[], benchmarks: Benchmarks): QuadrantResult[] {
  return metrics.map((villa) => {
    const { benchmark } = resolveBenchmark(villa, benchmarks);
    const highOccupancy = benchmark.occupancyPct > 0 ? villa.occupancyPct >= benchmark.occupancyPct : true;
    const highAdr = benchmark.adr > 0 ? villa.adr >= benchmark.adr : true;

    let quadrant: Quadrant;
    if (highOccupancy && highAdr) quadrant = 'STAR';
    else if (highOccupancy && !highAdr) quadrant = 'REVENUE_OPPORTUNITY';
    else if (!highOccupancy && highAdr) quadrant = 'DISTRIBUTION_PROBLEM';
    else quadrant = 'UNDERPERFORMER';

    return {
      villaName: villa.villaName,
      complex: villa.complex,
      quadrant,
      occupancyPct: villa.occupancyPct,
      adr: villa.adr,
    };
  });
}
// ---------------------------------------------------------------------------
// Concrete gap dates
// ---------------------------------------------------------------------------

function parseDateOnly(dateStr: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Days since the epoch, computed from the date's own calendar fields (UTC)
 *  rather than via the local timezone — avoids the classic "YYYY-MM-DD
 *  parsed as UTC midnight then read back in local time" off-by-one-day bug. */
function dateOnlyToUtcDayIndex(dateStr: string): number | null {
  const parsed = parseDateOnly(dateStr);
  if (!parsed) return null;
  return Math.round(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 86_400_000);
}

function isCountedBookingStatus(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return s !== 'canceled' && s !== 'cancelled' && s !== 'inquiry';
}

/** Largest contiguous run of uncovered nights within one calendar month, from
 *  confirmed bookings for one villa. Returns null when the month is fully
 *  covered or there's nothing to compute from. `month` is 1-12. */
export function findLargestBookingGap(
  bookings: Booking[],
  villaName: string,
  year: number,
  month: number
): BookingGap | null {
  const key = normalizeVillaKey(villaName);
  const dim = daysInMonth(year, month);
  const covered = new Array(dim + 1).fill(false); // 1-indexed by day-of-month

  bookings.forEach((b) => {
    if (normalizeVillaKey(b.listingId) !== key) return;
    if (!isCountedBookingStatus(b.status)) return;
    const checkIn = dateOnlyToUtcDayIndex(b.checkInDate);
    const checkOut = dateOnlyToUtcDayIndex(b.checkOutDate);
    if (checkIn === null || checkOut === null) return;
    for (let d = checkIn; d < checkOut; d++) {
      const dt = new Date(d * 86_400_000);
      if (dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === month) {
        covered[dt.getUTCDate()] = true;
      }
    }
  });

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let day = 1; day <= dim; day++) {
    if (!covered[day]) {
      if (curLen === 0) curStart = day;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }

  if (bestLen === 0 || bestStart === -1) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStr = pad(month);
  return {
    startDate: `${year}-${monthStr}-${pad(bestStart)}`,
    endDate: `${year}-${monthStr}-${pad(bestStart + bestLen - 1)}`,
    nights: bestLen,
  };
}

// ---------------------------------------------------------------------------
// OTA / channel signals
// ---------------------------------------------------------------------------

function normalizeChannelKey(source: string): string {
  const trimmed = String(source || '').trim().toLowerCase();
  return trimmed || 'direct';
}

function channelLabelFromSource(source: string): string {
  const trimmed = String(source || '').trim();
  return trimmed || 'Direct';
}

function isCheckInInMonth(dateStr: string, year: number, month: number): boolean {
  const parsed = parseDateOnly(dateStr);
  if (!parsed) return false;
  return parsed.year === year && parsed.month === month;
}

function addChannelBooking(map: Map<string, ChannelMetrics>, source: string, accommodationFare: number) {
  const channelKey = normalizeChannelKey(source);
  const existing = map.get(channelKey) || {
    channelKey,
    channelLabel: channelLabelFromSource(source),
    grossRevenue: 0,
    bookingCount: 0,
  };
  existing.grossRevenue += accommodationFare || 0;
  existing.bookingCount += 1;
  map.set(channelKey, existing);
}

/** Revenue and booking count per source ("channel") for one villa, for
 *  bookings check-in-dated within the target month. Keys are lowercase
 *  channel names ("direct" for blank/unlabeled). */
export function buildVillaChannelMetrics(
  bookings: Booking[],
  villaName: string,
  year: number,
  month: number
): Map<string, ChannelMetrics> {
  const key = normalizeVillaKey(villaName);
  const out = new Map<string, ChannelMetrics>();
  bookings.forEach((b) => {
    if (normalizeVillaKey(b.listingId) !== key) return;
    if (!isCountedBookingStatus(b.status)) return;
    if (!isCheckInInMonth(b.checkInDate, year, month)) return;
    addChannelBooking(out, b.source, b.financials.accommodationFare);
  });
  return out;
}

/** Same as buildVillaChannelMetrics but portfolio-wide, sorted by revenue
 *  descending — used to find the single highest-revenue channel this month. */
export function buildPortfolioChannelMetrics(
  bookings: Booking[],
  year: number,
  month: number
): ChannelMetrics[] {
  const out = new Map<string, ChannelMetrics>();
  bookings.forEach((b) => {
    if (!isCountedBookingStatus(b.status)) return;
    if (!isCheckInInMonth(b.checkInDate, year, month)) return;
    addChannelBooking(out, b.source, b.financials.accommodationFare);
  });
  return Array.from(out.values()).sort((a, b) => b.grossRevenue - a.grossRevenue);
}

/** Index of every (villa, channel, year-month) combination that had at
 *  least one counted booking, built once per buildAttentionItems call so
 *  "did this villa+channel book recently" is an O(1) lookup instead of a
 *  full rescan per check. */
export function buildChannelActivityIndex(bookings: Booking[]): Set<string> {
  const index = new Set<string>();
  bookings.forEach((b) => {
    if (!isCountedBookingStatus(b.status)) return;
    const parsed = parseDateOnly(b.checkInDate);
    if (!parsed) return;
    const key = `${normalizeVillaKey(b.listingId)}|${normalizeChannelKey(b.source)}|${parsed.year}-${parsed.month}`;
    index.add(key);
  });
  return index;
}

/** Walks backward from the month before `month` (1-12) up to
 *  `lookbackMonths` months, returning the most recent {year, month} where
 *  this villa+channel pair had a booking, or null if none was found. */
export function findLastChannelActivity(
  index: Set<string>,
  villaName: string,
  channelKey: string,
  year: number,
  month: number,
  lookbackMonths: number
): { year: number; month: number } | null {
  const key = normalizeVillaKey(villaName);
  let y = year;
  let m = month;
  for (let i = 0; i < lookbackMonths; i++) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    if (index.has(`${key}|${channelKey}|${y}-${m}`)) return { year: y, month: m };
  }
  return null;
}

/** Maps each owned villa (by its Villas-sheet name) to the OTA platforms it
 *  has a usable listing URL for, per the Listings sheet — reusing the
 *  existing, deliberately-conservative name-matching from listingsSheet.ts
 *  (exact/normalized/alias only) rather than reimplementing matching logic.
 *  Value is platformKey -> display label (e.g. "airbnb" -> "Airbnb"). */
export function buildVillaPlatformMap(
  villas: ParsedVillaRecord[],
  listings: ListingRecord[]
): Map<string, Map<string, string>> {
  const analysis = analyzeListingsVillaNameMatches(listings, villas);
  const listingNameToMatchedVilla = new Map<string, string>();
  [...analysis.exact, ...analysis.normalized, ...analysis.alias].forEach((match) => {
    if (match.matchedVillaName) {
      listingNameToMatchedVilla.set(match.listingVillaName, match.matchedVillaName);
    }
  });

  const map = new Map<string, Map<string, string>>();
  listings.forEach((listing) => {
    const matchedVilla = listingNameToMatchedVilla.get(listing.villaName);
    if (!matchedVilla) return;
    const platformsForVilla = map.get(matchedVilla) || new Map<string, string>();
    platformsForVilla.set(listing.platformKey, listing.platform);
    map.set(matchedVilla, platformsForVilla);
  });
  return map;
}

// ---------------------------------------------------------------------------
// Year-to-date timelines (Health Score sparkline + OTA monthly breakdown)
// ---------------------------------------------------------------------------

export interface HealthScorePoint {
  year: number;
  /** 1-12 */
  month: number;
  score: number;
  grade: Grade;
}

/** One Health Score point per calendar month, January through `throughMonth`,
 *  for every villa that has data in that month. Deliberately 1 point/month
 *  (not sub-month) — the composite score depends on operatingExpenses/
 *  netOperatingProfit, which only exist at monthly resolution in the source
 *  sheets, so a finer-grained line would be fabricating precision the data
 *  doesn't have. Each month's score is computed against that month's own
 *  benchmarks (not today's), matching how buildHealthScores works elsewhere —
 *  a villa's trend reflects real month-over-month movement, not benchmark
 *  drift. Keyed by villaName exactly as it appears in the Villas/Summary
 *  sheets (same convention as VillaMetrics.villaName). */
export function buildHealthScoreTimeline(
  summaries: ParsedSummaryRecord[],
  villas: ParsedVillaRecord[],
  year: number,
  throughMonth: number,
  thresholds: CockpitThresholds = DEFAULT_THRESHOLDS
): Map<string, HealthScorePoint[]> {
  const timeline = new Map<string, HealthScorePoint[]>();

  for (let m = 1; m <= throughMonth; m++) {
    const metrics = buildVillaMetrics(summaries, villas, year, m);
    if (metrics.length === 0) continue;
    const benchmarks = computeBenchmarks(metrics, thresholds);

    let prevYear = year;
    let prevMonth = m - 1;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const prevMetrics = buildVillaMetrics(summaries, villas, prevYear, prevMonth);
    const prevByName = new Map<string, VillaMetrics>();
    prevMetrics.forEach((pm) => prevByName.set(normalizeVillaKey(pm.villaName), pm));

    metrics.forEach((villa) => {
      const hs = computeHealthScore(villa, benchmarks, prevByName.get(normalizeVillaKey(villa.villaName)), thresholds);
      const points = timeline.get(villa.villaName) || [];
      points.push({ year, month: m, score: hs.score, grade: hs.grade });
      timeline.set(villa.villaName, points);
    });
  }

  return timeline;
}

export interface ChannelMonthlyBreakdown {
  channelKey: string;
  channelLabel: string;
  /** One entry per month, January through the requested month — zero-filled
   *  for quiet months so the row reads as a complete Jan..current strip, not
   *  just the months where this channel happened to book. */
  monthlyCounts: Array<{ year: number; month: number; bookingCount: number; grossRevenue: number }>;
  totalBookingCount: number;
  totalGrossRevenue: number;
}

/** Year-to-date, month-by-month booking counts per OTA/channel for one
 *  villa, January through `throughMonth`. Channels with zero bookings all
 *  year are omitted entirely (nothing to show); a channel that booked at
 *  least once shows a complete zero-filled row so quiet months are visible
 *  as gaps, not missing data. Sorted by total booking count, most first. */
export function buildVillaChannelTimeline(
  bookings: Booking[],
  villaName: string,
  year: number,
  throughMonth: number
): ChannelMonthlyBreakdown[] {
  const perMonth: Map<string, ChannelMetrics>[] = [];
  for (let m = 1; m <= throughMonth; m++) {
    perMonth.push(buildVillaChannelMetrics(bookings, villaName, year, m));
  }

  const channelLabelByKey = new Map<string, string>();
  perMonth.forEach((monthMap) => {
    monthMap.forEach((cm, key) => {
      if (!channelLabelByKey.has(key)) channelLabelByKey.set(key, cm.channelLabel);
    });
  });

  const rows: ChannelMonthlyBreakdown[] = [];
  channelLabelByKey.forEach((channelLabel, channelKey) => {
    const monthlyCounts = perMonth.map((monthMap, idx) => {
      const cm = monthMap.get(channelKey);
      return {
        year,
        month: idx + 1,
        bookingCount: cm?.bookingCount || 0,
        grossRevenue: cm?.grossRevenue || 0,
      };
    });
    const totalBookingCount = monthlyCounts.reduce((sum, mc) => sum + mc.bookingCount, 0);
    const totalGrossRevenue = monthlyCounts.reduce((sum, mc) => sum + mc.grossRevenue, 0);
    rows.push({ channelKey, channelLabel, monthlyCounts, totalBookingCount, totalGrossRevenue });
  });

  return rows.sort((a, b) => b.totalBookingCount - a.totalBookingCount);
}
