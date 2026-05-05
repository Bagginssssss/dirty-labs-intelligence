import type { RankMover } from '@/lib/dashboard/types';
import { fmtRank } from '@/lib/dashboard/format';

export function KeywordRankMovers({
  movers, windowLabel,
}: {
  movers: RankMover[]; windowLabel: string;
}) {
  const filtered = movers.filter((m) => Math.abs(m.delta) >= 5);
  const sorted = [...filtered].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  if (sorted.length === 0) {
    return <div className="text-[9px] text-[#475569] italic">No qualifying movers.</div>;
  }

  return (
    <>
      <div className="text-[7px] text-[#475569] mb-[3px]">window: {windowLabel}</div>
      {sorted.slice(0, 8).map((m) => {
        const improved = m.delta < 0;
        const tone = m.delta === 0 ? 'text-[#64748b]' : improved ? 'text-[#10b981]' : 'text-[#ef4444]';
        const arrow = m.delta === 0 ? '→' : improved ? `↑${Math.abs(m.delta)}` : `↓${Math.abs(m.delta)}`;
        return (
          <div key={`${m.keyword}-${m.asin}`} className="flex justify-between items-center py-[3px]">
            <span className="text-[9px] text-[#3b82f6] font-medium min-w-[28px]">{fmtRank(m.rank)}</span>
            <span className="text-[9px] text-[#94a3b8] flex-1 truncate">{m.keyword}</span>
            <span className="text-[8px] text-[#475569] mx-1 truncate">{m.asinShortName}</span>
            <span className={`text-[9px] font-medium min-w-[20px] text-right ${tone}`}>{arrow}</span>
          </div>
        );
      })}
    </>
  );
}
