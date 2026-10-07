# DECISIONS.md — Every choice we made, and why

This file exists so you never have to ask "why is it built this way?"
It is written for a business owner, not a programmer. Short sentences,
no jargon without an explanation.

**Last updated:** Phase 2 complete.

> ### ⚠ Read section 6.1 first
>
> **None of the Phase 2 database code has ever been run.** A local
> PostgreSQL server would not start in our environment (a Windows fault,
> not a fault in the SQL). The SQL is written and reviewed, but not
> verified by execution.
>
> Before a real customer uses this app, run the tests in Step 3 of
> `SETUP_STEPS.md` and confirm **twenty-three `PASS` and zero `FAIL`.**
> Please treat that as a real gate, not a formality.

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

**What we did:** every table and view we create gets an explicit access
statement. For the base tables that is in
`supabase/migrations/003_grants_and_audit.sql`; migrations 005–013 each
grant their own objects as they are created.

This matters for **views** as much as tables. A view that exists but has
never been granted is exactly as invisible as an ungranted table, and it
fails with the same confusing "permission denied" message.

**We re-checked the Supabase announcement at the end of Phase 2**
(6 October 2026). Nothing newer affects us. The three that remain worth
knowing:

| Announcement | Effect on us |
|---|---|
| Tables not exposed by default, **enforced 30 Oct 2026** | Already handled — explicit grants everywhere. **Read this before going live.** |
| The client library requires TypeScript 5.0+ from **31 Jan 2027** | None yet. Just never downgrade TypeScript. |
| Free-plan database limit is now **per active project** | Good news: a paused project no longer counts against your 500 MB. |

Everything else on that list affects paid features we do not use, or
self-hosting we do not do.

This applies to **views as well as tables.** A view that exists but has
never been granted is exactly as invisible as an ungranted table, so
migrations 008, 012 and 013 each grant their own objects explicitly.

**We re-checked the Supabase announcement at the end of Phase 2**
(6 October 2026). Nothing newer affects us. The three that remain worth
knowing about:

| Announcement | Effect on us |
|---|---|
| Tables not exposed by default (enforced **30 Oct 2026**) | Already handled — explicit grants everywhere. **Read this before going live.** |
| Supabase's client library will require TypeScript 5.0+ from **31 Jan 2027** | None yet, but do not downgrade TypeScript. |
| Free plan database limit is now **per active project** | Good news. Paused projects no longer count against your 500 MB. |

Everything else on the list affects paid features we do not use, or
self-hosting we do not do.

### 5.2 Tailwind version 4 changed how custom styles work

In version 4 you cannot apply your own custom class inside another one.
Our first build failed on this. We found it, read the current
documentation, and switched to the new mechanism (`@utility`). Recorded
here so the next person does not try the old way.

### 5.3 A cost note on hosting

We split the built code into separate files so no single file is too
large for the free hosting limit.

After Phase 2 the app is about **123 KB compressed** for the login screen
and everything behind it, plus a separate 125 KB barcode-scanner file that
is only downloaded when somebody actually opens the scanner. That is a
small website, which matters for users on slow mobile connections.

The barcode scanner is deliberately separate. It is the single largest
piece of code in the app and almost nobody needs it on every visit — see
§5A.6 for the bug that had it bundled into every page load.

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

## 5A. Phase 2 — products, prices, and the two safe views

This is the part of the app where a mistake costs you money, so it gets
the longest notes.

### 5A.1 The two prices are hidden by the database, not by the screen

A product has two prices: what an **Agent** pays you, and what a **Client**
pays you. The gap is your profit. If a Client could see both, they would
know your margin on every line and could go around you or demand a better
price.

The obvious way to hide one price is to leave it out of the screen. That
is not security — it is a label over a number that the browser already
received. Anybody can open the browser's developer tools and see it.

So the hiding happens one layer lower. `products` has **no** read rule for
Clients or Agents at all — the absence is deliberate and load-bearing.
They read **views** instead, and the views were written without the
sensitive columns:

