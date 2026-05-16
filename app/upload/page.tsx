import { Header } from '@/components/dashboard/Header'
import { TrackerView } from '@/components/upload-tracker/TrackerView'
import { UploadArea } from '@/components/upload-tracker/UploadArea'
import { BRAND_ID } from '@/lib/dashboard/data'
import { loadTrackerData } from '@/lib/upload-tracker/data'

export const dynamic = 'force-dynamic'

export default async function UploadPage() {
  const today = new Date()
  const rows = await loadTrackerData(BRAND_ID)

  return (
    <div className="min-h-screen bg-[#111113] text-[#e2e8f0] antialiased font-mono">
      <Header today={today} />

      <div className="mx-auto max-w-[1600px] px-4 py-5">
        {/* Title row */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] tracking-[0.15em] text-[#3b82f6]">DATA · UPLOAD STATUS</span>
          <span className="text-[9px] text-[#475569]">{rows.length} REPORTS</span>
        </div>

        {/* Tracker: filter bar + table + detail panel (client) */}
        <TrackerView rows={rows} />

        {/* Upload area at bottom */}
        <UploadArea defaultBrandId={BRAND_ID} />
      </div>
    </div>
  )
}
