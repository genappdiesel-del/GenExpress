# SETUP_STEPS.md — What you need to do, in order

This is the short version. Follow it top to bottom.
Every step is something only you can do — everything that can be done by
code has already been done.

You need about **30 minutes** and a free Supabase account.

---

## What you need before you start

- [ ] A Supabase account (free) — <https://supabase.com>
- [ ] A Cloudflare account (free) — <https://dash.cloudflare.com>
- [ ] A GitHub account (free) — <https://github.com>
- [ ] Node.js installed on your computer — <https://nodejs.org>

None of these ask for a credit card.

---

## STEP 1 — Create the Supabase project

1. Go to <https://supabase.com> and sign in.
2. Click **New project**.
3. Fill in:
   - **Organization** — pick the free one offered, or create your own
   - **Project name** — anything, e.g. `trade-tracker`
   - **Database password** — **write this down and keep it safe.** You
     cannot see it again. It never appears in the website.
   - **Region** — pick the closest one to Indonesia, **Singapore** or
     **Jakarta** if offered. A closer region means faster page loads.
4. Click **Create new project**.
5. Wait about 2 minutes while it builds.

---

## STEP 2 — Run the thirteen database migrations

These create your tables and, most importantly, your security rules.

**Do this one file at a time, in numeric order.**

1. In the left menu click **SQL Editor**.
2. Click **New query**.
3. Open the matching file from `supabase/migrations/` on your computer.
   Copy the whole file. Paste it into the editor. Click **Run**.
4. Work down this list, in this order:

   | # | File | What it sets up |
   |---|---|---|
   | 1 | `001_profiles.sql` | The four kinds of account, and the first security rules |
   | 2 | `002_rls_profiles.sql` | The rules that stop one business seeing another |
   | 3 | `003_grants_and_audit.sql` | Who may read or write what, and the log |
   | 4 | `004_private_functions.sql` | The hidden actions: change password, switch an account off |
   | 5 | `005_supplier_settings.sql` | One row of settings per Supplier |
   | 6 | `006_products.sql` | The product list and its two prices |
   | 7 | `007_client_feature_settings.sql` | The nine switches a Supplier controls per Client |
   | 8 | `008_product_views.sql` | **The most important file.** Two safe views: one for Clients, one for Agents |
   | 9 | `009_stock_movements.sql` | The stock history, and the only way stock is allowed to move |
   | 10 | `010_product_photo_storage.sql` | A private picture folder, closed to the public |
   | 11 | `011_audit_triggers.sql` | The log records price and permission changes automatically |
   | 12 | `012_account_views.sql` | The account list, readable only by you |
   | 13 | `013_public_wrappers.sql` | Lets the app switch an account off, without opening the hidden door |

**You should see "Success. No rows returned" after each one.**

> **If you get an error:** stop and do not continue. Copy the error text
> and send it to your developer. Running later files after a failed one
> will leave your database half-built.

---

## STEP 3 — Run the security tests

This is the important part. It proves your data is actually private.

1. **SQL Editor** → **New query**.
2. Open `supabase/tests/rls_tests.sql` from this project. Copy the whole
   file. Paste. Click **Run**.
3. Look at the messages below the editor.

**You want to see twenty-three messages starting with `PASS` and none with
`FAIL`.**

> Twenty-three, not twenty-one. Two of the checks print two messages each
> because they prove two separate things. That is deliberate — merging
> them would hide one failure behind the other.

The file makes its own throwaway test data and deletes it again at the
end, so it is safe to run as often as you like. Nothing real is touched.

**The seven that prove nobody can see each other's business:**

| If you see | What it means |
|---|---|
| `PASS - Client isolation` | A Client can see only their own profile and Supplier. Correct. |
| `PASS - Supplier isolation` | A Supplier cannot see another Supplier's team. Correct. |
| `PASS - Privilege escalation blocked` | A Client cannot make themselves an owner. Correct. |
| `PASS - Signed-out access` | Someone not logged in sees nothing. Correct. |
| `PASS - Agent isolation` | An Agent sees only their own profile and Supplier. Correct. |
| `PASS - Super Admin reach` | You, as the owner, can still see everyone. Correct. |
| `PASS - Deactivation cuts access` | Switching someone off really stops their access. Correct. |

**The ten that protect your prices and your stock — where you lose money:**

