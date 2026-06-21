import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pledgeConfirmedTemplate } from './emailTemplates.js';

const base = {
  userName: 'jamie',
  eventTitle: 'Campus Party',
  qty: 2,
  pricePerTicket: 15,
  total: 30,
  deadline: '2026-12-15T18:00:00+08:00',
};

describe('pledgeConfirmedTemplate', () => {
  it('states payment is captured at pledge time', () => {
    const html = pledgeConfirmedTemplate(base);
    assert.match(html, /payment.*captured/i);
    assert.doesNotMatch(html, /charged once the threshold/i);
    assert.doesNotMatch(html, /only be charged once/i);
  });

  it('escapes HTML in user-supplied fields', () => {
    const html = pledgeConfirmedTemplate({
      ...base,
      userName: '<script>alert(1)</script>',
      eventTitle: 'Party <img src=x onerror=alert(1)>',
    });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /Party &lt;img/);
  });
});
