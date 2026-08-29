# Test checklist — audit fix branch

Everything changed on `fix/pre-launch-critical-batch-1` that has **not been run**. All of it was
verified by syntax check, bundle compile and logic simulation only, because the local `.env`
points at the production database (finding G-01) and running it would write to the live shop.

Work through this once staging exists — see `STAGING-SETUP.md`.

**Branch:** `fix/pre-launch-critical-batch-1` · **Commits:** `69ac1bf` → `970ee65` + this one
**Status key:** ☐ not tested · ☑ passed · ✗ failed (note what happened)

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
- ☐ First two 404, third 200
- ☐ **If `/.git/config` returned 200 before this deploys, rotate the GitHub token**

### ☐ Password reset links are not returned over HTTP (A-10)
With `RESEND_API_KEY` blank (as on staging), `POST /api/auth/forgot-password`:
- ☐ Response is exactly `{"ok":true}` — no `resetLink` field
- ☐ The link is printed in the server console instead

### ☐ Email addresses cannot be enumerated (A-11)
- ☐ `forgot-password` with `a%` → `{"ok":true}`, and **no** password-reset email is sent
- ☐ Same response for a real address, an unknown one, and a wildcard — all identical
- ☐ A real address still receives its reset email normally
- ☐ Sign-in still works with mixed-case input (`Solomon@…` vs `solomon@…`)

---

## STEP 3 — Order input handling

### ☐ Empty and unavailable baskets (C-03)
- ☐ `POST /api/orders` with `items: []` → 400, no order created
- ☐ Same with only invalid product ids → 400 naming what is unavailable

### ☐ Quantities and duplicates (C-04)
- ☐ 500 lines of the same product → one line, capped at 99 units, order places
- ☐ 101 different products → 400 "too many different items"
- ☐ `qty: 0` → that line is dropped, not turned into 1

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
- ☐ Returns `content-encoding: gzip`
- ☐ Bundle transfers at roughly 80 KB rather than 360 KB *(measured locally: 77.9% saving)*

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
