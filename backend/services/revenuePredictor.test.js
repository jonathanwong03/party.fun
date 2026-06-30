import test from 'node:test';
import assert from 'node:assert/strict';

import {
  avgTicketPrice,
  dailyRevenue,
  dailySales,
  operationalCosts,
  predictRevenue,
  projectedFinalTickets,
  scoreLocation,
  scorePricing,
  scoreTiming,
} from './revenuePredictor.js';

test('scores central locations above non-central locations', () => {
  assert.ok(scoreLocation('199018') > scoreLocation('640123'));
});

test('scores evening timing above morning timing', () => {
  assert.ok(scoreTiming(20) > scoreTiming(9));
});

test('scores cheaper prices as more affordable', () => {
  assert.ok(scorePricing(12) > scorePricing(45));
});

test('computes weighted static average ticket price', () => {
  assert.equal(avgTicketPrice({
    pricing_model: 'static',
    early_price: 10,
    early_capacity: 20,
    greenlit_price: 20,
    greenlit_capacity: 20,
  }), 15);
});

test('computes hype curve average ticket price from base and max', () => {
  assert.equal(avgTicketPrice({
    pricing_model: 'hype',
    base_price: 20,
    max_price: 50,
  }), 35);
});

test('projected tickets respect active ticket floor and capacity ceiling', () => {
  assert.equal(projectedFinalTickets({ max_capacity: 30, active_tickets: 35 }, 0.2), 30);
  assert.equal(projectedFinalTickets({ max_capacity: 50, active_tickets: 20 }, 0.1), 20);
  assert.equal(projectedFinalTickets({ max_capacity: 0, active_tickets: 20 }, 0.9), 0);
});

test('daily sales sums to the projected total and weights sales closer to event day', () => {
  const series = dailySales(20, 4);
  assert.equal(series.reduce((sum, d) => sum + d.tickets, 0), 20);
  assert.ok(series.at(-1).tickets >= series[0].tickets);
});

test('daily revenue prices tiered tickets early-bird then greenlit', () => {
  const curve = [{ dayOffset: 1, tickets: 2 }, { dayOffset: 2, tickets: 2 }];
  const rev = dailyRevenue(curve, {
    pricing_model: 'static', early_price: 10, early_capacity: 3, greenlit_price: 20,
  });
  // tickets 0,1,2 @ $10 (3rd is index 2 < cap 3), ticket 3 @ $20 => 20 + 30
  assert.equal(rev[0].revenue, 20);
  assert.equal(rev[1].revenue, 30);
});

test('daily revenue escalates with hype pricing', () => {
  const curve = [{ dayOffset: 1, tickets: 1 }, { dayOffset: 2, tickets: 1 }];
  const rev = dailyRevenue(curve, {
    pricing_model: 'hype', base_price: 20, max_price: 60, max_capacity: 100,
  });
  assert.ok(rev[1].revenue >= rev[0].revenue);
});

test('predictRevenue daily revenue sums to projected revenue', () => {
  const result = predictRevenue({
    title: 'Hype Night', description: 'Live DJ party with limited slots.',
    pricing_model: 'hype', base_price: 20, max_price: 50, max_capacity: 80,
    active_tickets: 5, days_until_event: 6, start_hour: 20, day_of_week: 5,
  });
  const summed = result.dailyRevenue.reduce((sum, d) => sum + d.revenue, 0);
  assert.ok(Math.abs(summed - result.projectedRevenue) < 0.01);
});

test('daily sales returns zeros when no tickets are projected', () => {
  assert.deepEqual(dailySales(0, 3), [
    { dayOffset: 1, tickets: 0 },
    { dayOffset: 2, tickets: 0 },
    { dayOffset: 3, tickets: 0 },
  ]);
});

test('predictRevenue returns the frontend forecast shape without cost or profit totals', () => {
  const result = predictRevenue({
    title: 'Rooftop DJ Party',
    description: 'Live DJ, food, drinks and limited rooftop party slots.',
    postal_code: '199018',
    start_hour: 20,
    day_of_week: 5,
    pricing_model: 'static',
    early_price: 12,
    early_capacity: 50,
    greenlit_price: 18,
    greenlit_capacity: 50,
    max_capacity: 100,
    active_tickets: 10,
    elapsed_hours: 12,
    remaining_hours: 72,
    days_until_event: 5,
  });

  assert.equal(typeof result.attractiveness, 'number');
  assert.equal(typeof result.projectedTicketsSold, 'number');
  assert.equal(typeof result.avgTicketPrice, 'number');
  assert.equal(typeof result.projectedRevenue, 'number');
  assert.ok(Array.isArray(result.dailySales));
  assert.equal(result.dailySales.reduce((sum, d) => sum + d.tickets, 0), result.projectedTicketsSold);
  assert.ok(result.breakdown.location >= 0);
  assert.ok(Array.isArray(result.operationalCosts));
  const venue = result.operationalCosts.find((c) => c.category === 'Venue booking');
  const dj = result.operationalCosts.find((c) => c.category === 'DJ or live talent');
  assert.equal(typeof venue.cost, 'number');
  assert.equal(typeof dj.cost, 'number');
  assert.equal(typeof result.totalOperationalCost, 'number');
  assert.equal(typeof result.estimatedNet, 'number');
});

test('operational costs add context-specific categories with numeric amounts', () => {
  const costs = operationalCosts({
    title: 'Outdoor Picnic Workshop',
    description: 'Bring materials for a speaker-led networking workshop at the green.',
  }, { attendees: 40, revenue: 800 });

  const labels = costs.map((c) => c.category);
  assert.ok(labels.includes('Weather contingency'));
  assert.ok(labels.includes('Workshop materials'));
  assert.ok(costs.every((c) => typeof c.cost === 'number'));
});
