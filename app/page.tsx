import { Header } from '@/components/dashboard/Header';
import { ChatPanel } from '@/components/dashboard/ChatPanel';
import { AgentAlerts } from '@/components/dashboard/AgentAlerts';
import { GoalRail } from '@/components/dashboard/GoalRail';
import { BusinessHealth } from '@/components/dashboard/BusinessHealth';
import { PPCAtAGlance } from '@/components/dashboard/PPCAtAGlance';
import { SearchIntelligence } from '@/components/dashboard/SearchIntelligence';
import { VirtualBundlesPanel } from '@/components/dashboard/VirtualBundlesPanel';
import { Footer } from '@/components/dashboard/Footer';
import { resolvePeriod } from '@/lib/dashboard/period';
import { BRAND_ID, loadDashboardData } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ period?: string }>;

export default async function CommandCenter({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const today = new Date();
  const period = resolvePeriod(params.period, today);
  const data = await loadDashboardData(period);

  return (
    <div className="min-h-screen bg-[#111113] text-[#e2e8f0] antialiased font-mono">
      <Header today={today} />

      {data.period.fellBack && (
        <div className="mx-auto max-w-[1600px] px-4 pt-3">
          <div className="text-[8px] uppercase tracking-[0.1em] text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-sm px-2 py-1 inline-block">
            No data for {data.period.label} — showing {data.period.effectiveLabel}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1600px] px-4 pt-3">
        <ChatPanel brandId={BRAND_ID} />
      </div>

      <div className="mx-auto max-w-[1600px] px-4">
        <AgentAlerts alerts={data.alerts} summary={data.alertSummary} />
      </div>

      <div className="mx-auto max-w-[1600px] px-4">
        <GoalRail cards={data.goals} period={period} />
      </div>

      <section className="mx-auto max-w-[1600px] px-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[9px]">
          <BusinessHealth data={data.businessHealth} periodLabel={data.period.effectiveLabel} />
          <PPCAtAGlance data={data.ppc} periodLabel={data.period.effectiveLabel} />
          <SearchIntelligence data={data.search} />
        </div>
      </section>

      <div className="mx-auto max-w-[1600px] px-4 mt-[9px]">
        <VirtualBundlesPanel data={data.virtualBundles} />
      </div>

      <div className="mx-auto max-w-[1600px] px-4 mt-[9px]">
        <Footer status={data.status} />
      </div>
    </div>
  );
}
