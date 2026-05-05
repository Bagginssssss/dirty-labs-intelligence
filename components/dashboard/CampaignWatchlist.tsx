'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CampaignRow, CampaignStatus } from '@/lib/dashboard/types';
import { fmtIntCompact, fmtRoas, fmtUSDCompact } from '@/lib/dashboard/format';

const MAX_PINS = 10;
const STORAGE_KEY = 'dl:watchlist:pinned';

const STATUS: Record<CampaignStatus, { text: string; tone: string }> = {
  top:      { text: '✓ top',    tone: 'text-[#10b981]' },
  watching: { text: 'watch',    tone: 'text-[#f59e0b]' },
  waste:    { text: '⚠',        tone: 'text-[#ef4444]' },
  sbv:      { text: 'SBV',      tone: 'text-[#3b82f6]' },
  new:      { text: 'NEW',      tone: 'text-[#475569]' },
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
        if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        return b.spend - a.spend;
      })
      .slice(0, q ? 25 : MAX_PINS);
  }, [search, initial, pinned]);

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍  search campaigns to pin..."
        className="w-full bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-[7px] py-1 text-[9px] text-[#94a3b8] placeholder:text-[#475569] mb-[5px] focus:outline-none focus:border-[#3b82f6]/40"
      />

      <table className="w-full border-collapse text-[8px]">
        <thead>
          <tr className="text-left">
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
              <tr key={c.id} className="hover:bg-[#1e1e2e]/40 cursor-pointer" onClick={() => togglePin(c.id)}>
                <td className="py-[2px] px-1 text-[#94a3b8] border-b border-[#1e1e2e]/30 whitespace-nowrap truncate max-w-[20ch]">
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
              <td className="py-[2px] px-1 text-[#1e1e3a] border-b border-[#1e1e2e]/30">+ pin campaign...</td>
              <td colSpan={5} className="border-b border-[#1e1e2e]/30" />
            </tr>
          )}
        </tbody>
      </table>

      <div className="text-[8px] text-[#475569] mt-1">{pinned.size} / {MAX_PINS} pinned</div>
    </div>
  );
}
