# SDGMart — Handoff / Continuation Guide

A same-day grocery web app for Tamale, Ghana. This doc lets a new chat (or you) pick up exactly where we left off. Read this top-to-bottom once, then keep it as reference.

---

## ⭐ LATEST STATE — resume here (updated 2026-07-12)
> §1–§13 below are still accurate; this block is the current front line. `sw.js` CACHE_NAME = `sdgmart-v61-tracking-codes`.
- **Portable tracking codes (2026-07-12), all verified:** success screen shows a save-me box with the full code `SDG-<id>-<20-hex-token>` + Copy button; the "Send Order to My WhatsApp" message now appends the code + live-track link; the guest Track Your Order page has a "Have a tracking code?" input that works on ANY device (validates against the server, remembers locally, opens live tracking; bad codes rejected); shared `/?track=<id>&t=<token>` links work on fresh devices and self-save; per-order "📋 Code" copy buttons. **Codes expire 7 days after delivery** (410 + friendly message) — exact via `orders.delivered_at` (new migration §4.9, stamped by `db.orders.setStatus`), falling back to delivery_date+1d. Guest "Track this order" button on the success screen now shows for guests too.
- **UX batch (2026-07-12), all verified in preview:** stock level hidden on ProductPage (low-stock shows "Almost sold out", no number); related products clickable (App passes `onView` to ProductPage); **Suggested for You is now real** (signed-in: frequency-ranked from own /api/me/orders; others see "Popular right now" from TOP_IDS_BY_ORDERS — was hardcoded ids [5,13,17,29]); footer: "Track Order & Delivery"→orders page, Returns→/terms#returns, About→/about (only WhatsApp/Contact still open WhatsApp); **guest order tracking** — HMAC track token (`orderTrackToken(id)`, derived from SUPABASE_SERVICE_KEY, no schema change) returned by createOrderFromBody, saved in localStorage `sdgmart_guest_orders` (max 10), tracking endpoint accepts `?t=` (401 without/with bad token), MyOrdersPage shows guests their device-local orders ("Track Your Order" view); **compact checkout step 1** — with a saved default/last-used address only name+phone show plus a "Delivering to <label>" card with "Change / add details" (expands full form; family mode always expands); cart: "Clear all" button in drawer + cart persists in localStorage `sdgmart_cart` across reloads AND sign-out; search: live (first keystroke jumps to filtered grid), ✕ clear button, auto-clears on opening a product.
- **Catalog caching (2026-07-12):** `/data/products.js` (loaded by every visitor, was ~700ms + 2 Supabase queries per request, server buckled at 20 concurrent) is now cached in memory for 60s (`_catalogCache` in server.js); admin product create/update/delete + settings save call `invalidateCatalog()` so edits appear immediately. Load-tested after: ~4,100 req/s at 50 connections, 10ms median, zero errors. ⚠️ Single-process cache — fine on one Render instance; revisit if ever scaled to multiple instances.

### SPA routing + Google Analytics (2026-07-12)
- **Google Analytics is live** — gtag (`G-D6LK26XSY0`) is in `SDGMart.html` `<head>` (user added). ⚠️ **NOT yet on `about.html`/`privacy.html`/`terms.html`** — offered, user hasn't confirmed adding it there.
- **The SPA now uses real URLs** (App.jsx `PAGE_PATHS`/`PATH_TO_PAGE`, `navigateTo` pushes real paths + fires `trackPageView` GA4 page_view): `/`, `/shop`, `/checkout`, `/squad`, `/my-orders`, `/account`, `/product`, `/cart`, `/track`, `/admin`. Order success → **`/order-confirmed`** (via `onOrderPlaced`/`markOrderConfirmed`) = the address to use as the **Google Ads conversion**.
- `server.js` has a catch-all (`app.get('*')`) serving the app shell for client routes (refresh/deep-link safe); API + real files fall through.
- **Fixed latent bug:** `SDGMart.html` loaded `data/products.js` + `responsive.css` via RELATIVE URLs → 404 + white-screen crash on deep paths → made absolute. (If a white screen with "Cannot read properties of undefined (reading 'map')" ever recurs, suspect a relative asset URL.)
- Verified end-to-end in preview: catch-all, cold-load deep paths load data, per-section page_views, `/order-confirmed` fires once on a real order, back button. NOT eyeballed: GA Realtime dashboard (needs live deploy).
- **GA4 `purchase` event DONE (2026-07-12):** `trackPurchase(snap, code)` in `CheckoutPage.jsx` fires on order success (both COD + Paystack, via `finishOrder`) → gtag `purchase` with `transaction_id`=SDG order code, `value`=order total (incl. delivery), `currency`=GHS, `shipping`, and `items[]` (item_id/name/category/price/quantity). Verified in preview: fires once on real order, correct fields. No double-count on refresh (/order-confirmed cold-loads to home). **User's GA setup TODO:** mark `purchase` as a Key event in GA4 + import to Google Ads (this is the accurate revenue conversion; the /order-confirmed page_view still works as a backup destination conversion).

