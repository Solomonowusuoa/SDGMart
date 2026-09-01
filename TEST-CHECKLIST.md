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

## 🐞 RUN LOG — 2026-08-31, step 2b (safe tier) — **found a live bug**

**21 checks, 20 passed, 1 failed** (`node scripts/checks/step2b-safe-checks.js`). The failure is a
*symptom* of the bug below, and should clear once the fix is deployed.

### `runDailyJobs()` has been dead since the v95 deploy

`db.appConfig.claim()` threw on **every** call:

```
invalid input syntax for type json — Token "-08" is invalid.
```

`app_config.value` is a **jsonb** column. `claim()` filtered with `.neq('value', value)` where
`value` is a bare date like `2026-08-31`. PostgREST has to cast that filter to jsonb, reads `2026`
as a number, then fails on `-08`. The *update body* was always fine — only the **filter** needed
JSON-encoding. Fixed in `database.js` by passing `JSON.stringify(value)` to `.neq`.

**`claim()` is the first thing `runDailyJobs()` does**, so when it threw, everything behind it
stopped — silently, because the outer handler only does `console.warn`:

| Job | Consequence of it not running |
|---|---|
| Retention sweep (B-12) | **42 expired sessions still in the table**, oldest 2026-06-01 — this is the failing check |
| Stuck-order watchdog (G-08) | **SLA alerts never fire** — the thing you were asked to enable admin push for |
| Recurring orders | Auto-reorders never place *(0 active rows today, so nothing was actually missed)* |
| Birthday gifts | Birthday pushes never fire |
| Leaderboard award | Monthly referral winner never paid |
| Abandoned-reservation + stock-hold sweeps | Holds never expire |

**Evidence of the timeline:** `daily_job_last_run` is stuck at `2026-08-29`, written
`00:05Z` — *before* the v95 deploy later that day. Nothing since, across at least two `/healthz`
hits I made today. The 42 expired sessions all expired on or before 2026-08-28, consistent with
the sweep having never run under the new code.

**Verified fixed** against the live database with a throwaway key: first claim `true`, same-day
re-claim `false`, next-day `true`, and **exactly one winner among 10 concurrent claims** — so the
A-08 concurrency guarantee still holds. Regression check added to the safe-tier script.

⚠️ **Not yet deployed.** Production still runs the broken code.

> **Follow-up worth considering:** this was invisible for two days because
> `runDailyJobs`'s outer catch logs to `console.warn` and nothing else. Recording it to
> `error_logs` would have surfaced it in Admin → Errors on day one.

**Also cleared in this run:** D-01 index usage · A-16 admin flag · E-08 stored-log redaction ·
H-03 consent columns · B-11 Accra delivery dating.

**On D-01, read the plan carefully:** `orders` holds 23 rows. Below a few hundred, Postgres
*correctly* prefers a Seq Scan — a planner choosing the index there would be the bug. All three
hot-path queries use an Index Scan with `enable_seqscan = off`, which is what proves the indexes
exist and are usable. Re-check once the table is big enough for the natural plan to flip.

---

## ✅ RUN LOG — 2026-08-31, step 2c (browser tier) — **found a second bug**

Driven against live `sdg-mart.com` as a guest. No order placed, no account created; the one test
cart was cleared afterwards.

| Check | Result |
|---|---|
| **H-03** consent checkbox | Present, **unchecked by default**, label reads correctly; Privacy Notice → `/privacy` 200 and Terms → `/terms` 200, both real pages, both `target=_blank` so the form is not lost |
| **F-07** focus rings | `solid 2px rgb(201, 89, 31)` on wordmark, nav and category buttons. Mouse click leaves **no** ring (`:focus-visible` = false) — correct |
| **F-07** search input | ✗ **Bug found — no focus indicator at all.** Fixed, see below |
| **F-05** payment options fail honestly | Both halves pass. Blocked → *"We couldn't check whether online payment is available just now. Cash on delivery still works."* + **Try again**, Pay Now hidden, cash still selectable. Unblocked + Try again → error clears, *"Pay Now — Card or Mobile Money"* returns |
| **A-17** CSP report-only violations | Exactly **one** distinct violation across home, login, shop, cart and checkout — see below |
| **STEP 5** browse / search / cart | Catalogue renders, search for "rice" returns results, add-to-cart updates the badge to "Cart, 1 item", and **the cart survives a full reload**. Search submit also blurs the input (`activeElement` → BODY), so the v81 mobile-keyboard fix still holds |

### Bug 2 — the search box had no focus ring (F-07)

`components/Header.jsx` set `outline: 'none'` **inline** on the search input. An inline style beats
any selector, so it silently cancelled the `header input:focus-visible` rule sitting right below it
in the same file. Everything else on the page ringed correctly; the search box was the one control
a keyboard user could not see themselves land on.

Proved in the live page before touching code: with the inline style removed, the computed outline
goes `none 3px rgb(17,17,17)` → `solid 2px rgb(201, 89, 31)`. Fixed by dropping the inline
`outline`, which lets the existing rule apply. Browsers only draw the ring on `:focus-visible`
anyway, which is exactly the case we want ringed. `esbuild` compiles the file clean.

### The one remaining CSP violation — now fixed

```
Loading the stylesheet 'https://accounts.google.com/gsi/style' violates
"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com"
```

Google Sign-In pulls its own stylesheet. `accounts.google.com` was already allowed in `script-src`,
`connect-src` and `frame-src` — just not `style-src`. **Paystack, Leaflet and Analytics produced no
violations at all.** Added to `style-src`; this was the last blocker to enforcing the policy rather
than only reporting it.

**✅ Both fixes verified live after deploy `94a8ad6`:**
- `style-src` now includes `https://accounts.google.com`, and a **fresh tab on both the shop and
  the sign-in page — with the Google button rendering — logs zero console output at all.**
  No CSP violations, no errors. The policy can now be moved from report-only to enforced.
- The search input rings on real keyboard focus: `solid 2px rgb(201, 89, 31)`,
  `:focus-visible` true, `inHeader` true. *(Note for whoever re-tests this: a programmatic
  `.focus()` will read as no-ring and is a false negative — `:focus-visible` deliberately ignores
  programmatic focus. Press Tab.)*
- Worth knowing: `/app.bundle.js` is served `Cache-Control: public, max-age=300`, so a browser can
  hold the previous bundle for up to 5 minutes after a deploy. Check the served file with `curl`
  before concluding a front-end fix did not land.

---

## ✅ DEPLOY VERIFICATION — 2026-08-31 19:13Z

The daily-jobs fix (`90f0add`) is **live and working**. Deployed build stamp
`sdgmart-90f0add7249b` matches HEAD. After one `/healthz` hit:

- `daily_job_last_run` moved **`2026-08-29` → `2026-08-31`**, updated `19:13:05Z` — the first
  successful daily-job run in two days
- `sessions` went **45 → 3**; expired sessions **42 → 0**. The retention sweep ran for the first
  time ever in production
- Safe-tier suite re-run: **21 checks, 21 passed, 0 failed** — the B-12 failure has cleared

---

## ✅ RUN LOG — 2026-08-31, step 2d (throwaway account) — **found a third issue**

`node scripts/checks/step2d-account-checks.js` — creates one throwaway account, runs the checks
that need a session, then deletes everything it made. **18 checks, 17 passed.**
Cleanup verified: users back to **9**, orders still **23**, zero `sdgtest-tmp-%` accounts left.

