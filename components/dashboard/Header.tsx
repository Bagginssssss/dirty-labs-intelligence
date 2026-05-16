import Link from 'next/link';
import { fmtDateLong } from '@/lib/dashboard/format';
import { BRAND_ID } from '@/lib/dashboard/data';
import { loadTrackerData } from '@/lib/upload-tracker/data';
import { NavLinks } from './NavLinks';

export async function Header({ today }: { today: Date }) {
  const rows = await loadTrackerData(BRAND_ID);
  const overdueCount = rows.filter(r => r.reportStatus === 'overdue').length;

  return (
    <header className="border-b border-[#1e1e2e]">
      <div className="mx-auto max-w-[1600px] px-4 flex justify-between items-center py-2">
        <Link href="/" className="text-[12px] tracking-[0.2em] text-[#3b82f6] font-medium">
          DL INTELLIGENCE
        </Link>

        <NavLinks overdueCount={overdueCount} />

        <div className="text-[11px] text-[#64748b]">
          {fmtDateLong(today)}
        </div>
      </div>
    </header>
  );
}