| Who | Reads | Cannot ever see |
|---|---|---|
| Client | `client_products_view` | `agent_price`, `sku`, `supplier_id` |
| Agent | `agent_products_view` | `client_price`, any other Supplier's rows |

There is no column to hide, because the column was never written into the
view. Rewriting the frontend tomorrow to ask for `agent_price` returns an
error, not a number.

**Trade-off:** you cannot use the normal Supabase table editor to see
those two columns. It shows the view's columns instead. This is a real
inconvenience for you, and it is the price of the guarantee.

The views run as `SECURITY DEFINER` with an explicit column list — never
`select *`. `select *` would quietly start shipping every column added to
`products` in six months' time, including ones nobody reviewed.

**Do not add `security_invoker = on` to these views.** That would make
the join subject to `products`' own rules and return nothing at all.

Tests 8–13 check all of this.

### 5A.2 A permission switch returns NULL, not a zero

The nine switches a Supplier controls per Client (migration 007) are real
boolean columns, not a JSON blob with flags inside. That is not a style
preference: a mistyped key in a JSON blob fails silently and the switch
simply stays off forever, whereas a misspelled column is a compile error
the moment it is written.

When a switch is off, the view returns `NULL` for that column. The screen
then says "price not shown — ask the supplier".

Showing `0` instead would be worse than showing nothing: a Client would
read zero as *free*, or as *out of stock*. A number that is a lie is
worse than a number that is absent.

### 5A.3 The nine switches: four on, five off

The defaults are split, and the split is a business decision:

| On by default | Off by default |
|---|---|
| See stock quantity | See order history |
| See availability status | See payments |
| See prices | Sales report |
| Can place orders | Statement report |
| | Product availability report |

**Why the left column is on:** without those four a Client has a login
that shows an empty screen, and the Supplier has to find them to fix it.

**Why the right column is off:** those reveal how busy your business is
and what it charges other people. Each one has to be switched on
deliberately, for a specific Client.

So the direction of failure is chosen rather than stumbled into: **seeing
too much always requires an explicit click; seeing too little is only the
state somebody chose.**

Note that `can_view_prices` shows the *Client's own* price — the number
they are about to be charged anyway. It leaks nothing. The dangerous one
is the Agent price, and that is handled by §5A.1 instead.

If you disagree with this split, it is one `default` in migration 007 and
one screen of wording. Say the word.

### 5A.4 Stock can only move through one recorded door

Stock is the thing that stops adding up when three people write it down
by hand. So `products.stock_qty` is not writable by anybody through the
Data API — not even by the Supplier, and not by us.

The only way in is `adjust_stock()`, which writes the new number **and**
a row in `stock_movements` in the same database transaction. If the
history row cannot be written, the stock change does not happen. That is
the point: stock and its history can never disagree.

`stock_movements` is append-only. A trigger refuses any UPDATE or DELETE,
including by the platform owner. A mistake in the numbers is corrected by
adding a *new* correcting movement, never by editing history.

Two consequences worth knowing:

- Negative stock is refused unless you switch backorder on. Selling 10
  units you do not have means promising goods that do not exist.
- The cost of an audit trail is that correcting a typo is an extra row.
  That is the right trade for anything a tax office might ask about.

Tests 14–17 check this.

### 5A.5 Photos live in a private folder with expiring links

Product photos are in a **private** storage bucket. There is no public
address for a photo, and a link that leaks stops working.

Every photo gets a link that lasts one hour. Long enough that a photo
does not vanish while somebody is looking at it, short enough that a link
pasted into a chat message is dead by tomorrow.

Photos are also shrunk on the phone before upload — to 1280 pixels and
about 150 KB. A modern phone photo is 4–8 MB; a Supplier with 200
products on shop 3G would send over a gigabyte, and most of it would
fail. Done with the browser's built-in canvas, so no library and no cost.

Each photo is stored under the Supplier's own folder, and the database
checks that a Supplier can only write inside their own folder. That is
checked by a tripwire function the test suite calls, so the check cannot
be quietly deleted.

### 5A.6 What we got wrong while building Phase 2