| Check | Result |
|---|---|
| **A-11** mixed-case sign-in | Works with exact, ALL-UPPERCASE and MiXeD-case input; stored lowercased |
| **A-06** address tenancy | `{"userId": <other>}` in the patch is **ignored** — the allowlist drops it and the update is scoped by `user_id`. Address stayed on its owner; the other account's rows untouched. Editing another account's address id → 400, content unchanged |
| **A-05** cancelling other people's orders | A **guest** order (`user_id NULL`) → 400 *"not yours"*; another customer's order → 400 *"not yours"*. Status unchanged in both cases |
| **B-10** recurring bounds | Past date, >1yr ahead, non-numeric cadence, malformed date and empty items are **all refused**; cadence 9999 correctly clamps to 90 |
| **H-03** consent record | A real signup writes `terms_version=2026-08-29` and `terms_accepted_at` — the column the audit added is genuinely populated |

### Issue 3 — input mistakes were being reported as server faults

Four of B-10's guards worked, but answered **500 "Something went wrong on our end. Please try
again."** `db.recurring.create` threw bare `Error`s with no `.status`, so `fail()` treated them as
crashes. Three costs:

1. The customer is told the *shop* is broken when they simply typed a date wrong — so they retry
   the identical request forever instead of fixing it.
2. Each attempt filed a **500 in `error_logs`** — confirmed, four rows appeared during this run —
   burying real faults in the Admin → Errors dashboard.
3. Each was also sent to **Sentry** as an exception.

Fixed by tagging them `status = 400`, the same pattern already used for the duplicate-review 409.
`fail()` then returns the real message and logs nothing.

**✅ Verified live after deploy `87d0bd4`.** All four now answer **400** with the real reason
(*"nextRunAt cannot be in the past."*, *"cadenceDays must be a number of days."*, etc.) instead of
500 *"Something went wrong on our end."*, and the re-run filed **zero** new `error_logs` rows. The
four stale 500s from the pre-fix run (ids 92–95) were deleted, so the Errors dashboard no longer
shows a fault that never was. A regression guard for this is now part of the script, which reads
**19 checks, 19 passed**.

### One expectation in this document was wrong, not the code

`cadence 0 stores as 1` **fails as written** — the route's `!cadenceDays` guard rejects `0` with a
400 before it ever reaches the clamp. **The code is right and this checklist was wrong.** Silently
turning "0" into a **daily** auto-order is precisely the class of bug B-10 exists to prevent, and
the database layer's own comment says so. Corrected in the item below.

*(Minor, unfixed: a `cadenceDays: 0` request answers "items, cadenceDays, nextRunAt required",
which is misleading — it was supplied. Worth a clearer message, not worth changing the behaviour.)*

---

## ✅ RUN LOG — 2026-09-01, step 2e (admin + rider tier) — **15 checks, 15 passed**

`node scripts/checks/step2e-admin-checks.js`, authorised by the shop owner, run in the evening
Accra time (well past the 12pm cutoff, the lowest-risk window).

**How admin access was obtained, and why it was done this way.** The script mints a **temporary
admin and two temporary riders directly in the database**, each with a deliberately unusable
password hash, and issues them session tokens. **No password is ever created, typed or stored**,
so there is nothing to leak and nothing to rotate afterwards; the real shared admin account is
never touched; and the H-04 bulk-PII access log attributes the run to an obviously-labelled temp
account rather than to the owner. All three accounts are deleted in a `finally`, so an exception
mid-run still cleans up. **Prefer this to using the real admin credentials for any future testing.**

| Check | Result |
|---|---|
| **A-01** rider cannot overwrite a customer's password | `POST /api/auth/change-password` as a rider → **403 "Not available for riders"**. `GET /api/me/orders` → 403 too. The `customerOnly` middleware makes this structural, not incidental |
| **C-02** rider cannot touch another rider's orders | Rider B on rider A's order → **404 "Order not found or not yours"**; status and `rider_id` both unchanged. An arbitrary status (`cancelled`) → 400 "Invalid status" |
| **A-19** photo upload | A real PNG uploads. **A text file renamed `.jpg` is rejected on its BYTES** ("Only JPEG, PNG and WebP images can be uploaded.") — the declared MIME is correctly ignored. Unauthenticated → 401 |
| **C-09** prices are current | Changed product 37 from GHS 5.50 → 8.71; `/api/catalog` served the new price immediately. Restored to 5.50 and re-verified live |
| **G-03** kill switches | All three off → checkout **503 "We have paused new orders for a short while"** (a clear message, not an error); Paystack init **503 "Online payment is temporarily unavailable — please choose Cash on Delivery."**; settings read back `false/false/false`. All three restored and independently re-verified |

**The audit trail was left in place on purpose.** Three `KILL SWITCH` rows (ids 97–99, dated
2026-09-01, attributed to temp admin 18) are in `error_logs` and will appear in Admin → Errors.
They are the record that the switches were genuinely exercised — an earlier draft of this script
deleted them, which would have defeated the very control G-03 exists to verify. **Do not "clean
them up".**

**Restored and independently confirmed** (not merely reported by the script): an empty-basket POST
now answers *"Your cart is empty."* rather than *"paused"*, so ordering is genuinely back on;
`/api/paystack/config` is enabled; product 37 reads GHS 5.50 in the live catalogue; switches all
`true`; users **9** / riders **1** / orders **23**, back to baseline; exactly **1 admin account**
remains. The 75-byte test PNG that A-19 uploaded was deleted from the `product-photos` bucket
(125 objects, no test-sized files left).

---

## 💰 RUN LOG — 2026-09-01, step 3 (the money paths, on Paystack TEST keys)

`node scripts/checks/step3-money-paths.js`. The script **refuses to run unless the public key is
`pk_test_`**, so it cannot be pointed at live money by accident. It places **real order rows** —
unavoidable for these checks — records every id, and deletes them in a `finally`.

| Check | Result |
|---|---|
| **B-02** idempotency | Same `clientRequestId` returns the **same order** (43 → 43), not a second one. **Five concurrent submits produced exactly ONE order.** This is the double-tap fix, proven under real concurrency |
| **A-02** loyalty double-spend | Two orders racing for the same GHS 50: **50 consumed of 50**, balance 50 → 0, never negative. One order got the discount (`used: 50`), the other correctly got `used: 0` |
| **C-01** cancel restores credit | Placing took GHS 20 (20 → 0); cancelling inside the window returned **exactly** 20 (0 → 20), order status `cancelled` |
| **C-01** rewards on delivery | A GHS 3,999.60 order credited **nothing** at checkout (balance 0). After marking it delivered, balance went **0 → 175**. This is the free-money-loop fix working |
| **C-07** Paystack reserves credit | Secret key valid (Paystack accepted the initialize). Credit reserved **before** the popup (30 → 0). Draft stored with `_reserved` populated |
| **C-07** release window | Credit is **NOT** released by an immediate second checkout — correct, the first payment may still complete. Aged past 30 minutes, returning to checkout **released it (0 → 30)** and cleared the abandoned draft |
| **E-01** webhook | Unsigned → **401**. Bad signature → **401**. It does not answer 200 on failure, so Paystack will retry |

### Two things this run taught us about the harness, not the app

**1. Paystack rejects the `.invalid` TLD.** The first attempt failed C-07 with a 502 that looked
like a broken secret key. The origin's actual body was `{"error":"Invalid Email Address Passed"}` —
Paystack refused `@example.invalid`. Test accounts on the money path must use `@example.com`.

**2. The 30-minute release window is deliberate, and an earlier version of this test called it a
bug.** `releaseStaleReservations()` uses `listStaleForUser(userId, 30)`, so only drafts older than
**30 minutes** are reclaimed. Releasing instantly would hand the credit back while the customer
still has the Paystack popup open and could still pay. The test now asserts **both** halves.

