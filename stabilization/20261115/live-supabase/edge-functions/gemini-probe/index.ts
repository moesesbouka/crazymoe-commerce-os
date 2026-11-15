const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const key = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY') ?? Deno.env.get('google') ?? ''
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
  const d = await res.json()
  const names = (d.models || []).map((m: any) => m.name).filter((n: string) => n.includes('flash') || n.includes('pro'))
  return new Response(JSON.stringify({ available: names }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
