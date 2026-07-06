import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripInternalIds } from './aiController.js';

const UUID = '21dcef74-7c3b-4a1e-9b2f-0a1b2c3d4e5f';

describe('stripInternalIds', () => {
  it('removes a parenthetical (ID: <uuid>) and tidies the leftover space', () => {
    const out = stripInternalIds(`Neon Rave (ID: ${UUID}) is greenlit.`);
    assert.equal(out, 'Neon Rave is greenlit.');
  });

  it('removes a labelled "ID: <uuid>"', () => {
    const out = stripInternalIds(`Event ID: ${UUID}`);
    assert.equal(out.includes(UUID), false);
    assert.equal(out.trim(), '');
  });

  it('removes a bare UUID anywhere in the text', () => {
    const out = stripInternalIds(`See ${UUID} for details.`);
    assert.equal(out.includes(UUID), false);
    assert.equal(out, 'See for details.');
  });

  it('strips every leaked id in a numbered list', () => {
    const input = [
      '1. Neon Rave (ID: 11111111-1111-4111-8111-111111111111)',
      '2. Jazz Night (id: 22222222-2222-4222-8222-222222222222)',
    ].join('\n\n');
    const out = stripInternalIds(input);
    assert.equal(/[0-9a-fA-F]{8}-/.test(out), false);
    assert.match(out, /Neon Rave/);
    assert.match(out, /Jazz Night/);
  });

  it('leaves normal text (and non-uuid numbers) untouched', () => {
    const text = 'Only 3 spots left — 80% to greenlit. Pledge by Friday.';
    assert.equal(stripInternalIds(text), text);
  });

  it('handles null/undefined/empty safely', () => {
    assert.equal(stripInternalIds(''), '');
    assert.equal(stripInternalIds(null), null);
    assert.equal(stripInternalIds(undefined), undefined);
  });
});
