# Test checklist — audit fix branch

Everything changed on `fix/pre-launch-critical-batch-1` that has **not been run**. All of it was
verified by syntax check, bundle compile and logic simulation only, because the local `.env`
points at the production database (finding G-01) and running it would write to the live shop.

Work through this once staging exists — see `STAGING-SETUP.md`.

**Branch:** `fix/pre-launch-critical-batch-1` · **Commits:** `69ac1bf` → `970ee65` + this one
**Status key:** ☐ not tested · ☑ passed · ◐ partly passed · ✗ failed (note what happened)

---

## ✅ RUN LOG — 2026-08-31, step 2 (automated API-level checks)

Ran against **live `sdg-mart.com`** at `main` = `70711ce`. **29 checks, 29 passed, 0 failed.**

Covered: security headers (A-17), secret-file lockdown (A-03), compression (D-06), health
endpoints, consent enforcement (H-03), order-input validation (C-03/C-04), and the
non-destructive half of email enumeration (A-11/A-10).

**Nothing was written.** Every request was either read-only or one the server is supposed to
refuse. Confirmed against the database afterwards: 0 orders created, 0 users created, 0 new
`error_logs`; totals unchanged at **23 orders / 9 users**, newest order still #42 (2026-08-20).

Re-runnable: `node scripts/checks/step2-api-checks.js` (override the target with `BASE=…`).
Separately, all **20 migrations were verified applied** by probing the live database for the 46
objects they create — `node scripts/checks/verify-migrations.js` — 20/20 present, including all
five unique indexes and all seven stock-hold functions. Both scripts are read-only.

**Deliberately not run, and why:**
| Check | Why it was held back |
|---|---|
| Login rate limits (A-13) | Burns the 50-per-15-min **per-IP** budget and triggers a 15-minute block — from this machine that would lock you out of your own site |
| `forgot-password` on a real address | Sends a live password-reset email |
| qty-clamp / duplicate-collapse (C-04) | Only provable by placing a real order |
| Everything on the money path | Paystack is still on **live keys** |

---

## STEP 0 — Migrations to run first

Run on **staging**, confirm, then production. Order matters.

| ☐ | File | What it does | If skipped |
|---|---|---|---|
| ☐ | `supabase-schema-order-idempotency.sql` | `orders.client_request_id` + unique index | Duplicate-order protection stays OFF. Server warns at startup and runs without it — it does not break. |
| ☐ | `supabase-schema-indexes-and-email.sql` | Hot-path indexes; lowercases legacy emails | Order queries stay slow; a legacy mixed-case address could become unreachable at login. |

**Verify both landed:**
```sql
select column_name from information_schema.columns
where table_name='orders' and column_name='client_request_id';        -- expect 1 row

select indexname from pg_indexes where tablename='orders';            -- expect the new *_idx entries

select count(*) from users where email <> lower(trim(email));         -- expect 0
```

Separately, `cleanup-test-data.sql` removes the pilot test accounts and orders from **production**
(finding G-02). It deletes real rows — read it fully, run its INSPECT section first, and take a
backup. Not part of staging testing.

---

## STEP 1 — The money paths

The highest-value tests. Everything here changed.

### ☐ Checkout tells the truth when it fails (B-01)
DevTools → Network → **Offline** → tap Place Order.
- ☐ Error panel appears: *"Your order didn't go through"*
- ☐ **Cart is still full**
- ☐ No success screen, no tracking code
- ☐ Go back Online, tap again → order places normally

*Before the fix this showed a confirmation, emptied the cart, and issued a fake `SDG-XXXXXX` code.*

### ☐ No duplicate orders from double-tapping (F-01, B-02)
Throttle to Slow 3G, then tap Place Order 4–5 times fast.
- ☐ Button disables and reads *"Placing your order…"*
- ☐ **Exactly one** order in Admin → Orders
- ☐ Repeat with the idempotency migration NOT applied — still one order per tap-set? (protection is off, so expect duplicates; this confirms the migration matters)

### ☐ Loyalty cannot be spent twice (A-02)
Give a test user GHS 50 credit. Open checkout in two tabs, both applying the full 50. Complete both.
- ☐ One order gets the discount, the other is priced without it
- ☐ Final balance is 0, not negative
- ☐ Total discount given = 50, not 100

