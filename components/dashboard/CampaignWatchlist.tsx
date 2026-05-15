'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CampaignRow, CampaignStatus } from '@/lib/dashboard/types';
import { fmtIntCompact, fmtRoas, fmtUSDCompact } from '@/lib/dashboard/format';

const MAX_PINS = 25;
const STORAGE_KEY = 'dl:watchlist:pinned';
const NAMES_KEY   = 'dl:watchlist:campaign-names';

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

  // Persisted uuid → campaign name map so ghost rows can show names for
  // campaigns absent from the current period's data.
  const nameCacheRef = useRef<Record<string, string>>({});

  // Server-resolved names for pinned campaigns never seen in any loaded period.
  // Kept in state (not just the ref) so the visible useMemo rerenders when they arrive.
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setPinned(new Set<string>(JSON.parse(saved))); } catch {}
    }
  }, []);

  // Server-side backstop: fetch campaign names from the campaigns table for any
  // pinned ID that has no client-side cache entry and no data in the current period.
  // Runs whenever pinned set or period data changes.
  useEffect(() => {
    const inPeriod = new Set(initial.map((c) => c.id));
    const unresolved = [...pinned].filter(
      (id) => !inPeriod.has(id) && !nameCacheRef.current[id]
    );
    if (unresolved.length === 0) return;

    fetch('/api/resolve-campaign-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_ids: unresolved }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { names: Record<string, string> }) => {
        Object.assign(nameCacheRef.current, data.names);
        try { window.localStorage.setItem(NAMES_KEY, JSON.stringify(nameCacheRef.current)); } catch {}
        setResolvedNames((prev) => ({ ...prev, ...data.names }));
      })
      .catch(() => {});
  }, [pinned, initial]);

  // Load name cache from localStorage then refresh it with any names
  // from the current period's data. Runs whenever initial changes so
  // the cache stays current as the period selector moves.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NAMES_KEY);
      if (saved) Object.assign(nameCacheRef.current, JSON.parse(saved));
    } catch {}
    for (const c of initial) nameCacheRef.current[c.id] = c.name;
    try { window.localStorage.setItem(NAMES_KEY, JSON.stringify(nameCacheRef.current)); } catch {}
  }, [initial]);

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

    type Row = CampaignRow & { isGhost?: boolean };
    let list: Row[];

    if (q) {
      list = initial.filter((c) => c.name.toLowerCase().includes(q));
    } else {
      // Pinned campaigns that have data this period
      list = initial.filter((c) => pinned.has(c.id));

      // Ghost rows: pinned campaigns absent from current-period data.
      // Names come from the persistent cache so they survive period switches.
      const inPeriod = new Set(initial.map((c) => c.id));
      for (const id of pinned) {
        if (!inPeriod.has(id)) {
          list = [...list, {
            id,
            name:        resolvedNames[id] ?? nameCacheRef.current[id] ?? id,
            adType:      'SP' as const,
            spend:       0,
            roas:        null,
            orders:      0,
            impressions: 0,
            status:      'watching' as const,
            pinned:      true,
            isGhost:     true,
          }];
        }
      }
    }

    return list
      .map((c) => ({ ...c, pinned: pinned.has(c.id) }))
      .sort((a, b) => {
        // Pinned-first; ghost rows after real pinned rows; spend-desc within each group
        if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        if ((a.isGhost ? 1 : 0) !== (b.isGhost ? 1 : 0)) return (a.isGhost ? 1 : 0) - (b.isGhost ? 1 : 0);
        return b.spend - a.spend;
      })
      .slice(0, q ? 25 : MAX_PINS);
  }, [search, initial, pinned, resolvedNames]);

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
            const isGhost = !!(c as CampaignRow & { isGhost?: boolean }).isGhost;
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
                <td className="py-[2px] px-1 border-b border-[#1e1e2e]/30 whitespace-nowrap truncate max-w-[20ch]" title={c.name}>
                  <span className={isGhost ? 'text-[#475569]' : 'text-[#94a3b8]'}>{c.name}</span>
                  {isGhost && <span className="ml-1 text-[7px] text-[#334155]">· no data</span>}
                </td>
                <td className="py-[2px] px-1 border-b border-[#1e1e2e]/30 text-right whitespace-nowrap text-[#475569]">
                  {isGhost ? '—' : fmtUSDCompact(c.spend, 0)}
                </td>
                <td className={`py-[2px] px-1 border-b border-[#1e1e2e]/30 text-right whitespace-nowrap ${isGhost ? 'text-[#334155]' : roasTone(c.roas)}`}>
                  {isGhost ? '—' : fmtRoas(c.roas)}
                </td>
                <td className="py-[2px] px-1 border-b border-[#1e1e2e]/30 text-right whitespace-nowrap text-[#475569]">
                  {isGhost ? '—' : fmtIntCompact(c.orders)}
                </td>
                <td className="py-[2px] px-1 border-b border-[#1e1e2e]/30 text-right whitespace-nowrap text-[#475569]">
                  {isGhost ? '—' : fmtIntCompact(c.impressions)}
                </td>
                <td className={`py-[2px] px-1 border-b border-[#1e1e2e]/30 whitespace-nowrap ${isGhost ? 'text-[#334155]' : st.tone}`}>
                  {isGhost ? '—' : st.text}
                </td>
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
