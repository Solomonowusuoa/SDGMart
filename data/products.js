// SDGMart Product Data
const PRODUCTS = [
  // Cereals
  { id: 1, name: "Quaker Oats", category: "Cereals", price: 32.50, unit: "1kg", bestBefore: "2026-12-01", stock: 48, img: null, description: "Wholesome rolled oats, great for breakfast porridge.", bestseller: true },
  { id: 2, name: "Milo Cereal", category: "Cereals", price: 28.00, unit: "500g", bestBefore: "2026-10-15", stock: 30, img: null, description: "Malted chocolate cereal loved by kids and adults." },
  { id: 3, name: "Tom Brown", category: "Cereals", price: 18.50, unit: "1kg", bestBefore: "2026-11-20", stock: 60, img: null, description: "Traditional Ghanaian roasted grain porridge mix.", bestseller: true },
  { id: 4, name: "Weatabix", category: "Cereals", price: 22.00, unit: "430g", bestBefore: "2026-09-30", stock: 25, img: null, description: "Whole wheat biscuits — filling and nutritious." },

  // Dairy
  { id: 5, name: "Peak Milk (Tin)", category: "Dairy", price: 38.00, unit: "400g", bestBefore: "2027-03-01", stock: 55, img: null, description: "Full cream evaporated milk, rich and creamy.", bestseller: true },
  { id: 6, name: "Cowbell Milk", category: "Dairy", price: 15.00, unit: "400g", bestBefore: "2026-12-10", stock: 40, img: null, description: "Fortified powdered milk for the whole family." },
  { id: 7, name: "Yoghurt (Strawberry)", category: "Dairy", price: 12.00, unit: "200ml", bestBefore: "2026-05-20", stock: 20, img: null, description: "Fresh cultured yoghurt, chilled and creamy." },
  { id: 8, name: "Fan Ice Vanilla", category: "Dairy", price: 5.00, unit: "100ml", bestBefore: "2026-06-01", stock: 80, img: null, description: "Classic Ghanaian fan ice cup, vanilla flavour." },

  // Detergents
  { id: 9, name: "Omo Washing Powder", category: "Detergents", price: 45.00, unit: "2kg", bestBefore: "2027-06-01", stock: 35, img: null, description: "Powerful stain-removing washing powder.", bestseller: true },
  { id: 10, name: "Key Soap", category: "Detergents", price: 8.50, unit: "200g", bestBefore: "2027-01-01", stock: 100, img: null, description: "Traditional all-purpose bar soap for laundry." },
  { id: 11, name: "Dettol Hand Wash", category: "Detergents", price: 22.00, unit: "250ml", bestBefore: "2027-08-01", stock: 42, img: null, description: "Antibacterial liquid hand wash, original scent." },
  { id: 12, name: "Ariel Liquid", category: "Detergents", price: 55.00, unit: "1L", bestBefore: "2027-04-15", stock: 18, img: null, description: "Premium concentrated liquid laundry detergent." },

  // Rice & Grains
  { id: 13, name: "Uncle Ben's Rice", category: "Rice & Grains", price: 65.00, unit: "5kg", bestBefore: "2027-05-01", stock: 40, img: null, description: "Long grain parboiled white rice.", bestseller: true },
  { id: 14, name: "Ofada Rice", category: "Rice & Grains", price: 48.00, unit: "5kg", bestBefore: "2027-04-01", stock: 30, img: null, description: "Local unpolished rice with a nutty flavour." },
  { id: 15, name: "Millet (Ground)", category: "Rice & Grains", price: 20.00, unit: "1kg", bestBefore: "2026-12-20", stock: 50, img: null, description: "Finely ground millet for TZ and porridge." },
  { id: 16, name: "Semolina", category: "Rice & Grains", price: 18.00, unit: "1kg", bestBefore: "2026-11-15", stock: 35, img: null, description: "Fine wheat semolina for light meals." },

  // Cooking Oil
  { id: 17, name: "Frytol Vegetable Oil", category: "Cooking Oil", price: 72.00, unit: "3L", bestBefore: "2026-12-31", stock: 25, img: null, description: "Refined vegetable oil for frying and cooking.", bestseller: true },
  { id: 18, name: "Gino Olive Oil", category: "Cooking Oil", price: 85.00, unit: "750ml", bestBefore: "2027-02-01", stock: 15, img: null, description: "Pure olive oil blend for healthy cooking." },
  { id: 19, name: "Groundnut Oil", category: "Cooking Oil", price: 40.00, unit: "1L", bestBefore: "2026-10-01", stock: 30, img: null, description: "Locally pressed groundnut (peanut) oil." },
  { id: 20, name: "Palm Oil (Red)", category: "Cooking Oil", price: 35.00, unit: "1L", bestBefore: "2026-09-15", stock: 45, img: null, description: "Traditional West African red palm oil." },

  // Snacks
  { id: 21, name: "Pringles Original", category: "Snacks", price: 32.00, unit: "165g", bestBefore: "2026-08-01", stock: 22, img: null, description: "Crispy stacked potato crisps, original flavour." },
  { id: 22, name: "Crackers (Cabin)", category: "Snacks", price: 12.00, unit: "200g", bestBefore: "2026-09-01", stock: 55, img: null, description: "Classic cabin biscuits, lightly salted.", bestseller: true },
  { id: 23, name: "Chin Chin", category: "Snacks", price: 15.00, unit: "250g", bestBefore: "2026-07-15", stock: 40, img: null, description: "Crunchy fried Ghanaian snack, lightly sweetened." },
  { id: 24, name: "Plantain Chips", category: "Snacks", price: 10.00, unit: "150g", bestBefore: "2026-07-01", stock: 60, img: null, description: "Crispy ripe plantain chips, locally made." },

  // Canned Foods
  { id: 25, name: "Sardines in Tomato", category: "Canned Foods", price: 18.50, unit: "125g", bestBefore: "2028-01-01", stock: 70, img: null, description: "Atlantic sardines in rich tomato sauce.", bestseller: true },
  { id: 26, name: "Corned Beef (Exeter)", category: "Canned Foods", price: 42.00, unit: "340g", bestBefore: "2028-06-01", stock: 30, img: null, description: "Premium corned beef, great for stews." },
  { id: 27, name: "Baked Beans", category: "Canned Foods", price: 25.00, unit: "400g", bestBefore: "2027-10-01", stock: 25, img: null, description: "Haricot beans in sweet tomato sauce." },
  { id: 28, name: "Tomato Paste (Gino)", category: "Canned Foods", price: 8.00, unit: "70g", bestBefore: "2027-05-01", stock: 90, img: null, description: "Concentrated tomato paste for soups and stews." },

  // Drinks
  { id: 29, name: "Coca-Cola", category: "Drinks", price: 8.00, unit: "500ml", bestBefore: "2026-12-01", stock: 100, img: null, description: "Refreshing original Coca-Cola.", bestseller: true },
  { id: 30, name: "Malta Guinness", category: "Drinks", price: 10.00, unit: "330ml", bestBefore: "2026-11-01", stock: 80, img: null, description: "Non-alcoholic malt drink, rich and nutritious." },
  { id: 31, name: "Voltic Water", category: "Drinks", price: 4.50, unit: "500ml", bestBefore: "2027-01-01", stock: 150, img: null, description: "Pure natural spring water, Ghanaian origin." },
  { id: 32, name: "Alvaro (Pineapple)", category: "Drinks", price: 9.50, unit: "330ml", bestBefore: "2026-10-20", stock: 65, img: null, description: "Sparkling pineapple-flavoured fruit drink." },

  // Desserts
  { id: 33, name: "Digestive Biscuits", category: "Desserts", price: 22.00, unit: "400g", bestBefore: "2026-10-01", stock: 30, img: null, description: "Semi-sweet wholemeal biscuits, great with tea.", bestseller: true },
  { id: 34, name: "Milo Powder", category: "Desserts", price: 45.00, unit: "400g", bestBefore: "2026-12-15", stock: 40, img: null, description: "Malted chocolate powder for hot or cold drinks." },
  { id: 35, name: "Scotch Fingers", category: "Desserts", price: 18.00, unit: "300g", bestBefore: "2026-09-01", stock: 28, img: null, description: "Buttery shortbread finger biscuits." },
  { id: 36, name: "Cadbury Chocolate", category: "Desserts", price: 28.00, unit: "100g", bestBefore: "2026-08-15", stock: 20, img: null, description: "Smooth milk chocolate bar by Cadbury." },
];

const CATEGORIES = ["Cereals","Dairy","Detergents","Rice & Grains","Cooking Oil","Snacks","Canned Foods","Drinks","Desserts"];

const ESSENTIALS = [1, 5, 13, 17, 9, 29, 25, 22, 3]; // product IDs in the essentials basket

const NEIGHBORHOODS = [
  "Tamale Central","Kalpohin","Lamashegu","Sagnarigu","Nyohini",
  "Choggu","Kalpohini","Vittin","Tishigu","Gumbihini","Jisonayili"
];

// Expose to window
if (typeof window !== 'undefined') {
  window.PRODUCTS = PRODUCTS;
  window.CATEGORIES = CATEGORIES;
  window.ESSENTIALS = ESSENTIALS;
  window.NEIGHBORHOODS = NEIGHBORHOODS;
}