### ☐ Cancelling restores what it took (C-01)
Spend GHS 20 credit on an order → cancel within 15 minutes.
- ☐ The 20 is back in the balance
- ☐ If it was the first order, free-delivery perk is available again

### ☐ Rewards land on delivery, not checkout (C-01)
- ☐ Place a GHS 1,000 order → balance does **not** move
- ☐ Mark it delivered in Admin → Orders → loyalty is credited now
- ☐ Place another and cancel it → no credit earned *(this was the free-money loop)*

### ☐ Success screen states the pending credit
- ☐ Signed-in order that crosses a GHS 1,000 lifetime-spend boundary → success screen shows
  *“GHS 50.00 in credit lands in your account once this order is delivered”*
- ☐ Ordinary basket that crosses no boundary → **no line at all** (not “GHS 0”)
- ☐ Guest checkout → no line
- ☐ The amount shown matches what actually lands after the order is marked delivered

### ☐ Paystack reserves credit up front (C-07)
Needs test Paystack keys in the staging `.env`.
- ☐ Start a payment with credit applied → balance drops **before** the popup
- ☐ Abandon it → return to checkout → credit is back (release runs at init)
- ☐ Complete a payment → amount charged matches the order total in Admin
- ☐ Check Admin → Errors for any `PAYMENT MISMATCH` entry — there should be none

### ☐ Webhook retries instead of giving up (E-01)
- ☐ Complete a payment, close the tab before it returns → order still appears (webhook path)
- ☐ Admin → 💳 Reconcile lists nothing unexpected

### ☐ Reconcile tab (E-01 follow-up)
- ☐ Start a payment, abandon it, wait 15 min → appears as **ABANDONED**
- ☐ "Discard" works on it
- ☐ A genuinely paid-but-orderless reference shows **PAID — NEEDS ACTION** and "Create the order" works

### ☐ Revenue and rider cash-up (C-06)
- ☐ Place a cash order, assign a rider, mark delivered
- ☐ Admin → 💰 Revenue shows it under that rider as **collected**
- ☐ An undelivered cash order shows as **still out**, not as takings
- ☐ A Paystack order appears under Mobile money / card, not in any rider total

---

## STEP 2 — Access control

### ☐ Rider cannot overwrite a customer's password (A-01)
Create rider #N where customer #N also exists. Change the rider's password.
- ☐ Rider's own password changes
- ☐ Customer #N can still sign in with their original password

### ☐ Rider cannot touch another rider's orders (C-02)
- ☐ Rider B tries to mark rider A's order delivered → rejected
- ☐ The order stays assigned to rider A

### ☐ Guest orders cannot be cancelled by strangers (A-05)
- ☐ Place a guest order, note its id
- ☐ From a different signed-in account, call cancel on that id → rejected

### ☐ Addresses cannot be moved between accounts (A-06)
- ☐ `PUT /api/me/addresses/:id` with `{"userId": <other id>, "isDefault": true}`
- ☐ Address stays on the original account; `user_id` unchanged

### ☐ `.git` is not downloadable (A-03)
```bash
curl -sI https://sdg-mart.com/.git/config      # expect 404
curl -sI https://sdg-mart.com/.env             # expect 404
curl -sI https://sdg-mart.com/app.bundle.js    # expect 200
```
- ☑ First two 404, third 200 — **verified live 2026-08-31**: `/.git/config` 404, `/.git/HEAD` 404,
      `/.env` 404, `/app.bundle.js` 200
- ☐ **If `/.git/config` returned 200 before this deploys, rotate the GitHub token**
      *(n/a — it was already confirmed shut in v92)*

### ☐ Password reset links are not returned over HTTP (A-10)
With `RESEND_API_KEY` blank (as on staging), `POST /api/auth/forgot-password`:
- ☑ Response is exactly `{"ok":true}` — no `resetLink` field — **verified live 2026-08-31**
- ☐ The link is printed in the server console instead *(not checkable from outside; Resend is
      configured in production, so this branch does not run there)*

### ☐ Email addresses cannot be enumerated (A-11)
- ☑ `forgot-password` with `a%` → `{"ok":true}`, and **no** password-reset email is sent —
      **verified live 2026-08-31**
- ◐ Same response for a real address, an unknown one, and a wildcard — all identical.
      **Partly verified**: two different unknown addresses and the `a%` wildcard all returned
      byte-identical `{"ok":true}` at 295/307/310 ms. The **real-address** arm was deliberately
      NOT run — it sends a live password-reset email. Needs a throwaway account.
