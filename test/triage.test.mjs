import assert from 'node:assert/strict';
import test from 'node:test';
import { askJev, buildRequest, headline, splitBacklog } from '../triage.mjs';

test("prints Jev's choice with Jev's confidence", () => {
  assert.equal(headline({ choice: 'build', confidence: 0.58 }), 'Build | 58% confidence');
  assert.equal(headline({ choice: 'orchestrator', confidence: 0.78 }), 'Orchestrator | 78% confidence');
});

test('asks one choice question between the two modes', () => {
  const { questions, state } = buildRequest('ticket');
  assert.equal(questions.mode.type, 'choice');
  assert.deepEqual(Object.keys(questions.mode.criteria), ['build', 'orchestrator']);
  assert.equal(state.ticket, 'ticket');
});

test('returns the mode answer and surfaces a rejected key', async () => {
  const answer = { choice: 'build', confidence: 0.9, probabilities: { build: 0.95, orchestrator: 0.05 } };
  const ok = async () => ({ status: 200, ok: true, json: async () => ({ answers: { mode: answer } }) });
  assert.deepEqual(await askJev('key', 'ticket', ok), answer);
  await assert.rejects(askJev('bad', 'ticket', async () => ({ status: 401, ok: false })), /JEV_API_KEY/);
});

test('splits a backlog on separator lines and keeps Markdown --- rules inside a ticket', () => {
  assert.deepEqual(splitBacklog('one\n+++\ntwo\n---\nmore\n+++\n\n'), ['one', 'two\n---\nmore']);
});
