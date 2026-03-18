/**
 * BeachCombersMania — SQLite Database
 * ────────────────────────────────────
 * Uses better-sqlite3 for zero-config, serverless database.
 * Stores: users, subscriptions, shell collections (future).
 *
 * NOTE: On Render.com free tier, the SQLite file persists between
 * sleep/wake cycles but is lost on new deploys. When you move to
 * Render paid ($7/mo) or Hostinger VPS, data persists permanently.
 * A backup strategy will be added before going live with real users.
 */

const Database = require('better-sqlite3');
const path = require('path');

// Store DB in a data directory
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bcm.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────

db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT DEFAULT '',
    home_region TEXT DEFAULT 'Marco Island',
    avatar_url TEXT DEFAULT '',
    email_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Subscriptions table
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free'
      CHECK(plan IN ('free', 'monthly', 'annual', 'lifetime', 'family')),
    status TEXT NOT NULL DEFAULT 'active'
      CHECK(status IN ('active', 'cancelled', 'expired', 'past_due', 'trialing')),
    stripe_customer_id TEXT DEFAULT '',
    stripe_subscription_id TEXT DEFAULT '',
    started_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    cancelled_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Shell collections (cloud sync for premium users — future)
  CREATE TABLE IF NOT EXISTS shell_collections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shell_name TEXT NOT NULL,
    scientific_name TEXT DEFAULT '',
    photo_url TEXT DEFAULT '',
    region TEXT DEFAULT '',
    beach TEXT DEFAULT '',
    found_date TEXT DEFAULT (datetime('now')),
    notes TEXT DEFAULT '',
    condition TEXT DEFAULT '',
    rarity TEXT DEFAULT '',
    ai_confidence TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Indexes for fast lookups
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
  CREATE INDEX IF NOT EXISTS idx_shell_collections_user_id ON shell_collections(user_id);
  CREATE INDEX IF NOT EXISTS idx_shell_collections_region ON shell_collections(region);
`);

console.log(`  Database: ${DB_PATH}`);

// ── Prepared Statements ─────────────────────────────────────────

const stmts = {
  // Users
  createUser: db.prepare(`
    INSERT INTO users (id, email, password_hash, name, home_region)
    VALUES (?, ?, ?, ?, ?)
  `),
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  updateUser: db.prepare(`
    UPDATE users SET name = ?, home_region = ?, avatar_url = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  // Subscriptions
  createSubscription: db.prepare(`
    INSERT INTO subscriptions (id, user_id, plan, status, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  getActiveSubscription: db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ? AND status IN ('active', 'trialing')
    ORDER BY created_at DESC LIMIT 1
  `),
  updateSubscriptionStatus: db.prepare(`
    UPDATE subscriptions SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `),
  updateSubscriptionStripe: db.prepare(`
    UPDATE subscriptions
    SET stripe_customer_id = ?, stripe_subscription_id = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  // Shell collections
  addShell: db.prepare(`
    INSERT INTO shell_collections (id, user_id, shell_name, scientific_name, photo_url, region, beach, found_date, notes, condition, rarity, ai_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getUserShells: db.prepare(`
    SELECT * FROM shell_collections WHERE user_id = ? ORDER BY found_date DESC
  `),
  countUserShells: db.prepare(`
    SELECT COUNT(*) as count FROM shell_collections WHERE user_id = ?
  `),

  // Stats
  countUsers: db.prepare(`SELECT COUNT(*) as count FROM users`),
  countPaidUsers: db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count FROM subscriptions
    WHERE plan != 'free' AND status = 'active'
  `),
};

module.exports = { db, stmts };
