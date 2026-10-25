# Resumable connection setup

Use the approved release manifest and matching archive digest for public installation; a private candidate needs its separately trusted exact digest. Earlier archives and installed programs remain immutable. This private candidate uses 0.5.11 in the examples below; public installation still follows its separately approved manifest. Read the canonical packaged installation guide with `"$ANGBAO_BIN" elfa guide --topic connection` (no Elfa/operator setup is needed). Use its resumable controller: `setup init|adopt --config /absolute/private-config.json`, then `setup status|resume --project /confirmed/project --version 0.5.11`. Keep the same checkpoint after interruption. Adopt a known connection explicitly; upgrades install side by side and preserve the data folder, installation identity, review history and settings.

The controller verifies the supplied runtime, archive and local connection. It does not download runtimes, wake cloud computers, replace an old server or run reviews. If the selected address belongs to an old program or another workspace, resolve that exact connection; do not start a second server or reset data. Query only the verified Angbao process when restart is needed. Keep diagnostics private and show one plain-language next action. No signup is required.

The manual fallback below remains available to an agent with verified terminal access. Use it only for a fresh project; it is not a resume or upgrade procedure.

# Choose the computer and data folder first

For a new installation, check the agent's actual execution tools, Node.js >=22.13 and a private folder that survives the environment's restarts. Inspect runtime and folder metadata only; do not read personal files or financial Context. A successful write/read probe proves writability, not long-term retention. Verify persistence through the environment or operator, and stop if it cannot be established.

Recommend **Keep with this agent** and show the real absolute file location: `<confirmed project>/data/workspace.json`, on the verified execution computer. Only call it a cloud computer when the tool/environment evidence says so. Do not assume the agent runs on a Mac or on the user's computer. Offer **Keep on my computer** only when a connected trusted execution tool can run there and the user chooses it. Confirm the location before transferring the private archive or installing. If that choice was already made, retain it.

Preserve an existing installation and its data folder. Preserve an explicitly selected hosted connection. Do not run this fresh-install recipe over either one, change global configuration, open a public tunnel or bypass authentication. No tools, compatible Node or persistent private storage means installation stops with an explanation of what is missing.

A metadata-only runtime probe is enough to check Node; it does not identify the physical or cloud host by itself:

```sh
node --input-type=module <<'NODE'
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || major === 22 && minor < 13) throw new Error('Angbao requires Node.js 22.13 or newer.');
console.log(JSON.stringify({ node: process.versions.node, platform: process.platform, executable: process.execPath }));
NODE
```

If Node is too old, stop this recipe and explain what is missing. A separately approved supported runtime may be prepared in a separate fresh private bootstrap folder outside the chosen workspace from a verified official release (so the empty-project check still applies), without replacing global/shared Node. Use its absolute executable or a per-command process environment consistently for Node, npm, Angbao and MCP, then repeat the version check. Do not claim Angbao is installed while this requirement is unmet.

Private folder permissions separate OS users. They do not isolate agents that share the same system account; explain that verified access when confirming the storage location. Use only the data the user chooses to place in that environment.

## Verify and install the private archive

These commands are for a verified macOS/Linux terminal on the chosen computer. Use paths that actually exist there, not paths copied from another machine. For another operating system, establish its supported commands and binary layout before installing. The archive is private, not published on the npm registry. Obtain its expected SHA-256 from the trusted operator; a hash calculated only from the received file cannot authenticate that file.

Keep the location already confirmed by the user. Wait for the operator-provided private archive, trusted SHA-256 and guide; do not guess a public npm package or repository link. If the file has not arrived, explain that installation is waiting for it without asking for the storage choice again.

Use the confirmed absolute physical path under its existing persistent parent. The check below creates the project or accepts a user-confirmed, current-user-owned empty directory created during setup. It refuses symlinks, another owner's folder and any nonempty directory. Existing saved workspaces must use their recorded connection instead of this fresh-install recipe.

```sh
ANGBAO_PROJECT='/actual/confirmed/persistent/angbao'
umask 077
env ANGBAO_PROJECT="$ANGBAO_PROJECT" node --input-type=module <<'NODE'
import { mkdir, lstat, realpath, readdir, chmod } from 'node:fs/promises';
import path from 'node:path';
const project = process.env.ANGBAO_PROJECT;
if (!path.isAbsolute(project) || path.resolve(project) !== project || await realpath(path.dirname(project)) !== path.dirname(project)) throw new Error('Use the confirmed absolute physical project path.');
try { await mkdir(project, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
const info = await lstat(project);
if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || await realpath(project) !== project) throw new Error('The confirmed project must be an owned directory without symlinks.');
if ((await readdir(project)).length) throw new Error('This folder is not empty. Preserve the existing setup and use its recorded connection.');
await chmod(project, 0o700);
for (const name of ['incoming', 'runtime', 'data', 'skills']) await mkdir(path.join(project, name), { mode: 0o700 });
console.log('Private Angbao project ready at the confirmed location.');
NODE
```

Only now transfer the reviewed archive to that computer's `incoming` folder through the authorized private channel. Set the expected digest supplied by the operator, then verify before installation:

