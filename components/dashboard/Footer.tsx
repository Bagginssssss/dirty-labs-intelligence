import type { IngestStatus } from '@/lib/dashboard/types';

export function Footer({ status }: { status: IngestStatus }) {
  return (
    <footer className="flex justify-between items-center py-[7px] border-t border-[#1e1e2e] mt-1 flex-wrap gap-[6px]">
      <FooterItem dot="amber">
        {status.monthsLoaded} month{status.monthsLoaded === 1 ? '' : 's'} loaded · backfill {status.backfillStatus}
      </FooterItem>
      <FooterItem dot="gray">
        SP-API {status.spApiConnected ? 'connected' : 'pending'} · BSR using SmartScout fallback
      </FooterItem>
    </footer>
  );
}

function FooterItem({ dot, children }: { dot: 'green' | 'amber' | 'gray'; children: React.ReactNode }) {
  const dotClass =
    dot === 'green' ? 'bg-[#10b981]'
    : dot === 'amber' ? 'bg-[#f59e0b]'
    : 'bg-[#475569]';
  return (
    <span className="text-[8px] text-[#475569] flex items-center gap-1">
      <span className={`w-[6px] h-[6px] rounded-full ${dotClass} shrink-0`} />
      {children}
    </span>
  );
}
