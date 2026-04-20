import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  // Verify caller is authenticated
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  let body: { recipeId?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const { recipeId } = body
  if (!recipeId) return new Response('Missing recipeId', { status: 400 })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: recipe } = await supabase
    .from('recipes')
    .select('id, status, retry_count, uploaded_by')
    .eq('id', recipeId)
    .single()

  if (!recipe) return new Response('Not found', { status: 404 })
  if (recipe.uploaded_by !== user.id) return new Response('Forbidden', { status: 403 })
  if (recipe.status !== 'failed') return new Response('Recipe is not failed', { status: 400 })
  if ((recipe.retry_count ?? 0) >= 3) return new Response('Max retries exceeded', { status: 400 })

  // Reset to pending — DB webhook will re-fire parse-recipe automatically
  await supabase.from('recipes').update({
    status: 'pending',
    processing_started_at: null,
    processing_completed_at: null,
    rejection_reason: null,
  }).eq('id', recipeId)

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