### ⚠️ A real operational finding: Cloudflare eats the app's 502 body

The app returns its own `502` with a useful message when Paystack rejects an initialize. Confirmed
by hitting both hostnames with the same request:

| Path | Response |
|---|---|
| `sdgmart.onrender.com` (origin) | `{"error":"Invalid Email Address Passed"}` |
| `sdg-mart.com` (through Cloudflare) | `error code: 502`, `content-type: text/plain` |

**Cloudflare replaces 5xx bodies with its own error page**, so a customer whose payment fails for a
fixable reason sees a bare Cloudflare error instead of the explanation the app wrote. Same family as
the recurring-order 500s already fixed: **a caller-fixable rejection should not be a 5xx.** Returning
`400`/`422` for Paystack validation failures would let the real message reach the customer.

### The order rate limit is real, and it bit the test

A later run returned **429** on every order attempt. `LIMIT_ORDERS` is **30 orders per 10 minutes
per IP, then a 10-minute block**, and the test suite's own volume tripped it. Working as designed —
but worth knowing before anyone re-runs this suite repeatedly, and relevant to **A-15**: the limit
sits far above any real customer's behaviour, yet a shared NAT address could plausibly approach it.

---

## 💳 RUN LOG — 2026-09-01, step 3b (the rest of the payment chain)

`node scripts/checks/step3b-payment-chain.js` — **16 checks, 15 passed, 1 skipped**, on test keys.
Mints a temp admin + rider, seeds the database into the state a finished day leaves behind, and
deletes everything. Verified after: orders **23**, users **9**, riders **1**, only order 42 open.

### ⚠️ THE ONE STEP A HUMAN STILL HAS TO DO

