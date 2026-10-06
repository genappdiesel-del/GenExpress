# Trade Tracker

A free web app for tracking money and goods moving through a supply chain
with several levels of middlemen.

**Four kinds of user, each seeing only their own part of the business:**

| Role | What they do |
|---|---|
| **Super Admin** | Owns the platform. Sees every supplier and the full audit log. |
| **Supplier** | Runs the business. Manages products, agents, stock and orders. |
| **Client** | Buys from a Supplier. Sees the catalogue, places orders, pays. |
| **Agent** | Works on the ground. Scans barcodes, requests goods, collects money. |

---

## Current status: Phase 1 complete

Phase 1 builds the foundation. Working now:

- Log in with a username and password
- Four separate areas, one per role, each with its own navigation
- New accounts are forced to set their own password at first login
- Account creation only through one controlled server function
- Security enforced **in the database**, not just hidden in the screens
- Seven automated tests that prove the security rules hold
- Bahasa Indonesia and English, switchable
- Works on a 360px phone
- Installable to a phone home screen

Not built yet — see the phase table at the bottom.

---

## Quick start

You do not need to read this to use the app. You need it only if you want
to run the code.

**For the person who has to set this up:** read **[SETUP_STEPS.md](SETUP_STEPS.md)**.
It is written for someone with no programming knowledge and walks through
everything, one click at a time.

**For a developer:**

```bash
npm install
```

Copy `.env.example` to `.env` and fill in:

```
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

```bash
npm run dev
```

Then apply the four SQL files in `supabase/migrations/` in order using
the Supabase dashboard's SQL Editor, create your first Super Admin with
`supabase/seed/first_super_admin.sql`, and deploy the two functions in
`supabase/functions/`.

---

## Project layout

```
GenApp/
├── DECISIONS.md            Every choice and why (read this second)
├── SETUP_STEPS.md          Step-by-step setup for a non-technical person
├── README.md               This file
├── .env.example            Where the Supabase keys go
├── .github/workflows/
│   └── keepalive.yml       Stops the free database pausing
│
├── supabase/
│   ├── migrations/         Database, in order. Never edit an old one.
│   │   ├── 001_profiles.sql          Tables, types, helper functions
│   │   ├── 002_rls_profiles.sql      Security rules
│   │   ├── 003_grants_and_audit.sql  Table access + audit log
│   │   └── 004_private_functions.sql Sensitive operations
│   ├── seed/
│   │   └── first_super_admin.sql     One-time owner account
│   ├── functions/
│   │   ├── create-user/              Account creation (holds the secret key)
│   │   └── complete-password-change/ Clears the password-change flag
│   └── tests/
│       └── rls_tests.sql             Proves the security rules hold
│
└── src/
    ├── App.tsx             Routing and role dispatch
    ├── main.tsx            Entry point
    ├── index.css           Design tokens and shared styles
    ├── components/
    │   └── ui.tsx          Shared buttons, cards, navigation, states
    ├── hooks/
    │   ├── useAuth.ts      Who is logged in, and what they may do
    │   └── useLanguage.ts  Language switching
    ├── i18n/
    │   └── index.ts        Bahasa Indonesia + English, and money formatting
    ├── lib/
    │   ├── supabase.ts     The single database connection
    │   └── errors.ts       Turns database errors into plain sentences
    ├── pages/
    │   ├── LoginPage.tsx
    │   └── ChangePasswordPage.tsx
    ├── portals/
    │   ├── superadmin/     Super Admin area
    │   ├── supplier/       Supplier area
    │   ├── client/         Client area
    │   └── agent/          Agent area
    └── types/
        └── database.ts     What the tables look like in TypeScript
```

---

## How security works here

This is the part worth understanding, so read it once.

**The database decides, not the screen.** Every table has rules about
who may see which rows. Hiding something on a screen does nothing —
someone can inspect the browser and see what is really being sent. Our
rules live in Postgres and cannot be bypassed from a browser.

**Two separate switches, and you need both.**

- **Table access** — "can this kind of user even ask about this table?"
- **Row rules (RLS)** — "of the rows in that table, which ones may they
  actually see?"

Turning on the second without the first still produces "permission
denied". Supabase changed their default so new tables now have the first
switch **off** — permanently from 30 October 2026. We grant it explicitly
for every table in `003_grants_and_audit.sql`.

**Nobody can make themselves an owner.** A user editing their own profile
may only change their full name, phone and address. `role` is not in that
list. Test 3 in `rls_tests.sql` proves it.

**Account creation has one door.** There is no insert rule on the profiles
table, so the browser cannot create an account even if the code is
tampered with. Everything goes through the `create-user` function, which
identifies the caller from their login token, reads their real role from
the database, and overrides any attempt to attach the new account to
somebody else's team.

**Nobody can quietly take a user away.** There is no delete rule at all.
Deactivate instead, so the history survives.

**Switching somebody off really switches them off.** Deactivation is
enforced in the database, not merely hidden in the screens, so a
deactivated person's existing login stops returning any data.

---

## Testing

The security tests matter more than anything else here, because this app
holds other people's business data.

Run `supabase/tests/rls_tests.sql` in the Supabase SQL Editor after any
change to the database. It prints `PASS` or `FAIL` for each rule.

**Seven `PASS` and no `FAIL` before you put this in front of real users.**

---

## Cost

Rp 0.

| Service | Free tier |
|---|---|
| Supabase | 500 MB database, 50,000 monthly active users, 5 GB egress |
| Cloudflare Pages | Unlimited static hosting, unlimited bandwidth |
| GitHub Actions | Free on public repositories |
| Supabase Auth | Unlimited logins on the free plan |

No credit card is required for any of them.

---

## Roadmap

| Phase | What it adds | Status |
|---|---|---|
| 1 | Logins, roles, security, languages, mobile layout | **Done** |
| 2 | Products, barcode scanning, Supplier → Agent transfers | Next |
| 3 | Multi-level cash tracking, goods receiving, client orders, payments, reports | Planned |
| 4 | Design polish, offline handling, test suite, deployment | Planned |

Phase 1 screens say plainly when a feature is not here yet, rather than
showing a placeholder number that could be mistaken for real data.

---

## Decisions and assumptions

Every choice, every assumption, and every trade-off is written down in
**[DECISIONS.md](DECISIONS.md)**. Read it if you want to know why
something was built a particular way — there are four open questions at
the end of it that may need your answer.