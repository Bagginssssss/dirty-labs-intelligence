'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { CampaignRow, CampaignStatus } from '@/lib/dashboard/types';
import { fmtIntCompact, fmtRoas, fmtUSDCompact } from '@/lib/dashboard/format';

const MAX_PINS = 25;
const STORAGE_KEY = 'dl:watchlist:pinned';

const STATUS: Record<CampaignStatus, { text: string; tone: string }> = {
  top:      { text: '✓ top',    tone: 'text-[#10b981]' },
  watching: { text: 'watch',    tone: 'text-[#f59e0b]' },
  waste:    { text: '⚠',        tone: 'text-[#ef4444]' },
  new:      { text: 'warming',  tone: 'text-[#475569]' },
};

function roasTone(r: number | null): string {
  if (r == null) return 'text-[#94a3b8]';
  if (r >= 5) return 'text-[#10b981]';
  if (r < 2) return 'text-[#ef4444]';
  if (r < 3) return 'text-[#f59e0b]';
  return 'text-[#94a3b8]';
}

export function CampaignWatchlist({ initial }: { initial: CampaignRow[] }) {
  const [pinned, setPinned] = useState<Set<string>>(
    () => new Set<string>(initial.filter((c) => c.pinned).map((c) => c.id))
  );
  const [search, setSearch] = useState('');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setPinned(new Set<string>(JSON.parse(saved))); } catch {}
    }
  }, []);

  function togglePin(id: string) {
    setPinned((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PINS) next.add(id);
      else return curr;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? initial.filter((c) => c.name.toLowerCase().includes(q))
      : initial.filter((c) => pinned.has(c.id));
    return list
      .map((c) => ({ ...c, pinned: pinned.has(c.id) }))
      .sort((a, b) => {
        // Pinned-first within both search and browse modes; spend-desc within each group
        if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        return b.spend - a.spend;
      })
      .slice(0, q ? 25 : MAX_PINS);
  }, [search, initial, pinned]);

  return (
    <div>
      <div className="relative mb-[5px]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  search campaigns to pin..."
          className="w-full bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-[7px] py-1 text-[9px] text-[#94a3b8] placeholder:text-[#475569] focus:outline-none focus:border-[#3b82f6]/40"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
          >
            <X size={10} />
          </button>
        )}
      </div>

      <table className="w-full border-collapse text-[8px]">
        <thead>
          <tr className="text-left">
            <th className="w-[14px] py-[2px] px-1 border-b border-[#1e1e2e]" />
            <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e]">CAMPAIGN</th>
            <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e] text-right">SPEND</th>
            <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e] text-right">ROAS</th>
            <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e] text-right">ORDERS</th>
            <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e] text-right">IMPR</th>
            <th className="text-[8px] tracking-[0.05em] text-[#3b82f6] py-[2px] px-1 border-b border-[#1e1e2e]">STATUS</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => {
            const st = STATUS[c.status];
            return (
              <tr key={c.id} className="hover:bg-[#1e1e2e]/40">
                <td
                  className="py-[2px] px-1 border-b border-[#1e1e2e]/30 cursor-pointer w-[14px] text-center"
                  onClick={() => togglePin(c.id)}
                >
                  {c.pinned
                    ? <span className="text-emerald-500 text-[9px] leading-none">✓</span>
                    : <span className="inline-block w-[9px]" />}
                </td>
                <td className="py-[2px] px-1 text-[#94a3b8] border-b border-[#1e1e2e]/30 whitespace-nowrap truncate max-w-[20ch]" title={c.name}>
                  {c.name}
                </td>
                <td className="py-[2px] px-1 text-[#94a3b8] border-b border-[#1e1e2e]/30 text-right whitespace-nowrap">{fmtUSDCompact(c.spend, 0)}</td>
                <td className={`py-[2px] px-1 border-b border-[#1e1e2e]/30 text-right whitespace-nowrap ${roasTone(c.roas)}`}>{fmtRoas(c.roas)}</td>
                <td className="py-[2px] px-1 text-[#94a3b8] border-b border-[#1e1e2e]/30 text-right whitespace-nowrap">{fmtIntCompact(c.orders)}</td>
                <td className="py-[2px] px-1 text-[#94a3b8] border-b border-[#1e1e2e]/30 text-right whitespace-nowrap">{fmtIntCompact(c.impressions)}</td>
                <td className={`py-[2px] px-1 border-b border-[#1e1e2e]/30 whitespace-nowrap ${st.tone}`}>{st.text}</td>
              </tr>
            );
          })}
          {!search && (
            <tr>
              <td className="py-[2px] px-1 border-b border-[#1e1e2e]/30" />
              <td className="py-[2px] px-1 text-[#1e1e3a] border-b border-[#1e1e2e]/30">+ pin campaign...</td>
              <td colSpan={5} className="border-b border-[#1e1e2e]/30" />
            </tr>
          )}
        </tbody>
      </table>

      <div className="text-[8px] text-[#475569] mt-1">{pinned.size} / {MAX_PINS} pinned</div>
      <div className="text-[7px] text-[#475569] mt-[3px] leading-[1.6]">
        <span className="text-[#10b981]">✓ top</span>: ROAS ≥ 5 &nbsp;·&nbsp;
        <span className="text-[#f59e0b]">watch</span>: ROAS 2–5 &nbsp;·&nbsp;
        <span className="text-[#ef4444]">⚠ waste</span>: ROAS &lt; 2 &nbsp;·&nbsp;
        <span className="text-[#475569]">new</span>: &lt;14d, &lt;100 impr
      </div>
    </div>
  );
}