**Completing a Paystack payment through the popup cannot be automated here.** The popup is a
cross-origin iframe; the browser harness cannot deliver clicks or keystrokes into it — they land on
the parent document instead (confirmed by watching the focus ring appear on the shop's own search
box while trying to press the popup's Confirm button). Paystack's own test-mode MoMo number
(0551234967, MTN) is pre-filled and the **TEST** badge renders, so the popup is reachable and
correctly in test mode — it simply cannot be finished programmatically from here.

**So this remains untested end to end:** complete a payment → close the tab before it returns →
confirm the webhook still creates the order. Everything on either side of that single click is
proven; the click itself needs a person. **Do it while the test keys are still on.**

| Check | Result |
|---|---|
| **E-01** Reconcile lists orphans | 3 listed for an admin; unauthenticated → 401 |
| **E-01** ABANDONED vs PAID | A draft Paystack confirms unpaid shows **ABANDONED**. An unverifiable one shows **UNKNOWN**, never a guess |
| **E-01** Discard | Removed the abandoned draft; row confirmed gone *(passed in the first run; skipped on re-runs once consumed)* |
| **E-01** no order for an abandoned payment | Orders stayed at 23 across an abandoned checkout — the draft exists, the order does not |
| **C-06** prepaid vs rider cash | The prepaid order lands in **online takings and in no rider bucket**; the rider's cash reads GHS 100 (the two cash orders only), not 150 |
| **C-06** collected vs still-out | Delivered cash → **collected GHS 50**; undelivered cash → **still out GHS 50**, not counted as takings |
| **C-06** totals roll up | `totalTakings 100 = online 50 + collected 50`, with 50 still out |
| **H-04** ⭐ prepaid rider view | The prepaid order reaches the rider with **`paid: true`**, so it renders "collect nothing" rather than demanding cash. **This is the one that costs real money if wrong.** |
| **H-04** cash rider view | The cash order carries `paid: false` → "collect GHS X" |
| **H-04** rider can still work | Phone, address and neighbourhood all present |
| **H-04** PII withheld | `userId`, `momoNumber`, `subtotal`, `discount`, `loyaltyUsed` are **all absent** from the rider payload (18 keys) |

**Worth knowing for real use:** while the shop is on test keys, Reconcile **cannot verify references
created under the live keys** — they come back `UNKNOWN`. That is correct (the code refuses to
guess), but an admin opening Reconcile during a test window will see UNKNOWN against every genuine
orphan. Judge Reconcile on live keys.

**Two of the three "failures" in the first pass were my assertions, not the app:** `byRider` is
nested under `cash`, not top level; and a re-run legitimately finds no abandoned draft left to
discard because the previous run discarded it.

---

## 🧾 RUN LOG — 2026-09-01, the human-completed Paystack payments

The shop owner completed the popup step by hand (the part the harness cannot reach) and closed the
tab. **Two real test-mode checkouts landed cleanly:**

| Order | Total | Paid | Ref | Draft |
|---|---|---|---|---|
| 90 | GHS 466.99 | `true` | `SDG_1788289001610_33m04u` | cleaned up |
| 91 | GHS 933.98 | `true` | `SDG_1788289054300_as4pvx` | cleaned up |

Both guest checkouts, 8 line items each, `paid = true`, `payment_method = paystack`, correct
Paystack reference recorded, `status = queued`, delivery date 2026-09-02 (after the noon cutoff —
the B-11 dating rule working on a real order). **No money moved: these were test keys.**

**The `pending_payments` drafts for both were deleted**, so whichever path created the order also
completed its cleanup. And across the entire database there has **never** been a `PAYMENT MISMATCH`
or a `PAID BUT NO ORDER` row — the two conditions the audit added alarms for.

**⚠️ Still not distinguished: webhook vs verify.** Both `/api/paystack/verify` and
`/api/paystack/webhook` create the order identically, so the row alone cannot say which ran. If the
success screen appeared before the tab was closed, `verify` created it and the webhook correctly
skipped via the `findByPaystackRef` guard. Only if the tab closed *first* is the webhook proven.
**Paystack Dashboard → the transaction → its webhook delivery log settles it.** The E-01 safety net
therefore remains the one genuinely unproven link in the chain.

### An unhandled rejection worth chasing

Two `unhandledRejection: invalid input syntax for type bigint: "undefined"` rows appeared at 18:28
and 18:35 — **during automated testing, not during the owner's payments at 18:56/18:57**, which
produced no errors at all. Non-fatal: only `uncaughtException` exits the process, and this is not
that.

The problem is that it is **untraceable**. A Supabase/PostgREST error is a plain object, not an
`Error`, so it carries no `.stack` — the rows recorded an empty stack. The handler now keeps
PostgREST's `code`/`details`/`hint` and synthesises a stack when the reason has none, so the next
occurrence can actually be located. There is also at least one true fire-and-forget promise in the
codebase (`pushToUser` at server.js:1928, no `await`, no `.catch`), which is the shape of thing that
produces these.

---

## 🖥️ RUN LOG — 2026-09-01, step 3c (browser UI, on test keys)

Driven through the real UI on live `sdg-mart.com`. Four test orders created and **all deleted**;
verified after: orders back to 25, users 9, no `sdgtest-` accounts left.

### B-01 — checkout tells the truth when it fails ⭐

The highest-value one: before the fix a failed checkout showed a **success** screen, cleared the
cart and invented a tracking code. Simulated a dropped connection at the moment of submission.

- ☑ Error panel appears — verbatim: **"Your order didn't go through"** ·
      *"Your connection dropped before we could send it. Nothing was charged and your items are
      still in your cart. Check your internet, then tap Place Order again."*
- ☑ **Cart still full** — both items intact
- ☑ No success screen, no tracking code
- ☑ Back online, tapped again → order placed normally (`SDG-00092`), cart then cleared
- ☑ **The failed attempt created NOTHING**: exactly one order row existed afterwards, not two

### F-01 — the button state during submission

- ☑ While in flight the button is **disabled** and reads **"Placing your order…"** — captured
      mid-request, not inferred

### Success screen states the pending credit — all four cases

- ☑ Crossing a GHS 1,000 boundary → **"GHS 50.00 in credit lands in your account once this order
      is delivered."** (`total_spent` 980 + subtotal 39.99 = 1,019.99, one boundary, GHS 50)
- ☑ Ordinary basket crossing no boundary → **no line at all**, and specifically not "GHS 0.00"
- ☑ Guest checkout → no line
- ◐ "The amount shown matches what actually lands" — **it does not, and that is deliberate.**
      Promised 50, delivered credit was **75**. The extra 25 is the squad bonus, and
      `createOrderFromBody` says why: *"Only the tier credit is promised: the squad bonus also
      depends on other members and could change before this order arrives, so it stays a
      surprise."* The customer is never promised **more** than they receive — the direction that
      would matter — so this is safe. `total_spent` also dropped 1,019.99 → 519.99, which is the
      documented squad rollover, not corruption. **Worth re-wording this checklist line, not the
      code.**

---

## ✅ RUN LOG — 2026-09-01, step 4 (the last no-risk tier)

`node scripts/checks/step4-remaining.js` — **15 checks, 15 passed**, plus G-03's paid-order case
added to `npm test` (now **48 assertions, was 42**). Orders back to 23, users 9, no product left
at stock 0.

| Check | Result |
|---|---|
| **B-03** supplier model | `deduct_stock` is off. A product set to **stock 0 still sold** (order placed, 201), and the shelf count was **not** touched. This is the regression check for how the shop actually trades |
| **C-04** quantities | **500 lines of one product collapsed to ONE line, capped at qty 99**, and the order still placed. Priced off the cap: GHS 544.50 = 99 × 5.50, not 500 × |
| **C-09** price integrity | Order subtotal = catalogue price × qty exactly; the stored line price matches the catalogue, not a stale copy; and `total = subtotal + delivery − discount − loyalty` with nothing unexplained |
| **B-13** one review per order | First rating accepted; the second → **400 "You have already rated this order."**; exactly one review row survives (the duplicate would have overwritten 5 stars with 1). Reviewing **someone else's** order → **403 "Not your order"** |
| **G-03** paid order vs kill switch | With ordering **off**: an ordinary order is refused 503 and writes nothing, but a **signed Paystack webhook still creates the order**, marks it paid, and clears the draft. Money already taken is never stranded |

G-03's paid case lives in `tests/order-flow.test.js` section F rather than the live scripts,
because it needs `extra.paid` — which only the Paystack verify/webhook paths set, so it cannot be
reached through `/api/orders` at all. The test signs the webhook exactly as Paystack does, against
a stubbed database.

### ⚠️ A mistake of mine, found and fixed during this run

The step-2e admin script sent `stock: 0` in its `PUT /api/products/:id` body and then restored
**only the price**. `PUT` replaces every field it accepts, so this left product 37 (Indomie Instant
Noodles) **flagged out of stock and de-listed as a bestseller** — invisible to shoppers, since
stock 0 is the "Sold out" flag in both stock modes.

Caught because it was the **only** product of 132 not at stock 100. Restored from
`SDGMart-catalog-import.csv`, the original import source: stock 100, `bestseller: true`. The
bestseller count went **23 → 24**, matching the handoff's record of "24 auto-selected bestsellers"
exactly — independent confirmation the flag had been wiped.

`step2e-admin-checks.js` now snapshots the **whole product row**, echoes every field back on the
update, and verifies field-by-field that the restore round-tripped. **Lesson for any future test
that touches a product: `PUT` is a replace, not a patch.**

---

## ✅ RUN LOG — 2026-09-01, step 5 (regression sweep)

`node scripts/checks/step5-regressions.js` — **31 checks: 29 passed, 0 failed, 2 skipped.**
Throwaway customer, admin and rider; everything deleted. Verified after: orders 23, users 9,
riders 1, **products back to 132**.

| Area | Result |
|---|---|
| Sign up / in / out | Account created, session issued, `/api/auth/me` identifies it, **sign-out invalidates the token** (reuse → 401), wrong password refused |
| Saved addresses | Add, edit, and set-default all work — and setting a new default leaves **exactly one** default, not two |
| Guest checkout | Guest order placed with no account, tracking token issued, **the tracking link resolves**, and a wrong token → 401 |
| Admin | Created a product, uploaded a photo, assigned an order to a rider |
| Rider | Went online, saw the assigned order, marked **in transit → delivered**, and `delivered_at` was stamped |
| Squad / referral | Squad endpoint returns the account's squad with the GHS 500 goal; leaderboard renders |
| **C-01** perk | The first-order perk is claimed on placing, **released again on cancel**, and a cancelled order earns **zero** credit |
| **B-11** admin day | `/api/admin/revenue` defaults to the **Accra** business date, not UTC |
| **B-10** recurring | A due recurring order **actually placed** when the daily job ran, and `next_run_at` advanced by the cadence (2026-09-01 → 2026-09-08) |

**Two skipped, deliberately and honestly:** Google sign-in needs a real Google account and consent
screen; push notifications need a real device to hold the subscription. Neither is marked passed.

**One "failure" was my test, not the code.** The first-order perk only applies at
`FIRST_ORDER_FREE_MIN` = **GHS 50** and up. The first run ordered GHS 5.50 and read the perk
correctly *not* being claimed as a failure. Re-run with a GHS 60.50 basket: claimed on placing,
released on cancel.

### 🔎 Finding: riders cannot change or recover their password

There is **no rider password-change route at all**. `/api/auth/change-password` is `customerOnly`
and answers a rider **403**, and `/api/auth/forgot-password` looks the address up in `users`, not
`riders` — so a rider's reset request silently matches nothing. A rider is therefore stuck with
whatever password an admin set at `createRider`, permanently, with no self-service recovery.

Not a security hole — it is a gap in the rider experience, and it will bite the first time a rider
forgets their password or one leaves and the shared credential needs rotating. The checklist line
*"Rider's own password changes"* cannot pass because the feature does not exist.

---

## 🛵 RUN LOG — 2026-09-01, step 6 (rider password recovery — new feature)

Riders had **no way to change or recover a password**. Built and proven:
`node scripts/checks/step6-rider-password.js` — **19 checks, 19 passed.**

Added: `db.riders.changePassword`, `POST /api/rider/change-password` (riderOnly), and rider support
in forgot-password / reset-password. Migration `supabase-schema-rider-tokens.sql`.

**The dangerous part, and why it is built this way.** `email_tokens` recorded a bare `user_id`, and
riders and customers **share an id space** — the A-01 finding. A reset token minted for rider #N
under the plain `'reset'` purpose would have reset **customer #N's** password. Rider tokens now get
their own owner column (`rider_id`, with its own cascade) *and* their own purpose
(`'reset-rider'`), and a CHECK enforces exactly one owner — never both, never neither.

**Exercised, not argued.** The test builds the collision deliberately: a customer and a rider both
on **id 56**. Using the rider's reset link changed the **rider's** hash, left the **customer's**
untouched, and both could still sign in with their own credentials.

Two schema constraints were rejecting every rider token — a `purpose` CHECK limited to
`('verify','reset')` and a foreign key to `users(id)` — and **both failed silently**, because
`makeEmailToken` never checked its insert error: the caller answered "check your email" for a token
that had never been stored. **A customer hitting any insert failure would have had the same silent
dead end.** It now throws.

forgot-password still returns a byte-identical `{"ok":true}` for a rider, a customer and an unknown
address, so A-11 stays shut.

---

## ✅ RUN LOG — 2026-09-01, settling the "not testable" items

Seven items were conditionals already answered, or only visible from inside Render. Resolved with
evidence rather than left looking outstanding.

| Item | Resolution |
|---|---|
| **A-17** Paystack · Google · map tiles | **VERIFIED live.** Paystack popup opened earlier with its TEST badge; Google Sign-In loads its script, **its stylesheet** and its button; the map opened with **6 of 6 OpenStreetMap tiles** and Leaflet CSS from unpkg. **Zero CSP violations across the whole flow** — the tightened policy broke nothing |
| **A-16** bootstrap password not logged | **Resolved by construction.** `bootstrap()` prints a password in exactly one branch: creating an admin that does not exist *and* `ADMIN_BOOTSTRAP_PASSWORD` unset. With the variable set it prints only the sentence, never the value — and an admin already exists, so neither branch runs |
| **A-16** unlock after must_change_password | **n/a** — the flag is `false` on the one admin |
| **A-03** rotate the GitHub token | **n/a** — conditional on `/.git/config` having been open before v92. It was confirmed shut then and 404s now |
| **A-10** reset link printed to console | **n/a in production** — that branch runs only when `RESEND_API_KEY` is blank. Resend is configured, and there has **never** been a mail-failure row in `error_logs` |
| **F-01** repeat without the idempotency migration | **Won't do.** It means dropping a live unique index to watch duplicates appear. The protection is proven under real concurrency (five simultaneous submits → one order) |
| **A-11** a real address receives its reset email | **Still genuinely open** — needs a mailbox. The send path is healthy (zero mail failures ever), but arrival cannot be asserted from here |

---

## 🚦 RUN LOG — 2026-09-01, step 7 (rate limiting: A-13, A-14, A-15)

`node scripts/checks/step7-rate-limits.js` — **10 checks, 10 passed.** Run while the shop owner was
away from the machine, because A-13 deliberately gets this IP blocked from signing in for 15
minutes. Customers on other addresses are unaffected: the buckets are per-IP.

**Section order is deliberate and the script explains why:** A-15 first (cheapest, needs a working
sign-in), A-14 second (spends the 20-per-hour signup allowance), A-13 **last** (blocks sign-in from
this IP). Test accounts were seeded straight into the database rather than through
`/api/auth/signup`, so the signup allowance was reserved for the one section actually testing it.

| Check | Result |
|---|---|
| **A-15** normal use | A real order → 201. A **second household member on the same connection** → 201. Five more back to back → all 201. The cap is 30 per 10 minutes per IP; ordinary use is nowhere near it |
| **A-14** concurrent signups | **6 at once, all 201.** An existing account still signs in afterwards — hashes unchanged in format |
| **A-14** shop stays responsive | Idle catalogue latency **256 ms**; during the signup burst **2216 / 273 / 238 / 290 / 271 / 257 ms** |
| **A-13** a fumbling customer | Three wrong passwords → 401, 401, 401, then the **correct one → 200**. A customer mistyping their own password is not locked out |
| **A-13** spraying | One password against many different addresses → **first 429 after 44 attempts** |
| **A-13** the message | *"Too many sign-in attempts from this connection. Try again in 15 minute(s)"*, with `Retry-After: 899s` |
| **A-13** blast radius | **Browsing still works while sign-in is blocked** — a sprayer cannot take the shop down |

### Read the A-14 latency honestly

One of the six polls took **2216 ms**; the other five ran at **238–290 ms** against an idle baseline
of **256 ms**. That is the shape of a *free* event loop with one unlucky request — most likely a
cold catalogue cache (60 s TTL) or a network hiccup. **If scrypt were still blocking the loop,
every poll during the burst would have been slow, not one of six.** The fix is doing its job; the
outlier is noise, and is recorded rather than smoothed away.

### Why the first 429 came at 44, not 50

The cap is 50 per 15 minutes, and the bucket had already counted the session's earlier sign-ins —
A-15's two logins, A-13's three fumbles and the recovery. 44 + those ≈ 50. That the count carried
across the window is itself confirmation the bucket is a real sliding window, not something that
resets per request.

### ⚠️ One thing to watch after launch, not a failure

**50 sign-ins per 15 minutes per IP is roughly 3 a minute.** That is generous for a household and
tight for a **carrier NAT**: MTN and Vodafone put many subscribers behind one address, and the
checklist flags exactly this. With today's handful of customers it cannot bite. At scale, a
legitimate customer seeing *"Too many sign-in attempts from this connection"* is the symptom —
**raise `LOGIN_IP_LIMIT`, do not remove it**, since the per-account bucket alone gave spraying a
fresh allowance for every address tried, which is what A-13 was about.

---

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

### ☑ Checkout tells the truth when it fails (B-01)
DevTools → Network → **Offline** → tap Place Order.
- ☑ Error panel appears: *"Your order didn't go through"* — **verified live 2026-09-01**
- ☑ **Cart is still full** — both items intact
- ☑ No success screen, no tracking code
- ☑ Go back Online, tap again → order places normally (`SDG-00092`), and the failed attempt
      created **no** row — exactly one order existed afterwards

*Before the fix this showed a confirmation, emptied the cart, and issued a fake `SDG-XXXXXX` code.*

### ☑ No duplicate orders from double-tapping (F-01, B-02)
- ☑ **Exactly one** order — **verified live 2026-09-01 under real concurrency**: five simultaneous
      POSTs with one `clientRequestId` produced a single order id, and a repeat submit returned the
      SAME order (43 → 43) rather than creating a second.
- ☑ Button disables and reads *"Placing your order…"* — **verified live 2026-09-01**, captured
      mid-request (`disabled: true`)
- ☑ Repeat with the idempotency migration NOT applied — **won't do, deliberately**: it means
      dropping a live unique index to watch duplicates appear. The migration is applied and the
      protection is proven under real concurrency (five simultaneous submits → exactly one order).

### ☑ Loyalty cannot be spent twice (A-02)
**Verified live 2026-09-01** with two orders racing for the same GHS 50.
- ☑ One order gets the discount, the other is priced without it — `loyalty_used` was 50 and 0.
- ☑ Final balance is 0, not negative.
- ☑ Total discount given = 50, not 100.

### ☑ Cancelling restores what it took (C-01)
- ☑ The 20 is back in the balance — **verified live 2026-09-01**: 20 → 0 on placing, 0 → 20 on
      cancelling inside the window, order status `cancelled`. Exact, not approximate.
- ☑ If it was the first order, the free-delivery perk is available again — **verified live**:
      `first_order_done` true on placing → false after cancelling. *(The perk needs a basket of
      GHS 50+; a smaller order never claims it in the first place.)*

### ☑ Rewards land on delivery, not checkout (C-01)
- ☑ Place a large order → balance does **not** move — **verified live 2026-09-01**: a GHS 3,999.60
      order left the balance at 0.
- ☑ Mark it delivered → loyalty is credited now — balance went **0 → 175**.
- ☑ Place another and cancel it → no credit earned — **verified live**: balance stayed 0. This was
      the free-money loop.

### ◐ Success screen states the pending credit
- ☑ Signed-in order crossing a GHS 1,000 boundary → **"GHS 50.00 in credit lands in your account
      once this order is delivered."** — verified live 2026-09-01
- ☑ Ordinary basket that crosses no boundary → **no line at all**, and not "GHS 0.00"
- ☑ Guest checkout → no line
- ◐ The amount shown matches what actually lands — promised 50, landed **75**. The extra 25 is
      the squad bonus, which the code deliberately does not promise. The customer is never
      promised more than they get. **Re-word this line, not the code** — see the step-3c run log.

### ☐ Paystack reserves credit up front (C-07)
**Verified live 2026-09-01 on Paystack TEST keys.**
- ☑ Start a payment with credit applied → balance drops **before** the popup (30 → 0), and the
      draft is stored with `_reserved` populated.
- ☑ Abandon it → return to checkout → credit is back — **but only after 30 minutes**, and that
      matters: an immediate return does NOT release (correct — the popup may still be paid).
      Past the window it released 0 → 30 and cleared the draft. `listStaleForUser(userId, 30)`.
- ☐ Complete a payment → amount charged matches the order total in Admin
- ☐ Check Admin → Errors for any `PAYMENT MISMATCH` entry — there should be none

### ☐ Webhook retries instead of giving up (E-01)
- ☑ The webhook does not answer 200 on failure — **verified live 2026-09-01**: unsigned → **401**,
      bad signature → **401**. Paystack will therefore retry rather than give up.
- ☐ Complete a payment, close the tab before it returns → order still appears *(needs a completed
      test payment in the browser)*
- ☐ Admin → 💳 Reconcile lists nothing unexpected

### ☐ Reconcile tab (E-01 follow-up)
- ☑ Start a payment, abandon it → appears as **ABANDONED** — **verified live 2026-09-01**. A real
      abandoned checkout produced a `pending_payments` draft and **no order** (orders stayed 23).
- ☑ "Discard" works on it — DELETE 200, row confirmed gone.
- ☑ An unverifiable reference reads **UNKNOWN**, never guessed as abandoned. *(On test keys, every
      live-key orphan reads UNKNOWN — correct, but judge Reconcile on live keys.)*
- ☐ A genuinely paid-but-orderless reference shows **PAID — NEEDS ACTION** and "Create the order"
      works *(needs a completed payment — the popup step below)*

### ☑ Revenue and rider cash-up (C-06)
**Verified live 2026-09-01** by seeding a day's orders and reading `/api/admin/revenue`.
- ☑ A delivered cash order shows under that rider as **collected** — GHS 50, count 1.
- ☑ An undelivered cash order shows as **still out**, not as takings — GHS 50 outstanding.
- ☑ A Paystack order appears in online takings and **in no rider total** — the rider's cash read
      GHS 100 (the two cash orders), not 150.
- ☑ Day totals roll up: `totalTakings 100 = online 50 + collected 50`, 50 still out.

---

## STEP 2 — Access control

### ✗ Rider cannot overwrite a customer's password (A-01)
- ☑ **Verified live 2026-09-01, and it is stronger than this item assumed.** A rider cannot reach
      the customer password route at all: `POST /api/auth/change-password` with a rider session →
      **403 "Not available for riders"** (the `customerOnly` middleware). `GET /api/me/orders` is
      refused the same way. There is no shared write path left to get the ids confused.
- ☑ Rider's own password changes — **BUILT and verified 2026-09-01.** It genuinely did not exist;
      `POST /api/rider/change-password` now does, along with rider recovery through
      forgot-password. Proven not to cross into a customer sharing the same id. See the step-6 log.

### ☑ Rider cannot touch another rider's orders (C-02)
- ☑ Rider B tries to mark rider A's order delivered → **404 "Order not found or not yours"** —
      verified live 2026-09-01 with two temporary riders.
- ☑ The order stays assigned to rider A — status `assigned` → `assigned`, `rider_id` 1 → 1.
- ☑ Bonus: an arbitrary status value (`cancelled`) → 400 "Invalid status".

### ☑ Guest orders cannot be cancelled by strangers (A-05)
- ☑ From a different signed-in account, call cancel on a guest order id → **rejected 400 "not yours"** —
      **verified live 2026-08-31**. Also refused for another *customer's* order. Status unchanged in
      both cases. (Ownership is checked before any mutation, and a hard 15-minute window sits
      behind it, so this was safe to run against real order ids.)

### ☑ Addresses cannot be moved between accounts (A-06)
- ☑ `PUT /api/me/addresses/:id` with `{"userId": <other id>, "isDefault": true}` — **verified live
      2026-08-31**: the allowlist drops `userId` entirely and the update is scoped by `user_id`.
- ☑ Address stays on the original account; `user_id` unchanged (before 15 → after 15, target 2).
      The other account's default address was untouched, and editing *its* address id → 400 with
      content unchanged.

### ☑ `.git` is not downloadable (A-03)
```bash
curl -sI https://sdg-mart.com/.git/config      # expect 404
curl -sI https://sdg-mart.com/.env             # expect 404
curl -sI https://sdg-mart.com/app.bundle.js    # expect 200
```
- ☑ First two 404, third 200 — **verified live 2026-08-31**: `/.git/config` 404, `/.git/HEAD` 404,
      `/.env` 404, `/app.bundle.js` 200
- ☑ **If `/.git/config` returned 200 before this deploys, rotate the GitHub token** — **n/a**:
      confirmed shut in v92 and 404s today. No rotation needed.

### ☑ Password reset links are not returned over HTTP (A-10)
With `RESEND_API_KEY` blank (as on staging), `POST /api/auth/forgot-password`:
- ☑ Response is exactly `{"ok":true}` — no `resetLink` field — **verified live 2026-08-31**
- ☑ The link is printed in the server console instead — **n/a in production**: that branch runs
      only when `RESEND_API_KEY` is blank. Resend is configured, and `error_logs` has **never**
      recorded a mail failure.

### ☐ Email addresses cannot be enumerated (A-11)
- ☑ `forgot-password` with `a%` → `{"ok":true}`, and **no** password-reset email is sent —
      **verified live 2026-08-31**
- ◐ Same response for a real address, an unknown one, and a wildcard — all identical.
      **Partly verified**: two different unknown addresses and the `a%` wildcard all returned
      byte-identical `{"ok":true}` at 295/307/310 ms. The **real-address** arm was deliberately
      NOT run — it sends a live password-reset email. Needs a throwaway account.
- ☐ A real address still receives its reset email normally — **still open**: needs a mailbox to
      check. The send path is healthy (zero mail-failure rows ever recorded), but arrival cannot be
      asserted from here.
- ☑ Sign-in still works with mixed-case input — **verified live 2026-08-31**: exact lowercase,
      ALL-UPPERCASE and MiXeD-case all issued a session, and the address is stored lowercased.

> **Note (2026-08-31), separate from A-11:** `POST /api/auth/signup` answers **409 "An account with
> that email already exists"** (server.js:1941). That is a genuine enumeration oracle on the signup
> endpoint — A-11 only ever covered `forgot-password`. It is arguably the right UX trade-off, but it
> should be a decision on the record rather than an oversight.

---

## STEP 3 — Order input handling

### ☑ Empty and unavailable baskets (C-03)
- ☑ `POST /api/orders` with `items: []` → 400 "Your cart is empty.", no order created —
      **verified live 2026-08-31**
- ☑ Same with only invalid product ids → 400 "Those items are no longer available."
- ☑ Also refused: `items` as a string, and no `items` field at all → 400
- ☑ Confirmed against the database afterwards: **0 orders created** in the hour of testing;
      newest order is still #42 from 2026-08-20, total still 23

### ☑ Quantities and duplicates (C-04)
- ☑ 500 lines of the same product → one line, capped at 99 units, order places —
      **verified live 2026-09-01**: one line, qty 99, status 201, and priced off the cap
      (GHS 544.50 = 99 × 5.50).
- ☑ 101 different products → 400 "That order has too many different items." —
      **verified live 2026-08-31** with 130 distinct ids (`MAX_ORDER_LINES = 100`)
- ☑ `qty: 0` → that line is dropped, not turned into 1 — verified: a basket of one
      `qty: 0` line falls through to "Your cart is empty.", not a 1-unit order
- ☑ Negative qty (`-5`) is likewise dropped, not absolutised

### ☐ Stock is still ignored while sourcing from suppliers (B-03)
**This is the regression check for your operating model.**
- ☑ Admin → Settings → "Own-stock mode" is **OFF** — `deduct_stock` unset, verified 2026-09-01.
- ☑ Order a product with `stock: 0` → places normally — **verified live**: order created 201 and
      the shelf count was not touched. The supplier model is intact.
- ☐ *(Optional)* Turn the toggle ON → the same order is now rejected → turn it back OFF
      *(deliberately left for the own-stock session; see STEP 10)*

---

## STEP 4 — Operations

### ☑ Kill switches (G-03)
Admin → Settings → Emergency switches. **Exercised live 2026-09-01** (see the step-2e run log).
- ☑ Turn off **Accept new orders** → checkout shows a clear message, not an error:
      **503 "We have paused new orders for a short while. Please try again soon, or message us on
      WhatsApp."**
- ☑ Turn off **Online payment** → `/api/paystack/init` → **503 "Online payment is temporarily
      unavailable — please choose Cash on Delivery."** *(the UI half — Pay Now disappearing while
      Cash remains — was already proven in step 2c via F-05.)*
