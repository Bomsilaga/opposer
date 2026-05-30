import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TIER_MAP: Record<string, {tier:string, cap:number, mrr:number, model:string}> = {
  'opposer-student': {tier:'student', cap:20,  mrr:9.99,  model:'claude-sonnet-4-6'},
  'opposer-solo':    {tier:'solo',    cap:30,  mrr:19.99, model:'claude-haiku-4-5-20251001'},
  'opposer-pro':     {tier:'pro',     cap:80,  mrr:39.99, model:'claude-sonnet-4-6'},
  'opposer-team':    {tier:'team',    cap:200, mrr:89.99, model:'claude-sonnet-4-6'},
}

Deno.serve(async (req) => {
  // Allow Gumroad ping
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const form = await req.formData()
    const email       = form.get('email')?.toString()
    const name        = form.get('full_name')?.toString() ?? ''
    const productSlug = form.get('product_permalink')?.toString() ?? ''
    const licenseKey  = form.get('license_key')?.toString() ?? ''
    const subId       = form.get('subscription_id')?.toString() ?? ''
    const saleType    = form.get('sale_type')?.toString() ?? ''

    // Gumroad also sends cancellation pings
    const cancelled = form.get('cancelled')?.toString() === 'true'
    const ended     = form.get('ended')?.toString() === 'true'

    if (!email) return new Response('no email', { status: 400 })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Handle cancellation
    if (cancelled || ended) {
      await supabase
        .from('subscribers')
        .update({ status: 'cancelled' })
        .eq('email', email)
      return new Response('cancelled', { status: 200 })
    }

    const cfg = TIER_MAP[productSlug]
    if (!cfg) return new Response('unknown product: ' + productSlug, { status: 200 })

    const now = new Date()
    const renewal = new Date(now)
    renewal.setMonth(renewal.getMonth() + 1)

    // Upsert subscriber — if email exists update tier, if new create record
    await supabase.from('subscribers').upsert({
      email,
      name,
      tier: cfg.tier,
      status: 'active',
      run_cap: cfg.cap,
      model: cfg.model,
      mrr_usd: cfg.mrr,
      license_key: licenseKey,
      gumroad_subscription_id: subId,
      gumroad_product_id: productSlug,
      billing_month: `${now.getFullYear()}-${now.getMonth() + 1}`,
      runs_used_this_month: 0,
      renewal_date: renewal.toISOString(),
      last_active: now.toISOString(),
    }, { onConflict: 'email' })

    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error(err)
    return new Response('error: ' + err.message, { status: 500 })
  }
})