- ☐ A real address still receives its reset email normally
- ☐ Sign-in still works with mixed-case input (`Solomon@…` vs `solomon@…`)

> **Note (2026-08-31), separate from A-11:** `POST /api/auth/signup` answers **409 "An account with
> that email already exists"** (server.js:1941). That is a genuine enumeration oracle on the signup
> endpoint — A-11 only ever covered `forgot-password`. It is arguably the right UX trade-off, but it
> should be a decision on the record rather than an oversight.

---

## STEP 3 — Order input handling

### ☐ Empty and unavailable baskets (C-03)
- ☑ `POST /api/orders` with `items: []` → 400 "Your cart is empty.", no order created —
      **verified live 2026-08-31**
- ☑ Same with only invalid product ids → 400 "Those items are no longer available."
- ☑ Also refused: `items` as a string, and no `items` field at all → 400
- ☑ Confirmed against the database afterwards: **0 orders created** in the hour of testing;
      newest order is still #42 from 2026-08-20, total still 23

### ☐ Quantities and duplicates (C-04)
- ☐ 500 lines of the same product → one line, capped at 99 units, order places
      *(NOT run — this one is only provable by placing a real order. Left for the
      test-key phase, where the resulting row can be cleaned up.)*
- ☑ 101 different products → 400 "That order has too many different items." —
      **verified live 2026-08-31** with 130 distinct ids (`MAX_ORDER_LINES = 100`)
- ☑ `qty: 0` → that line is dropped, not turned into 1 — verified: a basket of one
      `qty: 0` line falls through to "Your cart is empty.", not a 1-unit order
- ☑ Negative qty (`-5`) is likewise dropped, not absolutised

### ☐ Stock is still ignored while sourcing from suppliers (B-03)
**This is the regression check for your operating model.**
- ☐ Admin → Settings → "Own-stock mode" is **OFF**
- ☐ Order a product with `stock: 0` → places normally
- ☐ *(Optional)* Turn the toggle ON → the same order is now rejected → turn it back OFF

---

## STEP 4 — Operations

### ☐ Kill switches (G-03)
Admin → Settings → Emergency switches.
- ☐ Turn off **Accept new orders** → checkout shows a clear message, not an error
- ☐ Turn off **Online payment** → Pay Now disappears, Cash on Delivery remains
- ☐ Turn off **Loyalty redemption** → credit is not applied at checkout
- ☐ Each switch-off appears in Admin → Errors
- ☐ Turn all three back ON
- ☐ An already-paid order still completes while ordering is off

### ☐ Compression (D-06)
```bash
curl -sI -H 'Accept-Encoding: gzip' https://sdg-mart.com/app.bundle.js | grep -i content-encoding
```
- ☑ Returns `content-encoding: gzip` — **verified live 2026-08-31**. `/` and `/api/catalog`
      negotiate **brotli** (`content-encoding: br`) when offered it.
- ☑ Bundle transfers at **58.2 KB rather than 253 KB — a 77.0% saving**, matching the 77.9%
      measured locally. Absolute figures are below the 80/360 KB written here because of the
      v92 shopper/staff bundle split.

### ☐ Process exits on an uncaught exception (E-06)
- ☐ Force a crash on staging → process exits and restarts, rather than staying up
- ☐ The crash is recorded in Admin → Errors

### ☐ Indexes are being used (D-01)
```sql
explain analyze select * from orders order by created_at desc limit 50;
```
- ☐ Plan shows an **Index Scan**, not a Seq Scan + Sort

---

## STEP 5 — Regressions to watch

Things that were working and must still work.

- ☐ Sign up, sign in, sign out
- ☐ Google sign-in *(needs `GOOGLE_CLIENT_ID` and the staging origin allowed)*
- ☐ Browse, search, add to cart, cart persists across reload
- ☐ Guest checkout end to end, tracking code works
- ☐ Saved addresses: add, edit, set default
- ☐ Admin: create product, upload photo, assign rider
- ☐ Rider: go online, see assigned orders, mark in transit then delivered
- ☐ Push notifications arrive *(staging VAPID keys — subscribe a test device)*
- ☐ Recurring orders still place via the daily job
- ☐ Squad and referral pages render

---

## Known limits of this branch

Recorded so they are not mistaken for test failures.

