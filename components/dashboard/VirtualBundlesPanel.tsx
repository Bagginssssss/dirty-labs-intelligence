/**
 * VirtualBundlesPanel — full virtual bundle visualization including
 * brand-level time series, per-bundle small multiples, and click-
 * through drill-down with margin/profit detail.
 *
 * Currently NOT rendered in the Command Center dashboard. Preserved
 * for future use in the planned business dashboard surface (separate
 * from Command Center). When that surface is built, import this
 * component there.
 *
 * Data dependency: loadVirtualBundles in lib/dashboard/data.ts.
 * Returns VirtualBundleData with latest snapshot, WoW/QoQ
 * comparisons, brand time series, and per-bundle time series.
 */
'use client';

import { useState } from 'react';
import type { VirtualBundleData, VirtualBundleSnapshot } from '@/lib/dashboard/types';
import { fmtUSD, fmtUSDCompact, fmtPctSigned, fmtPct } from '@/lib/dashboard/format';

// ─── SVG helpers ──────────────────────────────────────────────────────────────

type Pt = { date: string; value: number };

function buildSvgPath(
  points: Pt[],
  w: number,
  h: number,
  pad: number,
  gapDays = 10,
): string {
  if (points.length === 0) return '';
  const dates = points.map(p => new Date(p.date + 'T00:00:00Z').getTime());
  const vals = points.map(p => p.value);
  const minD = Math.min(...dates);
  const maxD = Math.max(...dates);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const rangeD = maxD - minD || 1;
  const rangeV = maxV - minV || 1;
  const GAP_MS = gapDays * 86_400_000;

  const scaleX = (t: number) => pad + ((t - minD) / rangeD) * (w - 2 * pad);
  const scaleY = (v: number) => (h - pad) - ((v - minV) / rangeV) * (h - 2 * pad);

  let path = '';
  for (let i = 0; i < points.length; i++) {
    const x = scaleX(dates[i]).toFixed(1);
    const y = scaleY(vals[i]).toFixed(1);
    const isGap = i > 0 && (dates[i] - dates[i - 1]) > GAP_MS;
    path += `${i === 0 || isGap ? 'M' : 'L'} ${x} ${y} `;
  }
  return path.trim();
}

function buildDots(
  points: Pt[],
  w: number,
  h: number,
  pad: number,
): { cx: string; cy: string }[] {
  if (points.length === 0) return [];
  const dates = points.map(p => new Date(p.date + 'T00:00:00Z').getTime());
  const vals = points.map(p => p.value);
  const minD = Math.min(...dates);
  const maxD = Math.max(...dates);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const rangeD = maxD - minD || 1;
  const rangeV = maxV - minV || 1;
  const scaleX = (t: number) => pad + ((t - minD) / rangeD) * (w - 2 * pad);
  const scaleY = (v: number) => (h - pad) - ((v - minV) / rangeV) * (h - 2 * pad);
  return points.map((p, i) => ({
    cx: scaleX(dates[i]).toFixed(1),
    cy: scaleY(vals[i]).toFixed(1),
  }));
}

// ─── Brand-level time series chart ────────────────────────────────────────────

function TrendChart({ series }: {
  series: Array<{ snapshot_date: string; total_sales_90d: number }>;
}) {
  if (series.length === 0) return null;
  const W = 400; const H = 80; const PAD = 6;
  const pts: Pt[] = series.map(s => ({ date: s.snapshot_date, value: s.total_sales_90d }));
  const path = buildSvgPath(pts, W, H, PAD);
  const dots = buildDots(pts, W, H, PAD);
  const maxV = Math.max(...series.map(s => s.total_sales_90d));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      className="overflow-visible"
      aria-hidden
    >
      {/* Horizontal grid lines at 0%, 50%, 100% */}
      {[0, 0.5, 1].map(t => {
        const y = (H - PAD) - t * (H - 2 * PAD);
        return (
          <line
            key={t}
            x1={PAD} y1={y} x2={W - PAD} y2={y}
            stroke="#1e1e2e" strokeWidth={1}
          />
        );
      })}
      {/* Max label */}
      <text x={W - PAD} y={PAD + 3} textAnchor="end" fontSize={7} fill="#475569">
        {fmtUSDCompact(maxV, 0)}
      </text>
      {/* Trend path */}
      <path d={path} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Dots */}
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={2} fill="#3b82f6" />
      ))}
    </svg>
  );
}

// ─── Per-bundle sparkline ──────────────────────────────────────────────────────

