import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const TIER_MAP: Record<string, { tier: string; cap: number; mrr: number; model: string }> = {
  student:  { tier: 'student',  cap: 20,  mrr: 9.99,  model: 'claude-sonnet-4-6' },
  solo:     { tier: 'solo',     cap: 50,  mrr: 29.99, model: 'claude-haiku-4-5-20251001' },
  pro:      { tier: 'pro',      cap: 150, mrr: 59.99, model: 'claude-sonnet-4-6' },
  team:     { tier: 'team',     cap: 300, mrr: 129.99, model: 'claude-sonnet-4-6' },
}

const TIER_LABEL: Record<string, string> = {
  student: 'Student', solo: 'Solo', pro: 'Pro', team: 'Team',
}

function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let key = ''
  for (let i = 0; i < 24; i++) {
    if (i > 0 && i % 6 === 0) key += '-'
    key += chars[Math.floor(Math.random() * chars.length)]
  }
  return key
}

async function sendLicenseEmail(email: string, name: string, licenseKey: string, tier: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return

  const firstName = name.split(' ')[0] || 'there'
  const appUrl = 'https://the-opposer.com'
  const tierLabel = TIER_LABEL[tier] ?? tier

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM') ?? 'The Opposer <noreply@the-opposer.com>',
      to: email,
      subject: `Your Opposer ${tierLabel} license key`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0f0f14">
          <h2 style="margin:0 0 8px;font-size:24px;font-weight:900">You're in. ⚔️</h2>
          <p style="color:#6b7280;margin:0 0 28px">Hi ${firstName}, your <strong>Opposer ${tierLabel}</strong> subscription is active.</p>

          <div style="background:#fafafa;border:2px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:28px">
            <p style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#6b7280;margin:0 0 8px">Your License Key</p>
            <p style="font-family:monospace;font-size:20px;font-weight:700;letter-spacing:3px;color:#ff3d3d;margin:0">${licenseKey}</p>
          </div>

          <p style="margin:0 0 16px;color:#2a2a3a">To activate your account:</p>
          <ol style="padding-left:20px;margin:0 0 28px;color:#2a2a3a;line-height:2">
            <li>Go to <a href="${appUrl}" style="color:#ff3d3d">${appUrl}</a></li>
            <li>Click <strong>Upgrade 🔥</strong> in the top right</li>
            <li>Paste your license key and click Activate</li>
          </ol>

          <a href="${appUrl}" style="display:inline-block;background:#ff3d3d;color:#fff;padding:13px 28px;border-radius:999px;font-weight:900;font-size:15px;text-decoration:none">Go to The Opposer →</a>

          <p style="margin:28px 0 0;font-size:12px;color:#9ca3af">
            To manage or cancel your subscription, <a href="${appUrl}?manage=1" style="color:#6b7280">click here</a>.<br>
            Questions? Reply to this email.
          </p>
        </div>
      `,
    }),
  })
}

Deno.serve(async (req) => {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2024-04-10',
  })

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response('Bad signature', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode !== 'subscription') return new Response('ok')

      const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
      const plan = (subscription.metadata?.plan ?? session.metadata?.plan ?? '') as string
      const cfg = TIER_MAP[plan]
      if (!cfg) {
        console.error('Unknown plan in metadata:', plan)
        return new Response('ok')
      }

      const customer = await stripe.customers.retrieve(session.customer as string) as Stripe.Customer
      const email = customer.email ?? session.customer_email ?? ''
      const name = typeof customer.name === 'string' ? customer.name : ''
      const licenseKey = generateLicenseKey()

      const now = new Date()
      const renewal = new Date(now)
      renewal.setMonth(renewal.getMonth() + 1)

      await supabase.from('subscribers').upsert({
        email,
        name,
        tier: cfg.tier,
        status: 'active',
        run_cap: cfg.cap,
        model: cfg.model,
        mrr_usd: cfg.mrr,
        license_key: licenseKey,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        payment_provider: 'stripe',
        billing_month: `${now.getFullYear()}-${now.getMonth() + 1}`,
        runs_used_this_month: 0,
        renewal_date: renewal.toISOString(),
        last_active: now.toISOString(),
      }, { onConflict: 'email' })

      // Send license key email (no-op if RESEND_API_KEY not set)
      await sendLicenseEmail(email, name, licenseKey, cfg.tier)

    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription
      const plan = (sub.metadata?.plan ?? '') as string
      const cfg = TIER_MAP[plan]
      const status = sub.status === 'active' ? 'active' : sub.status === 'canceled' ? 'cancelled' : sub.status

      const updateData: Record<string, unknown> = { status }
      if (cfg) {
        updateData.tier = cfg.tier
        updateData.run_cap = cfg.cap
        updateData.model = cfg.model
        updateData.mrr_usd = cfg.mrr
      }

      await supabase
        .from('subscribers')
        .update(updateData)
        .eq('stripe_subscription_id', sub.id)

    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      await supabase
        .from('subscribers')
        .update({ status: 'cancelled' })
        .eq('stripe_subscription_id', sub.id)

    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.subscription) {
        await supabase
          .from('subscribers')
          .update({ status: 'payment_failed' })
          .eq('stripe_subscription_id', invoice.subscription as string)
      }
    }

  } catch (err) {
    console.error('Handler error:', err)
    return new Response('Handler error: ' + err.message, { status: 500 })
  }

  return new Response('ok', { status: 200 })
})
