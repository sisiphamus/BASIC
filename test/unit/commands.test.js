import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCommand } from '../../web/src/glasses/commands.js';

test('matches short command phrases', () => {
  assert.equal(matchCommand('Next'), 'next');
  assert.equal(matchCommand('next step please'), 'next');
  assert.equal(matchCommand('Hey Base, repeat'), 'repeat');
  assert.equal(matchCommand("what's this for?"), 'help');
  assert.equal(matchCommand('go back'), 'back');
  assert.equal(matchCommand('say that again'), 'repeat');
});

test('ignores normal talk that merely contains a command word', () => {
  assert.equal(matchCommand('put it next to the window'), null);
  assert.equal(matchCommand('I need help carrying this later maybe'), null);
  assert.equal(matchCommand(''), null);
  assert.equal(matchCommand(undefined), null);
});
