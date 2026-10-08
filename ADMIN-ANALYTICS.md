# Admin customers and analytics

The Customers tab lists current `users` rows with `role = customer`, including
people with no orders. Search matches literal text in name, email, or phone.
Results are paginated (25 per page) and sortable by registration date or name.
Both the directory and dashboard require the existing admin guard, including
its mandatory password-change check. Directory reads use the existing PII
audit log. Responses are `no-store`; authentication fields are never selected.

## Metric definitions

The dashboard uses 7, 30, or 90 **calendar days including today**, in
`BUSINESS_TZ` (default `Africa/Accra`). Today is partial. The comparison is the
preceding N complete calendar days, so it is not an equal-hours comparison.
Order metrics use **placement date and current status**. Delivery later changes
the metrics for the original placement period. These are operational readouts,
not immutable financial statements or historical snapshots.

| Metric | Definition and operating use |
| --- | --- |
| Registered customers | Current customer accounts, excluding admins and deleted accounts. The number links to the directory. |
| New registrations | Current customer accounts created in the selected period. Daily bars and the preceding-period count help identify growth changes. Deletions remove registrations from history. |
| First-purchase conversion | Current customers with at least one delivered order at any time / all current customers. A lifetime activation measure, not a registration-cohort or visit conversion rate. |
| Yet to purchase | Current customers with no delivered orders; includes those with only pending or cancelled orders. Indicates how many accounts have not completed a purchase. |
| Active buyers | Distinct current customers with delivered orders placed in the period. Measures purchasing, not logins or visits. |
| First-time buyers | Active buyers whose earliest currently delivered order was placed within the selected period. Two orders in that period still count as one first-time buyer. |
| Returning buyer share | Active buyers whose earliest currently delivered order predates the period / all active buyers. A repeat-buyer mix measure, not cohort retention. |
| Cancellation rate | Currently cancelled orders placed in the period / all orders placed in the period. Recent orders can still change status. |
| Delivered revenue | Sum of delivered order totals, including delivery fees and after discounts/loyalty credit. Includes orders whose account was deleted or is not a customer. Does not model refunds, settlement, costs, or profit. |
| Average order value | Delivered revenue / delivered orders. Uses the same population as revenue; formerly included pending orders. |
| Orders | Placed orders excluding cancellations. The status breakdown also includes cancellations. |
| Top products/categories | Quantity in delivered orders placed in the period. Categories absent from stored order items are not inferred from today's catalogue. |
| Active auto-reorders | Current active recurring-order schedules, independent of the selected period. |

Rates with no denominator display a dash. A percentage change from a zero
baseline displays “No baseline”; it is never reported as infinite growth.
Customer directory spend sums delivered order totals over retained history;
its order count and last-order date exclude cancellations.

## Data and verification

`database.js` reads `users`, `orders`, and `recurring_orders`; calculations live
in `admin-analytics.js`. All history reads use ID keyset pagination until an
empty page, including when the database's row cap is below the requested page
size. Any source error fails the whole result rather than substituting zero.
Only the selected customers' order summaries are loaded for a directory page;
the dashboard reads minimal historical order columns and recent item payloads.
No new columns or migrations are required.

Reads span separate database requests and are not a transactionally consistent
snapshot. At substantially higher order volume, move the same definitions to
database-side aggregates rather than reintroducing fixed row limits.

`npm test` includes `tests/admin-analytics.test.js` and
`tests/admin-customers-api.test.js`. They cover first-purchase attribution,
calendar boundaries, timezone grouping, empty denominators, safe search,
no-order customers, cancellation exclusions, projections, over 1,000 records,
query failures, and admin authorization. UI verification uses synthetic data;
it does not require access to production customer records.

Metrics needing additional evidence should be added with that instrumentation:
checkout abandonment requires linked checkout-start/completion events;
customer acquisition cost requires attributed marketing spend; margin requires
historical item costs and fulfilment expenses. Existing records cannot supply
trustworthy values for these, so the dashboard does not invent them.