- ☑ Turn off **Loyalty redemption** → settings read back `false`; the credit path itself needs a
      priced basket to observe, so the switch is proven, its effect on a real checkout is not.
- ☑ Each switch-off appears in Admin → Errors — three `KILL SWITCH` rows, ids 97–99. **Left in
      place deliberately; they are the audit trail.**
- ☑ Turn all three back ON — restored and independently re-verified against the live API.
- ☑ An already-paid order still completes while ordering is off — **proven in
      `tests/order-flow.test.js` section F**: with ordering off an ordinary order is refused 503
      and writes nothing, while a correctly-signed Paystack webhook still creates the order, marks
      it paid and clears the draft. Money already taken is never stranded.

### ☑ Compression (D-06)
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

### ☑ Indexes are being used (D-01)
```sql
explain analyze select * from orders order by created_at desc limit 50;
```
- ☑ Plan shows an **Index Scan**, not a Seq Scan + Sort — **verified live 2026-08-31**, with a
      caveat that matters: `orders` holds **23 rows**, and at that size Postgres correctly prefers
      a Seq Scan for the unfiltered `order by created_at` query. Forcing `enable_seqscan = off`
      shows it picks `orders_created_at_idx`, so the index is present and usable. The two filtered
      queries (`user_id + created_at`, `rider_id + status`) already use Index Scans naturally.
      **Re-check once the table is large enough for the natural plan to flip.**

