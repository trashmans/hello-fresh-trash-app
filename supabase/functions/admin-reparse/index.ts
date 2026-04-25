import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  let body: { recipeId?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400, headers: corsHeaders })
  }

  const { recipeId } = body
  if (!recipeId) return new Response('Missing recipeId', { status: 400, headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: role } = await supabase
    .from('user_roles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!role?.is_admin) return new Response('Forbidden', { status: 403, headers: corsHeaders })

  const { data: recipe } = await supabase
    .from('recipes')
    .select('id, status')
    .eq('id', recipeId)
    .single()

  if (!recipe) return new Response('Not found', { status: 404, headers: corsHeaders })
  if (recipe.status !== 'ready') return new Response('Recipe is not ready', { status: 400, headers: corsHeaders })

  // Delete existing ingredients so parse-recipe can re-insert them cleanly
  const { error: deleteError } = await supabase
    .from('ingredients')
    .delete()
    .eq('recipe_id', recipeId)

  if (deleteError) {
    return new Response(`Failed to clear ingredients: ${deleteError.message}`, { status: 500, headers: corsHeaders })
  }

  // Clear all parsed fields and reset to pending — webhook re-fires parse-recipe
  await supabase.from('recipes').update({
    status: 'pending',
    name: null,
    source_name: null,
    cook_time_minutes: null,
    prep_time_minutes: null,
    servings: null,
    difficulty: null,
    cuisine: null,
    tags: [],
    steps: [],
    ingredient_fingerprint: null,
    processing_started_at: null,
    processing_completed_at: null,
    rejection_reason: null,
  }).eq('id', recipeId)

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