- **Duplicate protection is off until the migration runs.** The server warns at startup.
- **Loyalty shortfall on legacy Paystack drafts.** `pending_payments` rows created before this
  deploy carry no locked pricing, so they fall back to the old absorb behaviour. Clears itself
  once old drafts age out.
- **`first_order_done` on a concurrent race.** If two of one customer's orders race for the
  free-delivery perk, the loser still gets the quoted free delivery — charging more than was shown
  at checkout would be worse. Logged as a warning.
- **Rewards now appear at delivery, not checkout.** Intended (it is the C-01 fix), but customers
  may ask. Worth a line on the success screen: *"You'll earn GHS X when this is delivered."*

---

# Part 2 — the medium-fix batches (branch `fix/audit-mediums-batch-1`)

Added 2026-08-29. Everything below was verified against a **stubbed database**
or a recording fake, plus a real browser for the client work. None of it has
run against a real database, a real payment, or a real customer.

Migrations first, staging first: `node scripts/migrate.js status`.
`supabase-schema-constraints-2.sql` **can fail by design** if duplicate
order-level reviews already exist — its INSPECT query is in the file.

## STEP 6 — Access and rate limiting

### ☐ Password spraying is throttled (A-13)
- ☐ 50+ sign-in attempts from one connection, each with a *different* email → 429
- ☐ A normal customer getting their own password wrong 3 times is unaffected
- ☐ Watch for false positives: many real customers share one carrier NAT address.
      If legitimate users see 429, raise `LOGIN_IP_LIMIT` rather than removing it.

### ☐ Signup and checkout stay responsive under load (A-14)
- ☐ Several signups at once → the shop still browses normally (scrypt is off the event loop now)
- ☐ Sign-in still works for every existing account *(password hashes are unchanged in format)*

### ☐ Anonymous write limits do not bite real customers (A-15)
- ☐ Place a real order → no 429
- ☐ Two people in the same household ordering within minutes → both succeed

### ☐ Admin password enforcement (A-16)
- ☐ `select email, must_change_password from users where role='admin'` BEFORE deploying
- ☐ If true: sign in, change the password, admin routes unlock
- ☐ Bootstrap password no longer appears in the Render log at startup

### ☐ Security headers (A-17)
```bash
curl -sI https://sdg-mart.com | grep -iE 'x-frame|content-security|strict-transport'
```
- ☑ `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` —
      **verified live 2026-08-31**, along with all six: `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: strict-origin-when-cross-origin`,
      `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()`,
      `Strict-Transport-Security: max-age=15552000; includeSubDomains`, and the
      `Content-Security-Policy-Report-Only` policy
- ☐ **Then open the site and check the browser console for CSP *report-only* violations.**
      That list is what to fix before the full policy can be enforced. Paystack,
      Google sign-in, Leaflet maps and Analytics are the ones to watch.
- ☐ Paystack checkout still opens · Google sign-in still works · the map still loads tiles

### ☐ Product photo upload (A-19)
- ☐ A normal JPEG/PNG/WebP still uploads
- ☐ Renaming a `.txt` to `.jpg` and uploading it is rejected

## STEP 7 — Money and scheduling

### ☐ Delivery dating uses Accra time, not the server's (B-11)
- ☐ Order at 11:30 Accra → same-day · order at 12:30 Accra → next-day
- ☐ Admin dashboard "today" matches the shop's day, not UTC

### ☐ Recurring orders are bounded (B-10)
- ☐ Try to schedule one for yesterday → rejected
- ☐ Cadence 0 stores as 1, cadence 9999 stores as 90, "abc" is rejected
- ☐ Existing recurring orders still run

### ☐ One review per order (B-13)
- ☐ Rate a delivered order → works
- ☐ Rate the same order again → "You have already rated this order."

### ☐ Rider payload no longer carries extra PII (H-04)
- ☐ **A prepaid order still shows "✓ PAID ONLINE — collect nothing" to the rider.**
      This is the one that would cost real money if wrong — riders demanding cash
      for orders already paid. Check it on a real Paystack order.
- ☐ A cash order still shows "COLLECT GHS X CASH"
- ☐ Rider can still call the customer and find the address

## STEP 8 — Customer-facing

### ☐ Cart prices are current (C-09)
- ☐ Add an item, change its price in Admin, reopen the cart → the new price shows
- ☐ Checkout charges the same number the cart displayed

