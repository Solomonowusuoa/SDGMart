# SDGMart — Architecture

How the whole thing fits together. Written to be read once, top to bottom, by
someone who has never seen the code.

For *why* it is shaped this way, and what each choice cost, see
[DECISIONS.md](DECISIONS.md). For where the work currently stands, see
[HANDOFF.md](HANDOFF.md).

---

## 1. The shape in one paragraph

SDGMart is a same-day grocery shop for Tamale, Ghana. It is a **progressive web
app** — one React front end that installs to a phone home screen — talking to a
**single Node/Express server**, which is the only thing that talks to
**Supabase (Postgres)**. There is no build step you run, no framework, no
bundler config, and no client-side router. The server bundles the front end as
it serves it. **The browser never touches the database directly.**

```
   ┌────────────────────────────────────────────────────────────┐
   │  Browser (PWA)                                             │
   │    React 18 (UMD from CDN)                                 │
   │    /app.bundle.js      shopper screens        ~1 file      │
   │    /app.staff.js       admin + rider          (on demand)  │
   │    /data/products.js   catalogue as globals               │
   │    sw.js               service worker, offline shell       │
   └───────────────┬────────────────────────────────────────────┘
                   │  HTTPS, JSON, Bearer token
                   ▼
   ┌────────────────────────────────────────────────────────────┐
   │  Node / Express — server.js   (ONE process, on Render)      │
   │    111 routes · auth · pricing · Paystack · rate limits     │
   │    esbuild bundling · daily jobs · error logging            │
   └───────────────┬────────────────────────────────────────────┘
                   │  service_role key (bypasses RLS)
                   ▼
   ┌────────────────────────────────────────────────────────────┐
   │  Supabase                                                   │
   │    Postgres  — 24 migrations, RLS on, no policies            │
   │    Storage   — product-photos bucket                         │
   └────────────────────────────────────────────────────────────┘

   Outside: Paystack (payments) · Resend (email) · Web Push (VAPID)
            LocationIQ (geocoding) · OpenStreetMap (map tiles)
```

---

## 2. The files that matter

| File | What it is |
|---|---|
| `server.js` | Everything server-side: routes, auth, pricing, payments, bundling, jobs. One file, deliberately. |
| `database.js` | The **only** place that talks to Supabase. Every query lives here. |
| `hooks.js` | Loaded first in the bundle. Shared helpers on `window`. |
| `App.jsx` | Root component, page routing, cart, session, catalogue refresh. |
| `components/*.jsx` | One file per screen. No imports — see §3. |
| `SDGMart.html` | The shell. Loads React, the catalogue, the bundle. |
| `sw.js` | Service worker: offline shell, push notifications. |
| `supabase-schema*.sql` | 24 migrations, applied in the order in `scripts/migrate.js`. |
| `scripts/checks/` | Re-runnable verification scripts, most self-cleaning. |
| `tests/` | Node test files run by `npm test` (111 assertions). |

---

## 3. The front end

### No modules, no imports

Components are plain `.jsx` files that define a component and attach it to
`window`:

```js
const CheckoutPage = ({ cart, setPage }) => { ... };
Object.assign(window, { CheckoutPage });
```

They reference each other as bare globals. There is no `import`, no `export`,
no module graph. The server concatenates the files in a fixed order and runs
one esbuild transform over the result, so the whole bundle shares a single
scope. **Load order is therefore load-bearing** — it is the array
`BUNDLE_FILES` in `server.js`, and `hooks.js` is first because everything else
depends on it.

### Two bundles, not one

| Bundle | Contains | Loaded |
|---|---|---|
| `/app.bundle.js` | All shopper screens | Always |
| `/app.staff.js` | `AdminPage`, `RiderPage` | Only after an admin or rider signs in |

The admin console is ~130 KB of source a shopper can never open. Splitting it
out means a customer on a Tamale mobile connection does not download it.
`App.jsx` injects the staff script on demand and re-renders when it lands.

### The catalogue arrives as globals, not as a fetch

`SDGMart.html` loads `/data/products.js` as a plain `<script>` before the
bundle. The server generates it per request and it sets:

