const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { OAuth2Client } = require('google-auth-library');
const { db } = require('../db');
const { protect } = require('../middleware/auth');
const { sendVerification, sendPasswordReset } = require('../utils/email');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'org';
}

// Every account gets a personal organization on creation — later phases
// (billing, database ownership, team invites) all hang off an org, not a
// bare user, so this needs to exist from the moment the account is created.
async function createPersonalOrg(userId, baseName) {
  const orgId = uuidv4();
  let slug = slugify(baseName);
  const existing = await db.execute({ sql: 'SELECT id FROM organizations WHERE slug = ?', args: [slug] });
  if (existing.rows.length > 0) slug = `${slug}-${orgId.slice(0, 6)}`;

  await db.execute({
    sql: 'INSERT INTO organizations (id, name, slug, owner_id) VALUES (?, ?, ?, ?)',
    args: [orgId, `${baseName}'s Org`, slug, userId]
  });
  await db.execute({
    sql: "INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')",
    args: [orgId, userId]
  });
  return orgId;
}

// Shared by the typed-code flow and the clickable-link flow so the two paths
// can't drift out of sync with each other.
async function completeVerification(user) {
  await db.execute({
    sql: `UPDATE users SET is_verified = 1, otp_code = NULL, otp_expires = NULL,
          verify_token = NULL, verify_token_expires = NULL WHERE id = ?`,
    args: [user.id]
  });
  return generateToken(user.id);
}

// ── POST /api/auth/register ──────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ message: 'email, username, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ? OR username = ?',
      args: [email.toLowerCase(), username]
    });
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Email or username already taken' });
    }

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const verifyToken = crypto.randomBytes(32).toString('hex');

    await db.execute({
      sql: `INSERT INTO users (id, email, username, password, otp_code, otp_expires, verify_token, verify_token_expires)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, email.toLowerCase(), username, hashedPassword, otp, expiresAt, verifyToken, expiresAt]
    });
    await createPersonalOrg(id, username);

    const verifyLink = `${process.env.APP_URL || ''}/api/auth/verify-link?token=${verifyToken}`;
    try {
      await sendVerification(email, username, otp, verifyLink);
    } catch (emailErr) {
      // The account row and org already exist at this point — don't leave the
      // person with no way forward if SMTP hiccups. They can hit /resend-verification.
      console.error('Failed to send verification email:', emailErr.message);
      return res.status(201).json({
        message: 'Account created, but the verification email failed to send. Use "Resend verification" on the login page.',
        userId: id
      });
    }

    res.status(201).json({ message: 'Check your email for a verification link (or code).', userId: id });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /api/auth/resend-verification ───────────────────────────────────
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [(email || '').toLowerCase()] });
    if (result.rows.length === 0) return res.status(404).json({ message: 'No account with that email' });

    const user = result.rows[0];
    if (user.is_verified) return res.status(400).json({ message: 'Account is already verified' });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const verifyToken = crypto.randomBytes(32).toString('hex');

    await db.execute({
      sql: 'UPDATE users SET otp_code = ?, otp_expires = ?, verify_token = ?, verify_token_expires = ? WHERE id = ?',
      args: [otp, expiresAt, verifyToken, expiresAt, user.id]
    });

    const verifyLink = `${process.env.APP_URL || ''}/api/auth/verify-link?token=${verifyToken}`;
    await sendVerification(user.email, user.username, otp, verifyLink);
    res.json({ message: 'Verification email resent' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /api/auth/verify (typed code) ───────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] });
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = result.rows[0];
    if (user.is_verified) return res.status(400).json({ message: 'Already verified' });
    if (!user.otp_code || user.otp_code !== otp || new Date() > new Date(user.otp_expires)) {
      return res.status(400).json({ message: 'Invalid or expired code' });
    }

    const token = await completeVerification(user);
    res.json({ message: 'Account verified!', token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /api/auth/verify-link (clicked from email) ───────────────────────
router.get('/verify-link', async (req, res) => {
  const frontend = process.env.FRONTEND_URL || '/';
  try {
    const { token: linkToken } = req.query;
    if (!linkToken) return res.redirect(`${frontend}/?verified=0&reason=missing_token`);

    const result = await db.execute({ sql: 'SELECT * FROM users WHERE verify_token = ?', args: [linkToken] });
    if (result.rows.length === 0) return res.redirect(`${frontend}/?verified=0&reason=invalid`);

    const user = result.rows[0];
    if (user.is_verified) return res.redirect(`${frontend}/?verified=already`);
    if (!user.verify_token_expires || new Date() > new Date(user.verify_token_expires)) {
      return res.redirect(`${frontend}/?verified=0&reason=expired`);
    }

    await completeVerification(user);
    res.redirect(`${frontend}/?verified=1`);
  } catch (err) {
    res.redirect(`${frontend}/?verified=0&reason=server_error`);
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'email and password are required' });

    const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email.toLowerCase()] });
    if (result.rows.length === 0) return res.status(401).json({ message: 'Invalid email or password' });

    const user = result.rows[0];
    if (!user.password) {
      return res.status(401).json({ message: 'This account uses Google or GitHub sign-in — try that instead' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid email or password' });

    if (!user.is_verified) return res.status(403).json({ message: 'Please verify your email before logging in', userId: user.id });
    if (user.account_status === 'banned') return res.status(403).json({ message: 'This account has been banned' });
    if (user.account_status === 'suspended') return res.status(403).json({ message: 'This account is suspended' });

    await db.execute({ sql: "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", args: [user.id] });

    const token = generateToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, avatar: user.avatar, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [(email || '').toLowerCase()] });

    // Always return success even if the email doesn't exist — don't leak
    // which addresses have accounts.
    if (result.rows.length === 0) return res.json({ message: 'If that email has an account, a reset link has been sent.' });

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await db.execute({
      sql: 'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      args: [resetToken, expiresAt, user.id]
    });

    const resetLink = `${process.env.FRONTEND_URL || ''}/reset-password.html?token=${resetToken}`;
    await sendPasswordReset(user.email, user.username, resetLink);
    res.json({ message: 'If that email has an account, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ message: 'token and newPassword are required' });
    if (newPassword.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

    const result = await db.execute({ sql: 'SELECT * FROM users WHERE reset_token = ?', args: [token] });
    if (result.rows.length === 0) return res.status(400).json({ message: 'Invalid or expired reset link' });

    const user = result.rows[0];
    if (!user.reset_token_expires || new Date() > new Date(user.reset_token_expires)) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.execute({
      sql: 'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      args: [hashedPassword, user.id]
    });
    res.json({ message: 'Password updated — you can now log in.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /api/auth/google ────────────────────────────────────────────────
// Frontend uses Google Identity Services to get an ID token, then posts it
// here for verification — no OAuth redirect dance needed for Google.
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'credential is required' });

    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let result = await db.execute({ sql: 'SELECT * FROM users WHERE google_id = ? OR email = ?', args: [googleId, email.toLowerCase()] });
    let user;

    if (result.rows.length === 0) {
      const id = uuidv4();
      const username = slugify(name || email.split('@')[0]) + '-' + id.slice(0, 4);
      await db.execute({
        sql: `INSERT INTO users (id, email, username, google_id, avatar, is_verified) VALUES (?, ?, ?, ?, ?, 1)`,
        args: [id, email.toLowerCase(), username, googleId, picture || '']
      });
      await createPersonalOrg(id, username);
      user = { id, email: email.toLowerCase(), username, role: 'member' };
    } else {
      user = result.rows[0];
      if (!user.google_id) {
        await db.execute({ sql: 'UPDATE users SET google_id = ? WHERE id = ?', args: [googleId, user.id] });
      }
    }

    await db.execute({ sql: "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", args: [user.id] });
    const token = generateToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (err) {
    res.status(401).json({ message: 'Google authentication failed' });
  }
});

// ── GET /api/auth/github/url ─────────────────────────────────────────────
// Returns the GitHub authorize URL — keeps GITHUB_CLIENT_ID out of frontend
// source, constructed server-side instead. The redirect_uri MUST be a
// frontend page (it needs to run JS to read ?code= and POST it to the API
// below) — never point this at APP_URL/the API itself.
router.get('/github/url', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) return res.status(503).json({ message: 'GitHub sign-in is not configured' });
  const redirectUri = `${process.env.FRONTEND_URL || ''}/github-callback.html`;
  const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user user:email`;
  res.json({ url });
});

