'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/',         label: 'Dashboard' },
  { href: '/upload',   label: 'Upload' },
  { href: '/ppc',      label: 'PPC' },
  { href: '/seo',      label: 'SEO' },
  { href: '/business', label: 'Business' },
];

export function NavLinks({ overdueCount }: { overdueCount: number }) {
  const pathname = usePathname();

  return (
    <nav className="text-[11px] text-[#64748b]">
      {NAV.map((item, i) => {
        const isActive = pathname === item.href;
        const isUpload = item.href === '/upload';

        return (
          <span key={item.href}>
            {i > 0 && <span className="mx-2 text-[#475569]">·</span>}
            <Link
              href={item.href}
              className={`hover:text-[#94a3b8] transition-colors ${isActive ? 'text-[#3b82f6]' : ''}`}
            >
              {item.label}
              {isUpload && overdueCount > 0 && (
                <span className="ml-[3px]" style={{ color: '#ef4444' }}>
                  (●{overdueCount})
                </span>
              )}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
