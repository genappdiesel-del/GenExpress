# GenApp — Project State

## What this is
Free multi-level supply-chain transaction tracker. Four roles: Super Admin,
Supplier, Client, Agent. Built from the client's master prompt
(`E:\AI Builder Prompt\GenApp\Prompt.docx`); plain-text copy at
`C:\Users\opstm\AppData\Local\Temp\opencode\prompt.txt`.

Full spec decisions live in the repo's own `DECISIONS.md`.

## Status: Phase 2 COMPLETE (committed `f758014`), Phase 1 in `01a7a40`

Branch `master`, **no remote configured, nothing pushed**.

### ⚠ The single most important fact
**None of the Phase 2 SQL has ever been executed.** A local PostgreSQL 18
server would not start in this environment (every backend dies
`0xC0000142 STATUS_DLL_INIT_FAILED` — environment fault, not SQL fault).
Migrations 004 (edited), 005–013 and the whole 21-check test suite are
**unverified by execution**.

Client must run `SETUP_STEPS.md` Steps 1–9 and confirm **23 `PASS` /
0 `FAIL`** before any real user. This is a real gate, not a formality.
Recorded in `DECISIONS.md` §6.1 and at the top of `README.md`.

### Stack (unchanged from Phase 1)
Vite 8 + React 19 + TypeScript 6 + Tailwind 4 (`@tailwindcss/vite`, pinned
4.3.3+ — 4.1.13 is incompatible with Vite 8) + Supabase Postgres/Auth, hosted
on Cloudflare Pages. Hash routing hand-rolled (~20 lines), no router library.

### Database — 13 migrations, apply in numeric order
1. `001_profiles.sql` — extensions, `user_role`, `profiles`,
   SECURITY DEFINER helpers (`current_role`, `current_supplier_id`,
   `is_super_admin`, `current_is_active`)
2. `002_rls_profiles.sql` — RLS; column-level UPDATE grant limited to
   `full_name, phone, address` (blocks self-promotion); no INSERT/DELETE
3. `003_grants_and_audit.sql` — explicit GRANTs per table + `audit_logs`
4. `004_private_functions.sql` — `private` schema, unreachable from browser:
   `complete_password_change`, `set_user_active`, `request_password_reset`.
   **Now also carries the self-deactivation guard.**
5. `005_supplier_settings.sql` — one settings row per Supplier
6. `006_products.sql` — products, `agent_price` + `client_price`
7. `007_client_feature_settings.sql` — the nine per-Client switches as real
   boolean columns
8. `008_product_views.sql` — **the security core.** `client_products_view`,
   `agent_products_view`, `assert_no_sensitive_view_columns()`
9. `009_stock_movements.sql` — append-only history + `public.adjust_stock()`
10. `010_product_photo_storage.sql` — private `product-photos` bucket
11. `011_audit_triggers.sql` — automatic logging of price/permission changes
12. `012_account_views.sql` — `account_list_view` + safety tripwire
13. `013_public_wrappers.sql` — public SECURITY INVOKER wrappers +
    `assert_private_functions_stay_private()` tripwire

`supabase/verify/00_stub_supabase.sql` fakes `auth`/`storage` for local runs
(written, never successfully run).

### Tests
`supabase/tests/rls_tests.sql` — **21 numbered checks printing 23 `PASS`
messages** (two stock checks print two each; deliberate, so one failure can't
hide behind another). Self-contained: creates its own `auth.users` fixtures,
cleans up after itself. Target **23 `PASS` / 0 `FAIL`**.

### Frontend layout
- `src/lib/` — `supabase.ts`, `errors.ts`, `money.ts` (single home for money
  formatting; `i18n` re-exports it), `products.ts`, `accounts.ts`,
  `permissions.ts`, `csv.ts` (hand-written parser), `image.ts` (canvas
  compress to 1280px / ~200KB JPEG)
- `src/components/supplier/` — `BarcodeScanner`, `BarcodeLabels`,
  `ProductForm`, `CsvImport`, `StockAdjust`
- `src/components/accounts/CreateUserForm.tsx`
- `src/portals/{superadmin,supplier,client,agent}/` — home + Phase 2 pages
- `src/App.tsx` — `ALLOWED_ROUTES` per role, `navForRole`, `Screen` switch,
  `currencyFor()` (currently hardcoded `'IDR'` — see open gap below)

