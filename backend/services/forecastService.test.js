import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { forecastForEvent, similarPastBenchmark, dependencies } from './forecastService.js';

describe('forecastService', () => {
  const originalAdminClient = dependencies.adminClient;
  const originalPredictRevenue = dependencies.predictRevenue;
  const originalEmbedText = dependencies.embedText;
  const originalIsEmbeddingEnabled = dependencies.isEmbeddingEnabled;
  const originalSimilarPastBenchmark = dependencies.similarPastBenchmark;

  let mockEvent = null;
  let mockRow = null;
  let mockSimilarPastResult = null;

  beforeEach(() => {
    mockEvent = {
      id: 'evt-1',
      title: 'Mock Event',
      description: 'Test description',
      startDate: '2026-07-10T12:00:00Z',
      maxCapacity: 100,
      hypeThreshold: 20,
      active_ticket_count: 5,
      deadlineAt: '2026-07-09T12:00:00Z',
      address: '123456 Singapore Road',
      hypeDrivenPricing: false,
      statuses: [
        { statusName: 'early_bird', price: 10, ticketCapacity: 20 },
        { statusName: 'greenlit', price: 20, ticketCapacity: 80 }
      ]
    };
    mockRow = { createdAt: '2026-07-01T00:00:00Z' };
    mockSimilarPastResult = { similarCount: 1, avgSellThroughPct: 80, examples: [] };

    dependencies.adminClient = () => ({
      rpc: async (name) => {
        if (name === 'get_events') return { data: [mockEvent], error: null };
        if (name === 'match_similar_past_events') {
          return {
            data: [{ title: 'Past Gig', capacity: 100, sold: 80 }],
            error: null
          };
        }
        return { data: null, error: null };
      },
      from: (table) => {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockRow, error: null })
            })
          })
        };
      }
    });

    dependencies.predictRevenue = async (features) => {
      return { totalRevenue: 1500, confidence: 0.9 };
    };

    dependencies.embedText = async () => {
      return [0.1, 0.2, 0.3];
    };

    dependencies.isEmbeddingEnabled = () => true;
    dependencies.similarPastBenchmark = originalSimilarPastBenchmark;
  });

  afterEach(() => {
    dependencies.adminClient = originalAdminClient;
    dependencies.predictRevenue = originalPredictRevenue;
    dependencies.embedText = originalEmbedText;
    dependencies.isEmbeddingEnabled = originalIsEmbeddingEnabled;
    dependencies.similarPastBenchmark = originalSimilarPastBenchmark;
  });

  test('forecastForEvent compiles features and retrieves forecast prediction', async () => {
    const result = await forecastForEvent('evt-1');

    assert.ok(result);
    assert.deepEqual(result.event, mockEvent);
    
    // Check key features
    assert.equal(result.features.postal_code, '123456');
    assert.equal(result.features.max_capacity, 100);
    assert.equal(result.features.early_price, 10);
    assert.equal(result.features.greenlit_price, 20);
    assert.equal(result.features.early_capacity, 20);
    assert.equal(result.features.greenlit_capacity, 80);
    assert.equal(result.features.pricing_model, 'static');

    // Forecast object checks
    assert.ok(result.forecast);
    assert.equal(result.forecast.totalRevenue, 1500);
    assert.ok(result.forecast.benchmark);
    assert.equal(result.forecast.benchmark.similarCount, 1);
    assert.equal(result.forecast.benchmark.avgSellThroughPct, 80);
  });

  test('similarPastBenchmark returns null if embedding is disabled', async () => {
    dependencies.isEmbeddingEnabled = () => false;
    const admin = dependencies.adminClient();
    const benchmark = await similarPastBenchmark(admin, mockEvent);
    assert.equal(benchmark, null);
  });

  test('similarPastBenchmark returns valid benchmark statistics', async () => {
    const admin = dependencies.adminClient();
    const benchmark = await similarPastBenchmark(admin, mockEvent);
    assert.ok(benchmark);
    assert.equal(benchmark.similarCount, 1);
    assert.equal(benchmark.avgSellThroughPct, 80);
    assert.deepEqual(benchmark.examples, [{ title: 'Past Gig', sellThroughPct: 80 }]);
  });
});
