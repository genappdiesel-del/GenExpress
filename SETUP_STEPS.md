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

## STEP 2 — Run the four database migrations

These create your tables and, most importantly, your security rules.

**Do this one file at a time, in numeric order.**

1. In the left menu click **SQL Editor**.
2. Click **New query**.
3. Open `supabase/migrations/001_profiles.sql` from this project on your
   computer. Copy the whole file. Paste it into the editor. Click **Run**.
4. Repeat for:
   - `002_rls_profiles.sql`
   - `003_grants_and_audit.sql`
   - `004_private_functions.sql`

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

**You want to see seven messages starting with `PASS` and none with `FAIL`.**

| If you see | What it means |
|---|---|
| `PASS - Client isolation` | A Client can see only their own data. Correct. |
| `PASS - Supplier isolation` | A Supplier cannot see another Supplier's business. Correct. |
| `PASS - Privilege escalation blocked` | A Client cannot make themselves an owner. Correct. |
| `PASS - Signed-out access` | Someone not logged in sees nothing. Correct. |
| `PASS - Agent isolation` | An Agent sees only their own data. Correct. |
| `PASS - Super Admin reach` | You, as the owner, can still see everything. Correct. |
| `PASS - Deactivation cuts access` | Switching someone off really stops their access. Correct. |

> **If any test says `FAIL`, do not put the website online.** It means
> data would leak between businesses. Send the message to your developer.

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

## STEP 8 — Create the other roles and check they are separate

Still logged in as Super Admin. The "create user" screens arrive in
Phase 2, so for now use the server function to make a test account. Or
simply wait — this check is listed here so you know how it will be done.

The real check happens in Phase 2. It is: log in as each of the four
roles and confirm each one sees a different home screen and cannot reach
the others' data.

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
- [ ] Four migrations run, each said "Success"
- [ ] Security tests run, seven `PASS`, zero `FAIL`
- [ ] First Super Admin created
- [ ] Two Edge Functions deployed
- [ ] `.env` file created with your two keys
- [ ] `npm run dev` works and you can log in
- [ ] Pushed to a public GitHub repo with three secrets set

---

## Common problems

| The problem | What it means | What to do |
|---|---|---|
| "permission denied for table profiles" | The table exists but has not been given access yet | Run `003_grants_and_audit.sql` |
| "new row violates row-level security policy" | The security rules refused the action | Usually means someone tried something they should not be allowed to. Check which test failed |
| Screen is blank and the console says keys are missing | `.env` file is missing or empty | Copy `.env.example` to `.env`, fill it in, then restart `npm run dev` |
| Login says wrong username or password | The account was not created, or the password was changed at first login | Try the new password you set after the first login |
| Website suddenly stops working after a week | The free database paused | Open the Supabase dashboard to wake it, then fix the keep-alive secrets (Step 9) |