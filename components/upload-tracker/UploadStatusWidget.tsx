import Link from 'next/link';
import { BRAND_ID } from '@/lib/dashboard/data';
import { loadTrackerData } from '@/lib/upload-tracker/data';
import type { ReportStatus } from '@/lib/upload-tracker/status';

const STATUS_COLORS: Record<ReportStatus, string> = {
  current: '#10b981',
  due_soon: '#f59e0b',
  overdue: '#ef4444',
  never_uploaded: '#475569',
  pending: '#334155',
};

export async function UploadStatusWidget() {
  const rows = await loadTrackerData(BRAND_ID);

  const total = rows.length;
  const counts: Record<ReportStatus, number> = {
    current: 0,
    due_soon: 0,
    overdue: 0,
    never_uploaded: 0,
    pending: 0,
  };
  for (const row of rows) counts[row.reportStatus]++;

  const overdueItems = rows
    .filter(r => r.reportStatus === 'overdue')
    .sort((a, b) => (b.daysSinceLastUpload ?? 0) - (a.daysSinceLastUpload ?? 0))
    .slice(0, 3);

  const isCollapsed = counts.overdue === 0 && counts.due_soon === 0;

  const lastRefresh = rows
    .map(r => r.lastUpload)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1)
    ?.slice(0, 10) ?? null;

  if (isCollapsed) {
    return (
      <Link
        href="/upload"
        className="block mb-3 mt-1 bg-[#16161a] border border-[#1e1e2e] rounded-[4px] px-3 py-2 hover:border-[#475569] transition-colors"
      >
        <div className="flex items-center gap-2 text-[9px] text-[#64748b]">
          <span
            className="w-[6px] h-[6px] rounded-full shrink-0"
            style={{ backgroundColor: STATUS_COLORS.current }}
          />
          <span className="text-[#94a3b8]">{counts.current} reports current</span>
          {lastRefresh && (
            <>
              <span className="text-[#1e1e2e]">·</span>
              <span>Last refresh {lastRefresh}</span>
            </>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      href="/upload"
      className="block mb-3 mt-1 bg-[#16161a] border border-[#1e1e2e] rounded-[4px] px-3 py-[9px] hover:border-[#475569] transition-colors"
    >
      {/* Title row */}
      <div className="flex justify-between items-center mb-[7px]">
        <span className="text-[9px] tracking-[0.12em] text-[#3b82f6]">DATA · UPLOAD STATUS</span>
        <span className="text-[8px] text-[#475569]">{total} REPORTS</span>
      </div>

      {/* Status summary dots */}
      <div className="flex items-center gap-4 mb-[8px]">
        <StatusDot color={STATUS_COLORS.current}  label="CURRENT"  count={counts.current}  />
        <StatusDot color={STATUS_COLORS.due_soon} label="DUE SOON" count={counts.due_soon} />
        <StatusDot color={STATUS_COLORS.overdue}  label="OVERDUE"  count={counts.overdue}  />
      </div>

      {/* Top overdue items */}
      {overdueItems.length > 0 && (
        <div className="flex flex-col gap-[3px] mb-[8px] border-t border-[#1e1e2e]/50 pt-[6px]">
          {overdueItems.map(row => (
            <div key={row.entry.internal_id} className="flex justify-between items-center">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-[6px] h-[6px] rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_COLORS.overdue }}
                />
                <span className="text-[10px] text-[#e2e8f0] truncate">{row.entry.display_name}</span>
              </div>
              <span className="text-[9px] shrink-0 ml-3" style={{ color: STATUS_COLORS.overdue }}>
                {row.daysSinceLastUpload}d overdue
              </span>
            </div>
          ))}
        </div>
      )}

      {/* VIEW ALL */}
      <div className="text-right">
        <span className="text-[9px] text-[#64748b] tracking-[0.08em]">VIEW ALL →</span>
      </div>
    </Link>
  );
}

function StatusDot({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-[6px] h-[6px] rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-[9px] text-[#64748b]">
        <span className="text-[#94a3b8]">{count}</span> {label}
      </span>
    </div>
  );
}