### Shipped & live (previous session)
- **Feature 1 — Profile:** "👤 My Profile" added to the mobile menu (page existed but was unreachable); **birthday** (day+month) captured **once then locked** (server-enforced in `/api/me/profile`); a user's **first saved address auto-becomes default**; checkout **auto-fills** name/phone + the default address.
- **Feature 3 — Scheduled delivery:** checkout has a **"Deliver ASAP vs Schedule for later"** toggle → future date (≤7 days) + an **admin-editable time slot**; `createOrderFromBody` validates the 7-day window; admin + rider cards show the slot; slot editor in Admin → Settings; public `GET /api/delivery/slots`.
- **Feature 2 — Birthday gifts (⚠️ built + live but STILL OFF):** Admin **"🎂 Birthday Gifts"** tab = enable toggle + product multi-select (→ `app_config.birthday_gifts`). In a customer's **birth month** they add **one free gift** at checkout (server-validated, **once/year**). Daily happy-birthday **push** via `runDailyJobs()` fired from `/healthz`. **NEXT ACTION (user):** Admin → 🎂 Birthday Gifts → toggle ON + pick 2–3 products + Save → then run the final end-to-end gift check (test customer has a June birthday).
- **5 UX fixes:** add-address marks **Label*/Neighborhood*** required; **delivered orders** show a thank-you + "Order again" (no stale map/notify) on `OrderTrackingPage`; **track page** shows the chosen slot + delivery date; report success says **"We'll reach out soon"**; **admin overview crash FIXED** (it rendered the raw `items` array → React crash; now a summary string, 10 recent rows) + **"Sign out & restart"** on the error screen.
- **Security + perf code review — all 10 findings + 2 follow-ups fixed & deployed:**
  1. **CRITICAL — server-authoritative pricing.** `computeOrderPricing(reqUser, body)` recomputes item prices (DB) + promos + squad discount + loyalty(capped) + delivery + total. Both `/api/paystack/init` (charge amount) and `createOrderFromBody` (stored order) use it — **client `price`/`total`/`amount` no longer trusted** (was: pay GHS 0.01 for any cart).
  2. `express.static(__dirname)` no longer serves source/docs (deny-middleware 404s `/server.js`, `/database.js`, `*.md`, `*.sql`, `package.json`, `/components/*`). 3. Riders blocked from `/api/me/*` (`customerOnly`) — was overwriting the customer with the same id. 4. 5-min cache (`getOrderItemCounts`) for the per-pageload top-seller scan. 6. gift claim set **after** create. 7. exported `db.rowOut/rowsOut`. 10. `ensureIcons` writes only missing files.
  - **Stock-decrement admin toggle** (`app_config.deduct_stock`, Admin → Settings, **OFF by default** — turn ON only when SDGMart holds its own stock; partners supply now).
  - Follow-ups: `/api/orders` bounded to recent **500** (`?limit`); **CORS locked** to `sdg-mart.com`/`www`/`sdgmart.onrender.com`; removed duplicate **"Kalpohini"** (kept "Kalpohin").
- **New migration run:** `supabase-schema-tweaks.sql` (birthday cols, `orders.delivery_slot`, `app_config` seeds) — applied in Supabase.

