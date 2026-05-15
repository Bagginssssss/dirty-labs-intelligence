'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { PERIOD_PRESETS } from '@/lib/dashboard/period';
import type { PeriodPreset } from '@/lib/dashboard/period';

type PickerMode = 'closed' | 'menu' | 'month' | 'range';

// ── tiny date helpers (no library) ───────────────────────────────────────────

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth() &&
    a.getDate()     === b.getDate();
}

const MSHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DSHORT  = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const thisYear = new Date().getFullYear();
const YEAR_OPTS = Array.from({ length: 5 }, (_, i) => thisYear - 2 + i); // e.g. 2024–2028

// ── MonthPicker ───────────────────────────────────────────────────────────────

function MonthPicker({ onApply, onCancel }: {
  onApply: (ym: string) => void;
  onCancel: () => void;
}) {
  const [year, setYear] = useState(thisYear);
  return (
    <div className="absolute right-0 top-full mt-1 w-52 rounded-sm border border-[#1e1e2e] bg-[#16161a] shadow-xl shadow-black/60 z-50 p-3">
      {/* Year selection */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setYear(y => y - 1)}
          className="p-0.5 text-[#475569] hover:text-[#94a3b8] transition-colors"
        >
          <ChevronLeft size={11} />
        </button>
        <select
          value={year}
          onChange={e => setYear(+e.target.value)}
          className="text-[10px] text-[#94a3b8] bg-[#111113] border border-[#1e1e2e] rounded-[2px] px-1.5 py-0.5 cursor-pointer"
        >
          {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          onClick={() => setYear(y => y + 1)}
          className="p-0.5 text-[#475569] hover:text-[#94a3b8] transition-colors"
        >
          <ChevronRight size={11} />
        </button>
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-3 gap-[3px]">
        {MSHORT.map((m, i) => (
          <button
            key={m}
            onClick={() => onApply(`${year}-${String(i + 1).padStart(2, '0')}`)}
            className="text-[9px] text-[#64748b] hover:bg-[#1e1e2e] hover:text-[#94a3b8] rounded-[2px] py-1.5 transition-colors"
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mt-2 pt-2 border-t border-[#1e1e2e] flex justify-end">
        <button
          onClick={onCancel}
          className="text-[9px] text-[#475569] hover:text-[#94a3b8] px-2 py-1 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── RangePicker ───────────────────────────────────────────────────────────────

function RangePicker({ onApply, onCancel }: {
  onApply: (range: string) => void;
  onCancel: () => void;
}) {
  const today = new Date();
  const [vy, setVy] = useState(today.getFullYear());
  const [vm, setVm] = useState(today.getMonth());
  const [start, setStart] = useState<Date | null>(null);
  const [end,   setEnd]   = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);

  function prevMonth() {
    if (vm === 0) { setVm(11); setVy(y => y - 1); } else setVm(m => m - 1);
  }
  function nextMonth() {
    if (vm === 11) { setVm(0); setVy(y => y + 1); } else setVm(m => m + 1);
  }

  function clickDay(d: Date) {
    if (!start || end) {
      setStart(d); setEnd(null);             // start fresh selection
    } else if (sameDay(d, start)) {
      setEnd(d);                             // same-day range — valid
    } else if (d < start) {
      setEnd(start); setStart(d);            // clicked before start — swap
    } else {
      setEnd(d);                             // normal: set end
    }
  }

  function isSelected(d: Date) {
    return (!!start && sameDay(d, start)) || (!!end && sameDay(d, end));
  }

  function inRange(d: Date) {
    const hi = end ?? hover;
    if (!start || !hi) return false;
    const [lo, hiD] = start <= hi ? [start, hi] : [hi, start];
    return d > lo && d < hiD;
  }

  function apply() {
    if (!start || !end) return;
    const [lo, hi] = start <= end ? [start, end] : [end, start];
    onApply(`${ymd(lo)}:${ymd(hi)}`);
  }

  // Build the day grid: leading nulls + days + trailing nulls to fill rows
  const firstWd = new Date(vy, vm, 1).getDay();
  const daysInM = new Date(vy, vm + 1, 0).getDate();
  const cells: (Date | null)[] = Array(firstWd).fill(null);
  for (let d = 1; d <= daysInM; d++) cells.push(new Date(vy, vm, d));
  while (cells.length % 7) cells.push(null);

  const hint = !start
    ? 'Click to set start date'
    : !end
    ? 'Click to set end date'
    : (() => {
        const [lo, hi] = start <= end ? [start, end] : [end, start];
        return `${ymd(lo)} → ${ymd(hi)}`;
      })();

  return (
    <div className="absolute right-0 top-full mt-1 w-56 rounded-sm border border-[#1e1e2e] bg-[#16161a] shadow-xl shadow-black/60 z-50 p-2.5">
      {/* Month nav + year select */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="p-0.5 text-[#475569] hover:text-[#94a3b8] transition-colors"
        >
          <ChevronLeft size={11} />
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#94a3b8] select-none">{MSHORT[vm]}</span>
          <select
            value={vy}
            onChange={e => setVy(+e.target.value)}
            className="text-[10px] text-[#94a3b8] bg-[#111113] border border-[#1e1e2e] rounded-[2px] px-1 py-0.5 cursor-pointer"
          >
            {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button
          onClick={nextMonth}
          className="p-0.5 text-[#475569] hover:text-[#94a3b8] transition-colors"
        >
          <ChevronRight size={11} />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-0.5">
        {DSHORT.map(d => (
          <div key={d} className="text-center text-[7px] text-[#334155] select-none py-0.5">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-[1px]">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const sel = isSelected(d);
          const rng = inRange(d);
          const hov = !!hover && sameDay(d, hover) && !sel;
          return (
            <button
              key={i}
              onClick={() => clickDay(d)}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              className={[
                'text-[9px] py-[3px] rounded-[2px] select-none transition-colors',
                sel ? 'bg-[#3b82f6] text-white font-medium'
                  : rng ? 'bg-[#3b82f6]/20 text-[#94a3b8]'
                  : hov ? 'bg-[#1e1e2e] text-[#94a3b8]'
                  : 'text-[#64748b] hover:bg-[#1e1e2e] hover:text-[#94a3b8]',
              ].join(' ')}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      {/* Status / hint */}
      <div className="text-[7.5px] text-[#334155] mt-1.5 text-center select-none min-h-[11px]">
        {hint}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-[#1e1e2e]">
        <button
          onClick={onCancel}
          className="text-[9px] text-[#475569] hover:text-[#94a3b8] px-2 py-1 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={apply}
          disabled={!start || !end}
          className="text-[9px] px-2.5 py-1 rounded-[2px] bg-[#3b82f6]/15 border border-[#3b82f6]/40 text-[#3b82f6] hover:bg-[#3b82f6]/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ── Main DashboardPeriodPicker ────────────────────────────────────────────────

export function DashboardPeriodPicker({ current, label }: { current: string; label: string }) {
  const router     = useRouter();
  const pathname   = usePathname();
  const params     = useSearchParams();
  const [mode, setMode] = useState<PickerMode>('closed');
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMode('closed');
    }
    if (mode !== 'closed') document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [mode]);

  // Close on Escape
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') setMode('closed');
    }
    if (mode !== 'closed') document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [mode]);

  function setPeriod(key: string) {
    const next = new URLSearchParams(params?.toString());
    next.set('period', key);
    setMode('closed');
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setMode(m => m === 'menu' ? 'closed' : 'menu')}
        className="text-[11px] text-[#64748b] hover:text-[#e2e8f0] transition-colors inline-flex items-center gap-1"
      >
        {label}
        <ChevronDown size={9} className={`opacity-60 transition-transform ${mode === 'menu' ? 'rotate-180' : ''}`} />
      </button>

      {/* ── Preset menu ── */}
      {mode === 'menu' && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-sm border border-[#1e1e2e] bg-[#16161a] shadow-xl shadow-black/60 overflow-hidden z-50">
          <ul className="py-1 text-[10px]">
            <li className="px-3 pt-1.5 pb-0.5 text-[7px] tracking-[0.12em] text-[#475569]">ROLLING</li>
            {PERIOD_PRESETS.filter(p => p.group === 'rolling').map(p => (
              <PresetItem key={p.key} p={p} current={current} onSelect={setPeriod} />
            ))}

            <li className="border-t border-[#1e1e2e] mt-1 px-3 pt-1.5 pb-0.5 text-[7px] tracking-[0.12em] text-[#475569]">TO-DATE</li>
            {PERIOD_PRESETS.filter(p => p.group === 'to-date').map(p => (
              <PresetItem key={p.key} p={p} current={current} onSelect={setPeriod} />
            ))}

            <li className="border-t border-[#1e1e2e] mt-1 px-3 pt-1.5 pb-0.5 text-[7px] tracking-[0.12em] text-[#475569]">QUARTERS</li>
            {PERIOD_PRESETS.filter(p => p.group === 'quarter').map(p => (
              <PresetItem key={p.key} p={p} current={current} onSelect={setPeriod} />
            ))}

            <li className="border-t border-[#1e1e2e] mt-1 px-3 pt-1.5 pb-0.5 text-[7px] tracking-[0.12em] text-[#475569]">CUSTOM</li>
            <li>
              <button
                onClick={() => setMode('month')}
                className="w-full text-left px-3 py-1.5 text-[#64748b] hover:bg-[#1e1e2e] hover:text-[#94a3b8] transition-colors"
              >
                Calendar month…
              </button>
            </li>
            <li>
              <button
                onClick={() => setMode('range')}
                className="w-full text-left px-3 py-1.5 text-[#64748b] hover:bg-[#1e1e2e] hover:text-[#94a3b8] transition-colors"
              >
                Custom range…
              </button>
            </li>
          </ul>
        </div>
      )}

      {/* ── Month picker ── */}
      {mode === 'month' && (
        <MonthPicker
          onApply={ym  => setPeriod(ym)}
          onCancel={() => setMode('closed')}
        />
      )}

      {/* ── Range picker ── */}
      {mode === 'range' && (
        <RangePicker
          onApply={range => setPeriod(range)}
          onCancel={() => setMode('closed')}
        />
      )}
    </div>
  );
}

// ── PresetItem (unchanged) ────────────────────────────────────────────────────

function PresetItem({ p, current, onSelect }: {
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
