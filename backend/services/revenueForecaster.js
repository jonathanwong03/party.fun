import { predictRevenue as predictRevenueLocal } from './revenuePredictor.js';

export async function predictRevenue(features) {
  try {
    return predictRevenueLocal(features);
  } catch (e) {
    console.warn('[revenueForecaster] forecast unavailable:', e?.message || e);
    return null;
  }
}
