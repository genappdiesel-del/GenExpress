# DECISIONS.md — Every choice we made, and why

This file exists so you never have to ask "why is it built this way?"
It is written for a business owner, not a programmer. Short sentences,
no jargon without an explanation.

**Last updated:** Phase 1 complete.

---

## 1. The stack, confirmed

| Part | What we use | Cost | One-line reason |
|---|---|---|---|
| Language | TypeScript | Free | JavaScript with error checking built in, so mistakes are caught before you see them. |
| Screen library | React 19 | Free | The most widely used and best-supported. |
| Build tool | Vite 8 | Free | Starts instantly and makes a fast website even on a slow connection. |
| Styling | Tailwind CSS 4 | Free | Consistent design with far less code to maintain. |
| Database | Supabase Postgres | Free tier | A real database, free, with no credit card. |
| Security | Postgres Row Level Security | Free | The **database** decides who sees what, not the screen. |
| Logins | Supabase Auth | Free | Handles passwords so we do not have to. |
| Hosting | Cloudflare Pages | Free tier | Fast static hosting, free, no credit card. |
| Server-side code | Supabase Edge Functions | Free tier | Small pieces of server code for the sensitive jobs. |

**Total monthly cost: Rp 0.** No paid plan anywhere. No credit card anywhere.

---

## 2. The rules we held ourselves to

These came straight from your instructions and they shaped everything.

### "100% free, no credit card"
Every service above has a free tier that does not ask for a card.
We checked this, not assumed it.

### "Do not ask me questions"
So we made the decisions ourselves and wrote them here. Every one of
them can be changed later if you disagree.

### "Do not hard-delete a user who has transactions"
We did not write any delete rule for accounts at all.
Deactivate instead. The record stays, the person just cannot log in.

### "Every list must show loading, empty, error"
These three states are built into our shared components, not left to
each screen. A screen cannot forget them.

### "Mobile first, 360px wide"
Every screen is designed for a 360px phone first — that is the width of
a cheap Android phone. It then gets roomier on bigger screens. Buttons
are at least 44px tall so they are easy to press.

### "Two languages, Bahasa Indonesia first"
Both languages are written out in full in one file. If someone adds a
word in one language and forgets the other, the build **fails** rather
than showing a blank label.

---

## 3. Assumptions we made

You did not specify these, so we chose and recorded them.

1. **Username instead of email.** Most field workers have no email
   address. They log in with a short name like `ali`. Behind the scenes
   the system treats it as `ali@tracker.local`. They never see that part.

2. **A person who creates an account must hand over a first password,
   and the new user must change it at first login.** This means the
   person who created the account never ends up knowing the password.
   That is deliberate — it stops a Supplier quietly holding a client's
   login.

3. **Accounts are never created from a sign-up page.** No sign-up page
   exists. If one did, whoever found the website first could create
   themselves an owner account.

4. **The first Super Admin is created by you, by hand, from the Supabase
   dashboard.** This is a one-time step. Instructions are in
   `SETUP_STEPS.md`.

5. **Colour meaning is fixed across the whole app.** Green means good
   or paid. Amber means needs attention. Red means a problem.
   The same colour means the same thing on every screen, so people learn
   it once.

6. **A database table called `profiles` holds who each person is.**
   The Supabase login and this table are linked by a matching ID. That
   link is what makes "this person logged in" and "this person's data"
   the same thing.

---

## 4. Big decisions and the reasoning

### 4.1 The database enforces security, not the screen

This is the single most important decision in the project.

The obvious way to keep data private is to hide it in the interface —
if you are a Client, the app simply does not draw the Supplier's numbers.

**We do not do that.** All security lives in the database itself. Every
single table has rules saying who may see which rows. If a person edits
the code in their browser, or opens the database directly with a stolen
password, the database still refuses to hand over anything.

Why it matters: the "hide it in the screen" approach fails the moment
someone looks at the page source or the network traffic, which any
competent person can do in a couple of minutes. Our approach cannot be
bypassed from the browser at all.

*Cost:* more SQL to write. *Benefit:* you can be confident the data is
actually private.

### 4.2 Accounts are only created through one controlled door

There is no way for the browser to write a new account directly. All
account creation goes through a single server function that:

1. Identifies the person asking, using their login token — not anything
   they typed.
2. Looks up their real role from the database.
3. Refuses if they are not allowed.
4. If allowed, forces the new account to belong to them, overriding
   whatever they asked for.

A Supplier who tries to create an account for somebody else's team gets
their request silently corrected to their own team, not accepted.

### 4.2b Deactivating is enforced in the database, not the app

Turning somebody off has to mean their existing login stops working
immediately. We enforce `is_active` inside every security rule rather
than merely hiding their screens, so a deactivated person's session
returns nothing from the database at all.

We got this wrong on the first pass — see 5.4.

### 4.3 Sensitive operations live in a hidden area

Some actions cannot be done by writing to a table directly, because the
security rules deliberately forbid it. Clearing the "must change
password" flag is the example.