## Load-bearing decisions — do not "tidy" these away

- **`products` has NO client/agent RLS policy, by design.** The absence is
  the security. Clients/Agents read `client_products_view` /
  `agent_products_view` instead. `grant select to authenticated` is still
  required on `products`.
- **Views are SECURITY DEFINER (owner), explicit column lists, never
  `select *`.** Do **not** add `security_invoker = on` — it would return
  nothing.
- **Permission switches return `null`, never a fake `0`.** Via `CASE WHEN` on
  the Client feature flags.
- **Migration 007 default split is deliberate:** `can_view_stock`,
  `can_view_readiness`, `can_view_prices`, `can_place_orders` default **true**
  (a Client with all four off sees an empty screen); the five
  business-information switches default **false**. `ALL_OFF` in
  `permissions.ts` is the fallback for a *missing* row — stricter on purpose.
- **`private.set_user_active` self-deactivation guard** — checked on *who* is
  being changed, not *whether* anything changes, so a colleague-switched-off
  admin can still re-enable themselves.
- **`public.set_user_active(uuid, boolean)` takes the caller from
  `auth.uid()`, never an argument.** Thin `security invoker` wrappers only —
  no duplicate permission checks.
- **`vite.config.ts` `manualChunks` splits `@zxing` into `'barcode-scanner'`
  BEFORE the `node_modules` catch-all.** The old catch-all assigned every
  module to `vendor`, which defeated the dynamic `import()` and shipped
  477 KB of scanner to every visitor before login. Main bundle 529 KB → 64 KB.
  Scanner is a separate 125 KB gzip file, fetched only when opened.
- **TS `interface` breaks supabase-js typing.** `GenericTable` needs
  `Record<string, unknown>`; only `type` aliases get implicit index
  signatures. Every table type is a `type`, never an `interface`.
- **Barcode + SKU uniqueness is per-Supplier**, not global — barcodes are
  manufacturer codes.
- **Warn, never block**, when `client_price <= agent_price`. Duplicate
  barcodes **are** blocked with a clear message.
- **`AlertDialog`/`onRefresh`/etc:** lists use the **keyed-remount pattern** —
  parent owns `search`/`page`/`refreshToken`, child is keyed on them and owns
  `loading`/`error`/data. Fixes a real page race and oxlint's
  `react(set-state-in-effect)`. Retry uses an internal `retryToken`, never
  `window.location.reload()`.
- **`ProductForm` resets via `key`** + `initialState(product)` as a
  `useState` initialiser — no effect, no stale-product window.
- **`ProductForm` calls `marginOf()`**, it does not recalculate. Two copies
  of the same arithmetic is two bugs waiting.
- **`deletePhoto` uses a static import** — `await import('./supabase')` split
  nothing (supabase is statically imported nearly everywhere) and only caused
  an `INEFFECTIVE_DYNAMIC_IMPORT` warning.

## Bugs we found in our own work (all fixed, documented)
1. `002` — SELECT policy compared `supplier_id` in the wrong direction. Would
   have *hidden* the client→supplier row rather than leaking it.
2. `002` — `is_active` never checked in any policy, so deactivating someone
   did not revoke access.
3. `005`/`007` — "may this row change?" compared the column to itself instead
   of to the signed-in session, so **every Supplier settings save was refused**.
4. `vite.config.ts` — the `manualChunks` catch-all defeated code splitting.
5. `rls_tests.sql` — five tests looked the Super Admin up as `'super_admin'`
   but the fixture stores `'super'`. They asserted on `NULL` and still
   printed `PASS`. Worst kind of test bug: passes for the wrong reason.
6. `SETUP_STEPS.md` said 21 `PASS`; the file prints 23. A non-technical
   person counting messages would have assumed two had failed.
7. `ProductForm` duplicated the margin arithmetic from `marginOf()`.

