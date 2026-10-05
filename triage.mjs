#!/usr/bin/env node
// Ask Jev whether a ticket should run in one agent session (Build) or with an Orchestrator and its subagents, then offer to start it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_HOME = path.join(os.homedir(), '.jev');

export const DEFAULTS = {
  provider: 'opencode',
  repository: 'A large backend codebase with an API and a relational database.',
  // Agent to open per provider and mode; a mode without one opens the provider's default agent.
  agents: { opencode: { build: 'build', orchestrator: 'orchestrator' }, claude: {} }
};

// Described the way Jev's docs recommend for options that are easy to confuse: what each covers, what it excludes, examples.
const MODES = {
  build: {
    what: 'One agent session researches, implements, tests and checks the change in a single context. Cheaper and faster than the Orchestrator.',
    covers: 'Well-scoped, low-risk work inside one area of the code, where a mistake would be caught by the unit tests and would not corrupt stored data.',
    excludes: 'Not for work that spans several modules, breaks an existing contract, needs a schema migration, puts data correctness at risk, or needs investigation before a plan is clear.',
    examples: ['Expose an existing column as a new optional API field', 'Add input validation to one endpoint', 'Change a constant, a default value, or a message text', 'Rename a private helper inside one module']
  },
  orchestrator: {
    what: 'A lead agent delegates to subagents that each start with clean context: a researcher, an implementer, an independent reviewer, and an end-to-end verifier that runs the real API and checks the database. Slower and more expensive than Build.',
    covers: 'Work across several modules, breaking changes or schema migrations, data correctness risk (concurrency, transactions, money amounts), or unclear requirements that need investigation first.',
    excludes: 'Not for small, local, low-risk changes that one session can finish and check on its own.',
    examples: ['Prevent two concurrent requests from claiming the same resource', 'Change how amounts are rounded across billing and invoicing', 'Split a table in two and migrate existing rows', 'Investigate intermittent duplicate records']
  },
  not_ready: {
    what: 'No agent should start yet: the ticket goes back to its author.',
    covers: 'Tickets that do not say what should change or what problem to solve.',
    excludes: 'Not for tickets that name a concrete change or problem, even short or partly unclear ones: an agent can find where in the code and how to check it on its own.',
    examples: ['Save a variable', 'Make it better', 'Fix the bug', 'Improve performance']
  }
};

// Asked with every ticket; listed only when Jev picks not_ready, to say what the author should add.
const GAPS = {
  goal: { label: 'what to change', ask: 'Does the ticket fail to say what should change or what problem to solve?' },
  where: { label: 'which feature', ask: 'Is it impossible to tell, even roughly, which feature or part of the system the ticket is about?' },
  check: { label: 'what done means', ask: 'Is there no way to tell from the ticket what result would count as done?' }
};

const NAMES = { build: 'Build', orchestrator: 'Orchestrator', not_ready: 'Not ready' };
const PROVIDERS = { opencode: 'OpenCode', claude: 'Claude Code' };
const pct = (p) => `${Math.round(p * 100)}%`;
const title = (ticket) => ticket.split('\n')[0].slice(0, 80);

// The interactive app to open, with the prompt already typed in.
export function launchCommand(provider, mode, prompt, agents = DEFAULTS.agents) {
  const agent = agents[provider]?.[mode];
  const flag = agent ? ['--agent', agent] : [];
  return provider === 'opencode' ? ['opencode', ...flag, '--prompt', prompt] : ['claude', ...flag, prompt];
}

export function loadConfig(file = path.join(JEV_HOME, 'triage', 'config.json')) {
  if (!existsSync(file)) return { ...DEFAULTS };
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    return { ...DEFAULTS, ...config, agents: { ...DEFAULTS.agents, ...config.agents } };
  } catch {
    throw new Error(`Could not read ${file}: it must be valid JSON.`);
  }
}

export function buildRequest(ticket, repository) {
  const questions = { mode: { type: 'choice', instructions: 'What should happen with this ticket in `repository`?', criteria: MODES } };
  for (const [name, gap] of Object.entries(GAPS)) {
    questions[name] = { type: 'noul', instructions: gap.ask, criteria: { true: 'It is missing.', false: 'The ticket gives it.' } };
  }
  return { model: 'jev-latest', state: { repository, ticket }, questions };
}

// Jev's choice is the verdict; a gap is listed when Jev finds it more likely missing than not.
export function decide(answers) {
  const verdict = answers.mode.choice;
  const missing = verdict === 'not_ready' ? Object.keys(GAPS).filter((name) => answers[name].noul >= 0.5).map((name) => GAPS[name].label) : [];
  return { verdict, confidence: answers.mode.confidence, missing };
}

