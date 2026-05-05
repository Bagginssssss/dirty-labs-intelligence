import Link from 'next/link';
import { DashboardPeriodPicker } from './DashboardPeriodPicker';
import type { ResolvedPeriod } from '@/lib/dashboard/period';
import { fmtDateLong } from '@/lib/dashboard/format';

const NAV = [
  { href: '/',         label: 'Dashboard' },
  { href: '/upload',   label: 'Upload' },
  { href: '/ppc',      label: 'PPC' },
  { href: '/seo',      label: 'SEO' },
  { href: '/business', label: 'Business' },
];

export function Header({ period, today }: { period: ResolvedPeriod; today: Date }) {
  // Active route — for now hardcode '/' since this is the dashboard. When you
  // build other pages, lift Header to a shared layout and read pathname.
  const activeHref = '/';

  return (
    <header className="border-b border-[#1e1e2e]">
      <div className="mx-auto max-w-[1600px] px-4 flex justify-between items-center py-2">
        <Link href="/" className="text-[12px] tracking-[0.2em] text-[#3b82f6] font-medium">
          DL INTELLIGENCE
        </Link>

        <nav className="text-[11px] text-[#64748b]">
          {NAV.map((item, i) => (
            <span key={item.href}>
              {i > 0 && <span className="mx-2 text-[#475569]">·</span>}
              <Link
                href={item.href}
                className={`hover:text-[#94a3b8] transition-colors ${
                  item.href === activeHref ? 'text-[#3b82f6]' : ''
                }`}
              >
                {item.label}
              </Link>
            </span>
          ))}
        </nav>

        <div className="text-[11px] text-[#64748b] flex items-center gap-1">
          <span>{fmtDateLong(today)}</span>
          <span className="text-[#475569]">·</span>
          <DashboardPeriodPicker current={period.key} label={period.label} />
        </div>
      </div>
    </header>
  );
}
