import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRoleQuestion, stripInternalIds, roleAnswer } from './aiController.js';

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

describe('isRoleQuestion', () => {
  it('catches varied ways of asking for the account role', () => {
    assert.equal(isRoleQuestion('what is my role?'), true);
    assert.equal(isRoleQuestion('tell me my role'), true);
    assert.equal(isRoleQuestion('what account type am I?'), true);
    assert.equal(isRoleQuestion('am I an organiser?'), true);
    assert.equal(isRoleQuestion('do I have admin access?'), true);
  });

  it('does not treat normal event discovery as a role question', () => {
    assert.equal(isRoleQuestion('show me events I can join'), false);
    assert.equal(isRoleQuestion('can you recommend a cheap music event'), false);
  });
});

describe('roleAnswer', () => {
  it('answers a yes/no role question with Yes/No, not a bare role word', () => {
    assert.match(roleAnswer('organiser', 'am I an organiser?'), /^Yes — your account is an organiser/);
    assert.match(roleAnswer('user', 'am I an organiser?'), /^No — your account is a regular user/);
    // "do I have admin access?" used to answer with the word "organiser", which answers neither.
    assert.match(roleAnswer('organiser', 'do I have admin access?'), /^No — your account is an organiser, not an admin/);
    assert.match(roleAnswer('admin', 'do I have admin access?'), /^Yes — your account is an admin/);
    // "can I host events?" is really "am I an organiser?".
    assert.match(roleAnswer('user', 'can I host events?'), /^No — .*not an organiser/);
    assert.match(roleAnswer('organiser', 'can I create events?'), /^Yes — your account is an organiser/);
  });

  it('answers an open role question with a sentence', () => {
    assert.match(roleAnswer('organiser', 'what is my role?'), /^You're an organiser —/);
    assert.match(roleAnswer('user', 'tell me my role'), /^You're a regular user \(attendee\) —/);
    assert.doesNotMatch(roleAnswer('admin', 'what is my role?'), /^admin$/);
  });
});
