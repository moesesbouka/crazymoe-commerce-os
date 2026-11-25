import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-council-key',
  'Access-Control-Allow-Methods': 'POST, GET, PATCH, OPTIONS'
}

const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

type Msg = { role: 'user' | 'assistant', content: string }

async function callClaude(messages: Msg[], context: string): Promise<[string, number]> {
  const t = Date.now()
  const key = Deno.env.get('ANTHROPIC_API_KEY') ?? Deno.env.get('Anthropic') ?? ''
  if (!key) throw new Error('Anthropic key not set')
  const sys = context ? context + '\n\nRespond naturally and conversationally.' : 'Respond naturally and conversationally.'
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8192, system: sys, messages })
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error?.message ?? `Claude ${res.status}`)
  return [d.content.filter((b: any)=>b.type==='text').map((b: any)=>b.text).join('\n') + (d.stop_reason==='max_tokens'?'\n\n[MOE AI COUNCIL: ANSWER INCOMPLETE -- provider reached token limit]':''), Date.now() - t]
}

async function callOpenAI(messages: Msg[], context: string): Promise<[string, number]> {
  const t = Date.now()
  const key = Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('OPENAI') ?? ''
  if (!key) throw new Error('OpenAI key not set')
  const sys = context ? context + '\n\nRespond naturally and conversationally.' : 'Respond naturally and conversationally.'
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 8192, messages: [{ role: 'system', content: sys }, ...messages] })
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error?.message ?? `OpenAI ${res.status}`)
  return [d.choices[0].message.content + (d.choices[0].finish_reason==='length'?'\n\n[MOE AI COUNCIL: ANSWER INCOMPLETE -- provider reached token limit]':''), Date.now() - t]
}

async function callGemini(messages: Msg[], context: string): Promise<[string, number]> {
  const t = Date.now()
  const key = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY') ?? Deno.env.get('google') ?? ''
  if (!key) throw new Error('Gemini key not set')
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const body: Record<string, unknown> = { contents, generationConfig: { maxOutputTokens: 8192 } }
  if (context) body.systemInstruction = { parts: [{ text: context }] }
  const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash']
  let lastError = ''
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
      const d = await res.json()
      if (res.ok && d.candidates?.[0]?.content?.parts?.[0]?.text) return [d.candidates[0].content.parts.map((p: any)=>p.text??'').join('\n') + (d.candidates[0].finishReason==='MAX_TOKENS'?'\n\n[MOE AI COUNCIL: ANSWER INCOMPLETE -- provider reached token limit]':''), Date.now() - t]
      lastError = d.error?.message ?? `Gemini ${res.status}`
    } catch(e) { lastError = (e as Error).message }
  }
  throw new Error(lastError || 'Gemini failed')
}

async function callGrok(messages: Msg[], context: string): Promise<[string, number]> {
  const t = Date.now()
  const key = Deno.env.get('GROK_API_KEY') ?? Deno.env.get('XAI_API_KEY') ?? Deno.env.get('xAI') ?? ''
  if (!key) throw new Error('Grok key not set')
  const sys = context ? context + '\n\nRespond naturally and conversationally.' : 'Respond naturally and conversationally.'
  const allMessages = [{ role: 'system', content: sys }, ...messages]
  const models = ['grok-3-fast', 'grok-3', 'grok-2-1212', 'grok-beta']
  let lastError = ''
  for (const model of models) {
    try {
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: allMessages, max_tokens: 2048 })
      })
      const d = await res.json()
      if (res.ok && d.choices?.[0]?.message?.content) return [d.choices[0].message.content, Date.now() - t]
      lastError = d.error?.message ?? `Grok ${res.status}`
    } catch(e) { lastError = (e as Error).message }
  }
  throw new Error(lastError || 'Grok failed')
}

const callers: Record<string, (msgs: Msg[], ctx: string) => Promise<[string, number]>> = {
  claude: callClaude, gpt: callOpenAI, gemini: callGemini, grok: callGrok
}

