#!/usr/bin/env node
// Ask Jev whether a ticket should run in one OpenCode Build session or with the Orchestrator and its subagents.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const MODEL = 'jev-latest';

export const REPOSITORY = 'A large backend codebase with an API and a relational database.';

// Described the way Jev's docs recommend for options that are easy to confuse: what each covers, what it excludes, examples.
export const MODES = {
  build: {
    what: 'One OpenCode session (the Build agent) researches, implements, tests and checks the change in a single context. Cheaper and faster than the Orchestrator.',
    covers: 'Well-scoped, low-risk work inside one area of the code, where a mistake would be caught by the unit tests and would not corrupt stored data.',
    excludes: 'Not for work that spans several modules, breaks an existing contract, needs a schema migration, puts data correctness at risk, or needs investigation before a plan is clear.',
    examples: ['Expose an existing column as a new optional API field', 'Add input validation to one endpoint', 'Change a constant, a default value, or a message text', 'Rename a private helper inside one module']
  },
  orchestrator: {
    what: 'An Orchestrator delegates to separate agents that each start with clean context: a researcher, an implementer, an independent reviewer, and an end-to-end verifier that runs the real API and checks the database. Slower and more expensive than Build.',
    covers: 'Work across several modules, breaking changes or schema migrations, data correctness risk (concurrency, transactions, money amounts), or unclear requirements that need investigation first.',
    excludes: 'Not for small, local, low-risk changes that one session can finish and check on its own.',
    examples: ['Prevent two concurrent requests from claiming the same resource', 'Change how amounts are rounded across billing and invoicing', 'Split a table in two and migrate existing rows', 'Investigate intermittent duplicate records']
  }
};

export function buildRequest(ticket) {
  return {
    model: MODEL,
    state: { repository: REPOSITORY, ticket },
    questions: {
      mode: {
        type: 'choice',
        instructions: 'Which way of working should take this ticket in `repository`?',
        criteria: MODES
      }
    }
  };
}

const NAMES = { build: 'Build', orchestrator: 'Orchestrator' };
const pct = (p) => `${Math.round(p * 100)}%`;
const title = (ticket) => ticket.split('\n')[0].slice(0, 80);

export const headline = (answer) => `${NAMES[answer.choice]} | ${pct(answer.confidence)} confidence`;

export function readApiKey() {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY;
  try {
    const line = readFileSync(path.join(os.homedir(), '.envs'), 'utf8').split('\n').find((l) => l.startsWith('JEV_API_KEY='));
    return line ? line.slice('JEV_API_KEY='.length).trim() : null;
  } catch {
    return null;
  }
}

export async function askJev(apiKey, ticket, fetchImpl = fetch) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequest(ticket)),
    signal: AbortSignal.timeout(60_000)
  });
  if (response.status === 401) throw new Error('Jev rejected JEV_API_KEY. Check that the key is current.');
  if (response.status === 400) {
    const detail = await response.json().then((b) => b?.detail, () => null);
    if (detail?.error_type === 'max_tokens_exceeded') throw new Error('The text is too long for Jev (about 100 KB works). Send a shorter spec or ticket.');
  }
  if (!response.ok) throw new Error(`Jev API request failed with HTTP ${response.status}.`);
  return (await response.json()).answers.mode;
}

// A line with only `+++` separates tickets; Markdown does not use it, so a spec with `---` rules stays whole.
export const SEPARATOR = '+++';

export function splitBacklog(text) {
  return text.split(/^\+\+\+\s*$/m).map((t) => t.trim()).filter(Boolean);
}

function logDecision(ticket, answer) {
  // Local only: lets you later compare the routing with how each ticket actually went.
  try {
    const dir = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'jev-triage');
    mkdirSync(dir, { recursive: true });
    const entry = { ts: new Date().toISOString(), title: title(ticket), choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities };
    appendFileSync(path.join(dir, 'decisions.jsonl'), `${JSON.stringify(entry)}\n`);
  } catch {
    // A log failure must not fail the triage.
  }
}

async function main(argv) {
  // One argument naming a file reads that file; anything else is the ticket text itself.
  const arg = argv.join(' ').trim();
  if (argv.length === 1 && ['.txt', '.md'].includes(path.extname(arg)) && !existsSync(arg)) throw new Error(`File not found: ${arg}`);
  const text = argv.length === 1 && existsSync(arg) ? readFileSync(arg, 'utf8') : arg || readFileSync(0, 'utf8');
  const tickets = splitBacklog(text);
  if (tickets.length === 0) throw new Error(`Pass a file path (tickets separated by lines "${SEPARATOR}"), the ticket text, or the ticket on stdin.`);
  const apiKey = readApiKey();
  if (!apiKey) throw new Error('JEV_API_KEY is not set (checked the environment and ~/.envs).');

  for (const ticket of tickets) {
    const answer = await askJev(apiKey, ticket);
    logDecision(ticket, answer);
    console.log(tickets.length > 1 ? `${headline(answer).padEnd(32)}${title(ticket)}` : headline(answer));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Piping into `head` closes stdout early; that is not an error.
  process.stdout.on('error', (error) => process.exit(error.code === 'EPIPE' ? 0 : 1));
  main(process.argv.slice(2)).catch((error) => {
    console.error(`jev-triage: ${error.message}`);
    process.exit(1);
  });
}
