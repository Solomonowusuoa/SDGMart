# Store bundles

Implemented 2026-09-23. Deployment is a separate step after the local commit.

The homepage replaces the old seven-product Essentials section with three bundle groups below individual products and immediately above Shop by Category. Each variation has fixed contents and its own product page. Extra products stay separate in the cart.

| Bundle | Separate total (GHS) | Saving (GHS) | Bundle total (GHS) |
| --- | ---: | ---: | ---: |
| Breakfast Basics | 89.50 | 5 | 84.50 |
| Breakfast Favourites | 226.00 | 10 | 216.00 |
| Family Breakfast | 387.50 | 15 | 372.50 |
| Everyday Home | 131.00 | 5 | 126.00 |
| Family Home | 327.00 | 10 | 317.00 |
| Cooking Basics | 186.50 | 5 | 181.50 |
| Everyday Cooking | 246.00 | 10 | 236.00 |
| Family Cooking | 382.50 | 15 | 367.50 |

These totals reflect the catalogue at implementation. Product price changes in Inventory automatically change bundle prices while preserving the fixed saving. Remie is one inventory pack containing 12 sachets, currently GHS 12; its price still needs owner confirmation. Family Breakfast uses Nutella and six Ideal 160g tins. Family Home includes Savlon 500ml.

All three cooking bundles use one Tasty Tom Tomato Mix 1.05kg pack (#228). Cooking Basics replaces its former two 200g packs with this one larger pack; savings remain GHS 5, 10 and 15 respectively.

## Administration and data

- Admin → Bundles edits contents, pack quantities, saving, description, optional custom image URL, and availability.
- Defaults live in `bundles.js`; saved overrides use the existing `app_config` table under `store_bundles`. No new SQL migration is required.
- Order pricing is verified on the server. Product promotions and squad discounts do not stack on bundle lines. Loyalty credit can still be redeemed.
- Orders store component quantities and allocated prices in integer pesewas, with bundle metadata. Stock deduction, reservation, cancellation and packing therefore use real product IDs. Reordering reconstructs complete bundles at current prices.
- Changes to bundle versions or prices require the customer to refresh the cart before checkout.
- The catalogue snapshot marks Jollof Mix 210g (#222) out of stock, making Everyday Cooking and Family Cooking unavailable until its stock setting is updated. Cooking Basics no longer depends on the out-of-stock Tasty Tom 200g (#227). No production stock was changed.

## Images and request footer

Bundle pictures are white-background collages of the actual member product photos, rendered in the site. They update when the contents change; quantities are explicitly listed on each bundle page. Group cards identify which variation is pictured.

The Breakfast, Tea & Coffee category uses `icons/categories/breakfast-tea-coffee.png`, created with the built-in image generation tool. Image brief: a natural breakfast scene with coffee, tea, cornflakes, oats and chocolate-spread toast on a wooden table in daylight, with room for the category caption.

Request an Item now appears below products on category pages and search results, including empty results. Search text prefills the existing multiline request form.

## Validation

All eight automated suites passed, covering exact bundle totals, quantity allocation, stock aggregation with separate products, promotions, admin validation and stale versions, reorders and paid webhook snapshots. All JSX files compile and `git diff --check` passes.

Browser checks used an isolated local server with a mock database and public catalogue photos: homepage placement, variation selection, Family Breakfast contents, mobile cart, category/search request footer and prefill, and successful Admin bundle save. No production orders, payments or catalogue writes were made.
