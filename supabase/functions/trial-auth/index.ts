import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { action, email, token } = await req.json()

    // ── REGISTER / RECOVER ──────────────────────────────────────────────
    if (action === 'register') {
      if (!email || !String(email).includes('@')) {
        return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: cors })
      }

      const emailLower = String(email).toLowerCase().trim()

      // Return existing record if already registered (same token, accumulated runs)
      const { data: existing } = await supabase
        .from('trial_users')
        .select('token, runs_used')
        .eq('email', emailLower)
        .single()

      if (existing) {
        return new Response(JSON.stringify({
          token: existing.token,
          runs_used: existing.runs_used,
          runs_remaining: Math.max(0, 3 - existing.runs_used),
        }), { headers: cors })
      }

      // New user
      const { data: created, error } = await supabase
        .from('trial_users')
        .insert({ email: emailLower })
        .select('token, runs_used')
        .single()

      if (error || !created) {
        console.error('insert error', error)
        return new Response(JSON.stringify({ error: 'registration_failed' }), { status: 500, headers: cors })
      }

      return new Response(JSON.stringify({
        token: created.token,
        runs_used: 0,
        runs_remaining: 3,
      }), { headers: cors })
    }

    // ── VERIFY TOKEN ────────────────────────────────────────────────────
    if (action === 'verify') {
      if (!token) {
        return new Response(JSON.stringify({ error: 'no_token' }), { status: 400, headers: cors })
      }

      const { data } = await supabase
        .from('trial_users')
        .select('runs_used, email')
        .eq('token', token)
        .single()

      if (!data) {
        return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 403, headers: cors })
      }

      return new Response(JSON.stringify({
        runs_used: data.runs_used,
        runs_remaining: Math.max(0, 3 - data.runs_used),
        email: data.email,
      }), { headers: cors })
    }

    return new Response(JSON.stringify({ error: 'unknown_action' }), { status: 400, headers: cors })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'server_error', detail: err.message }), {
      status: 500,
      headers: cors,
    })
  }
})
