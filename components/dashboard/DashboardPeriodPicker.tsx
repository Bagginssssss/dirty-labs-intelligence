'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { PERIOD_PRESETS } from '@/lib/dashboard/period';
import type { PeriodPreset } from '@/lib/dashboard/period';

export function DashboardPeriodPicker({ current, label }: { current: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function setPeriod(key: string) {
    const next = new URLSearchParams(params?.toString());
    next.set('period', key);
    setOpen(false);
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-[#64748b] hover:text-[#e2e8f0] transition-colors inline-flex items-center gap-1"
      >
        {label}
        <ChevronDown size={9} className={`opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-sm border border-[#1e1e2e] bg-[#16161a] shadow-xl shadow-black/60 overflow-hidden z-50">
          <ul className="py-1 text-[10px]">
            {/* Monthly presets */}
            {PERIOD_PRESETS.filter((p) => !p.group).map((p) => (
              <PresetItem key={p.key} p={p} current={current} onSelect={setPeriod} />
            ))}

            {/* Quarter presets */}
            <li className="border-t border-[#1e1e2e] mt-1 px-3 pt-1.5 pb-0.5 text-[7px] tracking-[0.12em] text-[#475569]">
              QUARTERS
            </li>
            {PERIOD_PRESETS.filter((p) => p.group === 'quarter').map((p) => (
              <PresetItem key={p.key} p={p} current={current} onSelect={setPeriod} />
            ))}

            {/* Custom inputs */}
            <li className="border-t border-[#1e1e2e] mt-1 pt-1">
              <button
                onClick={() => {
                  const month = prompt('Calendar month (YYYY-MM)', '2026-04');
                  if (month && /^\d{4}-\d{2}$/.test(month)) setPeriod(month);
                }}
                className="w-full text-left px-3 py-1.5 text-[#64748b] hover:bg-[#1e1e2e]"
              >
                Calendar month…
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  const r = prompt('Custom range (YYYY-MM-DD:YYYY-MM-DD)', '');
                  if (r && /^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r)) setPeriod(r);
                }}
                className="w-full text-left px-3 py-1.5 text-[#64748b] hover:bg-[#1e1e2e]"
              >
                Custom range…
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function PresetItem({
  p, current, onSelect,
}: {
  p: PeriodPreset;
  current: string;
  onSelect: (key: string) => void;
}) {
  const isActive = current === p.key;
  return (
    <li>
      <button
        onClick={() => onSelect(p.key)}
        className={`w-full text-left px-3 py-1.5 hover:bg-[#1e1e2e] transition-colors flex items-center justify-between gap-1 ${
          isActive ? 'text-[#3b82f6] bg-[#1e1e2e]' : 'text-[#94a3b8]'
        }`}
      >
        <span>{p.label}</span>
        {p.coverageWarning && (
          <span className="text-[7px] text-[#f59e0b] shrink-0" title={p.coverageWarning}>⚠</span>
        )}
        {!p.coverageWarning && p.partial && (
          <span className="text-[7px] text-[#64748b] shrink-0">partial</span>
        )}
      </button>
    </li>
  );
}
