import type { PPCSnapshot, PPCStatRow } from '@/lib/dashboard/types';
import { CampaignWatchlist } from './CampaignWatchlist';

const VAL_TONE = {
  neutral:  'text-[#e2e8f0]',
  positive: 'text-[#10b981]',
  warning:  'text-[#f59e0b]',
  critical: 'text-[#ef4444]',
} as const;

export function PPCAtAGlance({
  data, periodLabel,
}: {
  data: PPCSnapshot; periodLabel: string;
}) {
  return (
    <section className="bg-[#16161a] border border-[#1e1e2e] rounded-[6px] p-[11px]">
      <h3 className="text-[10px] tracking-[0.1em] text-[#3b82f6] mb-[9px] border-b border-[#1e1e2e] pb-[6px]">
        PPC AT A GLANCE
      </h3>

      <div className="text-[8px] text-[#475569] mb-1">{periodLabel}</div>

      {data.stats.map((s) => <StatRow key={s.id} stat={s} />)}

      <div className="text-[8px] tracking-[0.1em] text-[#3b82f6] mt-[10px] mb-[4px] flex items-center gap-[6px]">
        CAMPAIGN WATCHLIST
        <span className="text-[7px] px-1 py-[1px] rounded-[2px] bg-[#1e1e2e] text-[#475569] tracking-normal">
          pinned · search to add
        </span>
      </div>
      <CampaignWatchlist initial={data.campaigns} />
    </section>
  );
}

function StatRow({ stat }: { stat: PPCStatRow }) {
  return (
    <div className="flex justify-between items-baseline py-1 border-b border-[#1e1e2e]/30">
      <span className="text-[10px] text-[#64748b]">{stat.label}</span>
      <div className="text-right">
        <div className={`text-[12px] font-medium ${VAL_TONE[stat.tone ?? 'neutral']}`}>{stat.primary}</div>
        <div className="text-[8px] text-[#475569]">{stat.secondary}</div>
      </div>
    </div>
  );
}