| If you see | What it means |
|---|---|
| `PASS - Client blocked from products table` | A Client cannot open the real product table at all. |
| `PASS - Client view shape` | The Client's view has no hidden columns. Correct. |
| `PASS - Client catalogue isolation` | A Client sees only their own Supplier's products. |
| `PASS - Agent price protection` | An Agent cannot learn what a Client pays. |
| `PASS - Agent blocked from products table` | An Agent cannot open the real product table either. |
| `PASS - Permission switch works` | Switching a permission off removes the number from the data, not just the screen. |
| `PASS - Stock integrity` | Stock only moves through the recorded method. Correct. |
| `PASS - Agents cannot move stock` | An Agent cannot change stock. Correct. |
| `PASS - Stock log is append-only` | The stock history cannot be rewritten, not even by you. |
| `PASS - Backorder rule` | Stock cannot go below zero while backorder is off. |

**The six that protect accounts:**

| If you see | What it means |
|---|---|
| `PASS - Account list` | Only you can see the account list. A Supplier and a Client are refused. |
| `PASS - Account view safety` | The account list carries no settings and no permission switches. |
| `PASS - Account view join` | Each Client shows the correct Supplier's name. |
| `PASS - Private functions stay private` | The browser cannot call the hidden actions directly. |
| `PASS - Account deactivation` | A Supplier can switch off their own Client, and is refused for a rival's. |
| `PASS - Self-deactivation is refused` | Nobody can lock themselves — or everyone — out. |

> **If any test says `FAIL`, do not put the website online.** It means
> data would leak between businesses, or you could be locked out. Send
> the message to your developer.

---

## STEP 4 — Create your first Super Admin account

1. **SQL Editor** → **New query**.
2. Open `supabase/seed/first_super_admin.sql`. Find the two lines marked
   `CHANGE THESE`:

   ```sql
   v_username text := 'admin';
   v_password text := 'CHANGE_THIS_TO_A_STRONG_PASSWORD';
   ```

   Change `admin` to a username you will remember — at least 3
   characters, letters and numbers only.
   Change the password to something at least 8 characters long.

3. Copy the whole file, paste it in the editor, click **Run**.
4. You should see: `NOTICE: Super Admin "yourname" created.`

You will be asked to choose a new password the first time you log in.
That is on purpose — it means the password above was temporary.

---

## STEP 5 — Deploy the two server functions

These hold the sensitive key. They are why the website cannot create
accounts by itself.

For **each** of these two, in order:

- `supabase/functions/create-user`
- `supabase/functions/complete-password-change`

**Either way:**

**Option A — paste into the dashboard (easiest, no install):**
1. In the left menu click **Edge Functions**.
2. Click **Create a new function**.
3. Name it exactly `create-user`.
4. Click **Create function**. It opens an editor.
5. Delete everything in the editor. Open `index.ts` from the folder on
   your computer, copy the whole file, paste it in. Click **Deploy**.
6. Do the same for `complete-password-change`.

**Option B — from your computer's terminal:**
```
supabase functions deploy create-user --project-ref YOUR_PROJECT_REF
supabase functions deploy complete-password-change --project-ref YOUR_PROJECT_REF
```

> **Watch for two warnings.** Supabase will ask whether to verify your
> JWT. Answer **Yes** for both. It may also ask to set the service role
> key — that key is already available inside Edge Functions, so you do
> **not** need to paste it anywhere.

---

## STEP 6 — Put your Supabase keys in a file on your computer

1. In the Supabase dashboard, click the **gear icon** (Project Settings)
   at the bottom of the left menu.
2. Click **API**.
3. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - The **anon** or **publishable** key — a long string starting with
     `eyJ`

4. On your computer, copy the file `.env.example` and rename the copy to
   `.env` (note: the name has **no** extension).

5. Open `.env` in any text editor. Fill in:

   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci...
   ```

6. Save it.

> **These two keys are safe to have in a website.** They are meant to be
> visible — they only open the front door. Your actual data is protected
> by the security rules in Step 2. But **never** put the `service_role`
> key in this file or anywhere in the project. That one key would open
> everything.

---

## STEP 7 — Run it on your computer and test

In your computer's terminal, from the project folder:

```
npm install
npm run dev
```

Your browser will open `http://localhost:5173`.

**Test this:**

1. Log in with the username and password you chose in Step 4.
2. It asks you to set a new password. Set one and log in again.
3. You should see a screen headed **Super Admin** with your name on it.

**That is Phase 1 working.**

---

## STEP 8 — Create a Supplier, and check the four roles are separate

Still logged in as Super Admin.

