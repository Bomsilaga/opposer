import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }
    })
  }

  try {
    const { licenseKey, docType, messages, systemPrompt, isTrial } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let sub: any = null

    if (isTrial) {
      // Free trial — no key needed, just check by a session identifier
      // We use a lightweight check — trials are enforced client-side
      // Server just proxies the call with the free (Haiku) model
      sub = { model: 'claude-haiku-4-5-20251001', run_cap: 3, runs_used_this_month: 0, tier: 'free' }
    } else {
      // Verify license key
      if (!licenseKey) {
        return new Response(JSON.stringify({ error: 'no_key' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        })
      }

      const { data, error } = await supabase
        .from('subscribers')
        .select('*')
        .eq('license_key', licenseKey)
        .eq('status', 'active')
        .single()

      if (error || !data) {
        return new Response(JSON.stringify({ error: 'invalid_key' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        })
      }

      sub = data

      // Check monthly run cap
      const now = new Date()
      const thisMonth = `${now.getFullYear()}-${now.getMonth() + 1}`

      // Reset count if new billing month
      if (sub.billing_month !== thisMonth) {
        await supabase
          .from('subscribers')
          .update({ runs_used_this_month: 0, billing_month: thisMonth })
          .eq('id', sub.id)
        sub.runs_used_this_month = 0
      }

      if (sub.runs_used_this_month >= sub.run_cap) {
        return new Response(JSON.stringify({ error: 'cap_reached', cap: sub.run_cap, tier: sub.tier }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        })
      }
    }

    // Call Anthropic
    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: sub.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      })
    })

    const result = await anthropicRes.json()

    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: 'anthropic_error', detail: result }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    // Increment run count and log (skip for trials)
    if (!isTrial && sub.id) {
      await supabase
        .from('subscribers')
        .update({
          runs_used_this_month: sub.runs_used_this_month + 1,
          last_active: new Date().toISOString()
        })
        .eq('id', sub.id)

      await supabase.from('run_log').insert({
        subscriber_id: sub.id,
        doc_type: docType,
        model_used: sub.model,
        tokens_used: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
        is_trial: false
      })
    }

    return new Response(JSON.stringify({ text: result.content[0].text }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'server_error', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
})
