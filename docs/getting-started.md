# Getting started

[← Angbao](../README.md) · [Architecture](architecture.md) · [Evidence and current limits](submission-evidence.md)

The first useful result needs no Angbao account. Choose your existing agent or a terminal; both use the same private runtime and optional local app.

## Choose a route

| Route | Best for | What to expect |
| --- | --- | --- |
| **Install with your agent** | A personal agent with trusted execution tools and persistent storage | Give it the official guide. It checks its environment, explains the data location, installs a verified release and loads the skill. |
| **Terminal installer** | A supported macOS/Linux machine with Node 22.13+, npm and curl | Same verified program, no signup. Use the current official guide and live manifest. |
| **Run this source** | Judges and developers reviewing the submitted implementation | Dependency-free local runtime, isolated trial data, direct module access. Instructions below. |

Official guide: **https://www.angbao.money/angbao-install.md**. A web chat without execution tools cannot install software. A cloud agent's `127.0.0.1` is the cloud computer, not your laptop; terminal use still works there. Do not expose the local app through a public tunnel.

## 1. Start a clean source trial

After cloning this repository, run:

```sh
node --version
node cli/angbao.mjs --version
taskReviewData=$(mktemp -d /tmp/angbao-review.XXXXXX)
printf 'Keep this workspace path for restart: %s\n' "$taskReviewData"
env ANGBAO_DATA_DIR="$taskReviewData" node cli/angbao.mjs start --port 4317
```

Expected version: **0.5.11**. Leave the process running and open **http://127.0.0.1:4317/**. Default startup creates only the private local workspace; it does not connect a bank, broker, model, Elfa or wallet. The trial folder is temporary and may be cleaned by the operating system later. Before storing personal work, choose a persistent private directory on the computer that actually runs Angbao.

If port 4317 is occupied, use a free port, such as 4327. In every client below, set `ANGBAO_API_URL` to that same exact loopback address. Do not stop an unrelated listener.

## 2. Preview one result

In a second terminal, enter the repository and set the selected connection:

```sh
export ANGBAO_API_URL='http://127.0.0.1:4317'
node cli/angbao.mjs agent doctor
node cli/angbao.mjs agent sample preview --preset try-savings
```

Doctor checks the matching runtime without reading financial context. Preview uses the complete labelled **Try a savings review** example and saves nothing. The example suggests **USD 150**; it is not based on your balances and adds no extra reserve beyond its protected example reserve.

For a portfolio example, use **Research → Check against portfolio → Try a portfolio check** in the app, or inspect:

```sh
node cli/angbao.mjs agent portfolio sample
```

To use personal values, explicitly supply current cash/goals/limits or a dated portfolio and targets. Read back those inputs before requesting a review. There is no live account verification; unknown figures stay unknown. See [complete portfolio inputs](../integrations/angbao/references/portfolio-checks.md).

## 3. Save deliberately, then inspect

A preview and a save are separate. Read the current workspace revision:

```sh
node cli/angbao.mjs agent context
```

Its JSON includes `etag`, for example `"0"`. Use the actual returned value, including the inner quotes, and a fresh non-secret operation identifier:

```sh
node cli/angbao.mjs agent sample save --preset try-savings --etag '"0"' --key first-sample-review-001
node cli/angbao.mjs agent history --limit 10
```

Replace `"0"` if your returned ETag differs. A sample save adds one labelled result; it does not overwrite personal figures or installed strategy settings. Record the returned review ID. The GUI reads that same history.

An operation key identifies one write; it is **not an API key**. If a response is uncertain, keep its exact key, request body and ETag and inspect saved state. Do not create a new key and rerun an uncertain save. Changed inputs under the same key conflict; a stale ETag asks you to review current state.

## 4. Restart without losing work

1. Stop only this Angbao server with **Control-C** in its original terminal.
2. Start the same program with the **same data path** and port:

```sh
env ANGBAO_DATA_DIR='/the/exact/path/printed/in-step-1' node cli/angbao.mjs start --port 4317
```

3. In the second terminal, run `node cli/angbao.mjs agent history --limit 10` again.

The saved record and settings should return. A new empty data path is a different workspace; it does not mean the old work was lost. Do not copy a live transaction journal to create another writer or delete an uncertain operation to make progress.

## 5. Export and continue exact work

```sh
node cli/angbao.mjs export --out /a/private/new/angbao-export.json
node cli/angbao.mjs agent handoff --review REVIEW_ID
```

Replace both placeholders. Export requires an existing parent directory and a new filename; it refuses to overwrite a file. The normal native export preserves settings and retained active/archived portfolio history. Keep it private. The separate `--claim` format is for a later explicit hosted import and cannot carry an archive; it is not the recommended backup.

