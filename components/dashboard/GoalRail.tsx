import type { GoalCard, GoalCardId } from '@/lib/dashboard/types';
import type { ResolvedPeriod } from '@/lib/dashboard/period';
import { DashboardPeriodPicker } from './DashboardPeriodPicker';
import { fmtDate, fmtPctSigned } from '@/lib/dashboard/format';

export function GoalRail({ cards, period }: { cards: GoalCard[]; period: ResolvedPeriod }) {
  return (
    <section aria-label="Goal Rail" className="mb-3">
      <div className="flex justify-between items-center mb-[6px]">
        <span className="text-[8px] tracking-[0.1em] text-[#475569]">GOAL RAIL</span>
        <DashboardPeriodPicker current={period.key} label={period.label} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-[6px]">
        {cards.map((c) => <GoalCardCell key={c.id} card={c} />)}
      </div>
    </section>
  );
}

function tone(id: GoalCardId, variance: GoalCard['variance']): 'green' | 'red' | 'amber' | 'gray' {
  if (variance === null) return 'gray';
  if (typeof variance === 'string') return 'green';
  const lowerIsBetter = id === 'ad_spend' || id === 'cac';
  const adjusted = lowerIsBetter ? -variance : variance;
  if (adjusted >= 0.02) return 'green';
  if (adjusted >= -0.04) return 'amber';
  return 'red';
}

function GoalCardCell({ card }: { card: GoalCard }) {
  const t = tone(card.id, card.variance);

  const badgeClass =
    t === 'green' ? 'bg-[#10b981]/15 text-[#10b981]'
    : t === 'red' ? 'bg-[#ef4444]/15 text-[#ef4444]'
    : t === 'amber' ? 'bg-[#f59e0b]/15 text-[#f59e0b]'
    : 'bg-[#1e1e2e] text-[#475569]';

  const fillClass =
    t === 'green' ? 'bg-[#10b981]'
    : t === 'red' ? 'bg-[#ef4444]'
    : t === 'amber' ? 'bg-[#f59e0b]'
    : 'bg-[#1e1e2e]';

  const pacingPct = card.pacing == null ? 0 : Math.min(1.25, Math.max(0, card.pacing));
  const widthPct = `${Math.min(100, pacingPct * 100)}%`;

  const varianceText =
    card.variance === null ? '—'
    : typeof card.variance === 'string' ? card.variance
    : fmtPctSigned(card.variance, 1);

  return (
    <div className="bg-[#16161a] border border-[#1e1e2e] rounded-[4px] px-[9px] py-[7px]">
      <div className="text-[8px] tracking-[0.05em] text-[#475569] mb-[3px]">{card.label}</div>
      <div className="text-[13px] font-medium text-[#e2e8f0] leading-tight">{card.value}</div>
      <div className="text-[8px] text-[#475569] mt-[1px]">{card.target}</div>
      {card.warning ? (
        <div className="text-[7px] mt-[1px] text-[#f59e0b]">⚠ {card.warning}</div>
      ) : (
        <div className="text-[7px] mt-[1px] text-[#475569]">
          {fmtDate(card.freshnessDate)}{card.sourceTag ? ` · ${card.sourceTag}` : ''}
        </div>
      )}
      <div className={`inline-block text-[8px] px-[5px] py-[1px] rounded-[2px] mt-1 ${badgeClass}`}>
        {varianceText}
      </div>
      <div className="h-[2px] bg-[#1e1e2e] rounded-[1px] mt-[5px] overflow-hidden">
        <div className={`h-[2px] rounded-[1px] ${fillClass}`} style={{ width: widthPct }} />
      </div>
    </div>
  );
}
