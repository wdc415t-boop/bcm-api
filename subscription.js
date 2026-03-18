/**
 * Subscription Routes
 * ───────────────────
 * GET  /api/subscription         — Get current subscription details
 * POST /api/subscription/upgrade — Upgrade plan (Stripe placeholder)
 * POST /api/subscription/cancel  — Cancel subscription
 * GET  /api/subscription/plans   — List available plans & pricing
 *
 * NOTE: Stripe integration will be added in a follow-up session.
 * For now, these endpoints handle the subscription state in SQLite
 * and provide the structure for Stripe to plug into.
 */

const express = require('express');
const crypto = require('crypto');
const { stmts } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Pricing configuration ───────────────────────────────────────

const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    billing: null,
    features: [
      '3 AI shell identifications per day',
      'Static shell species database (200+ species)',
      'Save up to 10 shells locally',
      'Basic restaurant & boat charter listings',
      'Basic tide data for one region'
    ]
  },
  monthly: {
    name: 'Monthly Premium',
    price: 4.99,
    billing: 'monthly',
    stripe_price_id: process.env.STRIPE_MONTHLY_PRICE_ID || '',
    features: [
      'Unlimited AI shell identifications',
      'All 6 Gulf Coast regions unlocked',
      'Unlimited cloud-synced collection',
      'AI-refreshed restaurant & boat listings',
      'Full weather + shelling forecast',
      'Ad-free experience'
    ]
  },
  annual: {
    name: 'Annual Premium',
    price: 29.99,
    billing: 'annual',
    stripe_price_id: process.env.STRIPE_ANNUAL_PRICE_ID || '',
    features: [
      'Everything in Monthly Premium',
      'Save $30/year vs monthly',
      'Priority shell identification',
      'Downloadable species guides (PDF)'
    ]
  },
  lifetime: {
    name: 'Lifetime Premium',
    price: 79.99,
    billing: 'one-time',
    stripe_price_id: process.env.STRIPE_LIFETIME_PRICE_ID || '',
    features: [
      'Everything in Annual Premium',
      'One-time purchase — never pay again',
      'Early Supporter badge',
      'Beta access to new features'
    ]
  },
  family: {
    name: 'Family Plan (Annual)',
    price: 49.99,
    billing: 'annual',
    stripe_price_id: process.env.STRIPE_FAMILY_PRICE_ID || '',
    features: [
      'Everything in Annual Premium',
      'Up to 5 family members',
      'Each member gets own collection & badges',
      'One billing account'
    ]
  }
};

// ── GET /api/subscription/plans ─────────────────────────────────

router.get('/plans', (req, res) => {
  // Return plans without internal Stripe IDs
  const plans = {};
  for (const [key, plan] of Object.entries(PLANS)) {
    plans[key] = {
      name: plan.name,
      price: plan.price,
      billing: plan.billing,
      features: plan.features
    };
  }
  res.json({ plans });
});

// ── GET /api/subscription ───────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  try {
    const sub = stmts.getActiveSubscription.get(req.user.userId);

    if (!sub || sub.plan === 'free') {
      return res.json({
        plan: 'free',
        status: 'active',
        is_premium: false,
        features: PLANS.free.features,
        upgrade_url: 'https://beachcombersmania.online/subscribe'
      });
    }

    // Check expiry
    if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
      stmts.updateSubscriptionStatus.run('expired', sub.id);
      return res.json({
        plan: sub.plan,
        status: 'expired',
        is_premium: false,
        expired_at: sub.expires_at,
        renew_url: 'https://beachcombersmania.online/subscribe'
      });
    }

    res.json({
      plan: sub.plan,
      status: sub.status,
      is_premium: true,
      started_at: sub.started_at,
      expires_at: sub.expires_at,
      features: PLANS[sub.plan]?.features || PLANS.monthly.features
    });

  } catch (err) {
    console.error('Subscription fetch error:', err.message);
    res.status(500).json({ error: 'Could not load subscription.' });
  }
});

// ── POST /api/subscription/upgrade ──────────────────────────────
// NOTE: This is a PLACEHOLDER. When Stripe is integrated, this will
// create a Stripe Checkout session and return the checkout URL.
// For now, it allows manual plan upgrades (useful for testing).

router.post('/upgrade', requireAuth, (req, res) => {
  try {
    const { plan } = req.body;

    if (!plan || !PLANS[plan] || plan === 'free') {
      return res.status(400).json({
        error: 'Invalid plan. Choose: monthly, annual, lifetime, or family.',
        available_plans: Object.keys(PLANS).filter(p => p !== 'free')
      });
    }

    // Check if Stripe is configured
    const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;

    if (stripeConfigured) {
      // TODO: Create Stripe Checkout Session
      // const session = await stripe.checkout.sessions.create({...});
      // return res.json({ checkout_url: session.url });
      return res.status(501).json({
        error: 'Stripe checkout coming soon.',
        message: 'Payment integration is being set up. Check back shortly!'
      });
    }

    // ── DEV/TEST MODE: Direct upgrade without payment ───────────
    // This allows testing the full flow before Stripe is live.

    // Expire any existing active subscriptions
    const existingSub = stmts.getActiveSubscription.get(req.user.userId);
    if (existingSub && existingSub.plan !== 'free') {
      stmts.updateSubscriptionStatus.run('cancelled', existingSub.id);
    }

    // Calculate expiry
    let expires_at = null;
    const now = new Date();
    if (plan === 'monthly') {
      expires_at = new Date(now.setMonth(now.getMonth() + 1)).toISOString();
    } else if (plan === 'annual' || plan === 'family') {
      expires_at = new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();
    }
    // Lifetime = no expiry (null)

    const subId = crypto.randomUUID();
    stmts.createSubscription.run(subId, req.user.userId, plan, 'active', expires_at);

    console.log(`Subscription upgraded: ${req.user.email} → ${plan}`);

    res.json({
      message: `Upgraded to ${PLANS[plan].name}! Welcome to BCM Premium.`,
      subscription: {
        plan,
        status: 'active',
        is_premium: true,
        started_at: new Date().toISOString(),
        expires_at,
        features: PLANS[plan].features
      },
      note: 'TEST MODE — no payment charged. Stripe integration coming soon.'
    });

  } catch (err) {
    console.error('Upgrade error:', err.message);
    res.status(500).json({ error: 'Could not process upgrade. Please try again.' });
  }
});

// ── POST /api/subscription/cancel ───────────────────────────────

router.post('/cancel', requireAuth, (req, res) => {
  try {
    const sub = stmts.getActiveSubscription.get(req.user.userId);

    if (!sub || sub.plan === 'free') {
      return res.status(400).json({ error: 'No active premium subscription to cancel.' });
    }

    if (sub.plan === 'lifetime') {
      return res.status(400).json({ error: 'Lifetime subscriptions cannot be cancelled.' });
    }

    // Cancel at end of billing period (don't revoke immediately)
    stmts.updateSubscriptionStatus.run('cancelled', sub.id);

    console.log(`Subscription cancelled: ${req.user.email} (${sub.plan})`);

    res.json({
      message: 'Subscription cancelled. You\'ll retain premium access until your current billing period ends.',
      subscription: {
        plan: sub.plan,
        status: 'cancelled',
        access_until: sub.expires_at
      }
    });

  } catch (err) {
    console.error('Cancel error:', err.message);
    res.status(500).json({ error: 'Could not cancel subscription.' });
  }
});

module.exports = router;