function makeTitle(p: string) {
  return (p || '').replace(/\s+/g,' ').trim().split(' ').slice(0,8).join(' ') + (p.length > 60 ? '...' : '')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // Private, high-entropy Council access key; no secret ever appears in a public app bundle.
  const councilAccess = req.headers.get('x-council-key') ?? '';
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(councilAccess));
  const digest = Array.from(new Uint8Array(digestBytes)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (!councilAccess || digest !== '4c1ec8e4e80af664b1e23c66107701bdd3bb104218b964a15b040299390189e2') {
    return new Response(JSON.stringify({error:'Unauthorized. Open your personal Council link to activate access.'}), {
      status:401,headers:{ ...( cors ),'Content-Type':'application/json'}
    })
  }

  const url = new URL(req.url)
  const db = createClient(SUPA_URL, SUPA_KEY)

  // Health
  if (req.method === 'GET' || url.searchParams.get('health') === '1') {
    const checks = {
      claude: !!(Deno.env.get('ANTHROPIC_API_KEY') ?? Deno.env.get('Anthropic')),
      gpt: !!(Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('OPENAI')),
      gemini: !!(Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY') ?? Deno.env.get('google')),
      grok: !!(Deno.env.get('GROK_API_KEY') ?? Deno.env.get('XAI_API_KEY') ?? Deno.env.get('xAI')),
      database: !!SUPA_KEY,
    }
    return new Response(JSON.stringify({ checks, ready: Object.values(checks).filter(Boolean).length, total: 5 }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // Save winner
  if (req.method === 'PATCH') {
    const { sessionId, winner } = await req.json()
    await db.from('crunch_sessions').update({ winner }).eq('id', sessionId)
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  try {
    const body = await req.json()
    const {
      sessionId, round = 1, isNew = false, context = '',
      // Support both old (prompt) and new (firePrompt) field names
      firePrompt, prompt,
      prevResponses = {}, crunchNote = '',
      isCrunch = false,
      models = ['claude','gpt','gemini','grok'],
      // Thread reply mode
      threadModel, threadMessage, threadHistory = []
    } = body

    const thePrompt: string = (firePrompt ?? prompt ?? '').toString()

    // THREAD REPLY
    if (threadModel && threadMessage) {
      const caller = callers[threadModel]
      if (!caller) throw new Error(`Unknown model: ${threadModel}`)
      const messages: Msg[] = [...(threadHistory as Msg[]), { role: 'user' as const, content: threadMessage }]
      const [text, ms] = await caller(messages, context)
      await db.from('crunch_messages').insert([
        { session_id: sessionId, model: threadModel, role: 'user', content: threadMessage, round },
        { session_id: sessionId, model: threadModel, role: 'assistant', content: text, round }
      ])
      return new Response(JSON.stringify({ reply: text, latency: ms }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // FIRE ALL / CRUNCH
    let finalPrompt = thePrompt
    if (isCrunch && prevResponses && Object.keys(prevResponses).length > 0) {
      const combined = Object.entries(prevResponses as Record<string, string>)
        .filter(([, v]) => v && !v.startsWith('Error'))
        .map(([m, r]) => `[${m.toUpperCase()}]:\n${r}`).join('\n\n---\n\n')
      if (combined) {
        const note = crunchNote ? `\n\nAdditional instruction: ${crunchNote}` : ''
        finalPrompt = `Original prompt: "${thePrompt}"\n\nHere are the AI responses:\n\n${combined}\n\n---${note}\n\nSynthesize the absolute best single response.`
      }
    }

    const settled = await Promise.allSettled(
      models.map(async (m: string) => {
        const caller = callers[m]
        if (!caller) throw new Error(`Unknown: ${m}`)
        const msgs: Msg[] = [{ role: 'user', content: finalPrompt }]
        const [text, ms] = await caller(msgs, context)
        return { model: m, text, ms }
      })
    )

    const results: Record<string, string> = {}
    const latencies: Record<string, number> = {}
    const errors: Record<string, string> = {}
    const msgRows: Record<string, unknown>[] = []

    settled.forEach((r, i) => {
      const m = models[i]
      if (r.status === 'fulfilled') {
        results[m] = r.value.text
        latencies[m] = r.value.ms
        msgRows.push({ session_id: sessionId, model: m, role: 'user', content: thePrompt, round })
        msgRows.push({ session_id: sessionId, model: m, role: 'assistant', content: r.value.text, round })
      } else {
        const msg = (r.reason as Error)?.message ?? 'Unknown error'
        results[m] = `Error: ${msg}`
        errors[m] = msg
      }
    })

    const t = makeTitle(thePrompt)
    if (isNew) {
      await db.from('crunch_sessions').insert({ id: sessionId, prompt: thePrompt, title: t, round_count: 1, context: context || null })
    } else if (thePrompt) {
      await db.from('crunch_sessions').update({ round_count: round }).eq('id', sessionId)
    }
    if (msgRows.length > 0) await db.from('crunch_messages').insert(msgRows)

    return new Response(
      JSON.stringify({ results, latencies, errors, title: t }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err instanceof Error ? err.message : String(err)) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  }
})
