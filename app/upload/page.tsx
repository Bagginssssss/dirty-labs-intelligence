import { Header } from '@/components/dashboard/Header'
import { UploadArea } from '@/components/upload-tracker/UploadArea'
import { CommandCenter } from '@/components/command-center/CommandCenter'
import { BRAND_ID } from '@/lib/dashboard/data'
import { loadCommandCenter } from '@/lib/command-center/data'

export const dynamic = 'force-dynamic'

export default async function UploadPage() {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const data = await loadCommandCenter(BRAND_ID, todayIso)

  return (
    <div className="min-h-screen bg-[#111113] text-[#e2e8f0] antialiased font-mono">
      <Header today={today} />

      <div className="mx-auto max-w-[1600px] px-4 py-5">
        {/* Title row */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] tracking-[0.15em] text-[#3b82f6]">DATA · REPORT COMMAND CENTER</span>
          <span className="text-[9px] text-[#475569]">
            {data.header.total} ACTIVE · {data.planned.length} PLANNED
          </span>
        </div>

        {/* Tile grid: header rail + filter chips + sections + detail panel (client) */}
        <CommandCenter data={data} />

        {/* Upload flow — reused verbatim */}
        <UploadArea defaultBrandId={BRAND_ID} />
      </div>
    </div>
  )
}