export const headline = (d) => `${NAMES[d.verdict]} | ${pct(d.confidence)} confidence`;

function readApiKey() {
  try {
    process.loadEnvFile(path.join(JEV_HOME, '.env')); // never overrides a variable already set
  } catch {
    // No ~/.jev/.env: rely on the environment.
  }
  return process.env.JEV_API_KEY || null;
}

export async function askJev(apiKey, ticket, repository, fetchImpl = fetch) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequest(ticket, repository)),
    signal: AbortSignal.timeout(60_000)
  });
  if (response.status === 401) throw new Error('Jev rejected JEV_API_KEY. Check that the key is current.');
  if (response.status === 400) {
    const detail = await response.json().then((b) => b?.detail, () => null);
    if (detail?.error_type === 'max_tokens_exceeded') throw new Error('The text is too long for Jev (about 100 KB works). Send a shorter spec or ticket.');
  }
  if (!response.ok) throw new Error(`Jev API request failed with HTTP ${response.status}.`);
  return (await response.json()).answers;
}

// A line with only `+++` separates tickets; Markdown does not use it, so a spec with `---` rules stays whole.
export function splitBacklog(text) {
  return text.split(/^\+\+\+\s*$/m).map((t) => t.trim()).filter(Boolean);
}

export function parseArgs(argv) {
  const args = [...argv];
  const at = args.indexOf('--provider');
  const provider = at === -1 ? null : args.splice(at, 2)[1];
  if (at !== -1 && !PROVIDERS[provider]) throw new Error(`Unknown provider "${provider}". Use: ${Object.keys(PROVIDERS).join(', ')}.`);
  return { provider, input: args.join(' ').trim(), single: args.length === 1 };
}

// A spec file is handed over by path, so the agent reads it instead of a huge pasted prompt.
export const promptFor = (ticket, file) => (file ? `Implement the spec at ${path.resolve(file)}` : ticket);

const shown = (cmd) => cmd.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a.length > 80 ? `${a.slice(0, 77)}...` : a) : a)).join(' ');

async function confirmAndLaunch(d, provider, prompt, agents) {
  const cmd = launchCommand(provider, d.verdict, prompt, agents);
  console.log(`→ ${shown(cmd)}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Start ${NAMES[d.verdict]} in ${PROVIDERS[provider]}? [y/N] `)).trim().toLowerCase();
  rl.close();
  if (answer !== 'y') return;
  const result = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  if (result.error) throw new Error(`Could not start ${cmd[0]}: ${result.error.message}`);
  process.exitCode = result.status ?? 0;
}

async function main(argv) {
  const config = loadConfig();
  const { provider: flag, input, single } = parseArgs(argv);
  const provider = flag ?? config.provider;
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider "${provider}" in config. Use: ${Object.keys(PROVIDERS).join(', ')}.`);

  // One argument naming a file reads that file; anything else is the ticket text itself.
  if (single && ['.txt', '.md'].includes(path.extname(input)) && !existsSync(input)) throw new Error(`File not found: ${input}`);
  const file = single && existsSync(input) ? input : null;
  const tickets = splitBacklog(file ? readFileSync(file, 'utf8') : input || readFileSync(0, 'utf8'));
  if (tickets.length === 0) throw new Error('Pass a file path (tickets separated by lines "+++"), the ticket text, or the ticket on stdin.');
  const apiKey = readApiKey();
  if (!apiKey) throw new Error(`JEV_API_KEY is not set (checked the environment and ${path.join(JEV_HOME, '.env')}).`);

  if (tickets.length > 1) {
    for (const ticket of tickets) console.log(`${headline(decide(await askJev(apiKey, ticket, config.repository))).padEnd(32)}${title(ticket)}`);
    return;
  }

  const d = decide(await askJev(apiKey, tickets[0], config.repository));
  console.log(headline(d));
  if (d.verdict === 'not_ready') {
    if (d.missing.length > 0) console.log(`Missing: ${d.missing.join(', ')}`);
    return;
  }
  // Asking needs a keyboard: skip it when the ticket came through a pipe or the output is redirected.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  await confirmAndLaunch(d, provider, promptFor(tickets[0], file), config.agents);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Piping into `head` closes stdout early; that is not an error.
  process.stdout.on('error', (error) => process.exit(error.code === 'EPIPE' ? 0 : 1));
  main(process.argv.slice(2)).catch((error) => {
    console.error(`jev-triage: ${error.message}`);
    process.exit(1);
  });
}
