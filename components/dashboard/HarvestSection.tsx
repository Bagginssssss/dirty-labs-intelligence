'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { HarvestRow } from '@/lib/dashboard/types';
import { fmtRoas, fmtUSDCompact } from '@/lib/dashboard/format';

type Tier = 'ready' | 'investigation';

function roasTone(r: number | null): string {
  if (r == null) return 'text-[#94a3b8]';
  if (r >= 5)    return 'text-[#10b981]';
  if (r >= 3.33) return 'text-[#10b981]';
  if (r >= 2.5)  return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}

function TierRow({
  label, count, secondary, tone, active, onClick,
}: {
  label: string;
  count: number;
  secondary: string;
  tone: 'positive' | 'warning' | 'neutral';
  active: boolean;
  onClick: () => void;
}) {
  const colorMap = {
    positive: 'text-[#10b981]',
    warning:  'text-[#f59e0b]',
    neutral:  'text-[#e2e8f0]',
  } as const;

  return (
    <button
      onClick={onClick}
      className="w-full flex justify-between items-baseline py-1 border-b border-[#1e1e2e]/30 hover:bg-[#1e1e2e]/20 transition-colors rounded-[2px] px-0.5 group"
    >
      <span className="text-[10px] text-[#64748b] flex items-center gap-1">
        {label}
        <ChevronDown
          size={8}
          className={`opacity-40 group-hover:opacity-70 transition-transform ${active ? 'rotate-180' : ''}`}
        />
      </span>
      <div className="text-right">
        <div className={`text-[12px] font-medium ${colorMap[tone]}`}>{count} terms</div>
        <div className="text-[8px] text-[#475569]">{secondary}</div>
      </div>
    </button>
  );
}

export function HarvestSection({ ready, investigation }: {
  ready: HarvestRow[];
  investigation: HarvestRow[];
}) {
  const [expanded, setExpanded] = useState<Tier | null>(null);

  function toggle(tier: Tier) {
    setExpanded(e => e === tier ? null : tier);
  }

  const rows = expanded === 'ready' ? ready : expanded === 'investigation' ? investigation : [];

  return (
    <div>
      <TierRow
        label="Harvest — ready"
        count={ready.length}
        secondary="ROAS ≥ 3.33 · ≥ 2 orders · ≥ 10 clicks"
        tone={ready.length > 0 ? 'positive' : 'neutral'}
        active={expanded === 'ready'}
        onClick={() => toggle('ready')}
      />
      <TierRow
        label="Harvest — investigating"
        count={investigation.length}
        secondary="ROAS 2.5–3.33 · ≥ 2 orders · ≥ 10 clicks"
        tone={investigation.length > 0 ? 'warning' : 'neutral'}
        active={expanded === 'investigation'}
        onClick={() => toggle('investigation')}
      />

      {expanded && rows.length > 0 && (
        <div className="mt-1.5 mb-1">
          <table className="w-full border-collapse text-[8px]">
            <thead>
              <tr className="text-left">
                <th className="text-[7px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e]">SEARCH TERM</th>
                <th className="text-[7px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e] text-right">ROAS</th>
                <th className="text-[7px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e] text-right">ORDERS</th>
                <th className="text-[7px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e] text-right">SPEND</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-[#1e1e2e]/40">
                  <td className="py-[2px] px-1 border-b border-[#1e1e2e]/30 whitespace-nowrap truncate max-w-[18ch] text-[#94a3b8]" title={r.search_term}>
                    {r.search_term}
                    {r.campaign_name && (
                      <span className="ml-1 text-[#475569]">· {r.campaign_name}</span>
                    )}
                  </td>
                  <td className={`py-[2px] px-1 border-b border-[#1e1e2e]/30 text-right whitespace-nowrap ${roasTone(r.roas)}`}>
                    {fmtRoas(r.roas)}
                  </td>
                  <td className="py-[2px] px-1 border-b border-[#1e1e2e]/30 text-right whitespace-nowrap text-[#475569]">
                    {r.orders}
                  </td>
                  <td className="py-[2px] px-1 border-b border-[#1e1e2e]/30 text-right whitespace-nowrap text-[#475569]">
                    {fmtUSDCompact(r.spend, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expanded && rows.length === 0 && (
        <div className="text-[8px] text-[#334155] py-1.5 text-center">No candidates in this period</div>
      )}
    </div>
  );
}
