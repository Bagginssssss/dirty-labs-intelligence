// INB-147 — Report Command Center: unstable_cache wrapper over the DB core (data-core.ts).
// The core is kept free of next/cache so it stays unit-testable; this file adds caching only.
// Cached under the existing 'tracker-data' tag so UploadArea's refreshTrackerCache() invalidates
// it after an upload.

import { unstable_cache } from 'next/cache'
import { loadCommandCenterUncached } from './data-core'
import type { CommandCenterVM } from './types'

export { loadReportDetail } from './data-core'

export async function loadCommandCenter(brandId: string, today: string): Promise<CommandCenterVM> {
  return unstable_cache(() => loadCommandCenterUncached(brandId, today), ['command-center', brandId, today], {
    revalidate: 60,
    tags: ['tracker-data'],
  })()
}
