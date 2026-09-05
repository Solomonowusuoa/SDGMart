# SDGMart — Decisions and trade-offs

Why the system is shaped the way it is, and what each choice cost. A companion
to [ARCHITECTURE.md](ARCHITECTURE.md), which describes *what* it is.

Some of these were deliberate from the start. Several were forced by a bug that
had already happened, and those say so — a decision with a scar behind it is
more useful than one that reads as if it were obvious.

**How to read an entry:** the decision, then what it bought, then what it cost,
then when to revisit. If you are about to change something here, the "when to
revisit" line is the part that matters.

---

## 1. The browser talks to the server, never to the database

**Decision.** All database access goes through Node. The Supabase client never
ships to the browser, and the `service_role` key never leaves the server.

**Why.** Two reasons, and the second is decisive.

The obvious one: some rules exist precisely because someone benefits from
breaking them. What a basket costs, whether an order was paid, how much loyalty
credit someone has, whether a rider may mark *this* order delivered. Those have
to be settled somewhere the person they constrain cannot reach. Row-level
security can answer *"is this your row?"* — it cannot answer *"is this the real
price?"*

The decisive one: **the database has no idea who is asking.** RLS policies are
written against `auth.uid()`, which comes from Supabase Auth. SDGMart uses its
own `users` and `sessions` tables (see §3), so a query arriving at Postgres
carries no identity. A policy like "you may read your own orders" is
unwritable. Browser-direct access would leave only two options: expose
everything, or expose nothing.

