# Setting up a staging database

**Why:** right now your local `.env` points at the *production* Supabase project. Every local
test writes to the live shop — real orders, real customers, real push notifications to real
phones. HANDOFF's v76 entry records a test being skipped for exactly this reason
("Did NOT place a live order in preview"). This is audit finding **G-01**.

**Result:** a second, free Supabase project that your laptop talks to. Render keeps using the
real one. Nothing you do locally can touch a customer.

**Time:** about 20 minutes, most of it waiting for the project to provision.

---

## Before you start

- You are working in `C:\Users\Solo\Downloads\SDGMart`.
- Supabase's free plan allows **2 active projects** per organisation. If you already have two,
  you'll need to pause an unused one first (Dashboard → the project → Settings → Pause).
- Have `HANDOFF.md` open — §4 lists the migrations, and this guide adds one more.

---

## Step 1 — Create the project

1. Go to https://supabase.com/dashboard and click **New project**.
2. Name it `sdgmart-staging` so it can never be confused with the live one at a glance.
3. Set a database password and **save it in your password manager** — Supabase shows it once.
4. Pick the same region as production (fine either way; same region just behaves more alike).
5. Click **Create new project** and wait ~2 minutes for it to provision.

---

## Step 2 — Copy the two keys you need

In the new project: **Project Settings → API**.

| What | Where | Goes into |
|---|---|---|
| Project URL | "Project URL" | `SUPABASE_URL` |
| `service_role` key | "Project API keys" → `service_role` (click **Reveal**) | `SUPABASE_SERVICE_KEY` |

⚠️ Take the **`service_role`** key, not `anon`. The app uses the service key server-side and
will silently fail every query with the anon key, because RLS denies it everything by design.

Keep this tab open — you'll paste both in Step 4.

---

## Step 3 — Create the schema

Open **SQL Editor → New query** in the staging project. Run these files **in this order**, one
at a time, pasting the contents of each and clicking **Run**. They're all in the project folder.

```
 1. supabase-schema.sql
 2. supabase-schema-additions.sql
 3. supabase-schema-requests.sql
 4. supabase-schema-ops.sql
 5. supabase-rls-fix.sql
 6. supabase-schema-paystack.sql
 7. supabase-schema-referrals.sql
 8. supabase-schema-feedback.sql
 9. supabase-schema-delivered-at.sql
10. supabase-schema-order-reviews.sql
11. supabase-schema-cart.sql
12. supabase-schema-tweaks.sql
13. supabase-schema-order-idempotency.sql     ← new, from the B-02 fix
```

Order matters: later files add columns to tables the earlier ones create. Every file is
idempotent, so re-running one is harmless if you lose your place.

**Check it worked.** Run this — you should get 19 rows, all `rowsecurity = true`:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

And confirm the newest migration landed:

```sql
select column_name from information_schema.columns
where table_name = 'orders' and column_name = 'client_request_id';
```

One row means duplicate-order protection is active. No rows means step 13 didn't run — go back
and run it, or the server will warn at startup and run without that protection.

---

## Step 4 — Point your laptop at staging

**First, back up the production values.** From the project folder:

```bash
cp .env .env.production.backup
```

That filename is gitignored, so it stays off GitHub — but it holds live credentials, so don't
move it anywhere else. (Writing this guide turned up that `.gitignore` covered `.env` and
`.env.local` but *not* a backup like this one; it now covers `.env.*`, so yours is safe.)

Now edit `.env` and replace **only these two lines** with the staging values from Step 2:

```
SUPABASE_URL=https://YOUR-STAGING-REF.supabase.co
SUPABASE_SERVICE_KEY=<the staging service_role key>
```

### Generate separate push keys

Your `.env` currently holds the **production** VAPID private key, which means a stray test push
goes to real customers' phones. Generate a throwaway pair for staging:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Replace `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in `.env` with the pair it prints. Leave
`VAPID_SUBJECT` as it is.

### Leave the rest blank

`PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `RESEND_API_KEY` and `LOCATIONIQ_KEY` should stay
empty locally. That's expected and already documented in HANDOFF §5 — online payment reports
`enabled: false`, and maps fall back to OpenStreetMap. It also means **no local action can
charge anyone or send an email**, which is the point.

---

## Step 5 — Confirm you are on staging

Start the app locally, then check the two things that would tell you if you're still pointed at
production:

1. The **catalogue is empty** — a fresh staging database has no products. Production has 132.
   An empty shop is your confirmation that this worked.
2. **Sign in as admin** with `solomonowusuoa@gmail.com` and the default password
   `sdgadmin2026`. The server's `bootstrap()` recreates the admin on any database where that
   email is missing. If your *real* admin password works instead, you are still on production —
   stop and recheck `SUPABASE_URL`.

To give yourself something to test with, either add a handful of products through
Admin → Inventory, or import a small CSV with `node scripts/import-catalog.js <file.csv>`.

---

## Step 6 — Leave Render alone

**Do not change anything in the Render dashboard.** Render has its own copy of the environment
variables and keeps using production. The split is:

| | Supabase project | Set where |
|---|---|---|
| Your laptop | `sdgmart-staging` | `.env` in the project folder |
| Render (live site) | production | Render → Environment |

To confirm the separation is real, compare the project ref in Render → Environment →
`SUPABASE_URL` against your local `.env`. **They should now differ.** If they still match, `.env`
didn't save.

---

## Step 7 — Test the fixes that couldn't be tested before

Seven commits changed the failure paths and none has been exercised. On staging you can now run
these safely:

- **Order confirmation is truthful (B-01).** Open DevTools → Network → set to *Offline*, then tap
  Place Order. You should see the error panel with your cart still full — **not** a success screen.
- **No double orders (F-01, B-02).** Tap Place Order repeatedly and fast. The button should
  disable and read "Placing your order…", and you should end up with exactly one order.
- **Cancellation gives credit back (C-01).** Give a test user loyalty credit, spend it on an
  order, cancel within 15 minutes, then check the balance is restored.
- **Rewards land on delivery, not checkout (C-01).** Place an order — the balance should not move.
  Mark it delivered in Admin → Orders. Now it should.
- **Riders can't touch other orders (C-02).** With two rider accounts, have rider B try to mark
  rider A's order delivered. It should fail.
- **Kill switches (G-03).** Admin → Settings → Emergency switches → turn off "Accept new orders",
  then try to check out. You should get a clear message, not an error.
- **Revenue tab (C-06).** Place a cash order, mark it delivered, and confirm it appears under the
  right rider in Admin → Revenue.

---

## Switching back, if you ever need to

```bash
cp .env.production.backup .env
```

Only do this to reproduce something you genuinely cannot reproduce on staging — and remember
that every write then hits real customers again.

---

## Keeping staging in step

When you add a migration in future: run it on **staging first**, confirm the app still works,
then run it on production. That ordering is what would have prevented the incident in
HANDOFF §10, where code shipped ahead of its migration and every order insert failed silently
for a day.
