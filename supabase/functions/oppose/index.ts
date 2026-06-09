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
    const { licenseKey, docType, messages, systemPrompt, isTrial, trialToken } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

    let sub: any = null
    let trialUserId: string | null = null

    if (isTrial) {
      // Require a registered trial token — prevents anonymous abuse
      if (!trialToken) {
        return new Response(JSON.stringify({ error: 'trial_token_required' }), { status: 401, headers: cors })
      }

      const { data: trialUser, error } = await supabase
        .from('trial_users')
        .select('id, runs_used')
        .eq('token', trialToken)
        .single()

      if (error || !trialUser) {
        return new Response(JSON.stringify({ error: 'invalid_trial' }), { status: 403, headers: cors })
      }

      if (trialUser.runs_used >= 3) {
        return new Response(JSON.stringify({ error: 'trial_exhausted', cap: 3 }), { status: 429, headers: cors })
      }

      trialUserId = trialUser.id
      sub = { model: 'claude-haiku-4-5', run_cap: 3, runs_used_this_month: trialUser.runs_used, tier: 'free' }

    } else {
      // Verify license key
      if (!licenseKey) {
        return new Response(JSON.stringify({ error: 'no_key' }), { status: 401, headers: cors })
      }

      const { data, error } = await supabase
        .from('subscribers')
        .select('*')
        .eq('license_key', licenseKey)
        .eq('status', 'active')
        .single()

      if (error || !data) {
        return new Response(JSON.stringify({ error: 'invalid_key' }), { status: 403, headers: cors })
      }

      sub = data

      // Check monthly run cap
      const now = new Date()
      const thisMonth = `${now.getFullYear()}-${now.getMonth() + 1}`

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
          headers: cors,
        })
      }
    }

    // Normalise model ID — map any retired/old IDs to current ones
    const MODEL_MAP: Record<string, string> = {
      'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
      'claude-3-5-sonnet-20240620': 'claude-sonnet-4-6',
      'claude-3-opus-20240229':     'claude-sonnet-4-6',
      'claude-3-sonnet-20240229':   'claude-sonnet-4-6',
      'claude-3-haiku-20240307':    'claude-haiku-4-5',
      'claude-3-5-haiku-20241022':  'claude-haiku-4-5',
      'claude-haiku-4-5-20251001':  'claude-haiku-4-5',
    }
    const resolvedModel = MODEL_MAP[sub.model] ?? sub.model ?? 'claude-haiku-4-5'

    // Call Anthropic
    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      })
    })

    const result = await anthropicRes.json()

    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: 'anthropic_error', detail: result }), {
        status: 502,
        headers: cors,
      })
    }

    // Increment run count
    if (isTrial && trialUserId) {
      // Server-side trial tracking
      await supabase
        .from('trial_users')
        .update({
          runs_used: sub.runs_used_this_month + 1,
          last_used: new Date().toISOString(),
        })
        .eq('id', trialUserId)
    } else if (!isTrial && sub.id) {
      // Paid subscriber tracking
      await supabase
        .from('subscribers')
        .update({
          runs_used_this_month: sub.runs_used_this_month + 1,
          last_active: new Date().toISOString(),
        })
        .eq('id', sub.id)

      await supabase.from('run_log').insert({
        subscriber_id: sub.id,
        doc_type: docType,
        model_used: resolvedModel,
        tokens_used: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
        is_trial: false,
      })
    }

    return new Response(JSON.stringify({ text: result.content[0].text }), {
      headers: cors,
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'server_error', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
