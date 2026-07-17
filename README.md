# SpiderDB Engine — Auth Phase

This is the backend control plane for SpiderDB. This phase covers **auth
only** — registration, login, email verification (link + code), password
reset, Google sign-in, and GitHub sign-in. No database provisioning, billing,
or dashboard endpoints exist yet — those are later phases.

## Setup

```bash
npm install
cp .env.example .env
# fill in .env — see notes below on each variable
npm start
```

## What you need before this runs

1. **A Turso database for the control plane itself.** Sign up at turso.tech,
   create a database, put its URL + auth token in `TURSO_DATABASE_URL` /
   `TURSO_AUTH_TOKEN`. This is separate from the *customer-facing* databases
   SpiderDB will provision in a later phase — this one just holds SpiderDB's
   own users/orgs tables.
2. **SMTP credentials** for sending verification and password-reset emails —
   same setup as SpiderHub used (Gmail app password, or Brevo, etc.).
3. **Google OAuth credentials** from Google Cloud Console, if you want Google
   sign-in live.
4. **GitHub OAuth App credentials** from GitHub → Settings → Developer
   settings → OAuth Apps. The **Authorization callback URL** on the GitHub
   app must be set to `{FRONTEND_URL}/github-callback.html` — a frontend
   page that reads the `?code=` GitHub redirects back with and posts it to
   `/api/auth/github/callback`. Built in the frontend auth phase.

## Endpoints in this phase

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/register` | Create an account, sends verification email |
| POST | `/api/auth/resend-verification` | Re-send verification if the first email failed/expired |
| POST | `/api/auth/verify` | Verify via typed 6-digit code |
| GET | `/api/auth/verify-link` | Verify via clicked email link, redirects back to frontend |
| POST | `/api/auth/login` | Email/password login |
| POST | `/api/auth/forgot-password` | Request a password reset email |
| POST | `/api/auth/reset-password` | Complete a password reset |
| POST | `/api/auth/google` | Google sign-in (frontend sends an ID token) |
| GET | `/api/auth/github/url` | Returns the GitHub OAuth authorize URL |
| POST | `/api/auth/github/callback` | Completes GitHub OAuth (frontend sends the `code`) |
| GET | `/api/auth/me` | Returns the logged-in user (requires `Authorization: Bearer <token>`) |

## Design notes

- **Every account gets a personal organization automatically** on creation
  (`createPersonalOrg` in `routes/auth.js`). Later phases — billing, database
  ownership, team invites — all attach to an org, not directly to a user, so
  this needs to exist from day one rather than being retrofitted later.
- **Registration doesn't get permanently stuck if email sending fails** — the
  account and org are created either way, and the response tells the client
  to offer "Resend verification" instead of leaving someone locked out with
  no way to get a working link (this was a real bug caught and fixed on
  SpiderHub — built correctly here from the start).
- **GitHub's client secret never reaches the browser** — the authorize URL is
  constructed server-side (`GET /github/url`) and the code-for-token exchange
  also happens server-side (`POST /github/callback`), matching how Google's
  flow already keeps its secret server-only.

## Next phase

Database provisioning: wiring `POST /api/databases` etc. to Turso's Platform
API, plus the registry table mapping SpiderDB database names to real Turso
databases + tokens.