```sh
ANGBAO_ARCHIVE="$ANGBAO_PROJECT/incoming/angbao-personal-local-0.5.11.tgz"
ANGBAO_EXPECTED_SHA256='REPLACE_WITH_OPERATOR_PROVIDED_64_HEX_SHA256'
env ANGBAO_ARCHIVE="$ANGBAO_ARCHIVE" ANGBAO_EXPECTED_SHA256="$ANGBAO_EXPECTED_SHA256" node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const expected = process.env.ANGBAO_EXPECTED_SHA256.trim().toLowerCase();
if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Obtain the operator-provided SHA-256 before installing.');
const actual = createHash('sha256').update(readFileSync(process.env.ANGBAO_ARCHIVE)).digest('hex');
if (actual !== expected) throw new Error('Archive checksum mismatch. Stop; do not install this file.');
console.log('Archive SHA-256 matched the operator-provided value.');
NODE
```

Proceed only after that check succeeds. The separate prefix below does not change global PATH. npm remains offline, and lifecycle scripts are disabled.

```sh
npm install --global --prefix "$ANGBAO_PROJECT/runtime" "$ANGBAO_ARCHIVE" --offline --ignore-scripts --no-audit --no-fund --cache "$ANGBAO_PROJECT/npm-cache"
ANGBAO_BIN="$ANGBAO_PROJECT/runtime/bin/angbao"
"$ANGBAO_BIN" skill install --dest "$ANGBAO_PROJECT/skills/angbao"
```

The skill installer requires an absolute fresh destination ending in `/angbao`, with existing non-symlink parents. It refuses overwrite. This copies a project skill; loading it depends on the agent's supported project skill mechanism. Do not claim it is loaded merely because files were copied, and do not edit the user's global harness settings.

## Start once and reuse the same workspace

Start the server in a retained terminal or the chosen environment's supported process session. Use one server per data directory. Before starting another, check whether the recorded matching server is already running; reuse it when it is. If the port is occupied by another workspace, resolve the connection rather than resetting data.

```sh
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" start --port 4317
```

In the agent's client terminal, set the same confirmed project path again. Use the same data folder and exact loopback origin explicitly:

```sh
ANGBAO_PROJECT='/actual/confirmed/persistent/angbao'
ANGBAO_BIN="$ANGBAO_PROJECT/runtime/bin/angbao"
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent doctor
```

Doctor checks capabilities and installation identity without reading financial inputs. Read Context only when needed for the user's request. Record the computer, full binary path, data-file location, installation ID and loopback origin for repeat use. On restart, use those same paths; do not create another data directory or server. A different port requires the same change in both the server command and every client's `ANGBAO_API_URL`. The optional GUI shares saved record IDs, but its loopback URL opens only from a computer/browser that can actually reach it.

No account, token, provider key, payment or GUI is required. Sample inputs remain sample. Personal inputs require a complete explicit declaration before a separately requested review.

## Optional stdio MCP

If the selected agent supports stdio MCP, use the absolute installed binary with args `["mcp"]` and explicit environment entries for `ANGBAO_DATA_DIR` and `ANGBAO_API_URL` above. Start or reuse the server first. The [template](../assets/mcp-stdio.template.json) is a starting point; only loopback HTTP origins are accepted and no credential is sent. Otherwise use the terminal commands with this skill. Configure one transport when requested, without changing global harness settings automatically.

Discovery confirms the saved installation and accountless capabilities. Repeat use reads its saved settings, reviews and research after restart. Angbao does not replace Codex, Pi, Claude Code or another personal agent. A named external client's MCP compatibility remains unverified until that client's own connection test passes; a protocol fixture is not that acceptance.

# Optional hosted use later

When the user chooses an available hosted capability, sign in to that configured workspace. Export eligible local setup using the same explicit local connection:

```sh
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" export --claim --out "$ANGBAO_PROJECT/new-local-claim.json"
```

Open Agents in the signed-in hosted GUI, preview the file and explicitly confirm the target account and settings. Conflicts require a choice. Keep the local original until successful readback. Failed or declined sign-in does not change local use. This is a one-time import, not automatic synchronization.

A hosted personal-agent connection is separately opt-in: use a scoped expiring grant from authenticated Agents, keep `ANGBAO_AGENT_TOKEN` in the harness secret environment, and set `ANGBAO_REMOTE_ORIGIN` to the exact HTTPS origin. Invoke the same full binary with `agent --hosted ...` or `mcp --hosted`; an explicit `--origin HTTPS_ORIGIN` also selects hosted mode. Environment credentials alone never switch the local default. Preserve a hosted connection the user already selected. Native remote MCP can use that exact origin plus `/mcp` with manual bearer authentication. OAuth discovery/client registration is not implemented, and a hosted error never switches to local samples.

Never put tokens in chat, command arguments, URLs, template files or exports. The skill grants no permissions; provider reads and wallet permissions are separate.

# Transport bounds and acceptance

Stdio supports initialize, initialized notification, ping, tools/list and ten local tools/call operations (including explicit context setup), or up to nine hosted operations filtered by scope. It requires the valid lifecycle and UTF-8 newline-delimited JSON-RPC. Stdout contains only MCP messages. Limits: 32 KiB per input line, 1,000 messages per process, 512 KiB per response and 10 seconds per HTTP request. Redirects and arbitrary proxying are refused. Hosted mode supports a bounded matching SSE response; persistent push/resumable streams are unavailable. Writes never retry automatically.

MCP is pinned to `2025-06-18`. Before relying on a named client, test initialize/tools/list, a consented read, an exact pinned review, same-key replay and inspection of that review ID. Hosted acceptance additionally needs a real owner, expired/revoked grants and owner isolation on the chosen deployment. A local fixture does not establish those deployed outcomes.