**Bug 1 — the reversed check that blocked every Supplier from saving
settings.** In migrations 005 and 007, the "may this row change?" rule
asked the database to confirm ownership with a subquery that compared the
column to itself, which returns nothing for a Supplier. Every Supplier
settings save was rejected with no visible cause. Fixed to compare
against the signed-in session instead.

**Bug 2 — the bundle that would not split.** Phase 1 had a rule that
forced every `node_modules` file into one chunk named `vendor`. It looked
tidy. It also quietly defeated code splitting, which put the barcode
scanner library — about 12 MB on disk — into the file every visitor
downloads *before they can type a password*. The first login screen was
carrying a barcode reader nobody had asked for yet.

Fixing it dropped the main bundle from 529 KB to 64 KB. The scanner is
now a separate 478 KB file that is only downloaded when somebody actually
opens the scanner. **This is worth remembering as a general rule: a
`manualChunks` rule will silently undo every lazy import you wrote.**

**Bug 3 — the test that would have passed for the wrong reason.** Five new
tests looked up the Super Admin's id by the name `'super_admin'`, but the
fixture table stores it as `'super'`. The lookup returned nothing, so the
tests would have been checking a `NULL` id rather than a real account.

This is the worst kind of bug in a test suite: it looks like a pass.

### 5A.7 One number in the guide was wrong

The security tests are 21 checks but print **23** `PASS` messages,
because two of the stock checks each report two separate things. The
summary inside the test file originally said twenty-one. A non-technical
person counting messages would have seen 23 and assumed two had failed.

The instruction to the client now says twenty-three, and says why.

---

## 5B. Phase 2 — accounts and permissions

### 5B.1 Letting the app deactivate somebody, without opening the hidden door

Phase 1 deliberately put the sensitive actions in a `private` schema that
the browser cannot touch at all, because the only caller was a server
function holding the master key. That left you unable to switch an
account off from inside the app.

The tempting shortcut is to grant the private function to signed-in
users. **That would be a serious hole.** That function is passed *who is
asking* as an argument and trusts it. If the browser could call it, any
signed-in person could pass their own id and act as you.

So the functions stay private (migration 013 adds two thin public
wrappers):

| The wrapper | What it does | What it cannot do |
|---|---|---|
| `public.set_user_active(user, on)` | Supplies "who is asking" from the signed-in session | Choose who it is pretending to be |
| `public.request_password_reset(user)` | Same | Reset somebody else's password by claiming to be them |

Every rule stays in the private function. The wrappers check nothing, on
purpose: a second copy of a rule is a second place for it to be wrong,
and the disagreement would be a hole in whichever copy nobody was
reading.

Test 19 exists purely to catch somebody "fixing" a permission problem by
granting the private functions directly. It is the single most damaging
change anyone could make to this database.

### 5B.2 Nobody can switch off their own account

One tap by the last Super Admin would otherwise lock the entire platform
out, with no way back in through the app.

The rule is checked on *who* is being changed, not on *whether* anything
changes. That distinction matters: setting an account to the value it
already has is allowed, because that is how somebody a colleague switched
off gets switched back on. A guard on "whether" would be a different way
to brick the system.

Test 21 checks this.

### 5B.3 The account list is a view, and it deliberately carries no settings

Your account screen needs to show which Supplier each Client belongs to.
`profiles` stores that as a bare id, which tells an administrator nothing,
and the browser cannot join two tables in one request. So migration 012
adds a view that does the join.

It carries **no** settings and **no** permission switches. Building a list
of people must not hand over the ability to change what they can see.
Those are separate, deliberate acts.

A tripwire function checks the view's actual columns against a blocklist,
so a later "while we are in there, let me also join the permissions
table" fails the test instead of shipping. Test 17 calls it.

### 5B.4 Creating an account goes through one server door

New people cannot sign themselves up. If anybody could create an account,
anybody could create a Client account and read a Supplier's whole
catalogue.

Creation goes through the `create-user` server function, which checks who
is asking before doing anything:

- You (Super Admin) can create anybody.
- A Supplier can create a Client or an Agent, **for themselves only**. The
  Supplier's own id is read from their signed-in session, never from the
  form, so a Supplier cannot file somebody under a rival by editing the
  page.
