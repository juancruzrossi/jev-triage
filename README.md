# jev-triage

Ask [Jev](https://typesafe.ai) whether a ticket or spec should run in one OpenCode **Build** session or with the **Orchestrator** and its subagents.

```
$ jev-triage "Add a log line when a webhook delivery fails."
Build | 96% confidence
```

- **Build**: one session does everything. Small, low-risk work in one area.
- **Orchestrator**: researcher, implementer, reviewer, and end-to-end verifier. Work across modules, breaking changes, migrations, data risk, or unclear scope.

## Install

Needs Node.js and a [TypeSafe](https://console.typesafe.ai) API key as `JEV_API_KEY`, in your environment or in `~/.envs`.

```
git clone https://github.com/juancruzrossi/jev-triage.git
cd jev-triage
./install.sh
```

Installs `jev-triage` in `~/.local/bin`.

## Use

```
jev-triage "ticket text"
jev-triage path/to/spec.md
jev-triage path/to/backlog.txt
```

Separate several tickets in one file with a `+++` line:

```
$ cat backlog.md
Fix a typo in the login error message.
+++
Prevent two concurrent payments from charging the same invoice twice.

$ jev-triage backlog.md
Build | 100% confidence         Fix a typo in the login error message.
Orchestrator | 100% confidence  Prevent two concurrent payments from charging the same invoice twice.
```

In OpenCode, run it without a model: `!jev-triage backlog.md`.

## Confidence

| Confidence | Meaning |
|---|---|
| 90%+ | Clear. Follow it. |
| 50-89% | Leaning. Take a look. |
| Below 50% | Unsure. Add detail or decide yourself. |

Up to about 100 KB per ticket. Edit `REPOSITORY` and `MODES` in `triage.mjs` to fit your codebase. Decisions are logged locally to `~/.local/state/jev-triage/decisions.jsonl`.

## Uninstall

```
rm ~/.local/bin/jev-triage
```
