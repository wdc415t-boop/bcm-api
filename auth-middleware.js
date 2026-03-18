/**
 * JWT Authentication Middleware
 * ─────────────────────────────
 * Verifies the Bearer token on protected routes.
 * Attaches user info to req.user if valid.
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bcm-dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

/**
 * Generate a JWT token for a user
 */
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Middleware: Require authentication
 * Returns 401 if no valid token is present.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token. Please log in again.' });
  }
}

/**
 * Middleware: Optional authentication
 * Attaches user info if token is present and valid, but doesn't require it.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

/**
 * Middleware: Require active premium subscription
 * Must be used AFTER requireAuth.
 */
function requirePremium(req, res, next) {
  const { stmts } = require('./db');
  const sub = stmts.getActiveSubscription.get(req.user.userId);

  if (!sub || sub.plan === 'free') {
    return res.status(403).json({
      error: 'Premium subscription required.',
      upgrade_url: 'https://beachcombersmania.online/subscribe'
    });
  }

  if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
    stmts.updateSubscriptionStatus.run('expired', sub.id);
    return res.status(403).json({
      error: 'Your subscription has expired. Please renew.',
      upgrade_url: 'https://beachcombersmania.online/subscribe'
    });
  }

  req.subscription = sub;
  next();
}

module.exports = { generateToken, requireAuth, optionalAuth, requirePremium, JWT_SECRET };
