const { createClient } = require('@libsql/client');

// This is SpiderDB's OWN control-plane database — where it stores its users,
// orgs, API keys, and (in later phases) the registry mapping each customer's
// SpiderDB database name to the real underlying Turso database + token.
// It is Turso-backed from day one, deliberately — no local file fallback,
// so this doesn't repeat the "data resets on redeploy" mistake from scratch.
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. SpiderDB\'s control-plane database requires a real Turso ' +
      'database — sign up at turso.tech, create a database, and set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.'
    );
  }

  await db.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      password TEXT,                          -- NULL for OAuth-only accounts
      is_verified INTEGER DEFAULT 0,
      otp_code TEXT,
      otp_expires TEXT,
      verify_token TEXT,
      verify_token_expires TEXT,
      reset_token TEXT,
      reset_token_expires TEXT,
      google_id TEXT UNIQUE,
      github_id TEXT UNIQUE,
      avatar TEXT DEFAULT '',
      role TEXT DEFAULT 'member',              -- 'member' | 'admin'
      account_status TEXT DEFAULT 'active',    -- 'active' | 'suspended' | 'banned'
      created_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      owner_id TEXT NOT NULL,
      plan TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',              -- 'owner' | 'admin' | 'member'
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (org_id, user_id),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  console.log('✅ SpiderDB control-plane database ready (Turso)');
}

module.exports = { db, initDB };
