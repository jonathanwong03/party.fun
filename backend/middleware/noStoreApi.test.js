import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { noStoreApi } from './noStoreApi.js';

describe('noStoreApi', () => {
  it('marks API responses as user-specific and non-cacheable', () => {
    const headers = {};
    let nextCalled = false;
    const res = {
      set(name, value) {
        headers[name.toLowerCase()] = value;
      },
      vary(name) {
        headers.vary = name;
      },
    };

    noStoreApi({}, res, () => { nextCalled = true; });

    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(headers.vary, 'Authorization');
    assert.equal(nextCalled, true);
  });
});