- A Client or an Agent can create nobody.

The form mirrors those rules so nobody fills in something that will be
refused. The form is a convenience. The function is the authority, and
re-checks everything regardless.

Nobody is ever deleted. If somebody leaves the business, their orders and
history stay exactly where they are — a business that keeps records for
tax cannot throw them away because a person changed job.

---

## 5C. Phase 2 — code patterns worth knowing

These are not security decisions, but each one exists because the obvious
version was wrong.

### 5C.1 A list owns the data it loaded

The first version of every list screen kept its loading state in a
`useEffect` next to the search box. That produced **a real bug**: a slow
reply for page 1 could arrive after the user had already clicked to page
2, and overwrite it. The user would be reading page 2 while the screen
showed page 1.

The fix is a pattern we now use everywhere:

- The parent owns only the inputs: the search text, the page number, and
  a "please refresh" counter.
- The list itself is **keyed** on those values, so changing any of them
  throws the old list away and builds a new one that starts already
  loading.
- A slow reply for a page you have left finds a component that no longer
  exists and is discarded.

This also removed a synchronous `setState` inside an effect, which our
linter flags because it causes a cascade of re-renders.

The same idea fixes the edit form: `ProductForm` takes its starting values
from `useState`'s initialiser and the parent gives it a `key` of the
product being edited. Changing product rebuilds the form. There is no
window where the form shows one product's details while you are editing
another.

### 5C.2 Words and money have exactly one home each

Two traps we removed:

- **Money formatting was written twice**, once in the translation file
  and once in the money helper. Two copies drift apart, and a price shown
  as `Rp1.000` in one place and `1,000` in another is a money bug, not a
  formatting one. There is now one file, and the translation file
  re-exports from it.
- **The readiness badge had its colour and its label in two places.** The
  badge needs both, and they could disagree — "low stock" shown in green.
  One table now gives both answers together.
- **The margin was calculated twice.** The add/edit form worked it out
  itself, and the product list worked it out again, with the two copies
  not quite identical. The form now calls the same function the list does.
  Found by reading, after the rule above had already been written down —
  which is the honest way it happens.

The general rule we are applying: if two things must always agree, put
them next to each other so they cannot drift.

The deeper version of the rule: **if a calculation appears twice, it is
two bugs waiting.** Duplicated arithmetic does not stay correct. It stays
correct only until somebody fixes one copy.

### 5C.3 A missing translation key is a build failure

The translation file types Indonesian as the source of truth. A key that
exists in Indonesian but not in English is a **compile error**, not a
blank spot on screen. Adding a string means writing both languages.

We did not do this for every Phase 2 string. Those screens use a local
`two-language` helper so a half-finished feature does not block the build.
It is a deliberate inconsistency, and it is worth closing before anyone
outside the team touches these screens.

---

## 6. What we deliberately did NOT build yet

The instructions asked for phased delivery. These are **not** forgotten —
they are scheduled:

| Phase | What arrives | State |
|---|---|---|
| **1** | Logins, four roles, separate areas per role, language switch, database security rules, security tests | Done |
| **2** | Products, two prices with live margin, barcode scanning and label printing, stock tracking, CSV import, the nine per-Client switches, the account screen, photo storage | Done, **not yet run against a live database** |
| 3 | Multi-level cash tracking, goods receiving, orders, payments, reports | Next |
| 4 | Polished design, offline handling, automated tests, deployment | Later |

Phase 3 screens say plainly that a feature is not here yet, rather than
showing a fake number that looks like real data.

### 6.1 The single most important thing in this document

**None of the Phase 2 database code has ever been run.**

Every SQL file in `supabase/migrations/` and the whole test suite are
written and reviewed, but no PostgreSQL server in this environment would
start (a Windows fault, not a fault in the SQL). So migrations 005–013
and tests 8–23 are **unverified by execution**.

They are believed correct because they were reviewed closely against the
Phase 1 patterns, and because three self-inflicted bugs were found and
fixed by reading (§5A.6). That is not the same as having run them.

