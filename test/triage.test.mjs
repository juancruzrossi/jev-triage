import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { askJev, buildRequest, decide, DEFAULTS, headline, launchCommand, loadConfig, parseArgs, promptFor, splitBacklog } from '../triage.mjs';

const answers = ({ mode = 'build', gaps = {} } = {}) => ({
  mode: { choice: mode, confidence: 0.58 },
  goal: { noul: gaps.goal ?? 0.1 },
  where: { noul: gaps.where ?? 0.1 },
  check: { noul: gaps.check ?? 0.1 }
});

test("prints Jev's mode with Jev's confidence", () => {
  assert.equal(headline(decide(answers())), 'Build | 58% confidence');
  assert.equal(headline(decide(answers({ mode: 'orchestrator' }))), 'Orchestrator | 58% confidence');
});

test('a not-ready ticket lists the gaps Jev finds more likely missing than not', () => {
  const d = decide(answers({ mode: 'not_ready', gaps: { goal: 0.9, where: 0.6, check: 0.4 } }));
  assert.equal(headline(d), 'Not ready | 58% confidence');
  assert.deepEqual(d.missing, ['what to change', 'which feature']);
  assert.deepEqual(decide(answers({ gaps: { goal: 0.9 } })).missing, []);
});

test('asks one three-way choice plus each gap in one request', () => {
  const { questions, state } = buildRequest('ticket', 'repo');
  assert.deepEqual(Object.keys(questions).sort(), ['check', 'goal', 'mode', 'where']);
  assert.deepEqual(Object.keys(questions.mode.criteria), ['build', 'orchestrator', 'not_ready']);
  assert.deepEqual(state, { repository: 'repo', ticket: 'ticket' });
});

test('opens the interactive app of each provider, with an agent only when one is configured', () => {
  assert.deepEqual(launchCommand('opencode', 'orchestrator', 'p'), ['opencode', '--agent', 'orchestrator', '--prompt', 'p']);
  assert.deepEqual(launchCommand('claude', 'orchestrator', 'p'), ['claude', 'p']);
  assert.deepEqual(launchCommand('claude', 'orchestrator', 'p', { claude: { orchestrator: 'lead' } }), ['claude', '--agent', 'lead', 'p']);
});

test('reads --provider anywhere and rejects unknown ones', () => {
  assert.deepEqual(parseArgs(['--provider', 'claude', 'spec.md']), { provider: 'claude', input: 'spec.md', single: true });
  assert.deepEqual(parseArgs(['fix', 'the', 'typo']), { provider: null, input: 'fix the typo', single: false });
  assert.throws(() => parseArgs(['--provider', 'codex', 'x']), /Unknown provider/);
});

test('hands a spec file over by absolute path and a ticket as text', () => {
  assert.equal(promptFor('ticket', null), 'ticket');
  assert.equal(promptFor('ignored', 'spec.md'), `Implement the spec at ${path.resolve('spec.md')}`);
});

test('config falls back to defaults and overrides what it sets', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jev-triage-'));
  assert.deepEqual(loadConfig(path.join(dir, 'missing.json')), DEFAULTS);
  writeFileSync(path.join(dir, 'config.json'), '{"provider":"claude","agents":{"claude":{"orchestrator":"lead"}}}');
  const config = loadConfig(path.join(dir, 'config.json'));
  assert.equal(config.provider, 'claude');
  assert.deepEqual(config.agents, { opencode: DEFAULTS.agents.opencode, claude: { orchestrator: 'lead' } });
});

test('returns the answers and surfaces a rejected key', async () => {
  const ok = async () => ({ status: 200, ok: true, json: async () => ({ answers: answers() }) });
  assert.deepEqual(await askJev('key', 'ticket', 'repo', ok), answers());
  await assert.rejects(askJev('bad', 'ticket', 'repo', async () => ({ status: 401, ok: false })), /JEV_API_KEY/);
});

test('splits a backlog on +++ lines and keeps Markdown --- rules inside a ticket', () => {
  assert.deepEqual(splitBacklog('one\n+++\ntwo\n---\nmore\n+++\n\n'), ['one', 'two\n---\nmore']);
});