// ── POST /api/auth/github/callback ───────────────────────────────────────
// Frontend receives the `code` GitHub redirected back with, then posts it
// here to complete the exchange server-side (keeps GITHUB_CLIENT_SECRET out
// of the browser entirely).
router.post('/github/callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'code is required' });

    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      })
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return res.status(401).json({ message: 'GitHub authentication failed' });

    const [profileResp, emailsResp] = await Promise.all([
      fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokenData.access_token}` } }),
      fetch('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${tokenData.access_token}` } })
    ]);
    const profile = await profileResp.json();
    const emails = await emailsResp.json();
    const primaryEmail = (Array.isArray(emails) ? emails.find(e => e.primary) || emails[0] : null)?.email;
    if (!primaryEmail) return res.status(400).json({ message: 'Could not read an email from your GitHub account. Make sure you have a public or verified email set.' });

    const githubId = String(profile.id);
    let result = await db.execute({ sql: 'SELECT * FROM users WHERE github_id = ? OR email = ?', args: [githubId, primaryEmail.toLowerCase()] });
    let user;

    if (result.rows.length === 0) {
      const id = uuidv4();
      const username = slugify(profile.login) + '-' + id.slice(0, 4);
      await db.execute({
        sql: `INSERT INTO users (id, email, username, github_id, avatar, is_verified) VALUES (?, ?, ?, ?, ?, 1)`,
        args: [id, primaryEmail.toLowerCase(), username, githubId, profile.avatar_url || '']
      });
      await createPersonalOrg(id, username);
      user = { id, email: primaryEmail.toLowerCase(), username, role: 'member' };
    } else {
      user = result.rows[0];
      if (!user.github_id) {
        await db.execute({ sql: 'UPDATE users SET github_id = ? WHERE id = ?', args: [githubId, user.id] });
      }
    }

    await db.execute({ sql: "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", args: [user.id] });
    const token = generateToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'GitHub authentication failed' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