## Time-sensitive external change
Supabase stops exposing new public-schema tables to the Data/GraphQL API by
default. **Enforced for all projects 2026-10-30.** Every table *and view*
needs an explicit GRANT or it returns "permission denied" despite correct
RLS. Re-check `https://supabase.com/changelog.md` every phase (last checked
2026-10-06 — nothing newer affects us; the free-plan DB limit is now per
active project, and supabase-js needs TS 5.0+ from 2027-01-31).

## Skills policy (standing user instruction)
"Every time you have issue or problem I am solving or dealing with anything in
this app later, always get and install skills from https://www.skills.sh/
first to help you."

127 web-dev skills in `.agents/skills/` (gitignored — reproducible from
`skills-lock.json`). Install pattern:
```
npx skills add <owner/repo> --agent opencode -y --copy
```
List first: `npx skills add <owner/repo> -l`. Single: `--skill <name>`.
162 non-web skills moved to `D:\OpenCode\GenApp-unused-skills\`.

Gotchas: `vercel-labs/next-skills` is an empty pointer repo (use `vercel/next.js`);
`npx skills ls -g` times out at 120s; uninstall is unclean so always use `--copy`.

## Open items needing the user
1. **Currency** — assumed IDR (`Rp`, no decimals). MYR/SGD/USD ready behind one
   flag. **Known gap:** a Client and an Agent cannot read `supplier_settings`,
   so their screens hardcode `'IDR'` via `currencyFor()` in `App.tsx`. A price
   with the wrong symbol is a money bug, not a formatting one — the proper fix
   is a DB view exposing only the currency for the caller's own Supplier.
2. **How many supply-chain levels?** Designed for 4 (Supplier → Agent →
   sub-agent → sub-sub-agent). Only 2 needed?
3. **Password policy** — 8 chars minimum assumed.
4. **Per-Client switches** — decided for now: nine switches, four on by
   default, five off (`DECISIONS.md` §5A.3). Cheap to change if the client
   disagrees.
5. **i18n coverage is partial** — Phase 2 screens use a local two-language
   helper (`t(id, en)`) instead of the central `i18n/index.ts` dictionary.
   Deliberate so a half-finished feature cannot break the build. Worth closing
   before anyone outside the team touches those screens.

## Next phase
Phase 3: multi-level cash tracking, goods receiving, Client orders,
payments, reports. Orders and payments will need the same treatment Phase 2
gave prices — money amounts in `numeric(14,2)`, quantities in `numeric(14,3)`,
and permissions enforced by views, not screens.

Also still outstanding: a generated-DB-types pass
(`npx supabase gen types typescript --project-id ...`) to replace the
hand-written `src/types/database.ts`.

## Environment
Node v26.6.0, npm 11.18.0, git 2.55.0, win32. Repo `D:\OpenCode\GenApp`,
branch `master`. PostgreSQL 18 installed but **cannot be started here** —
do not burn time on it again without a fix for `0xC0000142`.

Gotchas worth remembering:
- PowerShell `Get-Content` renders UTF-8 emoji/CJK as mojibake (console codepage
  artifact, not file corruption). Use the `read` tool.
- `Out-File` writes a BOM, which corrupts `postgresql.auto.conf`. Use
  `[System.IO.File]::WriteAllLines` with `UTF8Encoding $false`.
- `@zxing/browser` `decodeFromVideoDevice` takes 3 args; format hints go in
  the **constructor** as `Map<number, unknown>`. `DecodeHintType` is not
  re-exported by `@zxing/browser` — import from `@zxing/library`.
- Barcode format names in `BarcodeScanner.tsx` are runtime lookups, so a typo
  fails at runtime, not compile time. The one place TypeScript cannot help.

# Phase 2a: RLS verification green
- Verification harness: 28 PASS / 0 FAIL / 0 ERROR (all 16 migrations + 26 checks).
- Fixed: set_user_active and request_password_reset supplier check now compare against p_actor_id (Suppliers with NULL supplier_id no longer rejected for own-team actions).
- Fixed: account_list_view reader gate restated after CREATE OR REPLACE (gate does not survive view replacement). Tripwire checks definition contains gate functions.
- Cleanup hardened: deepest-first profile deletes, stock_movements guard and products_audit_lifecycle guard stood down during cascade (audit actor_id FK no longer violated).
- UI: AccountListRow.level added (type + Super Admin and Supplier lists).
- Commit: 44981c4
