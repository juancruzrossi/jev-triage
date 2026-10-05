# jev-triage

Ask [Jev](https://typesafe.ai) whether a ticket or spec should run in one agent session (**Build**) or with an **Orchestrator** and its subagents, then start it in OpenCode or Claude Code.

```
$ jev-triage "Add a log line when a webhook delivery fails."
Build | 97% confidence
→ opencode --agent build
Start Build in OpenCode? [y/N]
```

- **Build**: one session does everything. Small, low-risk work in one area.
- **Orchestrator**: researcher, implementer, reviewer, and end-to-end verifier. Work across modules, breaking changes, migrations, data risk, or unclear scope.
- **Not ready**: too vague for any agent. Nothing starts.

## Install

Needs Node.js 20.12+ and a [TypeSafe](https://console.typesafe.ai) API key.

```
git clone https://github.com/juancruzrossi/jev-triage.git
cd jev-triage
./install.sh
echo "JEV_API_KEY=your-key" >> ~/.jev/.env
```

Installs `jev-triage` in `~/.local/bin`. To update: `git pull`.

## Use

```
jev-triage "ticket text"
jev-triage path/to/spec.md
jev-triage --provider claude path/to/spec.md
```

For a single ticket it shows the command and asks before opening the agent.

Several tickets in one file, separated by a `+++` line, get one line each and start nothing:

```
$ jev-triage backlog.md
Build | 100% confidence         Fix the typo "Pasword" in the login error message.
Orchestrator | 100% confidence  Prevent two concurrent payments from charging the same invoice twice.
Not ready | 100% confidence     Save a variable.
```

## Confidence

| Confidence | Meaning |
|---|---|
| 90%+ | Clear. Follow it. |
| 50-89% | Leaning. Take a look. |
| Below 50% | Unsure. Add detail or decide yourself. |

## Config

Optional, in `~/.jev/triage/config.json`:

```json
{
  "provider": "opencode",
  "repository": "Backend API in Go with Postgres",
  "agents": {
    "opencode": { "build": "build", "orchestrator": "orchestrator" },
    "claude": { "orchestrator": "my-lead-agent" }
  }
}
```

- `provider`: `opencode` (default) or `claude`.
- `repository`: one line about your codebase, so Jev judges in context.
- `agents`: the `--agent` to open per mode. Claude Code opens its default agent unless you set one.

## Uninstall

```
rm ~/.local/bin/jev-triage
```
