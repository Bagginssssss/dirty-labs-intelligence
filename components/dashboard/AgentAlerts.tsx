'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Alert, AlertSummary, Severity } from '@/lib/dashboard/types';

const SEV: Record<Severity, { dot: string; border: string; pillBg: string; pillText: string; label: string }> = {
  critical: { dot: 'bg-[#ef4444]', border: 'border-l-[#ef4444]', pillBg: 'bg-[#ef4444]/15', pillText: 'text-[#ef4444]', label: 'CRITICAL' },
  warning:  { dot: 'bg-[#f59e0b]', border: 'border-l-[#f59e0b]', pillBg: 'bg-[#f59e0b]/15', pillText: 'text-[#f59e0b]', label: 'WARNING'  },
  watch:    { dot: 'bg-[#3b82f6]', border: 'border-l-[#3b82f6]', pillBg: 'bg-[#3b82f6]/15', pillText: 'text-[#3b82f6]', label: 'WATCH'    },
  info:     { dot: 'bg-[#3b82f6]', border: 'border-l-[#3b82f6]', pillBg: 'bg-[#3b82f6]/15', pillText: 'text-[#3b82f6]', label: 'INFO'     },
};

function severityRank(s: Severity): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : s === 'watch' ? 2 : 3;
}

export function AgentAlerts({ alerts, summary }: { alerts: Alert[]; summary: AlertSummary }) {
  const [expanded, setExpanded] = useState(true);

  const sorted = [...alerts].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const top3 = sorted.slice(0, 3);

  return (
    <section aria-label="Agent Alerts" className="mb-3 mt-3">
      {/* Section label */}
      <div className="flex justify-between items-center mb-[7px] text-[9px] tracking-[0.15em]">
        <span className="text-[#3b82f6]">AGENT ALERTS</span>
        <span className="text-[8px] text-[#475569] tracking-[0.1em]">
          {summary.total} total
          {summary.critical > 0 && <> · <span className="text-[#ef4444]">{summary.critical} critical</span></>}
          {summary.warning > 0 && <> · <span className="text-[#f59e0b]">{summary.warning} warning{summary.warning === 1 ? '' : 's'}</span></>}
          {summary.watch > 0 && <> · <span className="text-[#3b82f6]">{summary.watch} watch</span></>}
        </span>
      </div>

      {/* Top 3 stacked cards */}
      <div className="flex flex-col gap-[5px]">
        {top3.length === 0 ? (
          <div className="text-[10px] text-[#64748b] italic px-2 py-2">
            No alerts in the current window. Agents are running.
          </div>
        ) : (
          top3.map((a) => <AlertCard key={a.id} alert={a} />)
        )}
      </div>

      {/* All alerts expandable */}
      {alerts.length > 0 && (
        <div className="mt-1.5 bg-[#16161a] border border-[#1e1e2e] rounded-[4px] overflow-hidden">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full text-[8px] text-[#3b82f6] tracking-[0.1em] px-2.5 py-1.5 border-b border-[#1e1e2e] flex justify-between items-center hover:bg-[#1e1e2e]/40"
          >
            <span>ALL ALERTS ({alerts.length})</span>
            <span className="text-[#475569]">{expanded ? 'collapse ↑' : 'expand ↓'}</span>
          </button>
          {expanded && (
            <div>
              {sorted.map((a) => {
                const sev = SEV[a.severity];
                return (
                  <Link
                    key={a.id}
                    href={a.href}
                    className="grid grid-cols-[80px_70px_1fr_80px] gap-2 px-2.5 py-1 border-b border-[#1e1e2e]/30 last:border-0 items-center hover:bg-[#1e1e2e]/40"
                  >
                    <div className="text-[8px] flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                      <span className={sev.pillText}>{sev.label}</span>
                    </div>
                    <div className="text-[8px] text-[#475569]">{a.domain}</div>
                    <div className="text-[8px] text-[#94a3b8] truncate">{a.entity} — {a.description}</div>
                    <div className="text-[8px] text-[#64748b] text-right">{a.metric}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const sev = SEV[alert.severity];
  return (
    <article className={`px-2.5 py-2 rounded-[4px] border-l-[3px] ${sev.border} bg-[#16161a]`}>
      <div className="flex items-center gap-[7px] mb-[3px]">
        <span className={`text-[8px] tracking-[0.05em] font-medium px-1.5 py-[2px] rounded-[2px] whitespace-nowrap ${sev.pillBg} ${sev.pillText}`}>
          {sev.label}
        </span>
        <span className="text-[10px] text-[#e2e8f0] font-medium">{alert.entity}</span>
        <span className="text-[8px] text-[#475569] ml-auto">{alert.domain} · {alert.figure}</span>
      </div>
      <div className="text-[9px] text-[#64748b] leading-[1.4] mb-[3px]">{alert.description}</div>
      <div className="text-[8px] text-[#475569]">
        {alert.recommendation} · <Link href={alert.href} className="text-[#3b82f6] hover:underline">→ {alert.domain.charAt(0) + alert.domain.slice(1).toLowerCase()} view</Link>
      </div>
    </article>
  );
}