The handoff selects an exact saved record. **Copy for another agent** in the app produces the same kind of reference without embedding financial figures or credentials. The receiving agent needs its own valid connection to the same workspace. A reference is not access permission, automatic synchronization or the other agent's private conversation memory.

After five active portfolio proposals, archive older ones rather than deleting history or paying to unlock a local save. The current archive bound is 64 proposals; see [portfolio history](../integrations/angbao/references/portfolio-checks.md). These are storage safety limits, not subscription allowances.

## Use your existing agent

An installation is complete only when the agent loads the skill and returns a useful result from the actual runtime. A download or displayed logo is insufficient. The submission has accepted **Codex** in one named installed-harness path; Grok Bot, Dots, Instinct, Hermes and other agents require their own end-to-end acceptance before being called compatible.

For a source checkout, have the agent read [the skill](../integrations/angbao/SKILL.md) and use the absolute source/CLI path. To copy the packaged skill into a chosen project directory:

```sh
node cli/angbao.mjs skill install --dest /an/existing/private/parent/angbao
```

The final `angbao` directory must be new; existing/symlink destinations are refused. Use the physical parent path (for example, obtain it with `pwd -P`): on macOS, `/tmp` and `/var` may be symlink aliases and are correctly refused by this installer. This command does not discover or edit your harness's global configuration. Let the harness load that exact project skill using its supported mechanism.

Useful first prompts:

> Show me a labelled savings-review example without saving it.

> Review this supplied article against the dated portfolio and limits I provide. Keep the evidence, assessment and unknowns separate. Preview first; ask before saving.

> Open this exact saved record. Explain what changed since it was saved, and keep its original method and settings.

Default tools do not fetch an X/Telegram/Substack URL, invoke a model or grant wallet access. Your personal agent provides its own reasoning; it must supply source text it is authorized to access.

### Optional stdio MCP

Start the local server first. Configure the agent's own supported MCP connection using your actual absolute paths:

```json
{
  "mcpServers": {
    "angbao": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/angbao-robinhood/cli/angbao.mjs", "mcp"],
      "env": {"ANGBAO_API_URL": "http://127.0.0.1:4317"}
    }
  }
}
```

This is a template to adapt, not a universal harness import format. Use Node 22.13+ for both server and bridge. The bridge is pinned to MCP protocol **2025-06-18**. Confirm initialize, discovered tools, exact saved-record read and useful return in your chosen harness. Do not silently modify global settings.

Default local mode trusts clients on that computer's OS account. For separately scoped read-only clients, see [protected local access](product/local-scoped-clients.md); that mode is not an automatic permission upgrade or a writable cloud service.

## Optional provider and wallet work

| Need | What to do |
| --- | --- |
| **Elfa evidence** | Begin with `node cli/angbao.mjs elfa guide`. An owner must separately provision eligible private access, reviewed budgets and the exact query approval. No provider is activated by install. |
| **Robinhood checkpoint** | Read [the accepted evidence](submission-evidence.md) and [owner controller](product/checkpoint-owner-controller.md). The submission used an assisted owner profile and separate MetaMask approvals; ordinary startup cannot sign or deploy. |
| **Hosted sync / subscription** | Not launched. Continue local use; no account is required to recover or export local work. |

The full source contains historical simulation/advanced operator paths. `--managed` is a plan simulation; it does not collect payment or start a background worker. Use the dated [status guide](submission-evidence.md) rather than assuming every source flag is an activated service.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Node import/SQLite error | `node --version`; use Node 22.13+ in the server, CLI and MCP process. |
| Connection refused | Server must be running; client `ANGBAO_API_URL` must match its printed loopback origin. |
| Port in use | Choose a different free port and update every client; do not kill an unrelated app. |
| Empty history | Confirm the exact saved data path and runtime. Preserve the original files. |
| Save conflict / stale revision | Read state, compare changes and use the current ETag for a newly reviewed action. Preserve original uncertain-operation identity. |
| Agent can't open local GUI | The runtime may be on another computer. Use CLI/MCP there; do not expose its unauthenticated loopback app publicly. |
| Source citation lacks content/date | Retain it as link-only/unknown. Supply new verified source material before relying on it for sizing. |
| Wallet/provider unavailable | Ordinary research and local reviews still work. Setup does not promise a funded wallet, provider credit or authority. |

Status verified for this guide: **25 October 2026**, source snapshot 0.5.11. Source-mode checks are separate from real browser, named-harness, provider and chain evidence.