### ☐ Catalogue refreshes on resume (F-06)
- ☐ Install the PWA, background it for a few minutes, reopen → prices and stock are current
- ☐ Change a price in Admin while a phone has the app backgrounded → it appears on resume

### ☐ Payment options fail honestly (F-05)
- ☐ Block `/api/paystack/config` in DevTools → checkout says it couldn't check,
      offers "Try again", and cash on delivery still works
- ☐ Unblock, tap "Try again" → the Pay Now option appears

### ☐ Keyboard focus is visible (F-07)
- ☐ Tab through the shop → every focused control has a visible orange ring
- ☐ Clicking with a mouse leaves no ring behind

### ☐ Admin tables on a phone (F-08)
- ☐ Open Admin → Orders on an actual phone → the table scrolls sideways to the last column
- ☐ Same for Inventory and All Riders

### ☐ Signup consent (H-03)
- ☐ The checkbox is there, unchecked, with working Privacy and Terms links
      *(the v95 deploy check confirmed the checkbox and both links render; the unchecked
      default still wants a real eyeball)*
- ☑ Submitting without it is refused — **verified live 2026-08-31**: a direct POST to
      `/api/auth/signup` omitting `acceptedTerms` returns 400 "You must accept the Privacy
      Notice and Terms to create an account.", and **no user row was created** (users still 9)
- ☐ After signup: `select terms_version, terms_accepted_at from users order by created_at desc limit 1`

### ☐ Map pin quality (I-02)
- ☐ Indoors (network fix) → the "accurate to about N m — drag the pin" warning appears
- ☐ Outdoors (GPS) → shows a small accuracy figure, no warning
- ☐ `select location from orders order by id desc limit 1` → includes `accuracy` and `source`

## STEP 9 — Things that only show up in production

### ☐ Alerts actually arrive (G-08)
- ☐ **Tap "Enable admin alerts" on the phone you carry, once.** Nothing below works without it.
- ☐ Mark an order queued and leave it past `ORDER_SLA_HOURS` → an alert arrives
- ☐ Alerts do not repeat more than once per 30 minutes per kind

### ☐ Nothing sensitive in the logs (E-08)
- ☐ Force a 500 on a guest tracking link → Admin → Errors shows `?t=[redacted]`, not the token
- ☐ Same for a password-reset link (`?reset=[redacted]`)

### ☐ Retention sweep (B-12)
- ☐ After the first daily run, the console shows `retention sweep: sessions=… errorLogs=…`
- ☐ `select count(*) from sessions where expires_at < now()` → 0
- ☐ A pending payment still holding a reservation was NOT deleted

### ☐ Rollback works (G-06)
- ☐ On **staging only**: `node scripts/migrate.js down supabase-schema-constraints-2.sql`
- ☐ It reverses, and `status` shows it pending again
- ☐ `down supabase-schema.sql` refuses, explaining it is not reversible

---

## STEP 10 — Stock reservations (C-10), only before turning own-stock mode ON

The SQL functions have never executed. Run these on **staging** first — they are
section 9 of `supabase-schema-stock-holds.sql`.

```sql
select * from stock_available(array[1]);                     -- note `available`
select hold_stock('[{"id":1,"qty":2}]'::jsonb, 'chk', 15);   -- {"ok": true}
select * from stock_available(array[1]);                     -- available is 2 lower, on_shelf unchanged
select release_stock_hold('chk');                            -- 1
select * from stock_available(array[1]);                     -- back to on_shelf
select hold_stock('[{"id":1,"qty":999999}]'::jsonb, 'x', 15);-- {"ok": false, shortfalls...}
```
- ☐ A hold lowers `available` but never `on_shelf`
- ☐ Releasing restores it
- ☐ Over-holding is refused rather than going negative
- ☐ `commit_stock_hold` lowers `on_shelf` and clears the hold
- ☐ `restock_items` puts it back

Then, still on staging, with own-stock mode ON:
- ☐ Two browsers, one unit left → the first to reach payment gets it, the second
      is told which item ran out and is **not** charged
- ☐ Abandon a Paystack popup → stock is sellable again within 15 minutes
- ☐ Place a cash order, cancel it → the stock comes back
- ☐ **Turn own-stock mode back OFF → ordering a `stock: 0` product works again.**
      This is the supplier model the live shop runs on. If it breaks, stop.
