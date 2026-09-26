import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuleText, ruleIdFrom } from '../../server/rule-text.js';

test('"when you see X, say Y"', () => {
  assert.deepEqual(parseRuleText('When you see a ladder against the wall, say check your footing.'), { when: 'a ladder against the wall', say: 'Check your footing' });
});

test('"whenever X say Y" without a comma, quoted line', () => {
  assert.deepEqual(parseRuleText('whenever there is a hose near the pad say "move the hose"'), { when: 'there is a hose near the pad', say: 'Move the hose' });
});

test('"if X, tell them to Y"', () => {
  assert.deepEqual(parseRuleText('If the disconnect is on, tell them to switch it off'), { when: 'the disconnect is on', say: 'Switch it off' });
});

test('"now check for X" makes a rule the model phrases itself', () => {
  assert.deepEqual(parseRuleText('Now check for gloves and safety glasses'), { when: 'Check for gloves and safety glasses', say: '' });
  assert.deepEqual(parseRuleText('look out for kids near the work area'), { when: 'Look out for kids near the work area', say: '' });
});

test('anything else becomes the condition', () => {
  assert.deepEqual(parseRuleText("you're checking for the torque stripe"), { when: 'Check for the torque stripe', say: '' });
  assert.deepEqual(parseRuleText('smoke'), { when: 'smoke', say: '' });
  assert.throws(() => parseRuleText('   '), /type a rule/);
});

test('ruleIdFrom makes a short slug', () => {
  assert.equal(ruleIdFrom('A ladder against the wall near the pad'), 'a-ladder-against-the-wall');
  assert.equal(ruleIdFrom('!!!'), 'rule');
});
