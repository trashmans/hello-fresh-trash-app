// Sets a recipe's cover_path. Recipes has no client-writable UPDATE policy
// (by design — see supabase/migrations/20260418000001_recipes.sql), so this
// narrow, admin-gated function is the only way to backfill cover_path on
// recipes that already exist. The cover image itself is generated and
// uploaded client-side (see src/lib/pdfCover.js) — this function only
// records the resulting storage path, using the service role to bypass RLS.
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

  let body: { recipeId?: string; coverPath?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400, headers: corsHeaders })
  }

  const { recipeId, coverPath } = body
  if (!recipeId || !coverPath) {
    return new Response('Missing recipeId or coverPath', { status: 400, headers: corsHeaders })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: role } = await supabase
    .from('user_roles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!role?.is_admin) return new Response('Forbidden', { status: 403, headers: corsHeaders })

  const { data: recipe } = await supabase
    .from('recipes')
    .select('id')
    .eq('id', recipeId)
    .single()

  if (!recipe) return new Response('Not found', { status: 404, headers: corsHeaders })

  const { error: updateError } = await supabase
    .from('recipes')
    .update({ cover_path: coverPath })
    .eq('id', recipeId)

  if (updateError) {
    return new Response(`Failed to set cover_path: ${updateError.message}`, { status: 500, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
