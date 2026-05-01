export * from './episodic'
export * from './semantic'
export * from './watchlist'

import { getRecentInsights, formatInsightsForPrompt, Insight } from './episodic'
import { getKnowledge, formatKnowledgeForPrompt, KnowledgeItem } from './semantic'
import { getActiveWatches, formatWatchlistForPrompt, WatchItem } from './watchlist'

export interface MemoryContext {
  promptContext:    string        // combined formatted string for prompt injection
  recentInsights:  Insight[]     // raw for UI
  accountKnowledge: KnowledgeItem[] // raw for UI
  activeAlerts:    WatchItem[]   // triggered watches only, raw for UI
}

// Called by the analysis engine before every API call.
// Fetches all three memory layers in parallel and returns them combined.
// Never throws — returns empty context on any DB failure.
export async function buildMemoryContext(brandId: string): Promise<MemoryContext> {
  const empty: MemoryContext = {
    promptContext:    '',
    recentInsights:  [],
    accountKnowledge: [],
    activeAlerts:    [],
  }

  try {
    const [insights, knowledge, allWatches] = await Promise.all([
      getRecentInsights(brandId, 30, 20),
      getKnowledge(brandId),
      getActiveWatches(brandId),
    ])

    const triggeredWatches = allWatches.filter(w => w.triggered_at !== null)

    const insightsStr  = formatInsightsForPrompt(insights)
    const knowledgeStr = formatKnowledgeForPrompt(knowledge)
    const alertsStr    = formatWatchlistForPrompt(triggeredWatches)

    const parts = [insightsStr, knowledgeStr, alertsStr].filter(Boolean)

    return {
      promptContext:    parts.join('\n\n'),
      recentInsights:  insights,
      accountKnowledge: knowledge,
      activeAlerts:    triggeredWatches,
    }
  } catch {
    return empty
  }
}