**Run the tests yourself (Step 3 of `SETUP_STEPS.md`) and confirm
twenty-three `PASS` and zero `FAIL` before you let a real customer in.**
That is the gate. Please treat it as a real gate.

---

## 7. Open questions for you

None are blocking. If you have a preference on any of these, tell us
and we will change it — none of them require rewriting the database.

1. **Currency.** We assume Rupiah (`Rp`) and format it the Indonesian way,
   no decimals. Ready for Malaysian Ringgit, Singapore Dollar or US Dollar
   in the code, switched on by one setting.

   **Known gap, flagged rather than guessed:** a Client and an Agent
   cannot read your settings table, so their screens currently assume
   Rupiah. If you ever bill in another currency, the fix belongs in the
   database — a view exposing nothing but the currency for the caller's
   own Supplier. Showing a price with the wrong symbol is a money bug, not
   a formatting one, so it is worth doing properly rather than hardcoding.
2. **How many levels?** "Multi-level" is in the project name. We have
   designed for four levels (Supplier → Agent → sub-agent → sub-sub-agent).
   If you only need two, tell us and we keep it simpler.
3. **Password strength.** We require 8 characters minimum. Some
   businesses require longer or require a mix of letters and numbers.
4. **Which features a Supplier may switch on or off for their Clients.**
   **Decided for now** — nine switches, four on by default and five off
   (§5A.3). If you want a different set, or a different split, tell us.
   It is one table and one screen, so it is a cheap change.# # #   P h a s e   2 a        V e r i f i c a t i o n   f i x e s   ( O c t   6 ,   2 0 2 6 ) 
 
 
 
 1 .   * * a c c o u n t _ l i s t _ v i e w   g a t e   i s   n o t   p r e s e r v e d . * *   C R E A T E   O R   R E P L A C E   V I E W   r e p l a c e s   t h e   e n t i r e   v i e w   b o d y        i t   d o e s   n o t   i n h e r i t   t h e   W H E R E   c l a u s e   t h a t   w a s   p a r t   o f   a n   e a r l i e r   b o d y   ( o n l y   o w n e r s h i p / G R A N T s   p e r s i s t ) .   T h e   o r i g i n a l   0 1 2   v e r s i o n   h a d   a   r e a d e r   g a t e   u s i n g   c u r r e n t _ i s _ a c t i v e ( )   a n d   i s _ s u p e r _ a d m i n ( ) ,   b u t   0 1 6 ' s   f i r s t   d r a f t   r e l i e d   o n   t h e   g a t e   t r a v e l i n g ,   s o   a   v i e w   r e p l a c e m e n t   d r o p p e d   i t   a n d   a l l o w e d   a n y   s i g n e d - i n   u s e r   t o   r e a d   e v e r y   a c c o u n t .   0 1 6 _ a c c o u n t _ l e v e l . s q l   n o w   r e s t a t e s   t h e   g a t e   a t   t h e   e n d   o f   t h e   v i e w   S E L E C T ;   t h e   c o l u m n - s h a p e   t r i p w i r e   a l s o   a s s e r t s   t h e   s t o r e d   p g _ v i e w s . d e f i n i t i o n   c o n t a i n s   b o t h   c u r r e n t _ i s _ a c t i v e   a n d   i s _ s u p e r _ a d m i n . 
 
 
 
 2 .   * * S u p p l i e r   b r a n c h   c o m p a r e d   a g a i n s t   s u p p l i e r ,   n o t   a g a i n s t   a c t o r . * *   p r i v a t e . s e t _ u s e r _ a c t i v e   a n d   p r i v a t e . r e q u e s t _ p a s s w o r d _ r e s e t   c o m p a r e d   v _ t a r g e t _ s u p p l i e r   i s   d i s t i n c t   f r o m   v _ a c t o r _ s u p p l i e r .   F o r   a   S u p p l i e r   a c t o r ,   v _ a c t o r _ s u p p l i e r   i s   N U L L   ( S u p p l i e r s   h a v e   p r o f i l e s . s u p p l i e r _ i d   N U L L ) ,   s o   e v e r y   a t t e m p t   b y   a   S u p p l i e r   t o   m a n a g e   t h e i r   o w n   C l i e n t s / A g e n t s   w a s   r e j e c t e d .   T h e   c h e c k   n o w   c o m p a r e s   a g a i n s t   p _ a c t o r _ i d   ( t h e   c a l l e r ' s   a u t h . u i d ( ) ) .   T h e   a u t h   w r a p p e r   p a t h   a l r e a d y   w o r k s   ( p r o v e d   b y   T e s t   2 1 ) . 
 
 
 
 3 .   * * C l e a n u p   i n   R L S   h a r n e s s   m u s t   a v o i d   a u d i t   t r i g g e r s   a n d   a p p e n d - o n l y   g u a r d s . * *   D e l e t i n g   t e s t   p r o f i l e s   d e e p e s t - f i r s t   c a s c a d e s   t o   p r o d u c t s ;   p r o d u c t s _ a u d i t _ l i f e c y c l e   ( A F T E R   D E L E T E )   i n s e r t s   a n   a u d i t   r o w   n a m i n g   a u t h . u i d ( )        w i t h   a   s t a l e   J W T   c l a i m   ( l e f t o v e r   f r o m   t h e   l a s t   t e s t   i n   t h e   s i n g l e   t r a n s a c t i o n )   t h i s   v i o l a t e d   a u d i t _ l o g s . a c t o r _ i d   F K .   T h e   h a r n e s s   c l e a n u p   n o w   t e m p o r a r i l y   d i s a b l e s   p r o d u c t s _ a u d i t _ l i f e c y c l e   d u r i n g   t h e   p r o f i l e - d e l e t i o n   l o o p   a n d   r e - e n a b l e s   i t   a f t e r ,   m i r r o r i n g   t h e   e x i s t i n g   s t a n d - d o w n   o f   s t o c k _ m o v e m e n t s _ n o _ u p d a t e .   P r o f i l e s   a r e   d e l e t e d   d e e p e s t - f i r s t   ( c h i l d r e n   b e f o r e   p a r e n t s ,   n e v e r   n u l l i n g   s u p p l i e r _ i d / p a r e n t _ i d   t o   s a t i s f y   0 1 4 ' s   u p d a t e   t r i g g e r ) .   T h e s e   a r e   t a r g e t e d ,   t e s t - o n l y   g u a r d s   i n s i d e   t h e   s i n g l e   t r a n s a c t i o n . 
 
 ### Phase 2a — Verification fixes (Oct 6, 2026)

1. **account_list_view gate is not preserved.** CREATE OR REPLACE VIEW replaces the entire view body — it does not inherit the WHERE clause that was part of an earlier body (only ownership/GRANTs persist). The original 012 version had a reader gate using current_is_active() and is_super_admin(), but 016's first draft relied on the gate traveling, so a view replacement dropped it and allowed any signed-in user to read every account. 016_account_level.sql now restates the gate at the end of the view SELECT; the column-shape tripwire also asserts the stored pg_views.definition contains both current_is_active and is_super_admin.

2. **Supplier branch compared against supplier, not against actor.** private.set_user_active and private.request_password_reset compared v_target_supplier is distinct from v_actor_supplier. For a Supplier actor, v_actor_supplier is NULL (Suppliers have profiles.supplier_id NULL), so every attempt by a Supplier to manage their own Clients/Agents was rejected. The check now compares against p_actor_id (the caller's auth.uid()). The auth wrapper path already works (proved by Test 21).

3. **Cleanup in RLS harness must avoid audit triggers and append-only guards.** Deleting test profiles deepest-first cascades to products; products_audit_lifecycle (AFTER DELETE) inserts an audit row naming auth.uid() — with a stale JWT claim (leftover from the last test in the single transaction) this violated audit_logs.actor_id FK. The harness cleanup now temporarily disables products_audit_lifecycle during the profile-deletion loop and re-enables it after, mirroring the existing stand-down of stock_movements_no_update. Profiles are deleted deepest-first (children before parents, never nulling supplier_id/parent_id to satisfy 014's update trigger). These are targeted, test-only guards inside the single transaction.

