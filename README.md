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

## Current status: Phase 2 complete

> ⚠ **The Phase 2 database code has never been run.** It is written and
> reviewed, but no local PostgreSQL server would start in our environment.
> Before real users: run the tests in Step 3 of `SETUP_STEPS.md` and
> confirm **twenty-three `PASS` and zero `FAIL`.** See `DECISIONS.md` §6.1.

Working now:

**Foundation (Phase 1)**

- Log in with a username and password
- Four separate areas, one per role, each with its own navigation
- New accounts are forced to set their own password at first login
- Account creation only through one controlled server function
- Security enforced **in the database**, not just hidden in the screens
- Bahasa Indonesia and English, switchable
- Works on a 360px phone
- Installable to a phone home screen

**Products and prices (Phase 2)**

- Product list with **two prices side by side** — what an Agent pays, what a
  Client pays — and the margin in both money and percent, recalculated as
  you type
- Warns (does not block) when the Client price is at or below the Agent
  price, because that means you lose money on the line
- Barcode by typing or by scanning with the phone camera; a barcode that is
  already used by the same Supplier is refused with a clear message
- Barcode label printing, laid out for a sheet of labels
- Product photos, shrunk on the phone before upload and stored privately
- Stock quantities with a running history — stock can only be changed
  through one recorded door, and the history cannot be edited afterwards
- Import products from a spreadsheet (CSV), one wrong row at a time, with a
  downloadable template
- A Supplier screen for the nine switches they control per Client (see
  prices, see stock, see order history, and so on)
- An account screen where a Super Admin creates and switches off accounts,
  and a Supplier does the same for their own team

**Twenty-three automated security tests** now cover the price protection,
the stock rules and the account screens, not just the four roles.

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

Then apply the **thirteen** SQL files in `supabase/migrations/` in numeric
order using the Supabase dashboard's SQL Editor, create your first Super
Admin with `supabase/seed/first_super_admin.sql`, and deploy the two
functions in `supabase/functions/`.

Then run `supabase/tests/rls_tests.sql` in the SQL Editor. It should print
**23 `PASS` and no `FAIL`**, and it cleans up after itself.

> **Never edit a migration that has already run.** Add a new numbered file
> instead. Supabase remembers which migrations have been applied, and
> changing an old one means the database and the repository disagree with
> no way to tell which is right.

`supabase/verify/00_stub_supabase.sql` fakes the parts of Supabase that
live outside the database (`auth`, `storage`) so the migrations can be
run against a plain PostgreSQL server. It is a development aid only.

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
│   │   ├── 001_profiles.sql           Tables, types, helper functions
│   │   ├── 002_rls_profiles.sql       Security rules
│   │   ├── 003_grants_and_audit.sql   Table access + audit log
│   │   ├── 004_private_functions.sql  Sensitive operations (private schema)
│   │   ├── 005_supplier_settings.sql  One settings row per Supplier
│   │   ├── 006_products.sql           Products and the two prices
│   │   ├── 007_client_feature_settings.sql  The nine per-Client switches
│   │   ├── 008_product_views.sql      The two safe views — the core of Phase 2
│   │   ├── 009_stock_movements.sql    Append-only stock history
│   │   ├── 010_product_photo_storage.sql  Private photo bucket
│   │   ├── 011_audit_triggers.sql     Automatic logging of price changes
│   │   ├── 012_account_views.sql      Account list view (Super Admin only)
│   │   └── 013_public_wrappers.sql    Thin public wrappers for private actions
│   ├── seed/
│   │   └── first_super_admin.sql     One-time owner account
│   ├── functions/
│   │   ├── create-user/              Account creation (holds the secret key)
│   │   └── complete-password-change/ Clears the password-change flag
│   ├── tests/
│   │   └── rls_tests.sql             23 checks proving the rules hold
│   └── verify/
│       └── 00_stub_supabase.sql      Fakes auth/storage for local runs
│
└── src/
    ├── App.tsx             Routing, role dispatch, allowed routes
    ├── main.tsx            Entry point
    ├── index.css           Design tokens and shared styles
    ├── components/
    │   ├── ui.tsx          Shared buttons, cards, navigation, list states
    │   ├── accounts/
    │   │   └── CreateUserForm.tsx   Role-aware account creation
    │   └── supplier/
    │       ├── BarcodeScanner.tsx    Camera scanning (lazy-loaded)
    │       ├── BarcodeLabels.tsx     Label sheet layout + printing
    │       ├── ProductForm.tsx       Add / edit one product
    │       ├── CsvImport.tsx         Spreadsheet import
    │       └── StockAdjust.tsx       The only stock-changing screen
    ├── hooks/
    │   ├── useAuth.ts      Who is logged in, and what they may do
    │   └── useLanguage.ts  Language switching
    ├── i18n/
    │   └── index.ts        Bahasa Indonesia + English
    ├── lib/
    │   ├── supabase.ts     The single database connection
    │   ├── errors.ts       Turns database errors into plain sentences
    │   ├── money.ts        The only place money is ever formatted
    │   ├── products.ts     Every product query, plus margin and readiness
    │   ├── accounts.ts     Create, list and deactivate accounts
    │   ├── permissions.ts  The nine per-Client switches
    │   ├── csv.ts          Spreadsheet parsing and the template
    │   └── image.ts        Photo shrinking, before upload
    ├── pages/
    │   ├── LoginPage.tsx
    │   └── ChangePasswordPage.tsx
    ├── portals/
    │   ├── superadmin/     SuperAdminHome, SuperAdminAccountsPage
    │   ├── supplier/       SupplierHome, SupplierProductsPage,
    │   │                    SupplierClientPermissions
    │   ├── client/         ClientHome, ClientCatalogPage
    │   └── agent/          AgentHome, AgentProductsPage
    └── types/
        └── database.ts     What the tables look like in TypeScript
