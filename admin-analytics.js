// Pure calculations shared by the admin database adapter and regression tests.
// Order metrics use placement date and current status, not payment/settlement date.
const DAY_MS = 86400000;
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const percent = (numerator, denominator) => denominator ? Math.round(numerator / denominator * 1000) / 10 : null;

function summarizeCustomerOrders(orders) {
  const summaries = new Map();
  for (const order of orders) {
    const key = String(order.userId);
    const summary = summaries.get(key) || { orders: 0, deliveredOrders: 0, totalSpent: 0, lastOrderAt: null };
    if (order.status !== 'cancelled') {
      summary.orders++;
      if (!summary.lastOrderAt || new Date(order.createdAt) > new Date(summary.lastOrderAt)) summary.lastOrderAt = order.createdAt;
    }
    if (order.status === 'delivered') {
      summary.deliveredOrders++;
      summary.totalSpent = money(summary.totalSpent + Number(order.total || 0));
    }
    summaries.set(key, summary);
  }
  return summaries;
}

function buildMetrics({ customers, orders, productOrders, activeRecurring, days, now, dayKey, timezone }) {
  // Generate calendar labels independently of the server timezone and DST.
  const today = dayKey(now);
  const calendarDay = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * DAY_MS).toISOString().slice(0, 10);
  const start = calendarDay(1 - days);
  const previousStart = calendarDay(1 - days * 2);
  const buckets = new Map(Array.from({ length: days }, (_, i) => {
    const date = calendarDay(i + 1 - days);
    return [date, { date, orders: 0, revenue: 0, registrations: 0 }];
  }));
  const registered = customers.filter(c => new Date(c.createdAt) <= now);
  const customerIds = new Set(registered.map(c => String(c.id)));
  const firstPurchase = new Map();
  const validOrders = orders.filter(o => new Date(o.createdAt) <= now);
  for (const o of validOrders) {
    if (o.status !== 'delivered' || !customerIds.has(String(o.userId))) continue;
    const id = String(o.userId);
    if (!firstPurchase.has(id) || new Date(o.createdAt) < new Date(firstPurchase.get(id))) firstPurchase.set(id, o.createdAt);
  }
  const period = (from, to) => {
    const rows = validOrders.filter(o => { const day = dayKey(new Date(o.createdAt)); return day >= from && day < to; });
    const delivered = rows.filter(o => o.status === 'delivered');
    const buyers = new Set(delivered.filter(o => customerIds.has(String(o.userId))).map(o => String(o.userId)));
    const firstTimeBuyers = [...buyers].filter(id => dayKey(new Date(firstPurchase.get(id))) >= from).length;
    const newCustomers = registered.filter(c => { const day = dayKey(new Date(c.createdAt)); return day >= from && day < to; }).length;
    const revenue = money(delivered.reduce((sum, o) => sum + Number(o.total || 0), 0));
    const cancelled = rows.filter(o => o.status === 'cancelled').length;
    return {
      placedOrders: rows.length, orders: rows.length - cancelled, delivered: delivered.length,
      revenue, aov: delivered.length ? money(revenue / delivered.length) : 0,
      cancelled, cancellationRate: percent(cancelled, rows.length), newCustomers,
      activeBuyers: buyers.size, firstTimeBuyers, returningBuyers: buyers.size - firstTimeBuyers,
      returningBuyerRate: percent(buyers.size - firstTimeBuyers, buyers.size),
    };
  };
  const totals = period(start, calendarDay(1));
  const previous = period(previousStart, start);
  const statusBreakdown = {};
  for (const o of validOrders) {
    const bucket = buckets.get(dayKey(new Date(o.createdAt)));
    if (!bucket) continue;
    statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1;
    if (o.status !== 'cancelled') bucket.orders++;
    if (o.status === 'delivered') bucket.revenue = money(bucket.revenue + Number(o.total || 0));
  }
  for (const customer of registered) {
    const bucket = buckets.get(dayKey(new Date(customer.createdAt)));
    if (bucket) bucket.registrations++;
  }
  const prodQty = new Map(), catQty = new Map();
  for (const o of productOrders) {
    if (o.status !== 'delivered' || new Date(o.createdAt) > now || !buckets.has(dayKey(new Date(o.createdAt)))) continue;
    for (const item of Array.isArray(o.items) ? o.items : []) {
      const qty = Number(item.qty || 1);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const name = item.name || 'Unnamed product';
      prodQty.set(name, (prodQty.get(name) || 0) + qty);
      if (item.category) catQty.set(item.category, (catQty.get(item.category) || 0) + qty);
    }
  }
  const ranked = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, qty]) => ({ name, qty }));
  return {
    days, generatedAt: now.toISOString(), timezone, period: { start, end: today, previousStart, previousEnd: calendarDay(-days) },
    series: [...buckets.values()], statusBreakdown, topProducts: ranked(prodQty), topCategories: ranked(catQty), previous,
    totals: {
      ...totals, customers: registered.length, activeRecurring,
      convertedCustomers: firstPurchase.size, neverPurchased: registered.length - firstPurchase.size,
      activationRate: percent(firstPurchase.size, registered.length),
    },
  };
}

module.exports = { summarizeCustomerOrders, buildMetrics };
