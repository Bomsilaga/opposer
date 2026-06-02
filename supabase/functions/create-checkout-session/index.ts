import Stripe from 'https://esm.sh/stripe@14?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PRICE_IDS: Record<string, string> = {
  student:  Deno.env.get('STRIPE_PRICE_STUDENT')  ?? '',
  solo:     Deno.env.get('STRIPE_PRICE_SOLO')     ?? '',
  pro:      Deno.env.get('STRIPE_PRICE_PRO')      ?? '',
  team:     Deno.env.get('STRIPE_PRICE_TEAM')     ?? '',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { plan, email, successUrl, cancelUrl } = await req.json()

    if (!plan || !PRICE_IDS[plan]) {
      return new Response(JSON.stringify({ error: 'invalid_plan' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
    })

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      customer_email: email || undefined,
      success_url: successUrl + '?stripe_session={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl,
      metadata: { plan },
      subscription_data: { metadata: { plan } },
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
