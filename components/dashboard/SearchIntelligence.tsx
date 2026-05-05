import type { SearchIntelData, SQPRow } from '@/lib/dashboard/types';
import { KeywordRankMovers } from './KeywordRankMovers';
import { fmtPct, fmtIntCompact } from '@/lib/dashboard/format';

export function SearchIntelligence({ data }: { data: SearchIntelData }) {
  return (
    <section className="bg-[#16161a] border border-[#1e1e2e] rounded-[6px] p-[11px]">
      <h3 className="text-[10px] tracking-[0.1em] text-[#3b82f6] mb-[9px] border-b border-[#1e1e2e] pb-[6px]">
        SEARCH INTELLIGENCE
      </h3>

      <div className="text-[8px] tracking-[0.1em] text-[#3b82f6] mt-[7px] mb-[4px]">
        TOP BRAND QUERIES — purchase share
      </div>
      {data.brandQueries.length === 0 ? (
        <div className="text-[9px] text-[#475569] italic">No SQP data.</div>
      ) : (
        data.brandQueries.slice(0, 5).map((q) => <SQPRowItem key={q.query} row={q} tone="positive" />)
      )}

      <div className="text-[8px] tracking-[0.1em] text-[#3b82f6] mt-[7px] mb-[4px] flex items-center gap-[6px]">
        SHARE GAPS — high volume · low brand share
        <span className="text-[7px] px-1 py-[1px] rounded-[2px] bg-[#1e1e2e] text-[#475569] tracking-normal">
          NTB opportunity
        </span>
      </div>
      {data.shareGaps.length === 0 ? (
        <div className="text-[9px] text-[#475569] italic">No gap data.</div>
      ) : (
        data.shareGaps.slice(0, 5).map((q) => <SQPRowItem key={q.query} row={q} tone="critical" sharePrecision={2} />)
      )}

      <div className="text-[8px] tracking-[0.1em] text-[#3b82f6] mt-[7px] mb-[4px]">
        KEYWORD RANK MOVERS · ±5 positions
      </div>
      <KeywordRankMovers movers={data.rankMovers} windowLabel={data.rankWindowLabel} />
    </section>
  );
}

function SQPRowItem({ row, tone, sharePrecision = 1 }: { row: SQPRow; tone: 'positive' | 'critical'; sharePrecision?: number }) {
  const shareTone = tone === 'positive' ? 'text-[#10b981]' : 'text-[#ef4444]';
  return (
    <div className="flex justify-between py-[3px] border-b border-[#1e1e2e]/30">
      <span className="text-[9px] text-[#94a3b8] flex-1 truncate">{row.query}</span>
      <span className={`text-[9px] font-medium min-w-[36px] text-right ${shareTone}`}>{fmtPct(row.purchaseShare, sharePrecision)}</span>
      <span className="text-[8px] text-[#475569] min-w-[55px] text-right">{fmtIntCompact(row.searchVolume)}/mo</span>
    </div>
  );
}
