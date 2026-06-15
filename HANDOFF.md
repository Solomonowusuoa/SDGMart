# SDGMart — Handoff / Continuation Guide

A same-day grocery web app for Tamale, Ghana. This doc lets a new chat (or you) pick up exactly where we left off. Read this top-to-bottom once, then keep it as reference.

---

## 1. What & where

- **Local project dir:** `C:\Users\Solo\Downloads\SDGMart`
- **Repo:** https://github.com/Solomonowusuoa/SDGMart (branch `main`)
- **Custom domain:** `https://sdg-mart.com` (bought on Cloudflare; note the hyphen). `https://sdgmart.onrender.com` still works and stays active.
- **Hosting:** Render, auto-deploys on every `git push` to `main`.
- **The codebase is domain-agnostic** — all API calls are relative, referral links use `window.location.origin`, push uses `self.location.origin`. Switching domains needs **no code change**, only external config (see §13).
- **Admin login:** `solomonowusuoa@gmail.com` (default pw was `sdgadmin2026`, changed on first login; use “Forgot password” if lost)

## 2. Tech stack (and the non-obvious bits)

- **Frontend:** React 18 (UMD via CDN) written as `.jsx` files using **global-window components** (no imports/modules). Each file defines components and does `Object.assign(window, { Foo })`. They reference each other as bare globals.
- **No Babel in the browser.** The server bundles all source files with **esbuild** (`/app.bundle.js`), built once at startup and rebuilt only when a source file's mtime changes (see `server.js` → `BUNDLE_FILES`, `buildAppBundle`). `SDGMart.html` loads just React + `/app.bundle.js` + `/data/products.js`.
- **Backend:** Node/Express (`server.js`), single process.
- **DB:** Supabase (Postgres) via `@supabase/supabase-js` using the **service_role key** (bypasses RLS). All DB access is in `database.js` (async methods, snake_case↔camelCase mapping via `rowIn`/`rowOut`).
- **File storage:** Supabase Storage bucket `product-photos` (product images, compressed client-side to ~900px JPEG before upload).
- **Maps:** Leaflet + **OpenStreetMap tiles** for display; **LocationIQ** for search + reverse-geocoding (key in `window.LOCATIONIQ_KEY`, falls back to Nominatim if unset). See `components/MapPicker.jsx` (`sdgMapTileLayer`, `sdgGeocoder`).
- **Payments:** **Paystack** (card + mobile money). Inline v2 popup → server `init`/`verify`/`webhook`. See §6.
- **Email:** Resend (optional; only used for password reset now — signup verification was removed).
- **Push:** Web Push (VAPID). `sw.js` handles `push`/`notificationclick`.
- **PWA:** `manifest.json`, `sw.js`. **Bump `CACHE_NAME` in `sw.js` on every deploy** (currently `sdgmart-v39-...`).

### Client globals injected by `/data/products.js`
`window.PRODUCTS`, `CATEGORIES`, `ESSENTIALS`, `NEIGHBORHOODS`, `TOP_IDS_BY_ORDERS`, `SHOW_FRESHNESS`, `LOCATIONIQ_KEY`, `PAYSTACK_PUBLIC_KEY`, `PROMO_MAP` (set by App.jsx), and helper `window.orderCode(id)` → `SDG-00017` (from `hooks.js`).

## 3. Environment variables (Render → Environment, and local `.env`)

