import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (token !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const now = new Date()
  const iso = now.toISOString()

  // 1. Failed job cleanup: delete storage + DB for recipes failed > 48 hours ago
  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
  const { data: failedRecipes } = await supabase
    .from('recipes')
    .select('id, storage_path, cover_path')
    .eq('status', 'failed')
    .lt('processing_completed_at', cutoff48h)

  let cleaned = 0
  for (const recipe of failedRecipes ?? []) {
    const paths = [recipe.storage_path, recipe.cover_path].filter(Boolean)
    if (paths.length > 0) {
      await supabase.storage.from('recipe-pdfs').remove(paths)
    }
    await supabase.from('recipes').delete().eq('id', recipe.id)
    cleaned++
  }

  // 2. Ghost pending cleanup: pending for > 30 min with no processing_started_at
  const cutoff30m = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
  await supabase.from('recipes')
    .update({
      status: 'failed',
      rejection_reason: 'webhook_timeout',
      processing_completed_at: iso,
    })
    .eq('status', 'pending')
    .is('processing_started_at', null)
    .lt('created_at', cutoff30m)

  // 3. Stuck processing cleanup: processing for > 30 min without completing
  await supabase.from('recipes')
    .update({
      status: 'failed',
      rejection_reason: 'processing_timeout',
      processing_completed_at: iso,
    })
    .eq('status', 'processing')
    .lt('processing_started_at', cutoff30m)

  return new Response(JSON.stringify({ cleaned }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