```
window.PRODUCTS  CATEGORIES  ESSENTIALS  NEIGHBORHOODS
       TOP_IDS_BY_ORDERS  SHOW_FRESHNESS  SHOW_STOCK
       TERMS_VERSION  LOCATIONIQ_KEY  PAYSTACK_PUBLIC_KEY
```

So the first paint has the whole catalogue with no round trip. It is cached in
memory server-side for 60 seconds; any admin write calls `invalidateCatalog()`.

**`/api/catalog` is the JSON twin of that script.** It exists because a script
tag cannot be re-read without `eval`, which the CSP forbids — so a PWA
returning from the background refreshes through the JSON endpoint instead. It
must return *everything* the script sets. (It once returned only `products`,
and a device whose script had failed ended up with a full catalogue and no
categories: every product rendered, and no way to browse them.)

### Routing

There is no router. `App.jsx` holds `page` in state — one of `home`,
`category`, `product`, `cart`, `checkout`, `orders`, `tracking`, `account`,
`squad`, `admin` — and renders accordingly. Deep links arrive as query
parameters (`?track=115&t=<token>`), which `App.jsx` reads once on boot.

### The service worker

`sw.js` does three things: serves an offline shell, handles Web Push, and
caches. Its caching rules are the important part:

- **`/api/*` is never cached.** CacheStorage is per-origin, not per-user, so on
  a shared phone a cached API response could replay one customer's order
  history to the next. Network-only.
- **Code and the catalogue are network-first**, falling back to cache, and
  **only a 200 is ever stored**. A cached error is worse than no cache: a
  500 from `/data/products.js` was once stored and replayed on every load,
  leaving one device permanently broken while others were fine.
- `CACHE_NAME` is **stamped by the server at serve time** from the git commit.
  Nobody bumps it by hand, because a release step that depends on remembering
  eventually runs without it.

---

## 4. The server

One Express process. 111 routes, grouped roughly:

| Prefix | Count | Who |
|---|---|---|
| `/api/admin/*` | 33 | Admin only |
| `/api/me/*` | 18 | The signed-in customer |
| `/api/auth/*` | 11 | Sign-up, sign-in, reset |
| `/api/products/*` | 8 | Public read, admin write |
| `/api/orders/*` | 6 | Place, track, cancel |
| `/api/rider/*` | 5 | Riders only |
| `/api/paystack/*` | 4 | Payment init, verify, webhook |

### Auth

Custom, not Supabase Auth. A `sessions` table maps an opaque bearer token to a
user id and a *type* (`user` or `rider`). Middleware resolves the token into
`req.user` on every request; four guards sit on top:

```
requireAuth      signed in as anyone
requireAdmin     role === 'admin', and not still on a bootstrap password
riderOnly        riders
customerOnly     customers — riders live in a separate table with their own
                 ids, so a rider hitting /api/me/* would read someone else's row
```

Rate limiting is two-layered: per account *and* per IP. The IP bucket is what
catches password spraying, where a per-account bucket gives every new address a
fresh allowance.

### Placing an order — the critical path

This is the path that can lose money, so it is worth reading in order:

1. **Idempotency.** The client sends a stable `client_request_id`. A unique
   index means a retried submit returns the original order rather than making a
   second one.
2. **Pricing is recomputed server-side.** The basket is priced from the
   catalogue and live promotions. Nothing the browser says about money is
   trusted.
3. **Kill switches.** `ordering_enabled`, `online_payment_enabled`,
   `loyalty_redemption_enabled` — admin-flippable stops that need no deploy.
4. **Stock**, only when own-stock mode is on (see §6). Atomic
   `consume_stock`, before the order is confirmed, never after.
5. **Payment.** Cash, or Paystack — which reserves loyalty credit *before* the
   popup opens and releases it if the customer never returns.
6. **Confirmation, or an honest failure.** If any step fails the cart is kept
   and the customer is told. There is no success screen for an order that does
   not exist.

Rewards (squad credit, referral credit) land **on delivery**, not at checkout,
and are reversed if the order is cancelled.

### Paystack

Three ways money is confirmed, in decreasing order of how much you can rely on
them:

- **`/verify`** — the customer's browser came back and said so.
- **`/webhook`** — Paystack tells the server directly. This is the safety net
  for the customer who closed the tab. It has created a real order (114) that
  `/verify` never saw.