---

## STEP 5 — Regressions to watch

Things that were working and must still work.

- ☑ Sign up, sign in, sign out — **verified live 2026-09-01**, including sign-out invalidating the
      token (reuse → 401) and a wrong password being refused
- ☐ Google sign-in — **SKIPPED, not tested**: needs a real Google account and consent screen
- ☑ Browse, search, add to cart, cart persists across reload — **verified live 2026-08-31**
      as a guest: 14 categories and the full catalogue render, "rice" returns results, Add
      updates the badge to "Cart, 1 item", and the cart survives a full page reload. Search
      submit also blurs the input, so the v81 mobile-keyboard fix still holds.
- ☑ Guest checkout end to end, tracking code works — **verified live**: order placed with no
      account, token issued, tracking link resolved, and a wrong token → 401
- ☑ Saved addresses: add, edit, set default — **verified live**, and a new default leaves exactly
      one default rather than two
- ☑ Admin: create product, upload photo, assign rider — **verified live** (test product deleted)
- ☑ Rider: go online, see assigned orders, mark in transit then delivered — **verified live**,
      with `delivered_at` correctly stamped
- ☐ Push notifications arrive — **SKIPPED, not tested**: needs a real device holding the
      subscription
- ☑ Recurring orders still place via the daily job — **verified live 2026-09-01**: a due row
      placed a real order and `next_run_at` advanced 2026-09-01 → 2026-09-08
