import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-council-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  // Private, high-entropy Council access key; no secret ever appears in a public app bundle.
  const councilAccess = req.headers.get('x-council-key') ?? '';
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(councilAccess));
  const digest = Array.from(new Uint8Array(digestBytes)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (!councilAccess || digest !== '4c1ec8e4e80af664b1e23c66107701bdd3bb104218b964a15b040299390189e2') {
    return new Response(JSON.stringify({error:'Unauthorized. Open your personal Council link to activate access.'}), {
      status:401,headers:{ ...( corsHeaders ),'Content-Type':'application/json'}
    })
  }


  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  )

  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')

  // Full session hydrate — returns all rounds of responses for a session
  if (sessionId) {
    const { data: session } = await db
      .from('crunch_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    const { data: responses } = await db
      .from('crunch_responses')
      .select('*')
      .eq('session_id', sessionId)
      .order('round', { ascending: true })
      .order('model', { ascending: true })

    return new Response(
      JSON.stringify({ session, responses }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Session list for sidebar
  const { data, error } = await db
    .from('crunch_sessions')
    .select('id, prompt, title, round_count, best_model, created_at')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify(data),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