Postgres has a habit of letting anyone run any function you create. We
counter that by putting these functions in a separate area of the
database that the public cannot reach. The website cannot call them at
all. Only our own server functions can, and those check who is asking
first.

### 4.4 No router library

We wrote the navigation ourselves, in about twenty lines.

*Reason:* the app has four sections and a login screen. A routing library
is a large dependency that can break with a major version update, for
something we can do in twenty lines.

*Trade-off:* if the app grows to dozens of screens with parameters in the
URL, we should add a proper router then.

### 4.5 Hand-written database types for now

The types in `src/types/database.ts` describe the tables by hand.

*Reason:* the alternative needs a live database connection. Hand-writing
means the code catches a mistyped column name immediately, before anyone
sees a broken screen.

*Action:* once the database is connected, replace them with
automatically generated types so they can never drift out of date.

### 4.6 Hash routing (`#/supplier`) instead of clean URLs

The URL bar shows `#/supplier` rather than `/supplier`.

*Reason:* the hash version works on any static hosting with no
configuration. A clean URL needs server rules that some free hosts make
awkward to set up.

*Trade-off:* slightly less pretty URLs. We can change this later if it
bothers you.

---

## 5. Things we found while building that you should know about

### 5.1 Supabase is changing how tables are exposed — this affects us

Supabase used to make every new table automatically reachable from the
website's data layer. **That has stopped.**

The Supabase announcement says this becomes permanent for **all**
projects on **30 October 2026**. We are building in October 2026, so
this lands within weeks.

The danger: your table exists, your security rules are correct, and the
app still says "permission denied" — because the table was never given
access in the first place. Security rules and table access are two
different switches, and you need both.

**What we did:** every table we create gets an explicit access statement
in `supabase/migrations/003_grants_and_audit.sql`. This is the fix
your instructions asked for, and we enforced it in code rather than
relying on a dashboard setting that could change.

### 5.2 Tailwind version 4 changed how custom styles work

In version 4 you cannot apply your own custom class inside another one.
Our first build failed on this. We found it, read the current
documentation, and switched to the new mechanism (`@utility`). Recorded
here so the next person does not try the old way.

### 5.3 A cost note on hosting

We split the built code into separate files so no single file is too
large for the free hosting limit. The whole app is about 68 KB
compressed — that is a very small website, which matters for users on
slow mobile connections.

### 5.4 Two holes we found in our own security rules before shipping

We review our own work, and two things were wrong on the first pass.
Recording them because they are the exact mistakes that repeat in this
kind of app:

**Hole 1 — the rule that would have hidden data instead of leaking it.**
Our first version of the "who can read a profile" rule checked the wrong
direction of the supplier link. It read as: *"show me rows where this
row's supplier is me"*. For a Client that meant they could see their own
staff but **not** their own Supplier's name.

This is worth noticing: a wrong `OR` branch in a security policy usually
**hides** rows rather than leaks them, so it can sit undetected for
months while screens quietly show the wrong thing. Test 1 is what caught
it. That is the reason the tests exist, not decoration.

**Hole 2 — switching somebody off did not actually switch them off.**
The rules asked "who are you?" but never "are you still active?". A
person we deactivated could still read their own profile and their
Supplier's name, because nothing in the database checked `is_active`.
The app hid their screens, but the **database** still answered.

We added a `current_is_active()` helper and required it in every policy.
Now switching somebody off genuinely revokes their access, which is what
"deactivate instead of delete" has to mean for it to be worth anything.

Test 7 checks this.

---

## 6. What we deliberately did NOT build yet

The instructions asked for phased delivery, and this is Phase 1. These
are **not** forgotten — they are scheduled:

| Phase | What arrives |
|---|---|
| **1 (done)** | Logins, four roles, separate areas per role, language switch, database security rules, security tests |
| 2 | Products, barcode scanning, supplier-to-agent transfers |
| 3 | Multi-level cash tracking, goods receiving, client orders, payments, reports |
| 4 | Polished design, empty states, loading skeletons, offline handling, tests, deployment |

Phase 1 screens say plainly that a feature is not here yet, rather than
showing a fake number that looks like real data.

---

## 7. Open questions for you

None are blocking. If you have a preference on any of these, tell us
and we will change it — none of them require rewriting the database.

1. **Currency.** We assume Rupiah (`Rp`) and format it the Indonesian way,
   no decimals. Ready for Malaysian Ringgit, Singapore Dollar or US Dollar
   in the code, switched on by one setting.
2. **How many levels?** "Multi-level" is in the project name. We have
   designed for four levels (Supplier → Agent → sub-agent → sub-sub-agent).
   If you only need two, tell us and we keep it simpler.
3. **Password strength.** We require 8 characters minimum. Some
   businesses require longer or require a mix of letters and numbers.
4. **What a Supplier may switch on or off for their Clients.** The
   instructions say Clients see only what the Supplier allows. We have
   not yet decided which features that covers.