- ☑ Squad and referral pages render — squad endpoint returns the account's squad and the GHS 500
      goal; leaderboard responds 200

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

### ◐ Password spraying is throttled (A-13)
- ☑ 50+ sign-in attempts from one connection, each with a different email → **429** — verified
      live 2026-09-01: first block after 44 attempts (the session's earlier sign-ins had already
      counted toward the 50/15min bucket), `Retry-After: 899s`
- ☑ A normal customer getting their own password wrong 3 times is unaffected — verified:
      401, 401, 401, then the correct password → **200**
- ◐ Watch for false positives: many real customers share one carrier NAT address. — **noted, and
      it cannot be settled before launch.** 50 per 15 min is ~3/minute: generous for a household,
      tight for an MTN/Vodafone NAT. Harmless at today's volume. If real customers ever see
      *"Too many sign-in attempts from this connection"*, **raise `LOGIN_IP_LIMIT` — do not remove
      it**, because the per-account bucket alone gave spraying a fresh allowance per address.

### ☑ Signup and checkout stay responsive under load (A-14)
- ☑ Several signups at once → the shop still browses normally — verified live: **6 concurrent
      signups all succeeded**, and catalogue latency during the burst was 238–290 ms against a
      256 ms idle baseline (one 2216 ms outlier of six — a blocked event loop would have slowed
      *all* of them)
- ☑ Sign-in still works for every existing account — verified after the burst, status 200

### ☑ Anonymous write limits do not bite real customers (A-15)
- ☑ Place a real order → no 429 — verified live: 201, plus five more back to back all 201 (the
      cap is 30 per 10 minutes per IP)
- ☑ Two people in the same household ordering within minutes → both succeed — verified with two
      accounts on the **same IP**, both 201

### ☑ Admin password enforcement (A-16)
- ☑ `select email, must_change_password from users where role='admin'` BEFORE deploying —
      **checked 2026-08-31**: one admin row, `must_change_password = false`. No lockout risk.
- ☑ If true: sign in, change the password, admin routes unlock — **n/a**: `must_change_password`
      is `false` on the one admin account, so there is no lockout to clear.
- ☑ Bootstrap password no longer appears in the Render log at startup — **resolved by
      construction**: `bootstrap()` prints a password only when creating an admin that does not
      exist AND `ADMIN_BOOTSTRAP_PASSWORD` is unset. With it set, only the sentence is printed,
      never the value — and an admin already exists, so neither branch runs.

### ☑ Security headers (A-17)
```bash
curl -sI https://sdg-mart.com | grep -iE 'x-frame|content-security|strict-transport'
```
- ☑ `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` —
      **verified live 2026-08-31**, along with all six: `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: strict-origin-when-cross-origin`,
      `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()`,
      `Strict-Transport-Security: max-age=15552000; includeSubDomains`, and the
      `Content-Security-Policy-Report-Only` policy
- ☑ **Then open the site and check the browser console for CSP *report-only* violations.**
      **Done 2026-08-31 across home, login, shop, cart and checkout. Exactly one distinct
      violation:** `accounts.google.com/gsi/style` blocked by `style-src` — Google Sign-In pulls
      its own stylesheet, and that host was allowed everywhere except `style-src`. **Paystack,
      Leaflet and Analytics produced none.** Added to `style-src`; re-verify on the next deploy,
      then the policy can move from report-only to enforced.
