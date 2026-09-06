import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, HelpCircle, RotateCcw, Save, Settings2, X } from 'lucide-react';
import type { ParsedSummaryRecord } from '../lib/summarySheet';
import type { ParsedVillaRecord } from '../lib/villaSheet';
import type { ListingRecord } from '../lib/listingsSheet';
import type { Booking } from '../types';
import { formatCurrency, convertValue } from '../lib/utils';
import {
  buildVillaMetrics,
  computeBenchmarks,
  buildAttentionItems,
  buildHealthScores,
  buildHealthScoreTimeline,
  buildVillaChannelTimeline,
  classifyQuadrants,
  resolveBenchmark,
  buildVillaPlatformMap,
  mergeThresholds,
  DEFAULT_THRESHOLDS,
  type Severity,
  type Quadrant,
  type VillaMetrics,
  type Benchmarks,
  type CockpitThresholds,
  type HealthScorePoint,
  type ChannelMonthlyBreakdown,
} from '../lib/attentionEngine';

interface CockpitProps {
  villas: ParsedVillaRecord[];
  summaries: ParsedSummaryRecord[];
  bookings: Booking[];
  allListings: ListingRecord[];
  /** 0-based, matches the rest of the app's selectedMonth state. */
  month: number;
  year: number;
  currency: string;
}

const SEVERITY_STYLES: Record<Severity, { bg: string; text: string; dot: string; label: string }> = {
  CRITICAL: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: '🔴 Critical' },
  HIGH: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', label: '🟠 High' },
  MEDIUM: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', label: '🟡 Medium' },
};