- **Reconcile** (admin screen) — for anything that still fell through.

Both `/verify` and the webhook run `assertChargeMatchesOrder`, so a charge that
disagrees with its order raises an alarm rather than being quietly accepted.

### Daily jobs without cron

Render's free tier has no scheduler. `/healthz` is pinged every few minutes by
an uptime monitor, and that ping calls `runDailyJobs()`.

The interesting part is how it avoids running twice. An in-process flag guards
one process; the actual decision is a **conditional database update**:

```js
if (!(await db.appConfig.claim('daily_job_last_run', today))) return;
```

The update only matches rows whose value differs, so Postgres picks exactly one
winner even if the monitor and a real visitor arrive in the same millisecond.
Behind that claim: the retention sweep, the stuck-order watchdog, recurring
orders, birthday pushes and the stock-hold sweep.

### Errors

Anything unexpected is written to `error_logs` and surfaced in Admin → Errors.
The client reports too, through `/api/client-error`, because a swallowed
browser error is invisible otherwise. Crashes exit the process **non-zero**
after recording, so the platform treats them as faults instead of restarting
into the same broken state silently.

---

## 5. The database

Supabase Postgres, reached only through `database.js`, only with the
**`service_role` key**.

- **`rowIn` / `rowOut`** convert between Postgres `snake_case` and JavaScript
  `camelCase` at the boundary, so no other file deals with both.
- **RLS is enabled on every table, with no policies.** The service key bypasses
  RLS; anon and authenticated get nothing. That is the intended posture, not an
  oversight — see DECISIONS.md §2.
- **24 migrations**, ordered by the `ORDER` array in `scripts/migrate.js`, which
  is the single source of truth for that sequence. `node scripts/migrate.js
  status | up | down <file>` records what has actually run in a
  `schema_migrations` table, with a checksum per file so a migration edited
  after being applied shows up as `CHANGED`.
- `scripts/checks/verify-migrations.js` is the stronger check: it probes for the
  objects the migrations *create*, catching a file marked applied that never
  really ran.

### Core tables

```
products     the catalogue. `category` is PLAIN TEXT, not a foreign key —
             which is why renaming a category has to move its products
users        customers and admins. Riders are separate.
riders       separate table, separate id space
orders       items as JSONB; status queued → assigned → in_transit → delivered
sessions     bearer token → user/rider
app_config   key/value JSONB: settings, categories, feature toggles, job markers
stock_holds  reservations, only meaningful in own-stock mode
error_logs   server + client errors
```

---

## 6. Two modes worth knowing about

**Own-stock mode (`deduct_stock`)** is **OFF**, and that is correct. The shop
sources from suppliers on demand, so it must keep selling a `stock: 0` product.
Stock counts are a note to the owner, not a constraint. Turning the toggle on
makes the shop start refusing orders it cannot fill — the reservation machinery
(`hold_stock`, `consume_stock`, `restock_items`) exists and is tested, and is
dormant until then.

**Freshness (`show_freshness`)** is off by default. When on, customers see
Best-Before dates and a clearance section for items nearing expiry.

---

## 7. Deployment

```
git push → GitHub → Render auto-deploys (~2 min)
```

There is no build step. Render runs `node server.js`; esbuild bundles the front
end in-process on first request and rebuilds when a source file's mtime
changes. Migrations are **not** automatic — they are run deliberately with
`scripts/migrate.js`.

Environment split:

| | Supabase project | Set where |
|---|---|---|
| Laptop | staging (once it exists) | `.env` |
| Render | production | Render → Environment |

---

## 8. What this architecture assumes

Two assumptions are load-bearing, and both are written down rather than
discovered later:

1. **Exactly one server process.** Rate limits, catalogue caches and the
   promotions cache live in that process's memory. A second instance would keep
   its own, so login throttling would weaken in proportion and an admin edit
   might appear on one instance and not the other. **Scale up, never out**,
   until that state moves into Postgres. (Audit finding D-11.)
2. **Nothing but the server holds the service key.** It bypasses RLS entirely,
   so it must never reach a browser, a repo, or a client-side bundle.