- ☑ Paystack checkout still opens · Google sign-in still works · the map still loads tiles —
      **verified live 2026-09-01**: Paystack popup opened (TEST badge); Google Sign-In loaded its
      script, **stylesheet** and button; the map opened with **6/6 OpenStreetMap tiles** and
      Leaflet CSS. **Zero CSP violations** across the whole flow.

### ☑ Product photo upload (A-19)
- ☑ A normal JPEG/PNG/WebP still uploads — verified live 2026-09-01 (test object deleted after).
- ☑ Renaming a `.txt` to `.jpg` and uploading it is rejected — **400 "Only JPEG, PNG and WebP
      images can be uploaded."** The declared MIME is ignored and the real format is read from the
      bytes, so the rename buys nothing.
- ☑ Unauthenticated upload → 401.

## STEP 7 — Money and scheduling

### ☑ Delivery dating uses Accra time, not the server's (B-11)
- ☑ Order at 11:30 Accra → same-day · order at 12:30 Accra → next-day — **verified 2026-08-31**
      at the function level (`businessDate`/`businessHour`/`businessDatePlus` driven with a fake
      clock, so the cutoff can be tested at any hour): 11:30→same day, 12:30→next day,
      23:30→next day, 00:30→same day, and correct across a month and a year boundary.
      `BUSINESS_TZ = Africa/Accra` while this machine is UTC, and the date still derives from
      Accra. *(The end-to-end half — a real order placed either side of noon — still needs an
      order and is held for the test-key phase.)*
- ☑ Admin dashboard "today" matches the shop's day, not UTC — `/api/admin/revenue` defaults to the
      Accra business date

### ☑ Recurring orders are bounded (B-10)
- ☑ Try to schedule one for yesterday → rejected — **verified live 2026-08-31** ("nextRunAt
      cannot be in the past."). Also rejected: a date more than a year out, and a malformed date.
- ☑ ~~Cadence 0 stores as 1~~ → **cadence 0 is REJECTED (400), and that is correct.** The route's
      `!cadenceDays` guard catches it before the clamp. Turning an explicit 0 into a daily
      auto-order is the bug this item exists to prevent — the original expectation was wrong.
      **Cadence 9999 correctly stores as 90**, and `"abc"` is rejected.
- ☑ Existing recurring orders still run — **proven live 2026-09-01** with a real due row: the
      daily job placed the order and advanced `next_run_at` by the cadence

### ☑ One review per order (B-13)
- ☑ Rate a delivered order → works — **verified live 2026-09-01**.
- ☑ Rate the same order again → **400 "You have already rated this order."**, and exactly one
      review row survives (the duplicate would have replaced 5 stars with 1).
- ☑ Rating **someone else's** order → **403 "Not your order"**.

### ☑ Rider payload no longer carries extra PII (H-04)
- ☑ **A prepaid order still shows "✓ PAID ONLINE — collect nothing" to the rider** —
      **verified live 2026-09-01**: the order reaches `/api/rider/orders` with **`paid: true`** and
      `paymentMethod: paystack`, which is exactly what drives that badge. The money-losing failure
      mode — a rider demanding cash for an already-paid order — does not occur.
- ☑ A cash order still shows "COLLECT GHS X CASH" — carries `paid: false`.
- ☑ Rider can still call the customer and find the address — phone, address and neighbourhood all
      present.
- ☑ And the payload **withholds** `userId`, `momoNumber`, `subtotal`, `discount` and
      `loyaltyUsed` — 18 keys, none of them the ones H-04 flagged.

## STEP 8 — Customer-facing

### ☑ Cart prices are current (C-09)
- ☑ Change a price in Admin → the new price is served immediately — verified live 2026-09-01:
      product 37 GHS 5.50 → 8.71 appeared in `/api/catalog` at once, then restored to 5.50.
- ☑ Checkout charges the same number the cart displayed — **verified live 2026-09-01**: order
      subtotal = catalogue price × qty exactly, the stored line price matches the catalogue rather
      than a stale copy, and total = subtotal + delivery − discount − loyalty with no unexplained
      difference.

### ☐ Catalogue refreshes on resume (F-06)
- ☐ Install the PWA, background it for a few minutes, reopen → prices and stock are current
- ☐ Change a price in Admin while a phone has the app backgrounded → it appears on resume

### ☑ Payment options fail honestly (F-05)
- ☑ Block `/api/paystack/config` → checkout says it couldn't check, offers "Try again", and cash
      on delivery still works — **verified live 2026-08-31**. Exact copy: *"We couldn't check
      whether online payment is available just now. Cash on delivery still works."* Pay Now was
      correctly hidden, Cash on Delivery still selectable.
- ☑ Unblock, tap "Try again" → the Pay Now option appears — verified: the warning cleared and
      *"Pay Now — Card or Mobile Money"* returned, with cash still offered alongside

### ☑ Keyboard focus is visible (F-07)
- ☑ Tab through the shop → every focused control has a visible orange ring —
      **verified live 2026-08-31**: `solid 2px rgb(201, 89, 31)` on the wordmark, Home,
      Categories and the nav buttons. **One exception found and fixed**: the search input
      carried an inline `outline: 'none'` that beat the `header input:focus-visible` rule.
      See the step-2c run log.
- ☑ Clicking with a mouse leaves no ring behind — verified: after a mouse click,
      `:focus-visible` is false and `outline-style` is `none`

### ☐ Admin tables on a phone (F-08)
- ☐ Open Admin → Orders on an actual phone → the table scrolls sideways to the last column
- ☐ Same for Inventory and All Riders

### ☑ Signup consent (H-03)
- ☑ The checkbox is there, unchecked, with working Privacy and Terms links — **verified live
      2026-08-31** on the real signup form: checkbox present and `checked === false` by default,
      label reads *"I've read and accept the Privacy Notice and Terms…"*, both links resolve
      (`/privacy` and `/terms`, 200, real pages) and open in a new tab so the form is not lost
- ☑ Submitting without it is refused — **verified live 2026-08-31**: a direct POST to
      `/api/auth/signup` omitting `acceptedTerms` returns 400 "You must accept the Privacy
      Notice and Terms to create an account.", and **no user row was created** (users still 9)
- ☑ After signup: `terms_version` and `terms_accepted_at` are both populated — **verified live
      2026-08-31** on a real signup (`terms_version=2026-08-29`). The server's own TERMS_VERSION is
      recorded, not the client's claim.

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
- ☑ **Standing check, verified 2026-08-31**: no row in `error_logs` currently stores an
      unredacted `?t=` / `?reset=` / `?token=` value. Zero leaks in what is actually stored.
      *(The two boxes above force the path deliberately and are still worth doing.)*

### ☑ Retention sweep (B-12)
- ☑ After the first daily run, the sweep runs — **confirmed in production 2026-08-31 19:13Z**,
      the first successful run ever (see the deploy-verification block above)
- ☑ `select count(*) from sessions where expires_at < now()` → **0**. Was **42** before the fix;
      the sweep had never run, because `appConfig.claim()` threw on every call and killed all of
      `runDailyJobs()`. Fixed in `90f0add`; `sessions` went 45 → 3 on the first real run.
- ☑ A pending payment still holding a reservation was NOT deleted — `pending_payments` went
      5 → 2 (three unreserved rows older than the 30-day policy were pruned, which is the
      intended behaviour); the reserved rows were left alone

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