`.env` is gitignored; `.env.example` documents them. Required/used:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — **required**
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — web push
- `LOCATIONIQ_KEY` — maps/geocoding (publishable; domain-restricted in LocationIQ dashboard)
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` — payments (online pay option only shows when BOTH are set; `/api/paystack/config` reports `enabled`)
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — optional email
- `GOOGLE_CLIENT_ID` — optional Google sign-in (set OAuth consent screen to "In production" to avoid the 100-user cap)
- `NODE_ENV` — not required (bundle caching is mtime-based)

**Server reads `.env` from its own dir** (`require('dotenv').config({ path: __dirname + '/.env' })`) so it works regardless of cwd.

## 4. Supabase SQL files — run in this order (idempotent, safe to re-run)
1. `supabase-schema.sql` (base tables; RLS enabled)
2. `supabase-schema-additions.sql` (addresses, reviews, issue_reports, promotions, user/product columns)
3. `supabase-schema-requests.sql` (product_requests)
4. `supabase-schema-ops.sql` (users.referral_count, error_logs)
5. `supabase-rls-fix.sql` (enable RLS everywhere)
6. `supabase-schema-paystack.sql` (orders.paid, orders.paystack_ref, pending_payments)
7. **`supabase-schema-referrals.sql`** ← **USER STILL NEEDS TO RUN THIS** (users.referred_by, referral_credited, referrals table)

## 5. Day-to-day workflow
1. Edit files locally.
2. Validate the bundle compiles:
   `node -c server.js && node -c database.js` and an esbuild transform of all `BUNDLE_FILES` (see git history for the one-liner).
3. Verify in the Claude **preview tool** (`preview_start` name `sdgmart`, runs `node server.js` on the local `.env`). Note: locally Paystack shows `enabled:false` (no keys) and LocationIQ falls back to OSM — that's expected.
4. **Bump `CACHE_NAME` in `sw.js`.**
5. Commit (author: `solomonowusuoa@gmail.com`, co-author line per house style) and `git push`.
6. Render auto-deploys (~2 min). Hard-refresh (Ctrl+Shift+R) to clear the service worker.

**GitHub auth:** the stored token has expired before. If push fails with "Invalid username or token", create a classic PAT with `repo` scope and `git remote set-url origin https://USER:TOKEN@github.com/Solomonowusuoa/SDGMart.git`.

## 6. Paystack flow (how it works)
- Checkout shows **"Pay Now (Card/MoMo)"** (if `enabled`) and **Cash on Delivery**.
- `POST /api/paystack/init` → server calls Paystack initialize (amount locked, pesewas, GHS), stashes the order draft in `pending_payments`, returns `access_code`.
- Client opens `js.paystack.co/v2/inline.js` popup → `resumeTransaction(access_code)`.
- `onSuccess` → `POST /api/paystack/verify` → server verifies, then `createOrderFromBody(... paid:true, paystackRef)` (idempotent). 
- `POST /api/paystack/webhook` (HMAC-SHA512 verified using `req.rawBody`) is the safety net if the customer's tab closes.
- **Going live:** REPLACE test keys with `sk_live_`/`pk_live_` (same var names), set the webhook URL to `https://sdgmart.onrender.com/api/paystack/webhook`, ensure the Paystack account is **activated** and a settlement account is set.

## 7. Order model notes
- Real order id is a Postgres bigserial. Displayed everywhere as **`SDG-<id>`** via `window.orderCode(id)`.
- Tracking uses the numeric id (`/api/orders/:id/tracking`). `createOrderFromBody` ignores any client-sent `id`.
- New orders are `status: 'queued'`, unassigned. **Riders only see orders the admin assigns** (`/api/admin/orders/:id/assign`). Riders see `forRider` (assigned/in_transit only).
- First order (signed-in) → free delivery, then sets `first_order_done`, and credits the referrer (see §8).

## 8. Referrals & leaderboard (current behaviour)
- Signup with a code stores `referred_by` (NO immediate credit).
- On the referee's **first order**, `db.referrals.creditFirstPurchase` gives the referrer **GHS 5** loyalty + logs a row in `referrals` tagged with `YYYY-MM`.
- Leaderboard is **monthly** (`db.leaderboard.topReferrers` counts current-month `referrals`). `db.leaderboard.awardLastMonthWinner` (called opportunistically from `/api/leaderboard`) gives last month's top referrer **GHS 15**, idempotent via `app_config` key `leaderboard_awarded_month`.
- All credit lands in one `loyalty_balance` (shown as the ⭐ pill + checkout toggle).

## 9. Admin panel (`components/AdminPage.jsx`) tabs
Overview, **Dashboard** (revenue/orders charts — inline SVG, no chart lib), Orders (filter/search/assign-rider/delete, PAID vs COLLECT badge), Inventory (photo upload + low-stock threshold), Expiry, Routes, Riders (create rider accounts), Promotions (create/publish flash sales → push), Requests (product requests), Issues (problem reports), Analytics (search queries), Leaderboard, Comms, Errors (server + client crash logs), Settings (freshness toggle), Security. *(Payments tab was removed.)*

## 10. Recently fixed (context for "why")
- **Orders silently failing yesterday:** Paystack code wrote `paid`/`paystack_ref` before `supabase-schema-paystack.sql` was run → every insert failed (no orders saved, counter frozen, first-order-free never cleared). Fixed once SQL ran. An **error boundary** (App.jsx `AppErrorBoundary`) + `/api/client-error` logging now surface such issues in the admin Errors tab instead of blanking the page.
- Tracking dead-end (random code mismatch), back-button-exits (SPA history), blank LocationIQ map (now OSM tiles), email-verification removed, order codes unified.

