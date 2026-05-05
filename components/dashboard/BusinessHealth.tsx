'use client';

import { useState } from 'react';
import type {
  BusinessHealthData, CVRBuyBoxRow, MarketShareView, SSCards, BundleCards, SubcategoryRankRow,
} from '@/lib/dashboard/types';
import { fmtPct, fmtPctSigned, fmtRank, fmtUSDCompact, fmtIntCompact } from '@/lib/dashboard/format';

export function BusinessHealth({
  data, periodLabel,
}: {
  data: BusinessHealthData; periodLabel: string;
}) {
  return (
    <section className="bg-[#16161a] border border-[#1e1e2e] rounded-[6px] p-[11px]">
      <h3 className="text-[10px] tracking-[0.1em] text-[#3b82f6] mb-[9px] border-b border-[#1e1e2e] pb-[6px]">
        BUSINESS HEALTH
      </h3>

      <SubLabel>SUBCATEGORY RANK <Tag>SmartScout · SP-API pending</Tag></SubLabel>
      {data.subcategoryRanks.map((r) => <SubcategoryRow key={r.key} row={r} />)}

      <SubLabel>MARKET SHARE</SubLabel>
      <MarketShareSection views={data.marketShare} defaultKey={data.defaultMarketShareKey} />

      <SubLabel>CVR / BUY BOX</SubLabel>
      <CVRBuyBoxTable rows={data.cvrBuyBox} />

      <SubLabel>SUBSCRIBE & SAVE</SubLabel>
      <SSGrid cards={data.ss} />

      <SubLabel>BUNDLE PERFORMANCE <Tag>{`90-day · ${data.bundles.windowLabel}`}</Tag></SubLabel>
      <BundlesGrid cards={data.bundles} />
    </section>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[8px] tracking-[0.1em] text-[#3b82f6] mt-[7px] mb-[4px] flex items-center gap-[6px]">
      {children}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[7px] px-1 py-[1px] rounded-[2px] bg-[#1e1e2e] text-[#475569] tracking-normal">
      {children}
    </span>
  );
}

function SubcategoryRow({ row }: { row: SubcategoryRankRow }) {
  return (
    <div className="flex justify-between items-center py-[3px] border-b border-[#1e1e2e]/50 last:border-0">
      <div className="min-w-0">
        <div className="text-[9px] text-[#94a3b8] truncate">{row.label}</div>
        {row.topAsins.length > 0 && (
          <div className="text-[8px] text-[#475569] truncate">{row.topAsins.join(' · ')}</div>
        )}
      </div>
      <div className="text-right shrink-0 ml-2">
        {row.rank != null ? (
          <>
            <div className="text-[12px] font-medium text-[#3b82f6] leading-none">{fmtRank(row.rank)}</div>
            <div className="text-[8px] text-[#475569] mt-[1px]">
              {row.revenuePerMonth != null ? `${fmtUSDCompact(row.revenuePerMonth, 0)}/mo` : '—'}
            </div>
          </>
        ) : (
          <div className="text-[9px] text-[#475569]">Upload report</div>
        )}
      </div>
    </div>
  );
}

function MarketShareSection({
  views, defaultKey,
}: {
  views: MarketShareView[]; defaultKey: MarketShareView['subcategory'];
}) {
  const [active, setActive] = useState<MarketShareView['subcategory']>(defaultKey);
  const view = views.find((v) => v.subcategory === active) ?? views[0];

  // Most recent snapshot date across any view that has data — shown in empty state copy
  const anySnapshotDate = views.reduce<string | null>((best, v) => {
    if (v.rows.length > 0 && v.snapshotDate && (!best || v.snapshotDate > best)) return v.snapshotDate;
    return best;
  }, null);

  return (
    <div>
      <div className="flex gap-1 mb-[5px]">
        {views.map((v) => (
          <button
            key={v.subcategory}
            onClick={() => setActive(v.subcategory)}
            className={`text-[8px] px-[7px] py-[2px] rounded-[3px] border transition-colors ${
              v.subcategory === active
                ? 'bg-[#3b82f6]/15 border-[#3b82f6] text-[#3b82f6]'
                : 'bg-[#111113] border-[#1e1e2e] text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {!view || view.rows.length === 0 ? (
        <div>
          <div className="text-[9px] text-[#475569]">Upload report</div>
          {anySnapshotDate && (
            <div className="text-[8px] text-[#2a2a3a] mt-[1px]">as of {anySnapshotDate}</div>
          )}
        </div>
      ) : (
        view.rows.slice(0, 6).map((r) => <MarketShareBar key={r.brand} row={r} />)
      )}
    </div>
  );
}

function MarketShareBar({ row }: { row: { brand: string; share: number; mom: number | null; isOurs: boolean } }) {
  const brandColor = row.isOurs ? 'text-[#10b981]' : 'text-[#94a3b8]';
  const barColor = row.isOurs ? 'bg-[#10b981]' : 'bg-[#475569]';
  const momColor =
    row.mom == null ? 'text-[#64748b]'
    : row.mom > 0 ? 'text-[#10b981]'
    : row.mom < 0 ? 'text-[#ef4444]'
    : 'text-[#64748b]';
  return (
    <div className="flex items-center gap-[6px] py-[2px]">
      <span className={`text-[9px] min-w-[76px] ${brandColor}`}>{row.brand}</span>
      <div className="flex-1 h-[3px] bg-[#1e1e2e] rounded-[2px] overflow-hidden">
        <div className={`h-[3px] rounded-[2px] ${barColor}`} style={{ width: `${Math.max(2, row.share * 100)}%` }} />
      </div>
      <span className="text-[8px] text-[#64748b] min-w-[28px] text-right">{Math.round(row.share * 100)}%</span>
      <span className={`text-[8px] min-w-[32px] text-right ${momColor}`}>
        {row.mom == null ? '—' : fmtPctSigned(row.mom, 1)}
      </span>
    </div>
  );
}

function CVRBuyBoxTable({ rows }: { rows: CVRBuyBoxRow[] }) {
  if (rows.length === 0) {
    return <div className="text-[9px] text-[#475569] italic">No product data.</div>;
  }
  return (
    <table className="w-full border-collapse text-[9px]">
      <thead>
        <tr className="text-left">
          <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e]">PRODUCT</th>
          <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e]">CVR</th>
          <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e]">VS AVG</th>
          <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e]">BUY BOX</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => <CVRRow key={r.asin} row={r} />)}
      </tbody>
    </table>
  );
}

function CVRRow({ row }: { row: CVRBuyBoxRow }) {
  const cvrColor =
    row.cvrTrend === 'above' ? 'text-[#10b981]'
    : row.cvrTrend === 'below' ? 'text-[#f59e0b]'
    : 'text-[#94a3b8]';
  const cvrArrow =
    row.cvrTrend === 'above' ? '↑'
    : row.cvrTrend === 'below' ? '↓'
    : '→';
  const cvrSuffix =
    row.cvrTrend === 'above' && row.cvr > 0.6 ? ' top'
    : row.cvrTrend === 'below' && row.cvr < 0.25 ? ' low'
    : '';
  const bbColor =
    row.buyBox >= 0.95 ? 'text-[#10b981]'
    : row.buyBox >= 0.90 ? 'text-[#f59e0b]'
    : 'text-[#ef4444]';
  const bbMarker = row.buyBox >= 0.95 ? ' ✓' : row.buyBox < 0.90 ? ' ⚠' : '';
  return (
    <tr>
      <td className="py-[3px] px-1 text-[#94a3b8] border-b border-[#1e1e2e]/30">{row.asinShortName}</td>
      <td className={`py-[3px] px-1 border-b border-[#1e1e2e]/30 ${cvrColor}`}>{fmtPct(row.cvr, 1)}</td>
      <td className={`py-[3px] px-1 border-b border-[#1e1e2e]/30 ${cvrColor}`}>{cvrArrow}{cvrSuffix}</td>
      <td className={`py-[3px] px-1 border-b border-[#1e1e2e]/30 ${bbColor}`}>{fmtPct(row.buyBox, 1)}{bbMarker}</td>
    </tr>
  );
}

function SSGrid({ cards }: { cards: SSCards }) {
  return (
    <div className="grid grid-cols-3 gap-[5px] mt-1">
      <MiniCard label="Active subs"  value={cards.activeSubs ? fmtIntCompact(cards.activeSubs) : '—'}   mom={cards.activeSubsMoM}  nullLabel="first snapshot" nullLabelItalic />
      <MiniCard label="S&S revenue"  value={cards.ssRevenue ? fmtUSDCompact(cards.ssRevenue) : '—'}       mom={cards.ssRevenueMoM}   nullLabel="first snapshot" nullLabelItalic />
      <MiniCard label="Penetration"  value={cards.penetration != null ? fmtPct(cards.penetration) : '—'} mom={cards.penetrationMoM} nullLabel="first snapshot" nullLabelItalic />
    </div>
  );
}

function BundlesGrid({ cards }: { cards: BundleCards }) {
  const isEmpty = cards.revenue === 0 && cards.units === 0;
  return (
    <div className="grid grid-cols-3 gap-[5px] mt-1">
      <MiniCard label="Revenue"     value={cards.revenue ? fmtUSDCompact(cards.revenue) : '—'} mom={cards.revenueWoW} momLabel="WoW" />
      <MiniCard
        label="% of total"
        value={cards.shareOfTotal != null ? fmtPct(cards.shareOfTotal) : '—'}
        mom={cards.shareOfTotalChange}
        momLabel="pts"
        momIsPoints
      />
      <MiniCard label="Units sold"  value={cards.units ? fmtIntCompact(cards.units) : '—'} mom={cards.unitsWoW} momLabel="WoW" />
      {isEmpty && (
        <div className="col-span-3 text-[8px] text-[#475569] mt-[2px]">
          No bundle activity in 90-day window{cards.lastUploadDate ? ` · last upload ${cards.lastUploadDate}` : ''}.
        </div>
      )}
    </div>
  );
}

function MiniCard({
  label, value, mom, momLabel = 'MoM', momIsPoints, nullLabel, nullLabelItalic,
}: {
  label: string; value: string;
  mom?: number | null;
  momLabel?: string;
  momIsPoints?: boolean;
  nullLabel?: string;
  nullLabelItalic?: boolean;
}) {
  let momText = '';
  let momTone = 'text-[#64748b]';
  let momItalic = false;
  if (mom == null) {
    momText = nullLabel ?? '';
    momItalic = !!nullLabelItalic;
  } else {
    const sign = mom > 0 ? '+' : '';
    const num = momIsPoints ? mom.toFixed(1) : (mom * 100).toFixed(1);
    momText = `${sign}${num}${momIsPoints ? 'pts' : `% ${momLabel}`}`;
    momTone = mom > 0 ? 'text-[#10b981]' : mom < 0 ? 'text-[#ef4444]' : 'text-[#64748b]';
  }
  return (
    <div className="bg-[#111113] rounded-[3px] px-[7px] py-[5px]">
      <div className="text-[8px] text-[#475569] mb-[2px]">{label}</div>
      <div className="text-[11px] font-medium text-[#e2e8f0]">{value}</div>
      {momText && (
        <div className={`text-[8px] mt-[1px] ${momTone}${momItalic ? ' italic' : ''}`}>{momText}</div>
      )}
    </div>
  );
}
