import { supabaseAdmin } from '@/lib/supabase-admin'

export type Confidence = 'confirmed' | 'probable' | 'hypothesis'

export interface KnowledgeItem {
  category:   string
  key:        string
  value:      string
  confidence: string
  source:     string | null
  updated_at: string
}

export async function saveKnowledge(
  brandId:    string,
  category:   string,
  key:        string,
  value:      string,
  confidence: Confidence,
  source?:    string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_knowledge')
    .upsert(
      {
        brand_id:   brandId,
        category,
        key,
        value,
        confidence,
        source:     source ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,category,key' }
    )

  if (error) throw new Error(`saveKnowledge failed: ${error.message}`)
}

export async function getKnowledge(
  brandId:   string,
  category?: string,
  key?:      string
): Promise<KnowledgeItem[]> {
  let query = supabaseAdmin
    .from('platform_knowledge')
    .select('category, key, value, confidence, source, updated_at')
    .eq('brand_id', brandId)
    .order('category')
    .order('key')

  if (category) query = query.eq('category', category)
  if (key)      query = query.eq('key', key)

  const { data, error } = await query
  if (error) throw new Error(`getKnowledge failed: ${error.message}`)
  return (data ?? []) as KnowledgeItem[]
}

export async function getKnowledgeByCategory(
  brandId:  string,
  category: string
): Promise<KnowledgeItem[]> {
  return getKnowledge(brandId, category)
}

export function formatKnowledgeForPrompt(items: KnowledgeItem[]): string {
  if (items.length === 0) return ''

  const lines = items.map(
    k => `${k.category} - ${k.key}: ${k.value} (confidence: ${k.confidence})`
  )

  return `ACCOUNT KNOWLEDGE:\n${lines.join('\n')}`
}

export async function seedInitialKnowledge(brandId: string): Promise<void> {
  const source = 'March 2026 initial analysis'

  const seeds: Array<[string, string, string, Confidence]> = [
    [
      'performance', 'top_roas_target',
      'dirty labs bio enzyme laundry booster exact match — ROAS 10.16, $1,314 spend, 464 orders, 61.70% CVR in March 2026',
      'confirmed',
    ],
    [
      'performance', 'top_cvr_asin',
      'B09B85NGBT Dish Scent Free — 73.90% CVR, $344K revenue March 2026',
      'confirmed',
    ],
    [
      'performance', 'top_revenue_asin',
      'B09B7YS1VK Laundry Signature 80-load — $359K revenue, 59.47% CVR March 2026',
      'confirmed',
    ],
    [
      'pattern', 'sp_sb_imbalance',
      'Approximately 85% of spend going to SP, significant underinvestment in SB/SBV brand building',
      'confirmed',
    ],
    [
      'pattern', 'spend_pacing_issue',
      'Account consistently underspending vs monthly targets — reach and scale problem, not a budget constraint. March PPC spend $186,234 vs $166,408 target (overspent) but revenue missed target.',
      'confirmed',
    ],
    [
      'pattern', 'retention_strength',
      '61,066 active S&S subscriptions generating $623,257/month (32.6% of total revenue). Strong retention base.',
      'confirmed',
    ],
    [
      'pattern', 'organic_revenue_base',
      '68.5% of revenue is organic ($1,311,779 of $1,913,813 in March 2026). Strong organic foundation. NTB acquisition is the primary growth constraint.',
      'confirmed',
    ],
    [
      'pattern', 'waste_target_tru_earth',
      'KW.CO.KT Dish Tru Earth dishwasher detergent exact match — $174 spend at ROAS 0.86. Confirmed waste target.',
      'confirmed',
    ],
    [
      'hypothesis', 'dish_ntb_entry',
      'Dish is a better NTB brand introduction than Laundry — stronger CVR (73.90% vs 59.47%), less competitive category, clearer differentiation, strong cross-sell potential to Laundry and Booster post-conversion.',
      'probable',
    ],
    [
      'hypothesis', 'branded_budget_reallocation',
      'Shifting some branded campaign budget to non-branded NTB expansion is likely mostly upside given strong organic branded rank and high branded CVR.',
      'probable',
    ],
    [
      'account_structure', 'sbv_naming_fix',
      '15 SBV campaigns were incorrectly named with SB. prefix — corrected in database and Amazon Ads in May 2026. Future reports will show correct SBV classification.',
      'confirmed',
    ],
  ]

  for (const [category, key, value, confidence] of seeds) {
    await saveKnowledge(brandId, category, key, value, confidence, source)
  }
}