## 11. OPEN / PENDING — start here next session
0. **Custom domain migration (`sdg-mart.com`)** — connect the domain everywhere per §13. Domain bought on Cloudflare. NO code change needed.
1. **➡️ NEXT MAJOR STEP: Google OAuth verification.** Now that a real domain exists, do brand verification so the sign-in consent screen shows the SDGMart name/logo with no "unverified app" warning. Requirements: (a) `sdg-mart.com` verified in **Google Search Console** (add the TXT record Google gives you into Cloudflare DNS); (b) a **privacy policy page** hosted on `sdg-mart.com` (ask the assistant to generate one — it can add a `/privacy` route/page); (c) homepage URL = `https://sdg-mart.com`; (d) app name, logo (square ~120px SDG mark), support email, developer contact email on the OAuth consent screen. Basic scopes only = light review, usually approved in days (no security assessment/demo video needed). Submit from Google Cloud Console → OAuth consent screen → "Publish/Prepare for verification".
2. **Run `supabase-schema-referrals.sql`** in Supabase (required for §8 to work) — if not already done.
3. **Swap Paystack to live keys** + set webhook to `https://sdg-mart.com/api/paystack/webhook` + confirm account activated.
4. **Verify post-deploy:** place a test order → appears in admin Orders with `SDG-` code + PAID/COLLECT badge; "Track" works; back button doesn't exit; admin refresh doesn't blank.
5. **Clarify & implement "admin dashboard items clickable to their pages"** — target was ambiguous (Dashboard top-products list? KPI cards? inventory rows?). Ask which items and where they should link.
6. **Deferred backlog** (see memory `project_sdgmart_deferred.md`): WhatsApp Cloud API store-bot; **recurring-orders cron** (data + UI exist, but NO job actually places due orders — `recurring_orders.next_run_at`); more push-subscribe prompts; saved cart/wishlist; phone/SMS login; neighborhood social proof; 2FA admin; audit log; Sentry (SENTRY_DSN hook ready); Dagbani/Twi i18n.

## 12. Free-tier ceilings (when to pay)
- Resend (100/day) — first to hit if order-confirmation emails are added.
- Supabase egress 5GB/mo — product images (already compressed); DB 500MB.
- LocationIQ 5,000 geocodes/day (generous).
- Render free: 512MB/slow CPU, kept awake by **UptimeRobot** pinging `/healthz`.
- Roughly ~$50/mo total once busy (Render $7 + Supabase $25 + Resend $20).

## 13. Custom domain migration — `sdg-mart.com` (Cloudflare)
No code changes needed; all external config. Do in this order:
1. **Render** → Settings → Custom Domains → add `sdg-mart.com` + `www.sdg-mart.com`. Render shows the DNS record(s) to create.
2. **Cloudflare** → DNS → add the records Render gave (root usually CNAME→`sdgmart.onrender.com` with flattening, plus `www`). Set proxy to **DNS only (grey cloud)** to avoid the Cloudflare↔Render SSL loop (or use SSL mode Full(strict) if proxied). Render then issues SSL → `https://sdg-mart.com` live.
3. **LocationIQ** → token → Allowed Origins → add `https://sdg-mart.com` + `https://www.sdg-mart.com` (keep onrender). *Maps/search break on the new domain without this — the key is domain-restricted.*
4. **Paystack** → webhook URL → `https://sdg-mart.com/api/paystack/webhook`.
5. **UptimeRobot** → monitor URL → `https://sdg-mart.com/healthz`.
6. **Resend** → add domain `sdg-mart.com` → add its SPF/DKIM/DMARC records in Cloudflare → verify → set Render env `RESEND_FROM_EMAIL=SDGMart <noreply@sdg-mart.com>`.
7. **Google OAuth** → Credentials → Authorized JavaScript origins: add `https://sdg-mart.com` + `https://www.sdg-mart.com`; consent screen → Authorized domains: `sdg-mart.com`. (Then proceed to §11.1 verification.)
- Keep `sdgmart.onrender.com` active throughout; both URLs serve the same app. Existing web-push subscriptions are tied to whichever origin the user subscribed on.

---
*Last updated after buying domain `sdg-mart.com` (commit after `e452ef6`). Bump this doc as things change. Next major step: Google OAuth verification (§11.1).*
