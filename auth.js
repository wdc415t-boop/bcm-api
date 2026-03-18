/**
 * Authentication Routes
 * ─────────────────────
 * POST /api/auth/register  — Create new account
 * POST /api/auth/login     — Log in, get JWT token
 * GET  /api/auth/me        — Get current user profile + subscription
 * PUT  /api/auth/me        — Update profile (name, home_region, avatar)
 * POST /api/auth/change-password — Change password
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { stmts } = require('../db');
const { generateToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Validation helpers ──────────────────────────────────────────

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password) {
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
  return password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password);
}

const VALID_REGIONS = [
  'Marco Island', 'Naples', 'Bonita Springs',
  'Fort Myers Beach', 'Sanibel', 'Captiva'
];

// ── POST /api/auth/register ─────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, home_region } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters with 1 uppercase, 1 lowercase, and 1 number.'
      });
    }

    // Check if email already exists
    const existing = stmts.getUserByEmail.get(email.trim().toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    // Create user
    const userId = crypto.randomUUID();
    const region = VALID_REGIONS.includes(home_region) ? home_region : 'Marco Island';

    stmts.createUser.run(userId, email.trim().toLowerCase(), password_hash, name || '', region);

    // Create free subscription
    const subId = crypto.randomUUID();
    stmts.createSubscription.run(subId, userId, 'free', 'active', null);

    // Generate token
    const user = stmts.getUserById.get(userId);
    const token = generateToken(user);

    console.log(`New user registered: ${email} (${userId})`);

    res.status(201).json({
      message: 'Welcome to BeachCombersMania!',
      token,
      user: sanitizeUser(user),
      subscription: { plan: 'free', status: 'active' }
    });

  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Look up user
    const user = stmts.getUserByEmail.get(email.trim().toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Get subscription
    const sub = stmts.getActiveSubscription.get(user.id) || { plan: 'free', status: 'active' };

    // Generate token
    const token = generateToken(user);

    console.log(`User login: ${email}`);

    res.json({
      message: 'Welcome back!',
      token,
      user: sanitizeUser(user),
      subscription: {
        plan: sub.plan,
        status: sub.status,
        expires_at: sub.expires_at || null
      }
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Could not log in. Please try again.' });
  }
});

// ── GET /api/auth/me ────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  try {
    const user = stmts.getUserById.get(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const sub = stmts.getActiveSubscription.get(user.id) || { plan: 'free', status: 'active' };
    const shellCount = stmts.countUserShells.get(user.id);

    res.json({
      user: sanitizeUser(user),
      subscription: {
        plan: sub.plan,
        status: sub.status,
        started_at: sub.started_at || null,
        expires_at: sub.expires_at || null
      },
      stats: {
        shells_collected: shellCount.count,
        member_since: user.created_at
      }
    });

  } catch (err) {
    console.error('Profile fetch error:', err.message);
    res.status(500).json({ error: 'Could not load profile.' });
  }
});

// ── PUT /api/auth/me ────────────────────────────────────────────

router.put('/me', requireAuth, (req, res) => {
  try {
    const { name, home_region, avatar_url } = req.body;
    const user = stmts.getUserById.get(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const region = VALID_REGIONS.includes(home_region) ? home_region : user.home_region;

    stmts.updateUser.run(
      name !== undefined ? name : user.name,
      region,
      avatar_url !== undefined ? avatar_url : user.avatar_url,
      user.id
    );

    const updated = stmts.getUserById.get(user.id);
    res.json({ message: 'Profile updated.', user: sanitizeUser(updated) });

  } catch (err) {
    console.error('Profile update error:', err.message);
    res.status(500).json({ error: 'Could not update profile.' });
  }
});

// ── POST /api/auth/change-password ──────────────────────────────

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }

    if (!isStrongPassword(new_password)) {
      return res.status(400).json({
        error: 'New password must be at least 8 characters with 1 uppercase, 1 lowercase, and 1 number.'
      });
    }

    const user = stmts.getUserById.get(req.user.userId);
    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(new_password, salt);

    const stmt = require('../db').db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?');
    stmt.run(hash, user.id);

    res.json({ message: 'Password changed successfully.' });

  } catch (err) {
    console.error('Password change error:', err.message);
    res.status(500).json({ error: 'Could not change password.' });
  }
});

// ── Helper: Strip sensitive fields from user object ─────────────

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    home_region: user.home_region,
    avatar_url: user.avatar_url,
    email_verified: !!user.email_verified,
    created_at: user.created_at
  };
}

module.exports = router;