**What it cost.**
- A Node server to run, monitor and pay for.
- No Supabase Realtime, no free auto-generated API.
- Auth, rate limiting and pricing all had to be built by hand — which is why
  riders could not reset a password until v96, and why the shared-id-space bug
  (a token for rider *N* resetting customer *N*'s password) was possible at all.
  Supabase Auth would have given both for free.

**Revisit if** a second client appears that cannot go through the server — a
native mobile app, say. That would mean adopting Supabase Auth and writing real
policies, which is a significant piece of work, not a switch.

---

## 2. RLS on every table, with no policies

**Decision.** Every table has row-level security enabled and **zero** policies.

**Why.** Given §1 this is the correct posture, not an oversight. The service key
bypasses RLS; anon and authenticated get nothing. The public PostgREST endpoint
is a door the app never knocks on, so it should be shut rather than guarded.

Supabase's advisor flags this as *"RLS Enabled No Policy"* on ~20 tables. The
warning is right in general and wrong here: for most Supabase projects the
browser *does* query directly, and RLS-with-no-policy means the app is silently
broken. Ours is not, because nothing of ours uses that path.

**Do not "fix" those advisories.** Writing twenty policies to silence a warning
would add surface area to no purpose.

**What it cost.** A permanently noisy advisor panel, and the real risk that
comes with it: **a genuine problem hiding among expected warnings.** Exactly
that happened — `schema_migrations`, `stock_holds` and `order_events` sat with
RLS *disabled* (not merely policy-less) and were the only tables in the database
writable with the public anon key. They were fixed in
`supabase-schema-advisors.sql`.

The distinction to hold onto:

> **"RLS enabled, no policy"** = shut. Expected.
> **"RLS disabled"** = open. Never expected.

**Revisit** alongside §1.

---

## 3. Custom auth instead of Supabase Auth

**Decision.** Own `users`, `riders` and `sessions` tables; opaque bearer tokens;
own password hashing.

**Why.** Riders and customers are genuinely different actors with different
tables, different id spaces and different permissions. The shop also needs
guest checkout with no account at all. Supabase Auth assumes one user table and
one identity space.

**What it cost.** Everything an auth provider gives away had to be built and
then debugged in production:
- Riders had no way to change or recover a password at all until v96.
- `email_tokens` originally held a bare `user_id`, so a reset token for rider
  *N* would have reset **customer *N*'s** password. Fixed with separate owner
  columns and a CHECK enforcing exactly one owner.
- Rate limiting, lockout, token expiry: all hand-rolled.
- And, as §1 notes, it is what makes RLS policies unwritable.

**Revisit if** the rider/customer split ever collapses, or if a second client
needs direct database access.

---

## 4. One Express process, and one file

**Decision.** A single Node process. `server.js` holds all 111 routes.

**Why.** A grocery shop in one town is not a distributed-systems problem. One
process is easy to reason about, deploy, and read end to end. Splitting routes
across files buys navigability and costs the ability to grep one file and see
everything.

**What it cost.**
- `server.js` is large. Finding things depends on grep and section comments.
- **The architecture now assumes exactly one instance.** Rate-limit buckets,
  catalogue caches, the promotions cache and `_lastCategories` all live in
  process memory. Two instances would each keep their own: login throttling
  would weaken in proportion to how much you scaled, and an admin edit could
  appear on one instance and not the other for up to 60 seconds — a ghost that
  looks exactly like a caching bug.
- One instance is also one point of failure.

**Revisit when** traffic actually needs more than one instance. The order is:
move rate limits to a Postgres table, move cache invalidation to a shared
marker, *then* scale out. Until then **scale up, never out** (audit D-11).

The pattern for doing it right already exists in the codebase:
`db.appConfig.claim()` decides the daily-job winner with a conditional database
update rather than a flag in memory, and works correctly with any number of
instances.

---

## 5. No build step, no framework, no modules

**Decision.** React via CDN, components as globals on `window`, and the server
bundles with esbuild as it serves.

**Why.** There is no `npm run build` to forget, no framework upgrade treadmill,
and no bundler configuration to debug. A source file changes and the next
request rebuilds. It made the project approachable for one person maintaining
it alongside other work.

**What it cost.**
- **Load order is load-bearing.** `BUNDLE_FILES` is an array whose order
  matters; a file that uses a helper before `hooks.js` defines it breaks.
- No tree-shaking, no per-route code splitting beyond the one split in §6.
- No TypeScript, so the guardrails that exist are tests and comments.
- Every component shares one scope; a name collision is a real hazard.

**Revisit if** the front end grows past a handful of contributors, or if a
second developer joins and the implicit ordering starts biting.

---

## 6. Splitting the staff bundle out

**Decision.** `AdminPage` and `RiderPage` live in `/app.staff.js`, loaded only
after an admin or rider signs in.

**Why.** They were 38% of the bundle — ~130 KB of admin console that every
shopper downloaded and could never open. On a Tamale mobile connection that is
real time and real data cost.

**What it cost.** A second bundle to keep in mind, and a re-render when it
lands. A modest complexity price for a large win on the path that matters most:
a customer's first page load.

---

## 7. The catalogue ships as globals, with a JSON twin

**Decision.** `/data/products.js` sets `window.PRODUCTS` and friends before the
app boots. `/api/catalog` returns the same data as JSON.

**Why.** The first paint has the full catalogue with no round trip, which
matters on a slow connection. The JSON twin exists because a `<script>` cannot
be re-read without `eval`, which the CSP forbids — so a PWA returning from the
background refreshes through the endpoint instead.

**What it cost.** Two paths that must stay in step, and they have drifted twice:

- `/api/catalog` once returned only `products`. A device whose catalogue script
  had failed recovered its 132 products and **none of its categories** — every
  product rendered and no way to browse them.
- Before that, a failing `/data/products.js` returned a comment with no
  globals at all, so the first screen to read `window.PRODUCTS` took the whole
  app to the error boundary.

**The rule that came out of both:** a recovery path must carry everything the
thing it replaces carried, or it converts a total failure into a subtle one —
which is harder to find. Defaults now live in `hooks.js` so no screen can crash
on a missing global.

---

## 8. Selling from `stock: 0` — the supplier model

**Decision.** `deduct_stock` is **OFF**. Stock counts are advisory. The shop
sells products it does not physically hold.

**Why.** It reflects how the business actually runs: orders are sourced from
suppliers on demand. A shop that refuses to sell what it can obtain in an hour
is refusing money.

**What it cost.**
- Stock numbers in Admin mean less than they appear to. Low-stock alerts are
  suppressed while the mode is off, because otherwise every product sits at or
  below its threshold and the banner cries wolf about all of them.
- **`stock: 0` is not a safety net.** Creating an unpriced product with zero
  stock does *not* stop it selling — a mistake made in this very repo, caught
  because STEP 10 had proved the opposite that morning.
- The reservation machinery (`hold_stock`, `consume_stock`, `restock_items`)
  exists, is tested, and is dormant.

**Revisit when** the shop holds real inventory. Turn the toggle on in one
sitting, watch it, and turn it back off if anything is wrong — the supplier
model is the fallback and must keep working.

---

## 9. Rewards on delivery, not at checkout

**Decision.** Loyalty and squad credit are granted when an order is
**delivered**, and reversed if it is cancelled.

**Why.** Granting at checkout pays for orders that never arrive, and creates an
obvious way to farm credit: order, earn, cancel, repeat.

**What it cost.** More moving parts — a reversal path, and a checkout screen
that must promise exactly what delivery will pay. When the GHS 50-per-1,000
tier was retired, the checkout projection had to be zeroed in the same change:
**a promised credit that never arrives is the same class of lie as a success
screen for an order that was never placed.**

---

## 10. Retiring the spend tier, keeping the squad and referral credits

**Decision (2026-09-05).** The GHS 50 per GHS 1,000 lifetime-spend tier and the
GHS 15 monthly leaderboard prize are gone. The squad goal, the GHS 5 referral
and both delivery perks stay.

**Why.** Stacked, a member of a full squad earned about **10% back**. Groceries
run at 10–25% gross margin. The two that stay pay for a customer who was not
there before; the two that went were discounting spend that had already
happened — and the leaderboard paid a *second* time for referrals the GHS 5 had
already covered.

**What it cost.** Nothing operationally. Credit already granted was deliberately
**not** clawed back — it was earned under the terms as they stood — and
`lifetime_spent` is still maintained because it is the honest record of what a
customer has spent. It simply no longer pays.

`awardLastMonthWinner` was left as a **no-op rather than deleted**, because
`runDailyJobs()` calls it and a missing method throws inside that chain — which
is exactly how every daily job died silently for two days in v96.

---

## 11. Categories in `app_config`, not in code or a table

**Decision.** The category list lives in `app_config`, editable from
Admin → Settings. `DEFAULT_CATEGORIES` in `server.js` is only a fallback.

**Why not code?** Every change was a deploy, for something the owner adjusts as
stock changes.

**Why not a `categories` table?** Products store `category` as **plain text**.
Introducing a foreign key would mean migrating every product and every write
path. `app_config` already exists, needs no migration, and the constraint that
actually matters is enforceable without a table.

**The constraint that matters.** Because the link is a string, dropping a name
from the list orphans every product carrying it: gone from the nav and every
category page, reachable only by search. That is not theoretical — Geisha Black
Soap sat filed under "Rice & Grains" and nobody browsing for soap could find
it. So the **server** refuses to remove a category that still holds products,
and a rename moves the products with it.

**What it cost.** Validation that would be free with a foreign key: uniqueness,
length, ordering, and the removal/rename guards. All server-side, all tested.

**Revisit if** categories ever need per-category metadata — an icon, a banner,
a sort weight. That is when a real table earns its place.

---

## 12. Migrations as numbered files with a checksum

**Decision.** SQL files applied in the order of the `ORDER` array in
`scripts/migrate.js`, recorded in `schema_migrations` with a checksum.

**Why.** The previous approach was a hand-maintained list in prose, and it
drifted: `supabase-schema-cart.sql` was ticked as run when it never had been,
leaving the cross-device cart silently broken. A record the tool writes cannot
be optimistic in the way a person can.

**Consequences worth knowing.**
- **Migrations are immutable once applied.** Editing one makes `status` report
  `CHANGED`, and that warning should mean "someone tampered with applied
  history", not "someone tidied up". Fix forward in a new file — which is why
  `supabase-schema-advisors-2.sql` exists rather than an edit to `-advisors`.
- The tool needs a helper function, `exec_sql`, in the database. It is
  `SECURITY DEFINER` and executes arbitrary SQL. It is revoked from
  `public`/`anon`/`authenticated`, so only the service key can call it —
  **but it is standing power that only exists for migrations, and could be
  dropped between them.** An open question, not a settled decision.
- `verify-migrations.js` probes for the objects migrations *create*, rather
  than trusting the record. It is the stronger of the two checks and must be
  extended whenever a migration is added — twice now it has reported
  `INCOMPLETE` for a check that had gone stale, which is the behaviour wanted
  from it.

---

## 13. Daily jobs on `/healthz` instead of cron

**Decision.** An uptime monitor pings `/healthz`; that call runs the daily jobs.

**Why.** Render's free tier has no scheduler, and the jobs need to run.

**What it cost.** Two failure modes, both since handled:

- **Double execution.** Solved with `db.appConfig.claim()` — a conditional
  update, so Postgres picks exactly one winner. An in-memory flag would only
  ever guard one process.
- **Silent death.** `claim()` once threw on *every* call, because `value` is
  `jsonb` and the filter passed a bare date, so PostgREST read `2026` as a
  number and choked on `-08`. It is the first thing `runDailyJobs()` does, so
  everything behind it stopped for two days with nothing but a `console.warn`:
  the retention sweep, the stuck-order watchdog and its SLA alerts, recurring
  orders, birthday pushes and the hold sweeps.

**The lesson, worth generalising:** a job chain that begins with one call needs
that call to be loud when it fails. Timing is not the fragile part of a cron
substitute — silence is.

**Revisit** on a paid tier with a real scheduler.

---

## 14. Failing honestly, everywhere

**Decision.** No optimistic UI on anything that writes. If a call fails, say so
and leave the screen showing what the server actually has.

**Why.** This is the most-repeated bug in the project's history — four
occurrences, each found by a person rather than a test:

- Checkout showed a success screen and a tracking code for orders that were
  never placed.
- Admin deleted a product that stayed on sale, because `fetch` does not reject
  on 4xx/5xx and the failure was swallowed.
- Admin added a product with no id, so pressing Remove sent
  `DELETE /api/products/undefined`.
- Saving a product wrote the server's *error object* into the row: name blank,
  price `GHS NaN`, and a low-stock alert for a stock field it did not have.

**The rule.** Check `res.ok`. Check the shape of what came back. On failure,
tell the user and change nothing. A screen that reports success it never
confirmed is worse than an error, because the person stops looking.

**What it cost.** More code on every write path, and a UI that occasionally
shows an error where a hopeful one would have shown nothing. That is the point.

---

## 15. Kill switches over deploys

**Decision.** `ordering_enabled`, `online_payment_enabled` and
`loyalty_redemption_enabled` are admin toggles, logged when turned off.

**Why.** When something is actively losing money, the fix cannot require a code
change and a deploy — especially with no staging environment to verify against.

**What it cost.** Three more branches on the order path, and three more states
to reason about. Worth it: they are the only way to stop an exploit in minutes.

---

## Open questions

Decisions not yet made, recorded so they are not mistaken for settled.

| Question | Why it is open |
|---|---|
| **Drop `exec_sql` between migrations?** | Standing arbitrary-SQL power in production, revoked from all roles but the service key. Only exists for `migrate.js`. |
| **2FA on the admin account** | The real answer to audit H-04. Worth deciding *first* whether admin should be one shared account at all — 2FA on a shared login means sharing the seed, which gives up most of the benefit. |
| **Rider position on the tracking page** | Removed when the map turned out never to have worked on a cold load. If it returns it should show the fix age: `watchPosition` stops when the phone backgrounds, and a stale position currently looks exactly as live as a fresh one. |
| **Staging environment (G-01)** | Blocks the last migration-rollback checks. The guide is correct as of v97; it needs a Supabase project created by hand. |
| **When to scale out** | See §4. Needs rate limits and caches in Postgres first. |