function Sparkline({ points }: { points: Array<{ snapshot_date: string; sales_90d: number }> }) {
  if (points.length < 2) return <div className="h-[30px]" />;
  const W = 80; const H = 30; const PAD = 2;
  const pts: Pt[] = points.map(p => ({ date: p.snapshot_date, value: p.sales_90d }));
  const path = buildSvgPath(pts, W, H, PAD, 14);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden>
      <path d={path} fill="none" stroke="#3b82f6" strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Drill-down modal ──────────────────────────────────────────────────────────

function BundleModal({
  data,
  bundleAsin,
  onClose,
  vbData,
}: {
  data: VirtualBundleData;
  bundleAsin: string;
  onClose: () => void;
  vbData: VirtualBundleData;
}) {
  const bundleSeries = data.perBundleTimeSeries.find(b => b.bundle_asin === bundleAsin);
  if (!bundleSeries) return null;

  const latestBundle = data.latest?.per_bundle.find(b => b.bundle_asin === bundleAsin) ?? null;
  const priorBundle  = data.wow.prior?.per_bundle.find(b => b.bundle_asin === bundleAsin) ?? null;
  const qoqBundle    = data.qoq.prior?.per_bundle.find(b => b.bundle_asin === bundleAsin) ?? null;

  const wowPct = latestBundle && priorBundle && priorBundle.sales_90d > 0
    ? (latestBundle.sales_90d - priorBundle.sales_90d) / priorBundle.sales_90d
    : null;
  const qoqPct = latestBundle && qoqBundle && qoqBundle.sales_90d > 0
    ? (latestBundle.sales_90d - qoqBundle.sales_90d) / qoqBundle.sales_90d
    : null;

  const hasMargin = latestBundle?.margin_pct != null && latestBundle.profit_90d != null;

  const W = 400; const H = 100; const PAD = 8;
  const pts: Pt[] = bundleSeries.points.map(p => ({ date: p.snapshot_date, value: p.sales_90d }));
  const path = buildSvgPath(pts, W, H, PAD);
  const dots = buildDots(pts, W, H, PAD);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#16161a] border border-[#1e1e2e] rounded-[6px] p-[16px] w-full max-w-[480px] mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-[10px]">
          <div>
            <div className="text-[10px] font-medium text-[#e2e8f0]">{bundleSeries.bundle_name ?? bundleAsin}</div>
            <div className="text-[8px] text-[#475569]">{bundleAsin}</div>
          </div>
          <button
            onClick={onClose}
            className="text-[#475569] hover:text-[#94a3b8] text-[14px] leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-[6px] mb-[10px]">
          <StatCard
            label="Latest 90d"
            value={latestBundle ? fmtUSDCompact(latestBundle.sales_90d, 0) : '—'}
          />
          <StatCard
            label="vs Last Week"
            value={wowPct != null ? fmtPctSigned(wowPct) : '—'}
            tone={wowPct != null ? (wowPct > 0 ? 'pos' : wowPct < 0 ? 'neg' : 'neutral') : 'neutral'}
          />
          <StatCard
            label="vs Last Quarter"
            value={qoqPct != null ? fmtPctSigned(qoqPct) : '—'}
            tone={qoqPct != null ? (qoqPct > 0 ? 'pos' : qoqPct < 0 ? 'neg' : 'neutral') : 'neutral'}
          />
        </div>

        {/* Margin / profit row — only when populated */}
        {hasMargin && latestBundle && (
          <div className="bg-[#111113] rounded-[3px] px-[8px] py-[5px] mb-[10px]">
            <span className="text-[9px] text-[#94a3b8]">
              {fmtUSD(latestBundle.sales_90d, 0)} revenue
              {' · '}~{fmtUSD(latestBundle.profit_90d!, 0)} profit
              {' · '}{fmtPct(latestBundle.margin_pct!)} margin
            </span>
          </div>
        )}

        {/* Per-bundle chart */}
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden>
          {[0, 0.5, 1].map(t => {
            const y = (H - PAD) - t * (H - 2 * PAD);
            return <line key={t} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#1e1e2e" strokeWidth={1} />;
          })}
          <path d={path} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          {dots.map((d, i) => <circle key={i} cx={d.cx} cy={d.cy} r={2.5} fill="#3b82f6" />)}
        </svg>

        <div className="text-[8px] text-[#475569] mt-[6px]">
          {bundleSeries.points.length} weekly snapshots · 90-day rolling window
          {wowPct !== null && Math.abs(wowPct) < 0.005 && (
            <span className="ml-1 text-[#f59e0b]">· WoW = 0% (overlapping windows, 1-week shift)</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, tone = 'neutral',
}: {
  label: string; value: string; tone?: 'pos' | 'neg' | 'neutral';
}) {
  const valueColor =
    tone === 'pos' ? 'text-[#10b981]'
    : tone === 'neg' ? 'text-[#ef4444]'
    : 'text-[#e2e8f0]';
  return (
    <div className="bg-[#111113] rounded-[3px] px-[7px] py-[5px]">
      <div className="text-[8px] text-[#475569] mb-[2px]">{label}</div>
      <div className={`text-[12px] font-medium leading-tight ${valueColor}`}>{value}</div>
    </div>
  );
}

// ─── Bundle grid cell ─────────────────────────────────────────────────────────

function BundleCell({
  bundle_asin,
  bundle_name,
  points,
  latestSales,
  onClick,
}: {
  bundle_asin: string;
  bundle_name: string | null;
  points: Array<{ snapshot_date: string; sales_90d: number }>;
  latestSales: number;
  onClick: () => void;
}) {
  const shortName = bundle_name ?? bundle_asin.slice(-6);
  return (
    <button
      onClick={onClick}
      className="bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-[6px] py-[5px] text-left hover:border-[#3b82f6]/40 transition-colors w-full"
    >
      <div className="text-[7.5px] text-[#94a3b8] truncate mb-[2px]" title={bundle_name ?? bundle_asin}>
        {shortName}
      </div>
      <Sparkline points={points} />
      <div className="text-[8px] font-medium text-[#e2e8f0] mt-[2px]">
        {fmtUSDCompact(latestSales, 0)}
      </div>
    </button>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function VirtualBundlesPanel({ data }: { data: VirtualBundleData }) {
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);

  const latest = data.latest;
  const wowPct = data.wow.change_pct;
  const qoqPct = data.qoq.change_pct;

  const isEmpty = !latest;

  // Build latestSalesMap for quick lookup in grid cells
  const latestSalesMap = new Map<string, number>();
  if (latest) {
    for (const b of latest.per_bundle) {
      latestSalesMap.set(b.bundle_asin, b.sales_90d);
    }
  }

  return (
    <>
      <section className="bg-[#16161a] border border-[#1e1e2e] rounded-[6px] p-[11px]">
        <h3 className="text-[10px] tracking-[0.1em] text-[#3b82f6] mb-[9px] border-b border-[#1e1e2e] pb-[6px]">
          VIRTUAL BUNDLES
          {latest && (
            <span className="ml-2 text-[7px] px-1 py-[1px] rounded-[2px] bg-[#1e1e2e] text-[#475569] tracking-normal">
              90-day · as of {latest.snapshot_date}
            </span>
          )}
        </h3>

        {isEmpty ? (
          <div className="text-[9px] text-[#475569]">No snapshot data. Upload the weekly VB aggregate report via /upload.</div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-[6px] mb-[9px]">
              <StatCard label="VB Total (last 90d)" value={fmtUSDCompact(latest.total_sales_90d, 0)} />
              <StatCard
                label="vs Last Week"
                value={wowPct != null ? fmtPctSigned(wowPct) : '—'}
                tone={wowPct != null ? (wowPct > 0.001 ? 'pos' : wowPct < -0.001 ? 'neg' : 'neutral') : 'neutral'}
              />
              <StatCard
                label="vs Last Quarter"
                value={qoqPct != null ? fmtPctSigned(qoqPct) : '—'}
                tone={qoqPct != null ? (qoqPct > 0.001 ? 'pos' : qoqPct < -0.001 ? 'neg' : 'neutral') : 'neutral'}
              />
            </div>

            {/* QoQ caveat for rolling-window overlap */}
            {data.qoq.prior && (
              <div className="text-[7.5px] text-[#475569] mb-[6px]">
                QoQ vs Week {data.qoq.prior.week_number} ({data.qoq.prior.snapshot_date}).
                90-day windows overlap — change reflects the marginal non-overlapping portion.
                {data.wow.prior && Math.abs(wowPct ?? 0) < 0.005 && (
                  <span className="text-[#f59e0b] ml-1">WoW ≈ 0%: latest two snapshots share nearly identical windows.</span>
                )}
              </div>
            )}

            {/* Brand-level time series */}
            <div className="text-[8px] tracking-[0.1em] text-[#3b82f6] mb-[4px]">TREND · {data.timeSeries.length} SNAPSHOTS</div>
            <div className="mb-[9px]">
              <TrendChart series={data.timeSeries} />
              <div className="flex justify-between text-[7px] text-[#475569] mt-[2px]">
                <span>{data.timeSeries[0]?.snapshot_date}</span>
                <span>{data.timeSeries.at(-1)?.snapshot_date}</span>
              </div>
            </div>

            {/* Per-bundle small multiples */}
            <div className="text-[8px] tracking-[0.1em] text-[#3b82f6] mb-[4px]">
              PER BUNDLE · {data.perBundleTimeSeries.length} ACTIVE · click for detail
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-[5px]">
              {data.perBundleTimeSeries.map(b => (
                <BundleCell
                  key={b.bundle_asin}
                  bundle_asin={b.bundle_asin}
                  bundle_name={b.bundle_name}
                  points={b.points}
                  latestSales={latestSalesMap.get(b.bundle_asin) ?? 0}
                  onClick={() => setSelectedAsin(b.bundle_asin)}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {selectedAsin && (
        <BundleModal
          data={data}
          bundleAsin={selectedAsin}
          onClose={() => setSelectedAsin(null)}
          vbData={data}
        />
      )}
    </>
  );
}