### 🟡 IN PROGRESS — catalog population (the active task)
User chose a **full wipe** of placeholder products → load the real catalog → then attach images.
- **Research delivered:** `C:\Users\Solo\Downloads\SDGMart-catalog-research.csv` — **254 Ghanaian grocery products, 16 categories**, from konzoom.shop et al.
- **✅ Triage workbook built (2026-07-12):** `C:\Users\Solo\Downloads\SDGMart-catalog-triage.xlsx` — Catalog sheet (Y/N dropdowns for Keep?/Bestseller?, pre-guessed Unit column, optional Image URL column, autofilter) + READ ME sheet (instructions, example row, live kept-count counters). **NEXT ACTION (user): fill the Keep? column** (adjust prices/units, add missing rows), hand it back.
- **✅ Import script built + dry-run tested (2026-07-12):** `scripts/import-catalog.js`. Usage: `node scripts/import-catalog.js <catalog.csv> [--wipe] [--dry-run] [--stock 100] [--images-dir <dir>]`. Reads a CSV export of the triage sheet (Claude converts the xlsx → CSV); imports only Keep=Y rows; `--wipe` required for full replace (refuses if products exist without it); default stock 100 (stock 0 shows "Sold out"); images from Image URL / local `--images-dir` (matched by row# or name slug), compressed to 900px JPEG via optional `sharp` (`npm i --no-save sharp`) using `db.uploadProductPhoto` + `db.products.create`. Aborts on invalid rows; prints the final category list at the end.
- **Images:** source **manufacturer-first** photos for the kept set (copyright caveat given; user does final review — inherently imperfect, candidates + cleanup).
- **Hardening:** the source-file deny middleware in `server.js` now also 404s `/scripts/*` (CACHE_NAME → `sdgmart-v50-scripts-deny`).
- ⚠️ **After a full replace:** update the app's **category list** (currently 9, hardcoded in `server.js` `categories` array) to the final set, and **re-point `ESSENTIALS`** (hardcoded product ids in `server.js` ~line 349) since ids change on reinsert. Then bump CACHE_NAME + deploy.

### Shipped 2026-07-12 (this session; CACHE_NAME `sdgmart-v52-feedback-retention`)
- **First-order free delivery ≥ GHS 50 + persistent perk** (see §7) — small first orders no longer consume it; referral credit now fires on the first *qualifying* order.
- **FeedbackBox** (`components/FeedbackBox.jsx`): "Spotted a problem? Tell us." card in the HomePage footer + Account page — in-app send (`POST /api/feedback`, rate-limited 5/10min) lands in Admin → Issues as "💬 General feedback (from <name>)"; WhatsApp button always available. Migration run + **verified end-to-end 2026-07-12** (insert → admin join with sender name → test row cleaned up).
- **Admin → 🔁 Retention tab**: `GET /api/admin/retention` (last-6-months active/returning/new + rate; lapsed = no order in 30+ days, capped 500) + `POST /api/admin/retention/notify` (win-back push, editable message, only reaches 🔔 push subscribers). Logic verified read-only against prod data; **tab UI not yet eyeballed (needs admin login)**.

### Still pending at launch
✅ Paystack LIVE keys active (verified on prod 2026-07-12: `pk_live_`, enabled; webhook already → sdg-mart.com since §11.0 — confirm account activation + settlement bank + do one small real payment test). ✅ referrals SQL confirmed run. Remaining: Enable Birthday Gifts (above; note test customer's June birthday has passed — set a July birthday on a test account to e2e-test) · **Cloudflare orange-cloud flip** (Full-strict first, then purge cache each deploy — §13) · GA4: mark `purchase` as Key event + import to Google Ads · eyeball Admin → 🔁 Retention tab (built, needs admin eyes) · post-deploy smoke test incl. **real iPhone test** (Paystack popup, Google sign-in, install, tracking) · Render Starter + Supabase Pro upgrades right before launch · clean **test data** in Supabase (throwaway customers `sdgtest-…@example.com` userId 6 and `sdgtest-firstorder@example.com` userId 9 + its address + test orders ~ids 20–23) · ⚠️ recommended pre-launch code item: **recurring-orders cron** (customers can enable auto-reorder but NO job places due orders).

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
7. **`supabase-schema-referrals.sql`** ✅ confirmed run (verified 2026-07-12: referrals table + users.referred_by exist)
8. **`supabase-schema-feedback.sql`** ✅ run 2026-07-12 (issue_reports.order_id nullable; general FeedbackBox verified end-to-end)
9. **`supabase-schema-delivered-at.sql`** ✅ run 2026-07-12 (orders.delivered_at — exact tracking-code expiry + fixes "Completed at" on the tracking page)

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
- First order (signed-in) → free delivery **only when the order is ≥ GHS 50** (`FIRST_ORDER_FREE_MIN`, after squad discount + loyalty; mirrored in `server.js` `computeOrderPricing` and `CheckoutPage.jsx`). **The perk persists**: `first_order_done` is set only when a qualifying (≥50) order is placed, so small first orders don't burn it. Referral credit rides the same flag → the referrer is credited on the referee's first **qualifying** order (also blocks GHS-1 referral farming). Guests can never get it (no session → `reqUser` null on every path).

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
0. ✅ **DONE (2026-06-18) — Custom domain migration (`sdg-mart.com`).** All 7 external configs done per §13: Render custom domains; Cloudflare grey-cloud CNAMEs (`@` + `www` → `sdgmart.onrender.com`); LocationIQ origins; Paystack webhook → `https://sdg-mart.com/api/paystack/webhook`; UptimeRobot kept on onrender `/healthz`; Resend domain verified (`RESEND_API_KEY` + `RESEND_FROM_EMAIL=SDGMart <noreply@sdg-mart.com>` set on Render); Google OAuth JS origins. Live at `https://sdg-mart.com` (cert issued; www→apex 301). `sdgmart.onrender.com` still active. Code unchanged (domain-agnostic).
1. ✅ **DONE (2026-06-18) — Google OAuth brand verification APPROVED.** Unverified-app warning gone, 100-user cap lifted. Search Console domain verified via the Google↔Cloudflare auto-integration (root TXT `google-site-verification=yOXxtnZiB8kVlHrueoBG-JuYPMUMtM8vdkFxadW9xFE` — **do NOT delete**). Consent screen: name/logo (`icons/icon-512.png`)/support+dev email; homepage = `https://sdg-mart.com/about`, privacy = `/privacy`, terms = `/terms`. First submission rejected (homepage was behind the login wall + didn't explain purpose/Google data) → fixed by adding the public **/about** landing page → resubmitted → approved.
   - **New static pages added this session:** `about.html` (`/about`, public homepage that explains purpose + Google Sign-In data usage), `privacy.html` (`/privacy`), `terms.html` (`/terms`); routes in `server.js`; footer "Privacy"/"Terms" links in `components/HomePage.jsx`. `sw.js` CACHE_NAME now `sdgmart-v44-about-tweak`. These are server-rendered standalone pages (NOT in the React bundle) so Google's reviewers fetch real HTML.
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
5. **UptimeRobot** → keep the keep-awake monitor on `https://sdgmart.onrender.com/healthz` (hits Render directly — immune to the future orange-cloud flip, where a cached `/healthz` on `sdg-mart.com` could be answered by Cloudflare's edge and never wake Render). Optionally add a *second* monitor on `https://sdg-mart.com/healthz` to alert on public-domain (DNS/cert/Cloudflare) failures.
6. **Resend** → add domain `sdg-mart.com` → add its SPF/DKIM/DMARC records in Cloudflare → verify → set Render env `RESEND_FROM_EMAIL=SDGMart <noreply@sdg-mart.com>`.
7. **Google OAuth** → Credentials → Authorized JavaScript origins: add `https://sdg-mart.com` + `https://www.sdg-mart.com`; consent screen → Authorized domains: `sdg-mart.com`. (Then proceed to §11.1 verification.)
- Keep `sdgmart.onrender.com` active throughout; both URLs serve the same app. Existing web-push subscriptions are tied to whichever origin the user subscribed on.
- **LAUNCH-TIME FOLLOW-UP — switch Cloudflare DNS records to proxied (orange cloud).** Currently DNS-only (grey) for a clean setup + testing. At launch, to gain Cloudflare CDN caching + DDoS protection + origin-IP hiding: **(1) FIRST** set Cloudflare → SSL/TLS → Overview → **Full (strict)** (Render serves a valid cert, so this is safe); **(2) THEN** flip both records (`@` and `www`) to orange. ⚠️ Flipping to orange while SSL mode is "Flexible" = infinite redirect loop (site down). ⚠️ After going orange, **purge Cloudflare cache after every deploy** (or add a cache rule that bypasses the HTML + `/app.bundle.js` + `/data/products.js`), otherwise users get the stale bundle even after bumping `sw.js` CACHE_NAME.

---
*Last updated 2026-06-18 (commit `e70bf4d`): domain migration COMPLETE + Google OAuth verification APPROVED; added public /about homepage + /privacy + /terms pages. Remaining open: run `supabase-schema-referrals.sql` (§11.2); swap Paystack to live keys + activate account (§11.3); post-deploy test order (§11.4); launch-time Cloudflare orange-cloud flip (§13). Bump this doc as things change.*