const QUADRANT_META: Record<Quadrant, { title: string; hint: string; className: string }> = {
  STAR: {
    title: 'Stars',
    hint: 'High occupancy + high ADR. Don’t touch what’s working.',
    className: 'border-emerald-200 bg-emerald-50',
  },
  REVENUE_OPPORTUNITY: {
    title: 'Revenue Opportunity',
    hint: 'High occupancy + low ADR. Likely underpriced.',
    className: 'border-blue-200 bg-blue-50',
  },
  DISTRIBUTION_PROBLEM: {
    title: 'Distribution / Marketing Problem',
    hint: 'Good ADR + low occupancy. Demand or distribution issue.',
    className: 'border-purple-200 bg-purple-50',
  },
  UNDERPERFORMER: {
    title: 'Underperformers',
    hint: 'Low occupancy + low ADR. Needs a deeper look.',
    className: 'border-gray-300 bg-gray-50',
  },
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


const METRIC_LABEL: Record<'occupancy' | 'adr' | 'expenses' | 'channel_missing' | 'channel_dormant', string> = {
  occupancy: 'Occupancy',
  adr: 'ADR',
  expenses: 'Expenses',
  channel_missing: 'Channel coverage',
  channel_dormant: 'Channel activity',
};

function formatPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatCurrencyValue(value: number, currency: string) {
  return formatCurrency(convertValue(value, 'IDR', currency), currency);
}

function formatImpact(idr: number, currency: string) {
  const formatted = formatCurrencyValue(Math.abs(idr), currency);
  return idr < 0 ? `−${formatted}` : `+${formatted}`;
}

function gradeColor(grade: string) {
  if (grade === 'Excellent') return 'text-emerald-600';
  if (grade === 'Good') return 'text-blue-600';
  if (grade === 'Warning') return 'text-amber-600';
  return 'text-red-600';
}

function gradeBg(grade: string) {
  if (grade === 'Excellent') return 'bg-emerald-50 border-emerald-100';
  if (grade === 'Good') return 'bg-blue-50 border-blue-100';
  if (grade === 'Warning') return 'bg-amber-50 border-amber-100';
  return 'bg-red-50 border-red-100';
}

/** Formats a SubScore's raw actual/benchmark number the way that particular
 *  metric should read (percent vs currency). */
function formatSubValue(label: string, value: number, currency: string) {
  if (label === 'ADR' || label === 'Booking trend') return formatCurrencyValue(value, currency);
  return formatPct(value); // Occupancy, NOI margin, Expenses are all ratios
}

function strokeForGrade(grade: string) {
  if (grade === 'Excellent') return '#059669';
  if (grade === 'Good') return '#2563eb';
  if (grade === 'Warning') return '#d97706';
  return '#dc2626';
}

const TREND_LABEL_COL = '120px';
const TREND_TOTAL_COL = '64px';

/** Year-to-date Health Score trend (1 point/month, Jan through the selected
 *  month) drawn on the SAME column grid as the bookings-by-channel table
 *  below it, so each month's dot sits exactly above that month's column and
 *  dashed guide lines run from the chart down through the table. The score
 *  value is printed above every dot in its grade colour, so the trend is
 *  readable without hovering.
 *
 *  Deliberately monthly, not sub-month: the composite score depends on
 *  expense/margin data that only exists at monthly resolution in the source
 *  sheets, so a finer line would fabricate precision the data doesn't have.
 *
 *  The connecting line is an SVG with a viewBox of exactly `monthNum` units
 *  wide, stretched over the month columns (preserveAspectRatio="none"), so
 *  x = month - 0.5 lands on each column's centre without any pixel
 *  measurement; dots are plain HTML so they stay round at any width. */
function HealthTrendAndChannels({
  points,
  channels,
  monthNum,
  year,
}: {
  points: HealthScorePoint[];
  channels: ChannelMonthlyBreakdown[];
  monthNum: number;
  year: number;
}) {
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `${TREND_LABEL_COL} repeat(${monthNum}, minmax(0, 1fr)) ${TREND_TOTAL_COL}`,
  };
  const pointByMonth = new Map<number, HealthScorePoint>();
  points.forEach((p) => pointByMonth.set(p.month, p));
  const months = Array.from({ length: monthNum }, (_, i) => i + 1);

  // Chart track: leave headroom at the top for the value labels.
  const trackClass = 'absolute left-0 right-0 top-[16px] bottom-[6px]';
  const yPct = (score: number) => 100 - Math.max(0, Math.min(100, score));
  const linePoints = months
    .filter((m) => pointByMonth.has(m))
    .map((m) => `${m - 0.5},${yPct(pointByMonth.get(m)!.score)}`)
    .join(' ');

  return (
    <div className="mt-4 pt-3 border-t border-brand-muted/10">
      <div className="text-[10px] text-brand-muted uppercase font-bold tracking-wide mb-1">
        Health Score trend {'\u2014'} Jan {year} to date
      </div>

      {points.length === 0 ? (
        <p className="text-[10px] text-brand-muted italic mb-2">No Health Score data yet for this villa this year.</p>
      ) : (
        <div className="grid h-[68px]" style={gridStyle}>
          <div className="text-[10px] text-brand-muted self-end pb-1.5" style={{ gridColumn: 1, gridRow: 1 }}>
            Score
          </div>
          {months.map((m) => {
            const p = pointByMonth.get(m);
            return (
              <div key={m} className="relative" style={{ gridColumn: m + 1, gridRow: 1 }}>
                <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-brand-navy/20" />
                {p && (
                  <div className={trackClass}>
                    <div
                      className="absolute left-1/2 -translate-x-1/2 -translate-y-full text-[11px] font-bold leading-none bg-white px-0.5"
                      style={{ top: `calc(${yPct(p.score)}% - 6px)`, color: strokeForGrade(p.grade) }}
                      title={`${MONTH_NAMES[m - 1]} ${p.year}: ${p.score} (${p.grade})`}
                    >
                      {p.score}
                    </div>
                    <div
                      className="absolute left-1/2 w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2 ring-2 ring-white"
                      style={{ top: `${yPct(p.score)}%`, backgroundColor: strokeForGrade(p.grade) }}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div className="relative pointer-events-none" style={{ gridColumn: `2 / span ${monthNum}`, gridRow: 1 }}>
            <div className={trackClass}>
              <svg className="block w-full h-full" viewBox={`0 0 ${monthNum} 100`} preserveAspectRatio="none">
                <polyline points={linePoints} fill="none" stroke="#94a3b8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          </div>
        </div>
      )}

      <div className="text-[10px] text-brand-muted uppercase font-bold tracking-wide mt-2 mb-1">
        Bookings by channel {'\u2014'} year to date
      </div>

      <div className="grid text-[11px]" style={gridStyle}>
        <div className="text-left text-brand-muted font-bold py-1.5 border-b border-brand-muted/10">Channel</div>
        {months.map((m) => (
          <div key={m} className="relative text-center text-brand-muted font-bold py-1.5 border-b border-brand-muted/10">
            <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-brand-navy/[0.06]" />
            {MONTH_NAMES[m - 1]}
          </div>
        ))}
        <div className="text-center text-brand-muted font-bold py-1.5 border-b border-brand-muted/10">Total</div>
      </div>

      {channels.length === 0 ? (
        <p className="text-[10px] text-brand-muted italic mt-1.5">No bookings recorded year-to-date.</p>
      ) : (
        channels.map((ch) => (
          <div key={ch.channelKey} className="grid text-[11px]" style={gridStyle}>
            <div className="text-left text-brand-navy font-medium py-1.5 border-b border-brand-muted/10 truncate pr-2">
              {ch.channelLabel}
            </div>
            {ch.monthlyCounts.map((mc) => (
              <div
                key={`${mc.year}-${mc.month}`}
                className={`relative text-center py-1.5 border-b border-brand-muted/10 ${
                  mc.bookingCount === 0 ? 'text-brand-muted/40' : 'text-brand-navy'
                }`}
              >
                <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-brand-navy/[0.06]" />
                <span className="relative bg-white px-0.5">{mc.bookingCount || '\u00B7'}</span>
              </div>
            ))}
            <div className="text-center font-bold text-brand-navy py-1.5 border-b border-brand-muted/10">{ch.totalBookingCount}</div>
          </div>
        ))
      )}
    </div>
  );
}

function MethodologyPanel({ onClose, thresholds }: { onClose: () => void; thresholds: CockpitThresholds }) {
  return (
    <div className="bg-white border border-brand-muted/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-bold text-brand-navy">How the Cockpit calculates this</h3>
        <button onClick={onClose} className="text-brand-muted hover:text-brand-navy flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4 text-xs text-brand-navy/80 leading-relaxed">
        <div>
          <p className="font-bold text-brand-navy mb-1">1. Benchmark — what "normal" means</p>
          <p>
            For every villa we compare occupancy, ADR, NOI margin and expense ratio against the <b>median</b> of
            comparable villas — villas in the same complex, as long as that complex has at least{' '}
            <b>{thresholds.minComplexGroupSize}</b> villas with data this month. Smaller or single-villa complexes fall
            back to the whole-portfolio median instead, so there's always something to compare against.
          </p>
        </div>

        <div>
          <p className="font-bold text-brand-navy mb-1">2. Attention items — is it worth flagging?</p>
          <p>
            A gap only becomes an attention item once it's at least <b>{Math.round(thresholds.minGapRatio * 100)}%</b>{' '}
            off benchmark <i>and</i> the estimated Rupiah effect clears{' '}
            <b>{formatCurrency(thresholds.minAttentionImpactIdr, 'IDR')}</b> — small gaps are noise, not decisions.
            Severity is just that estimated amount: ≥{formatCurrency(thresholds.severityCriticalIdr, 'IDR')} is
            Critical, ≥{formatCurrency(thresholds.severityHighIdr, 'IDR')} is High, the rest is Medium. These
            thresholds are configurable — see the "Thresholds" button above.
          </p>
          <ul className="list-disc list-inside mt-1.5 space-y-1">
            <li><b>Occupancy gap</b> → (benchmark occupancy − actual occupancy) × days in month × ADR = estimated lost revenue from empty nights. When a concrete empty-date stretch of 2+ nights exists this month, it's shown alongside the item.</li>
            <li><b>ADR gap</b> → (benchmark ADR − actual ADR) × booked nights = estimated pricing upside. Only shown when occupancy is already healthy — if occupancy is also low, raising price isn't the obvious first move.</li>
            <li><b>Expense anomaly</b> → (actual expense ratio − benchmark expense ratio) × gross revenue = potential saving.</li>
            <li><b>Channel coverage / activity</b> → qualitative flags, not sized in Rupiah (per-villa, per-channel, one-month sample sizes are too thin for a reliable estimate): a villa not listed on the portfolio's single highest-revenue channel this month, or listed somewhere it <i>previously</i> got bookings from (within the lookback window below) but got zero from this month while still getting bookings elsewhere — a villa that simply never books much through a given OTA isn't flagged for it.</li>
          </ul>
        </div>

        <div>
          <p className="font-bold text-brand-navy mb-1">3. Health Score — the 0–100 number</p>
          <p>
            Each factor gets a 0–100 sub-score: <b>60</b> means the villa is exactly on benchmark ("Good" — not
            perfect, just normal); every 10% the villa is above or below benchmark moves that sub-score by roughly
            10 points, capped at 0–100. The overall score is a weighted average — Occupancy{' '}
            {Math.round(thresholds.weightOccupancy * 100)}%, ADR {Math.round(thresholds.weightAdr * 100)}%,
            NOI margin {Math.round(thresholds.weightMargin * 100)}%, Expenses{' '}
            {Math.round(thresholds.weightExpenses * 100)}%, and Booking trend{' '}
            {Math.round(thresholds.weightTrend * 100)}% when a previous month exists (if not, that weight is
            redistributed across the other four).
          </p>
        </div>

        <div>
          <p className="font-bold text-brand-navy mb-1">4. Portfolio quadrants</p>
          <p>
            Each villa is simply above/below benchmark on two axes — occupancy and ADR — which sorts every villa
            into one of four groups: <b>Stars</b> (both high), <b>Revenue Opportunity</b> (occupancy high, ADR low —
            likely underpriced), <b>Distribution Problem</b> (ADR fine, occupancy low — demand/visibility issue), or
            <b> Underperformer</b> (both low).
          </p>
        </div>

        <div>
          <p className="font-bold text-brand-navy mb-1">Confidence — read this as a caveat, not a stat</p>
          <p>
            "Medium" means the comparison used a real complex-level benchmark (Health Score also needs last month's
            data for the trend factor); "Low" means it fell back to the whole-portfolio benchmark, or there's no
            prior month to compare against yet. Either way, this is rules-based math against the current sheet data
            — not a statistical model — so treat every number here as a starting point for a conversation, not a verdict.
          </p>
        </div>
      </div>
    </div>
  );
}

function ThresholdsPanel({
  draft,
  onChange,
  onSave,
  onReset,
  saving,
  error,
  onClose,
}: {
  draft: Partial<CockpitThresholds>;
  onChange: (next: Partial<CockpitThresholds>) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const value = (field: keyof CockpitThresholds): number => {
    const v = draft[field];
    return typeof v === 'number' ? v : DEFAULT_THRESHOLDS[field];
  };

  const setField = (field: keyof CockpitThresholds, raw: string) => {
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    onChange({ ...draft, [field]: num });
  };

  const weightTotal =
    value('weightOccupancy') + value('weightAdr') + value('weightMargin') + value('weightExpenses') + value('weightTrend');

  const weightFields: Array<[keyof CockpitThresholds, string]> = [
    ['weightOccupancy', 'Occupancy'],
    ['weightAdr', 'ADR'],
    ['weightMargin', 'NOI margin'],
    ['weightExpenses', 'Expenses'],
    ['weightTrend', 'Booking trend'],
  ];

  return (
    <div className="bg-white border border-brand-muted/15 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-brand-navy">Tune the Cockpit's thresholds</h3>
          <p className="text-[11px] text-brand-muted mt-0.5">
            Changes apply portfolio-wide for everyone with Cockpit access, right after saving.
          </p>
        </div>
        <button onClick={onClose} className="text-brand-muted hover:text-brand-navy flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="text-xs text-brand-navy/80 space-y-1 block">
          <span className="font-bold block">Min. villas for a complex benchmark</span>
          <input
            type="number"
            min={1}
            step={1}
            value={value('minComplexGroupSize')}
            onChange={(e) => setField('minComplexGroupSize', e.target.value)}
            className="w-full border border-brand-muted/20 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <span className="text-[10px] text-brand-muted block">Default {DEFAULT_THRESHOLDS.minComplexGroupSize}</span>
        </label>

        <label className="text-xs text-brand-navy/80 space-y-1 block">
          <span className="font-bold block">Min. gap vs benchmark to flag (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(value('minGapRatio') * 100)}
            onChange={(e) => setField('minGapRatio', String(Number(e.target.value) / 100))}
            className="w-full border border-brand-muted/20 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <span className="text-[10px] text-brand-muted block">Default {Math.round(DEFAULT_THRESHOLDS.minGapRatio * 100)}%</span>
        </label>

        <label className="text-xs text-brand-navy/80 space-y-1 block">
          <span className="font-bold block">Min. Rupiah impact to bother flagging</span>
          <input
            type="number"
            min={0}
            step={100000}
            value={value('minAttentionImpactIdr')}
            onChange={(e) => setField('minAttentionImpactIdr', e.target.value)}
            className="w-full border border-brand-muted/20 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <span className="text-[10px] text-brand-muted block">
            Default {formatCurrency(DEFAULT_THRESHOLDS.minAttentionImpactIdr, 'IDR')}
          </span>
        </label>

        <div />

        <label className="text-xs text-brand-navy/80 space-y-1 block">
          <span className="font-bold block">High severity from (Rupiah)</span>
          <input
            type="number"
            min={0}
            step={1000000}
            value={value('severityHighIdr')}
            onChange={(e) => setField('severityHighIdr', e.target.value)}
            className="w-full border border-brand-muted/20 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <span className="text-[10px] text-brand-muted block">
            Default {formatCurrency(DEFAULT_THRESHOLDS.severityHighIdr, 'IDR')}
          </span>
        </label>

        <label className="text-xs text-brand-navy/80 space-y-1 block">
          <span className="font-bold block">Critical severity from (Rupiah)</span>
          <input
            type="number"
            min={0}
            step={1000000}
            value={value('severityCriticalIdr')}
            onChange={(e) => setField('severityCriticalIdr', e.target.value)}
            className="w-full border border-brand-muted/20 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <span className="text-[10px] text-brand-muted block">
            Default {formatCurrency(DEFAULT_THRESHOLDS.severityCriticalIdr, 'IDR')}
          </span>
        </label>

        <label className="text-xs text-brand-navy/80 space-y-1 block">
          <span className="font-bold block">Channel-dormant lookback (months)</span>
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            value={value('channelDormantLookbackMonths')}
            onChange={(e) => setField('channelDormantLookbackMonths', e.target.value)}
            className="w-full border border-brand-muted/20 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <span className="text-[10px] text-brand-muted block">
            A listed channel only counts as "gone dormant" if it booked within this many months. Default {DEFAULT_THRESHOLDS.channelDormantLookbackMonths}.
          </span>
        </label>
      </div>

      <div>
        <p className="text-xs font-bold text-brand-navy mb-2">
          Health Score weights (should add up to 100% — currently {Math.round(weightTotal * 100)}%)
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {weightFields.map(([field, label]) => (
            <label key={field} className="text-xs text-brand-navy/80 space-y-1 block">
              <span className="font-bold block">{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={Math.round(value(field) * 100)}
                onChange={(e) => setField(field, String(Number(e.target.value) / 100))}
                className="w-full border border-brand-muted/20 rounded-lg px-2 py-1.5 text-sm"
              />
            </label>
          ))}
        </div>
        {Math.round(weightTotal * 100) !== 100 && (
          <p className="text-[10px] text-amber-600 mt-1.5">
            These don't add up to 100% — scores will still compute, just proportionally off from what the
            percentages above suggest.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-bold text-white bg-brand-navy rounded-full px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={onReset}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-bold text-brand-muted hover:text-brand-navy bg-white border border-brand-muted/20 rounded-full px-4 py-2 transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

export function Cockpit({ villas, summaries, bookings, allListings, month, year, currency }: CockpitProps) {
  const [showMethodology, setShowMethodology] = useState(false);
  const [showThresholds, setShowThresholds] = useState(false);
  const [isAttentionCenterOpen, setIsAttentionCenterOpen] = useState(true);

  const [savedThresholds, setSavedThresholds] = useState<Partial<CockpitThresholds>>({});
  const [thresholdDraft, setThresholdDraft] = useState<Partial<CockpitThresholds>>({});
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/cockpit/thresholds', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        setSavedThresholds(data || {});
        setThresholdDraft(data || {});
      })
      .catch(() => {});
  }, []);

  const handleSaveThresholds = useCallback(() => {
    setThresholdSaving(true);
    setThresholdError(null);
    fetch('/api/admin/cockpit/thresholds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(thresholdDraft),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || 'Failed to save thresholds');
        setSavedThresholds(data.thresholds || {});
        setThresholdDraft(data.thresholds || {});
      })
      .catch((err: any) => setThresholdError(err?.message || 'Failed to save thresholds'))
      .finally(() => setThresholdSaving(false));
  }, [thresholdDraft]);

  const handleResetThresholds = useCallback(() => {
    setThresholdSaving(true);
    setThresholdError(null);
    fetch('/api/admin/cockpit/thresholds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(DEFAULT_THRESHOLDS),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || 'Failed to reset thresholds');
        setSavedThresholds(data.thresholds || {});
        setThresholdDraft(data.thresholds || {});
      })
      .catch((err: any) => setThresholdError(err?.message || 'Failed to reset thresholds'))
      .finally(() => setThresholdSaving(false));
  }, []);

  const effectiveThresholds = useMemo(() => mergeThresholds(savedThresholds), [savedThresholds]);

  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    summaries.forEach((s) => {
      if (s.year && s.month) keys.add(`${s.year}-${s.month}`);
    });
    return Array.from(keys)
      .map((k) => {
        const [y, m] = k.split('-').map(Number);
        return { year: y, month: m };
      })
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));
  }, [summaries]);

  const { attentionItems, healthScores, quadrants, sampleSize, metricsByName, benchmarks } = useMemo(() => {
    const monthNum = month + 1; // ParsedSummaryRecord.month is 1-12
    const metrics = buildVillaMetrics(summaries, villas, year, monthNum);

    let prevYear = year;
    let prevMonthNum = monthNum - 1;
    if (prevMonthNum < 1) {
      prevMonthNum = 12;
      prevYear -= 1;
    }
    const prevMetrics = buildVillaMetrics(summaries, villas, prevYear, prevMonthNum);

    const benchmarks = computeBenchmarks(metrics, effectiveThresholds);
    const metricsByName = new Map<string, VillaMetrics>();
    metrics.forEach((m) => metricsByName.set(m.villaName, m));

    const villaPlatformMap = buildVillaPlatformMap(villas, allListings);

    return {
      attentionItems: buildAttentionItems(metrics, benchmarks, {
        thresholds: effectiveThresholds,
        bookings,
        year,
        month: monthNum,
        villaPlatformMap,
      }),
      healthScores: buildHealthScores(metrics, benchmarks, prevMetrics, effectiveThresholds),
      quadrants: classifyQuadrants(metrics, benchmarks),
      sampleSize: metrics.length,
      metricsByName,
      benchmarks,
    };
  }, [villas, summaries, bookings, allListings, month, year, effectiveThresholds]);

  // Year-to-date Health Score sparkline (1 point/month, Jan through the
  // selected month) — computed once per render rather than per-card so the
  // per-month benchmark recomputation (buildHealthScoreTimeline re-derives
  // each month's own benchmarks, matching how the rest of the engine works)
  // doesn't repeat across every villa card.
  const healthScoreTimelines = useMemo(() => {
    const monthNum = month + 1;
    return buildHealthScoreTimeline(summaries, villas, year, monthNum, effectiveThresholds);
  }, [summaries, villas, year, month, effectiveThresholds]);

  // Year-to-date top-OTA monthly booking counts per villa, keyed by
  // villaName (same key as healthScores/hs.villaName).
  const villaChannelTimelines = useMemo(() => {
    const monthNum = month + 1;
    const map = new Map<string, ChannelMonthlyBreakdown[]>();
    healthScores.forEach((hs) => {
      map.set(hs.villaName, buildVillaChannelTimeline(bookings, hs.villaName, year, monthNum));
    });
    return map;
  }, [healthScores, bookings, year, month]);

  const quadrantGroups = useMemo(() => {
    const groups: Record<Quadrant, typeof quadrants> = {
      STAR: [],
      REVENUE_OPPORTUNITY: [],
      DISTRIBUTION_PROBLEM: [],
      UNDERPERFORMER: [],
    };
    quadrants.forEach((q) => groups[q.quadrant].push(q));
    return groups;
  }, [quadrants]);

  const villaInvestorByName = useMemo(() => {
    const map = new Map<string, string>();
    villas.forEach((v) => map.set(v.name, v.investorName || ''));
    return map;
  }, [villas]);

  if (sampleSize === 0) {
    return (
      <div className="bg-white border border-brand-muted/10 rounded-2xl p-10 text-center">
        <AlertCircle className="w-8 h-8 text-brand-muted mx-auto mb-3" />
        <p className="text-sm font-bold text-brand-navy">No Summary data for this month yet</p>
        <p className="text-xs text-brand-muted mt-1">
          The Summary sheet has no rows for this villa/month combination — this reads the Summary tab directly, independent of the SHEETS/API booking-source toggle above.
        </p>
        {availableMonths.length > 0 ? (
          <p className="text-xs text-brand-muted mt-3">
            Months with Summary data right now:{' '}
            <span className="font-bold text-brand-navy">
              {availableMonths.map((m) => `${MONTH_NAMES[m.month - 1]} ${m.year}`).join(', ')}
            </span>
          </p>
        ) : (
          <p className="text-xs text-brand-muted mt-3">
            In fact, no month has Summary data yet at all — check the Summary tab in Google Sheets.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* METHODOLOGY / THRESHOLDS TOGGLES */}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowThresholds((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-bold text-brand-navy bg-white border border-brand-muted/20 rounded-full px-3 py-1.5 hover:bg-brand-bg/40 transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Thresholds
        </button>
        <button
          onClick={() => setShowMethodology((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-bold text-brand-navy bg-white border border-brand-muted/20 rounded-full px-3 py-1.5 hover:bg-brand-bg/40 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          How this is calculated
        </button>
      </div>
      {showThresholds && (
        <ThresholdsPanel
          draft={thresholdDraft}
          onChange={setThresholdDraft}
          onSave={handleSaveThresholds}
          onReset={handleResetThresholds}
          saving={thresholdSaving}
          error={thresholdError}
          onClose={() => setShowThresholds(false)}
        />
      )}
      {showMethodology && <MethodologyPanel onClose={() => setShowMethodology(false)} thresholds={effectiveThresholds} />}

      {/* ATTENTION CENTER */}
      <div className="bg-white border border-brand-muted/10 rounded-2xl overflow-hidden shadow-sm">
        <button
          onClick={() => setIsAttentionCenterOpen((v) => !v)}
          className="w-full p-5 border-b border-brand-muted/10 bg-brand-bg/30 flex items-center justify-between text-left"
        >
          <div>
            <h3 className="text-sm font-bold text-brand-navy">What needs your attention</h3>
            <p className="text-[11px] text-brand-muted mt-0.5">
              {attentionItems.length} item{attentionItems.length === 1 ? '' : 's'} across {sampleSize} villa
              {sampleSize === 1 ? '' : 's'} this month
            </p>
          </div>
          {isAttentionCenterOpen ? (
            <ChevronUp className="w-4 h-4 text-brand-muted flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-brand-muted flex-shrink-0" />
          )}
        </button>

        {isAttentionCenterOpen && (attentionItems.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-brand-navy">Nothing above threshold right now</p>
            <p className="text-xs text-brand-muted mt-1">No villa is off-benchmark by enough to matter financially.</p>
          </div>
        ) : (
          <div className="divide-y divide-brand-muted/10">
            {attentionItems.map((item, idx) => {
              const style = SEVERITY_STYLES[item.severity];
              const villaMetric = metricsByName.get(item.villaName);
              const isSizedMetric = item.metric === 'occupancy' || item.metric === 'adr' || item.metric === 'expenses';
              const { benchmark, usedComplex } = villaMetric
                ? resolveBenchmark(villaMetric, benchmarks)
                : { benchmark: benchmarks.portfolio, usedComplex: false };

              let actualLabel = '';
              let benchmarkLabel = '';
              if (villaMetric && isSizedMetric) {
                if (item.metric === 'occupancy') {
                  actualLabel = formatPct(villaMetric.occupancyPct);
                  benchmarkLabel = formatPct(benchmark.occupancyPct);
                } else if (item.metric === 'adr') {
                  actualLabel = formatCurrencyValue(villaMetric.adr, currency);
                  benchmarkLabel = formatCurrencyValue(benchmark.adr, currency);
                } else {
                  const ratio = villaMetric.grossRevenue > 0 ? villaMetric.operatingExpenses / villaMetric.grossRevenue : 0;
                  actualLabel = formatPct(ratio);
                  benchmarkLabel = formatPct(benchmark.expenseRatio);
                }
              }

              return (
                <div key={idx} className={`p-4 flex items-start gap-3 ${style.bg}`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${style.text}`}>
                        {style.label}
                      </span>
                      <span className="text-sm font-bold text-brand-navy">{item.villaName}</span>
                    </div>
                    <p className="text-xs text-brand-navy/80 mt-1">{item.title}</p>
                    {villaMetric && isSizedMetric && (
                      <p className="text-[11px] text-brand-muted mt-1">
                        <b>{METRIC_LABEL[item.metric]}:</b> {actualLabel} actual vs {benchmarkLabel} benchmark ·{' '}
                        {usedComplex ? `${villaMetric.complex} villas` : 'whole portfolio'} (n={benchmark.sampleSize})
                      </p>
                    )}
                    <p className="text-[11px] text-brand-muted mt-1">{item.recommendation}</p>
                    {item.detail && <p className="text-[11px] text-brand-navy/70 mt-1 italic">{item.detail}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {typeof item.estimatedImpactIdr === 'number' ? (
                      <>
                        <div className={`text-sm font-bold ${item.estimatedImpactIdr < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatImpact(item.estimatedImpactIdr, currency)}
                        </div>
                        <div className="text-[10px] text-brand-muted mt-0.5">
                          {item.estimatedImpactIdr < 0 ? 'est. impact' : 'est. opportunity'} · {item.confidence} confidence
                        </div>
                      </>
                    ) : (
                      <div className="text-[10px] text-brand-muted mt-0.5 max-w-[140px]">
                        Qualitative flag · {item.confidence} confidence
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* PORTFOLIO QUADRANTS */}
      <div>
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
          <h3 className="text-sm font-bold text-brand-navy">Portfolio structure</h3>
          <p className="text-[11px] text-brand-muted">
            Portfolio benchmark: {formatPct(benchmarks.portfolio.occupancyPct)} occupancy ·{' '}
            {formatCurrencyValue(benchmarks.portfolio.adr, currency)} ADR (n={benchmarks.portfolio.sampleSize}). Each
            villa is actually compared against its own complex when that complex has {effectiveThresholds.minComplexGroupSize}+ villas.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          {(Object.keys(QUADRANT_META) as Quadrant[]).map((q) => {
            const meta = QUADRANT_META[q];
            const group = quadrantGroups[q];
            return (
              <div key={q} className={`rounded-2xl border p-4 ${meta.className}`}>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-bold text-brand-navy">{meta.title}</h4>
                  <span className="text-xs font-bold text-brand-navy/60">{group.length}</span>
                </div>
                <p className="text-[11px] text-brand-muted mb-3">{meta.hint}</p>
                <div className="flex flex-col gap-2">
                  {group.length === 0 ? (
                    <span className="text-[11px] text-brand-muted italic">None this month</span>
                  ) : (
                    group.map((v) => (
                      <div
                        key={v.villaName}
                        className="w-full flex items-center justify-between gap-3 bg-white/70 border border-black/5 rounded-lg px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-brand-navy leading-tight">{v.villaName}</div>
                          <div className="text-[11px] text-brand-muted font-normal mt-0.5">
                            {formatPct(v.occupancyPct)} occ · {formatCurrencyValue(v.adr, currency)}
                          </div>
                        </div>
                        <div className="text-[11px] text-brand-muted text-right flex-shrink-0 max-w-[45%] truncate">
                          {villaInvestorByName.get(v.villaName) || '—'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* HEALTH SCORES */}
      <div>
        <div className="mb-3">
          <h3 className="text-sm font-bold text-brand-navy">Property Health Score</h3>
          <p className="text-[11px] text-brand-muted mt-0.5">Worst-scoring villas first — every factor is shown, actual vs benchmark</p>
        </div>
        <div className="space-y-3">
          {healthScores.map((hs) => {
            const subscoreList = [hs.subscores.occupancy, hs.subscores.adr, hs.subscores.margin, hs.subscores.expenses, hs.subscores.trend].filter(
              (sub): sub is NonNullable<typeof sub> => Boolean(sub)
            );
            const villaMetric = metricsByName.get(hs.villaName);
            const { benchmark: peerBenchmark, usedComplex } = villaMetric
              ? resolveBenchmark(villaMetric, benchmarks)
              : { benchmark: benchmarks.portfolio, usedComplex: false };
            const peerGroupLabel = usedComplex
              ? `${villaMetric!.complex} villas (n=${peerBenchmark.sampleSize})`
              : `whole portfolio — ${villaMetric?.complex || 'this complex'} doesn't have ${effectiveThresholds.minComplexGroupSize}+ villas with data (n=${peerBenchmark.sampleSize})`;
            return (
              <div key={hs.villaName} className="bg-white border border-brand-muted/10 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-4 mb-1">
                  <div className={`text-2xl font-bold w-14 text-center flex-shrink-0 ${gradeColor(hs.grade)}`}>{hs.score}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-brand-navy">{hs.villaName}</span>
                      <span className="text-[10px] text-brand-muted">{hs.complex}</span>
                    </div>
                    <span className={`text-[11px] font-bold ${gradeColor(hs.grade)}`}>{hs.grade}</span>
                    <span className="text-[10px] text-brand-muted ml-2">({hs.confidence} confidence)</span>
                  </div>
                </div>
                <p className="text-[10px] text-brand-muted mb-3 pl-[72px]">Occupancy/ADR/margin/expenses benchmarked against: {peerGroupLabel}</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {subscoreList.map((sub) => (
                    <div key={sub.label} className={`rounded-xl p-2.5 border ${gradeBg(sub.grade)}`}>
                      <div className="text-[10px] text-brand-muted uppercase font-bold tracking-wide">{sub.label}</div>
                      <div className={`text-xs font-bold ${gradeColor(sub.grade)}`}>{sub.grade}</div>
                      <div className="text-[10px] text-brand-navy/70 mt-0.5">
                        {formatSubValue(sub.label, sub.actual, currency)} vs {formatSubValue(sub.label, sub.benchmark, currency)}
                        {sub.label === 'Booking trend' && <span className="block text-brand-muted">(vs last month, same villa)</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <HealthTrendAndChannels
                  points={healthScoreTimelines.get(hs.villaName) || []}
                  channels={villaChannelTimelines.get(hs.villaName) || []}
                  monthNum={month + 1}
                  year={year}
                />
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-brand-muted text-center px-4">
        These scores are rules-based heuristics against this month's portfolio benchmarks — not a statistical model. Treat
        them as a starting point for investigation, not a verdict.
      </p>
    </div>
  );
}