1. Tap **Akun** (Accounts) in the menu.
2. Tap **＋ Akun baru** (New account).
3. Fill in:
   - **Nama lengkap** (Full name) — the person's real name
   - **Nama pengguna** (Username) — what they will type to sign in.
     Letters, numbers, dot or dash. At least 3 characters.
   - **Peran** (Role) — choose **Pemasok** (Supplier)
   - **Kata sandi sementara** (Temporary password) — at least 8 characters.
     A green bar means it is strong; red means it is short or simple.
4. Tap **Buat akun** (Create account).

**The person must change that password the first time they sign in.**
That is on purpose — it means the password you typed is only temporary
and never becomes their real one.

### Now check the other three roles

Make four accounts this way: one Supplier, one Client, one Agent. Then
sign in as each in turn and confirm:

| Role | What you should see | What you should NOT see |
|---|---|---|
| Super Admin | Every account, in one list | — |
| Supplier | Their own product list | Any other Supplier's products |
| Client | A read-only catalogue with prices | Their own cost prices, or any Agent's price |
| Agent | Products to scan, with the price they pay | What a Client pays |

> **The most important thing to check:** as a Client, the page source
> (Ctrl+U in a browser, or "View Source") must not contain the word
> `agent_price` anywhere. If it does, stop and send a message to your
> developer. That word appearing means the hidden price was sent to the
> browser, and hiding it with a small "hidden" label would not stop a
> determined person from seeing it.

Then, while signed in as the Client, tap **Client access** — nothing
should be there. If it is, send a message.

---

## STEP 9 — Keep the free database awake

Free Supabase projects pause after about 7 days with no activity. A
paused database stops answering and your website appears broken.

This is handled automatically once you push to GitHub.

1. Create a **public** GitHub repository and push this project to it.
2. In the repository click **Settings**.
3. Left menu → **Secrets and variables** → **Actions**.
4. Click **New repository secret** three times, adding:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_ANON_KEY` | your anon/publishable key |
   | `SUPABASE_KEEPALIVE_KEY` | any random text you invent, e.g. `keepalive-9f2a7b3c` |

> **The repository must be public.** GitHub's free allowance for
> scheduled Actions runs only on public repositories. Nothing secret is
> in the repository — your real keys live in GitHub Secrets, encrypted.

The workflow runs on the 1st and 16th of each month. You can also
trigger it by hand from the **Actions** tab.

---

## STEP 10 — Publish to the internet (Phase 4, not yet)

Not needed yet. Nothing is public until Phase 4. When we get there, we
will connect Cloudflare Pages, which is free and needs no card.

---

## Checklist — are you done?

- [ ] Supabase project created, password saved somewhere safe
- [ ] **Thirteen** migrations run, each said "Success"
- [ ] Security tests run, **twenty-three** `PASS`, zero `FAIL`
- [ ] First Super Admin created
- [ ] Two Edge Functions deployed
- [ ] `.env` file created with your two keys
- [ ] `npm run dev` works and you can log in
- [ ] A Supplier, a Client and an Agent account created from the **Akun** screen
- [ ] You signed in as each of the four roles and saw a different home screen
- [ ] As a Client, "View Source" does not contain the text `agent_price`
- [ ] Pushed to a public GitHub repo with three secrets set

---

## Common problems

| The problem | What it means | What to do |
|---|---|---|
| "permission denied for table profiles" | The table exists but has not been given access yet | Run `003_grants_and_audit.sql` |
| "permission denied for view client_products_view" | The view exists but has not been given access yet | Run `008_product_views.sql` |
| "permission denied for function set_user_active" | The wrapper is missing | Run `013_public_wrappers.sql` |
| "new row violates row-level security policy" | The security rules refused the action | Usually means someone tried something they should not be allowed to. Check which test failed |
| Screen is blank and the console says keys are missing | `.env` file is missing or empty | Copy `.env.example` to `.env`, fill it in, then restart `npm run dev` |
| "Code 42P01: relation auth.users does not exist" or the test file stops early with a missing column | Supabase changed the shape of its own `auth.users` table | Send the message to your developer — the test file needs one column added |
| Login says wrong username or password | The account was not created, or the password was changed at first login | Try the new password you set after the first login |
| "You cannot switch off your own account" | You tried to lock yourself out | That is the rule working. Ask another Super Admin to do it |
| Barcode scan does nothing on a phone | The camera needs permission, or the phone cannot use it in this browser | Use the box below the button and type the digits instead |
| Website suddenly stops working after a week | The free database paused | Open the Supabase dashboard to wake it, then fix the keep-alive secrets (Step 9) |