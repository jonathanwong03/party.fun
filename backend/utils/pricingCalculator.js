/**
 * Hype-Driven Pricing bonding curve:
 *   P(x) = P_base * (P_max / P_base) ^ (x / C)
 * Bulk quote for quantity Q at active count x:
 *   Total = sum_{k=0}^{Q-1} P(x + k)
 */

function normalizeCount(activeCount, maxCapacity) {
  return Math.min(Math.max(0, activeCount), maxCapacity);
}

export function ticketPrice(activeCount, { basePrice, maxPrice, maxCapacity }) {
  const validation = validateHypePricingConfig({ basePrice, maxPrice, maxCapacity });
  if (validation.error) throw new Error(validation.error);

  const x = normalizeCount(activeCount, maxCapacity);
  const ratio = maxPrice / basePrice;
  return basePrice * ratio ** (x / maxCapacity);
}

export function quoteTotal(activeCount, quantity, config) {
  const validation = validateHypePricingConfig(config);
  if (validation.error) throw new Error(validation.error);

  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const start = Math.max(0, Math.floor(Number(activeCount) || 0));

  if (start + qty > config.maxCapacity) {
    throw new Error('quote exceeds maxCapacity');
  }

  const unitPrices = [];
  for (let k = 0; k < qty; k += 1) {
    unitPrices.push(ticketPrice(start + k, config));
  }

  return {
    quantity: qty,
    activeCount: start,
    unitPrices,
    total: unitPrices.reduce((sum, price) => sum + price, 0),
  };
}

export function validateHypePricingConfig({ basePrice, maxPrice, maxCapacity }) {
  const base = Number(basePrice);
  const max = Number(maxPrice);
  const capacity = Number(maxCapacity);

  if (!Number.isFinite(base) || !Number.isFinite(max) || base <= 0 || max <= 0) {
    return { error: 'prices_must_be_positive' };
  }
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return { error: 'max_capacity_must_be_positive' };
  }
  if (base >= max) {
    return { error: 'base_price_must_be_less_than_max' };
  }
  return { ok: true };
}