```

> **A table type must be a `type`, never an `interface`.** Supabase's own
> generic types require an index signature, and only `type` aliases get
> one implicitly. An `interface` will compile until the moment it is
> passed to a Supabase query, then fail.

> **Barcode format names are runtime lookups.** A misspelled barcode format
> in `BarcodeScanner.tsx` compiles fine and fails only when a phone tries
> to scan. This is the one place TypeScript cannot help us.

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
deactivated person's existing login stops returning any data. And nobody
can switch off their *own* account, because one tap by the last Super
Admin would otherwise lock the whole platform out with no way back in.

**A hidden price is not a secure price.** Each product has an Agent price
and a Client price. The difference is the Supplier's profit, so Clients and
Agents must never see the wrong one. Leaving a column out of a screen does
nothing — the browser already received it.

So `products` has **no read rule for Clients or Agents at all**. That
absence is deliberate. They read views instead, and those views were
written without the sensitive columns:

| Who | Reads | Cannot ever see |
|---|---|---|
| Client | `client_products_view` | `agent_price`, `sku`, `supplier_id` |
| Agent | `agent_products_view` | `client_price`, any other Supplier's rows |

There is no column to reveal, because the column was never written into the
view. Asking for it tomorrow returns an error, not a number.

**A permission switch blanks the value, it does not fake one.** When a
Supplier turns a permission off, the view returns `NULL`. The screen then
says "not shown — ask your supplier". Returning `0` would be worse: a
Client would read zero as free, or as out of stock.

**Stock only moves through one door.** Nobody can type a new stock number
through the database directly. `adjust_stock()` writes the new quantity and
the history row in the same transaction, so the two can never disagree —
and the history is append-only, so it can never be quietly rewritten after
the fact.

---

## Testing

The security tests matter more than anything else here, because this app
holds other people's business data.

Run `supabase/tests/rls_tests.sql` in the Supabase SQL Editor after any
change to the database. It creates its own throwaway test data, checks 23
separate rules, prints `PASS` or `FAIL` for each, and deletes everything it
made. Safe to run as often as you like.

**23 `PASS` and no `FAIL` before you put this in front of real users.**

> There are **21 numbered checks but 23 `PASS` messages**, because two of
> the stock checks each report two separate findings. That is deliberate —
> merging them would hide one failure behind the other.

In the browser:

```bash
npx tsc -b --noEmit   # type check
npx oxlint            # lint
npm run build         # production build
```

## Bundle size

The login screen downloads about **123 KB compressed**, then nothing else.
The barcode scanner is a separate **125 KB** file that is only fetched when
somebody actually opens the scanner.

That separation is not decoration. A `manualChunks` rule in `vite.config.ts`
was silently forcing the scanner into the file every visitor downloads
*before they can type a password* — 529 KB instead of 64 KB. **A manual
chunk rule will quietly undo every lazy import you write.** See
`DECISIONS.md` §5A.6.

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
| 2 | Products, two prices with live margin, barcode scanning and label printing, stock tracking, CSV import, per-Client permission switches, account screens | **Done — not yet run against a live database** |
| 3 | Multi-level cash tracking, goods receiving, client orders, payments, reports | Next |
| 4 | Design polish, offline handling, deployment | Planned |

Screens for a later phase say plainly when a feature is not here yet,
rather than showing a placeholder number that could be mistaken for real
data.

---

## Decisions and assumptions

Every choice, every assumption, every trade-off, and every bug we found in
our own work is written down in **[DECISIONS.md](DECISIONS.md)**. Read it if
you want to know why something was built a particular way.

**§6.1 is the one to read first** — it explains exactly how much of this
has been proven by running it, and what you must check yourself.

Four open questions for you sit at the end of that file. None are blocking,
and none require rewriting the database.

## Free libraries used

Everything below is MIT-licensed or public domain. No paid service, no
trial, no credit card.

| Library | Used for | Loaded when |
|---|---|---|
| `@zxing/browser` + `@zxing/library` | Reading a barcode with the camera | Only when the scanner opens |
| `jsbarcode` | Drawing a barcode onto a printable label | With the label screen |
| React 19, Vite 8, Tailwind 4 | The app itself | Always |
| `@supabase/supabase-js` | Talking to the database and handling logins | Always |