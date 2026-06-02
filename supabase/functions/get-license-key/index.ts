import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { stripe_session_id } = await req.json()
    if (!stripe_session_id) {
      return new Response(JSON.stringify({ error: 'missing session id' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
    })

    const session = await stripe.checkout.sessions.retrieve(stripe_session_id)
    const subscriptionId = session.subscription as string

    if (!subscriptionId) {
      return new Response(JSON.stringify({ error: 'no subscription' }), {
        status: 404, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data, error } = await supabase
      .from('subscribers')
      .select('license_key, tier, email')
      .eq('stripe_subscription_id', subscriptionId)
      .single()

    if (error || !data) {
      return new Response(JSON.stringify({ error: 'subscriber not found' }), {
        status: 404, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({
      license_key: data.license_key,
      tier: data.tier,
      email: data.email,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
