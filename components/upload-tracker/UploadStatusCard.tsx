'use client';

import { useState } from 'react';
import Link from 'next/link';

type OverdueItem = {
  internal_id: string;
  display_name: string;
  daysSinceLastUpload: number | null;
};

type Counts = {
  total: number;
  current: number;
  due_soon: number;
  overdue: number;
  never_uploaded: number;
  pending: number;
};

export function UploadStatusCard({
  counts,
  overdueItems,
}: {
  counts: Counts;
  overdueItems: OverdueItem[];
}) {
  // Default expanded so the operator sees the 6 overdue items immediately.
  // Agent Alerts defaults collapsed; we deviate intentionally here per INB-82 spec.
  const [expanded, setExpanded] = useState(true);

  return (
    <section aria-label="Upload Status" className="mb-3 mt-3">
      {/* Section header row — mirrors Agent Alerts' "AGENT ALERTS … total … ↓" header */}
      <div className="flex justify-between items-center mb-[7px] text-[9px] tracking-[0.15em]">
        <span className="text-[#3b82f6]">DATA · UPLOAD STATUS</span>
        <div className="flex items-center gap-2">
          <span className="text-[8px] text-[#475569] tracking-[0.1em]">
            <span className="text-[#94a3b8]">{counts.total}</span>{' '}total
            {' · '}
            <span className="text-[#10b981]">{counts.current}</span>{' '}current
            {' · '}
            <span className="text-[#f59e0b]">{counts.due_soon}</span>{' '}due soon
            {' · '}
            <span className="text-[#ef4444]">{counts.overdue}</span>{' '}overdue
          </span>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-[#475569] hover:text-[#94a3b8] leading-none"
            aria-label={expanded ? 'Collapse upload status' : 'Expand upload status'}
          >
            {expanded ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Collapsible card — mirrors Agent Alerts' "ALL ALERTS (n) expand ↓" card */}
      <div className="mt-1.5 bg-[#16161a] border border-[#1e1e2e] rounded-[4px] overflow-hidden">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full text-[8px] text-[#3b82f6] tracking-[0.1em] px-2.5 py-1.5 border-b border-[#1e1e2e] flex justify-between items-center hover:bg-[#1e1e2e]/40"
        >
          <span>UPLOAD STATUS ({counts.overdue} OVERDUE)</span>
          <span className="text-[#475569]">{expanded ? 'collapse ↑' : 'expand ↓'}</span>
        </button>

        {expanded && (
          <div className="px-2.5 py-2">
            {/* Status dots summary */}
            <div className="flex items-center gap-4 mb-2">
              <StatusDot color="#10b981" label="CURRENT"  count={counts.current}  />
              <StatusDot color="#f59e0b" label="DUE SOON" count={counts.due_soon} />
              <StatusDot color="#ef4444" label="OVERDUE"  count={counts.overdue}  />
            </div>

            {/* Top overdue items */}
            {overdueItems.length > 0 && (
              <div className="flex flex-col gap-[3px] mb-2 border-t border-[#1e1e2e]/50 pt-[5px]">
                {overdueItems.map(item => (
                  <div key={item.internal_id} className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-[6px] h-[6px] rounded-full shrink-0"
                        style={{ backgroundColor: '#ef4444' }}
                      />
                      <span className="text-[10px] text-[#e2e8f0] truncate">{item.display_name}</span>
                    </div>
                    <span className="text-[9px] shrink-0 ml-3 text-[#ef4444]">
                      {item.daysSinceLastUpload}d overdue
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* VIEW ALL — only navigation target; stopPropagation so card doesn't also collapse */}
            <div className="text-right border-t border-[#1e1e2e]/50 pt-[5px]">
              <Link
                href="/upload"
                onClick={e => e.stopPropagation()}
                className="text-[9px] text-[#64748b] tracking-[0.08em] hover:text-[#94a3b8] transition-colors"
              >
                VIEW ALL →
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusDot({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[9px] text-[#64748b]">
        <span className="text-[#94a3b8]">{count}</span> {label}
      </span>
    </div>
  );
}
