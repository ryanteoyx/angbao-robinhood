# Personal-agent installation without signup

**Install only the manifest-approved release or a separately reviewed private candidate.** The kit is not an npm registry release. Start from the [public installation page](https://www.angbao.money/) and its [agent installation guide](https://www.angbao.money/angbao-install.md). The [release manifest](https://www.angbao.money/release.json) supplies the actual public version, artifact path, size and SHA-256. This source builds the private 0.5.11 candidate; source metadata alone does not publish that version. See the [candidate record](docs/engineering/releases/2026-10-25-0.5.11.md). Earlier archives remain immutable. Preserve the existing program and data folder during side-by-side upgrades.

Use saved reviews and research with the personal agent you already use. Local installation and use need no Angbao account. **Install with your agent** is the preferred entry point; **Terminal** uses the same verified release, with **Download the kit** retained as a fallback. Installation enables no provider/model call, financial action or paid service. A copied prompt, a transport download or a copied skill file is not evidence of a working connection.

## Preferred public installation

The public guide connects four distinct pieces: the skill teaches the agent, CLI/MCP supplies callable tools, the runtime retains context/rules/decisions, and the optional GUI inspects the same saved work. Give the current guide URL to an agent with trusted execution tools. It checks the environment, explains the actual data location, installs the verified release and loads its project instructions before doing one useful research or portfolio preview. Opening a GUI or creating an account is not a prerequisite for that first result.

The supported bootstrap path requires **macOS or Linux, Node.js 22.13.0 or newer, npm and curl already installed**. It does not install Node or establish Windows compatibility. After the environment and persistence checks below, the terminal convenience command is:

```sh
curl --proto '=https' --tlsv1.2 -fsS https://angbao-platform.vercel.app/install.sh | sh
```

For an agent, prefer downloading `install.sh` to a new private temporary directory, inspecting it and checking its digest against the current public guide before running that file. Do not fetch a similarly named script from another origin. To preview the plan through the terminal path:

```sh
curl --proto '=https' --tlsv1.2 -fsS https://angbao-platform.vercel.app/install.sh | sh -s -- --dry-run
```

The shell downloads a checksum-pinned Node bootstrap; the bootstrap uses its pinned release metadata to verify the exact archive path, byte count and SHA-256. It installs the dependency-free archive offline with lifecycle scripts disabled. Dry-run downloads temporary bootstrap files but makes no installation, data or settings changes. Installer verification is a separate acceptance surface from the frozen kit; preparing source does not establish public delivery or a named-agent installation.

Default programs live under `~/.local/share/angbao`; default data lives under `~/.angbao`. Those paths belong to the computer actually executing the installer. For an established custom location, pass the actual absolute program and data paths using `--project` and `--data-dir`; run dry-run with those same arguments first. **The bootstrap project is program-only: project and data must be separate directories, with neither nested inside the other.** Reuse the exact known data path, even if an older controller/manual setup stores it below a different project. Choose a separate program root for the new bootstrap instead of moving or copying that data into a new empty workspace.

The bootstrap records the connection in `<project>/.install-receipt.json`, retains versioned programs under `<project>/programs/<version>`, and copies the packaged skill into that version's `skills/angbao` directory. Follow its printed `cliCommand`, `startCommand`, `skillPath` and `receiptPath`; do not replace them with the advanced fallback paths below. It preserves existing data, identities and settings, refuses conflicting or incomplete paths, and does not start a server or edit global PATH, global harness files or MCP configuration. Verify the loaded skill and the expected CLI/runtime connection before reporting readiness.

At candidate preparation on 25 October 2026, the last accepted public guide and frontend deliver immutable 0.5.10; see its [versioned release record](docs/engineering/releases/2026-10-25-0.5.10.md). Publication of 0.5.11 remains pending; the live approved manifest determines public installation. Earlier archives and their packaged instructions remain immutable. Older example versions defer to the approved manifest and actual installed CLI. Root `public-release.json` is the historical frozen 0.5.7 manifest; preserve it and use an explicit versioned manifest for later deliveries. Source metadata alone does not establish a public release.

## Choose where Angbao will keep your data

Before downloading or transferring an archive or installing anything, the agent checks its actual execution tools, supported OS, Node.js >=22.13, npm, curl and persistent private storage. Tool/runtime metadata is sufficient; no personal files, financial Context or history need to be read. A temporary folder that accepts a file is not evidence that data survives the environment's restart. If execution, compatible Node or persistence cannot be verified, explain the missing requirement and stop installation.

Recommend **Keep with this agent**, and explain the actual absolute data-file path and verified execution computer. If one suitable persistent environment is available, proceed within the user's installation request after explaining it; ask for a choice only when multiple suitable locations exist or an existing location is ambiguous. Retain a choice already made. Explain that a cloud computer holds the data only when that host is verified. Do not assume the chat runs on the user's Mac or computer. Offer **Keep on my computer** only if a connected trusted tool can actually execute there.

Preserve an existing installation, its saved paths, installation identity, strategy settings and any explicitly selected hosted connection. These steps create a new private program directory only after the suitable location is established; they do not reset data or silently switch connections. They do not expose loopback through a public tunnel, change global configuration or bypass authentication. See [connection setup](integrations/angbao/references/connection.md) for the runtime probe and connection checks. If an older reference requires a redundant storage choice, retain the already established suitable location instead.

A Node version below 22.13 needs a separately approved supported runtime before this recipe can continue. Keep any such runtime in a separate fresh private bootstrap folder outside the chosen workspace, verify its official release, use its absolute executable or per-command process environment, and recheck its version for npm, Angbao and MCP. Do not replace shared/global Node or claim installation succeeded.

Private permissions separate OS users; agents sharing one system account can still access each other’s folders. Explain verified shared-host access before the user chooses where data stays.

## Advanced fallback: continue an existing controller setup

Use the resumable controller when continuing its already recorded checkpoint or when an operator explicitly chooses this advanced archive-based route. New public installations should use the guide/bootstrap above. The controller has its own project/data layout and must not be overlaid on a bootstrap project or invoked merely because the bootstrap has already installed a program. A verified setup checkpoint retains the established location, exact program/runtime and saved workspace identity. It contains no financial inputs or review bodies. Setup never runs a review or requests signup.

The agent first verifies the supplied archive against the approved release manifest or a separately trusted operator digest, then extracts it into a new private staging folder. Run its `cli/setup.mjs` with an available Node runtime. The controller can report a missing or older runtime; it does not download a runtime or wake a computer. Supply a verified Node 22.13+ executable and its expected binary digest through the private configuration. Fill the example version, archive path and digest from the approved manifest; use the actual confirmed paths and verified runtime digest. Keep the setup configuration and diagnostics private.

```json
{
  "project": "/confirmed/angbao",
  "program": {
    "prefix": "/confirmed/angbao/programs/0.5.7",
    "version": "0.5.7",
    "nodePath": "/verified/node/bin/node",
    "nodeSha256": "OPERATOR_VERIFIED_NODE_BINARY_SHA256",
    "archive": "/private/staging/angbao-personal-local-0.5.7.tgz",
    "sha256": "APPROVED_MANIFEST_ARTIFACT_SHA256"
  },
  "connection": { "origin": "http://127.0.0.1:4317" },
  "hostReady": true
}
```

```sh
/verified/node/bin/node /private/staging/package/cli/setup.mjs init --config /private/setup.json
/verified/node/bin/node /private/staging/package/cli/setup.mjs status --project /confirmed/angbao --version 0.5.7
/verified/node/bin/node /private/staging/package/cli/setup.mjs resume --project /confirmed/angbao --version 0.5.7
```

Use `--json` only for private agent diagnostics. A successful checkpoint is based on readback, not a command being dispatched. If the host becomes unavailable, retain the checkpoint and explain the actual platform action needed; `--host-ready no` records that current prerequisite. Waking a cloud computer remains a platform capability. Once it is available, resume with `--host-ready yes`.

For an existing installation, keep the actual data folder and origin. Explicit adoption requires its known `connection.installationId`, a matching running connection and the exact existing program prefix. A side-by-side update uses a new versioned prefix and the same verified installation ID. It never replaces the old prefix or changes financial settings. If the old server still occupies the selected address, the controller waits: the agent must verify and stop only that recorded Angbao process before resuming the new version. Never enumerate unrelated processes or take over a port. A server reporting the old version is not proof that the new program is ready.

Short progress should read: **Preparing Angbao**, **Waiting for the setup file**, **Checking your saved connection**, then **Angbao is ready**. Put paths, runtime details, checksums, ports and operation keys in optional private diagnostics. When something is missing, give one concrete next action and retain the choice already made. Readiness says nothing about a review being run.

## Advanced fallback: manual archive installation

This recipe is an alternative to the public bootstrap, not its next step. Its legacy layout puts `data` below its manual project and uses `runtime/bin/angbao`; the bootstrap deliberately uses separate program/data directories and prints different exact commands. Do not pass this manual project/data pair to bootstrap `--project`/`--data-dir`. Preserve an existing manual setup in place, or adopt its unchanged data with a different separate bootstrap program root. All later command examples using `$ANGBAO_PROJECT/data` and `$ANGBAO_BIN` retain this manual fallback layout; bootstrap users keep the explicit connection printed by their installer.

The following recipe is for a verified macOS/Linux terminal on the chosen computer. Paths must belong to that computer. Establish matching commands and the binary layout before using another operating system. Obtain the expected SHA-256 and size from the approved public release manifest, or a separately trusted operator record for an explicitly chosen private candidate. A hash calculated only from the received archive does not authenticate it. A manifest and archive fetched from one site establish checksum agreement, not independent publisher authentication; use the trusted installation page or operator record to establish the intended release. Do not install a similarly named npm registry package.

Keep the already established suitable location. Public installations use the approved manifest and its exact versioned download; an explicitly chosen private candidate still needs its operator-provided archive, digest and guide. If the required file or trusted release record is missing, explain what is needed without asking for the storage choice again. Do not guess a public npm package or repository link.

Use the established absolute physical path under its existing persistent parent. The check below creates the manual project or accepts a deliberately selected, current-user-owned empty directory created during setup. It refuses symlinks, another owner's folder and any nonempty directory. Existing saved workspaces must use their recorded connection instead of this fresh-install recipe.

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

After establishing the storage location, download the public manifest into the new manual project's `incoming` folder. This fresh-install recipe does not apply to a nonempty existing workspace. For a private candidate, retain its separately supplied manifest/digest and use the authorized transfer channel instead.

```sh
ANGBAO_RELEASE_BASE='https://angbao-platform.vercel.app'
ANGBAO_RELEASE_MANIFEST="$ANGBAO_PROJECT/incoming/release.json"
ANGBAO_APPROVED_VERSION='0.5.7'
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$ANGBAO_RELEASE_MANIFEST" "$ANGBAO_RELEASE_BASE/release.json"
env ANGBAO_RELEASE_MANIFEST="$ANGBAO_RELEASE_MANIFEST" ANGBAO_APPROVED_VERSION="$ANGBAO_APPROVED_VERSION" node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const release = JSON.parse(readFileSync(process.env.ANGBAO_RELEASE_MANIFEST, 'utf8'));
const version = process.env.ANGBAO_APPROVED_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version) || release.format !== 'angbao-public-release@1' || release.packageName !== 'angbao-personal-local' || release.version !== version) throw new Error('The manifest is not the intended release. Keep the existing installation.');
const artifact = release.artifact;
if (artifact?.fileName !== `angbao-personal-local-${version}.tgz` || artifact.path !== `releases/${version}/${artifact.fileName}` || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 4194304) throw new Error('Invalid versioned artifact or checksum.');
if (release.requirements?.node !== '>=22.13.0' || release.requirements.dependencies !== 0 || release.requirements.lifecycleScripts !== false || release.availability?.signupFree !== true || release.availability.accountRequired !== false) throw new Error('Unexpected installation requirements.');
console.log('Approved manifest checked. Download its exact versioned artifact next.');
NODE
```

After that validation, derive the file name and download path from the saved manifest. These commands download data only; they do not execute a remote script. Stop on any failed command.

```sh
ANGBAO_RELEASE_VERSION="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version' "$ANGBAO_RELEASE_MANIFEST")"
ANGBAO_ARTIFACT_PATH="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).artifact.path' "$ANGBAO_RELEASE_MANIFEST")"
ANGBAO_ARCHIVE="$ANGBAO_PROJECT/incoming/angbao-personal-local-$ANGBAO_RELEASE_VERSION.tgz"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$ANGBAO_ARCHIVE" "$ANGBAO_RELEASE_BASE/$ANGBAO_ARTIFACT_PATH"
env ANGBAO_ARCHIVE="$ANGBAO_ARCHIVE" ANGBAO_RELEASE_MANIFEST="$ANGBAO_RELEASE_MANIFEST" node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { artifact } = JSON.parse(readFileSync(process.env.ANGBAO_RELEASE_MANIFEST, 'utf8'));
const bytes = readFileSync(process.env.ANGBAO_ARCHIVE);
const actual = createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== artifact.bytes || actual !== artifact.sha256) throw new Error('Archive size or checksum mismatch. Stop; do not install this file.');
console.log('Archive size and SHA-256 match the approved release manifest.');
NODE
```

Proceed only after that check succeeds. The separate prefix below does not change global PATH. npm remains offline, and lifecycle scripts are disabled.

```sh
npm install --global --prefix "$ANGBAO_PROJECT/runtime" "$ANGBAO_ARCHIVE" --offline --ignore-scripts --no-audit --no-fund --cache "$ANGBAO_PROJECT/npm-cache"
ANGBAO_BIN="$ANGBAO_PROJECT/runtime/bin/angbao"
"$ANGBAO_BIN" skill install --dest "$ANGBAO_PROJECT/skills/angbao"
```

The skill destination is absolute, fresh, ends in `/angbao`, and has existing non-symlink parents. The installer refuses overwrite and never edits global harness instructions, MCP configuration or credentials. This copies a project skill; verify that the chosen agent can load skills from that location before claiming it is active. The archive is dependency-free and uses an explicit source allowlist excluding private data, environment files and keys.

Only when preparing a separate unpublished candidate, an operator generating an archive from reviewed source can run `node /absolute/reviewed/checkout/scripts/pack-personal-cli.mjs --out /absolute/output/folder`, then provide the actual archive path and its SHA-256 to the recipient through a trusted channel. Generate the checksum after packaging; do not copy one from another version.

## Start once and connect explicitly

For the preferred bootstrap path, use its printed start command and retained receipt connection. The following examples continue the manual fallback only; do not replace a bootstrap data path or origin with them.

Start or reuse one server for the confirmed data directory. If a matching server is already running, use it. If the port belongs to a different workspace, resolve that connection before starting another. Keep the server in the chosen environment's supported retained process session:

```sh
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" start --port 4317
```

In a separate client terminal, set the same confirmed project and use the full binary path. No global PATH edit is needed:

```sh
ANGBAO_PROJECT='/actual/confirmed/persistent/angbao'
ANGBAO_BIN="$ANGBAO_PROJECT/runtime/bin/angbao"
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent doctor
```

Doctor reports capabilities and installation identity without financial reads. Record the actual computer, binary path, data-file path, installation ID and loopback origin for next time. Data lives in `$ANGBAO_PROJECT/data/workspace.json`. On restart use that same folder and one server, rather than creating a new workspace. `ANGBAO_DATA_DIR` must be explicit so this installation does not fall back to `~/.angbao`. The client origin must match the chosen server; it is not selected by `ANGBAO_DATA_DIR`. If the port changes, update both `start --port` and every client's `ANGBAO_API_URL`.

The optional GUI shares saved record IDs but its loopback URL opens only from a computer/browser that can actually reach it. A cloud agent's loopback URL is not automatically reachable from the user's computer. Do not open a public tunnel to work around that.

## First and repeat local value

Only after the user asks to use saved inputs, read the needed Context and choose a supported exact strategy and numeric settings. These examples keep the explicit connection from above:

```sh
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent strategies
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent context
# Sample review example only: use the actual returned ETag and the user's chosen pin/settings.
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent review --strategy cash-buffer@1.1.0 --settings '{"extraReserve":0}' --etag '"0"' --key first-sample-review-001
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent history --limit 5
```

A fresh workspace uses labelled sample Context. The example pin is a choice for a fresh sample review; existing installations retain their saved exact pin and settings. Personal inputs need the complete manual declaration below. A review saves a calculation and its input/policy snapshots, then returns its ID; it moves no funds. For a genuinely new review, use the latest returned ETag and a new non-secret operation key. Recovery uses the original body, key and ETag exactly, with no automatic retry. A changed payload under the same key or a stale revision is rejected.

The simple `status`, `review --demo|--manual` and `export --out` commands remain available through the same full binary and explicit environment. Exports are private new files and refuse overwrite. `--managed` is simulation only. The default `agent` and `mcp` paths use the local workspace without an account or token.

For stdio MCP, use the absolute binary and args `["mcp"]`, with explicit environment entries for this data directory and matching loopback origin. Start or reuse the server first. MCP is pinned to `2025-06-18`; discover the bounded local tools on the actual connection (hosted tools are filtered by scope). The terminal path does not require MCP. Configure only the chosen project transport; do not change global harness settings automatically. Each named external client still needs its own connection test. [Connection limits](integrations/angbao/references/connection.md), [commands](integrations/angbao/references/commands.md).

## Remember research locally

```sh
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent briefs list
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent briefs read --id SAVED_VERSION_UUID
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent briefs save --file "$ANGBAO_PROJECT/final-brief.json" --etag '"1"' --key first-brief-save-001
```

The optional GUI offers New brief: a guided form for sources, claims, inferences and gaps, with a preview before explicit saving. Advanced JSON uses the same payload; Copy brief format can be pasted directly into that editor. No sign-in, source fetch or provider/model call is needed. The personal agent supplies only the final synthesis the user wants to retain. All reported sources and times remain unverified. The latest 20 visible versions are bounded; replay records may retain older copies. Keep credentials and private reasoning out of briefs. [Authoring schema](integrations/angbao/references/research-memory.md).

## Carry setup to an account when requested

```sh
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" export --claim --out "$ANGBAO_PROJECT/new-local-claim.json"
```

The local GUI also offers Export setup under Agents. When the user chooses an available hosted import, sign in to the configured deployment, open Agents → Import setup, select that file, preview the destination and settings, then confirm explicitly. No localhost data is uploaded cross-origin or merged silently. Credentials, grants, simulated plan entitlements and financial permissions are excluded. Keep the local original until successful readback. A failed or declined sign-in leaves local use available. This is a one-time import, not background sync or paid managed service.

## Optional authenticated hosted agent

Keep an explicitly chosen hosted connection unchanged. Only when the user chooses a new hosted connection, create a scoped expiring grant in authenticated Agents. Store `ANGBAO_AGENT_TOKEN` in the agent's secret environment and retain `ANGBAO_REMOTE_ORIGIN` as the exact chosen HTTPS origin. Then select hosted mode explicitly through the full installed binary:

```sh
"$ANGBAO_BIN" agent --hosted doctor
"$ANGBAO_BIN" agent --hosted context
# Stdio alternative:
"$ANGBAO_BIN" mcp --hosted
```

An explicit `--origin HTTPS_ORIGIN` also selects hosted mode. Environment credentials alone never switch local defaults. Hosted failures do not fall back to samples. Native remote MCP can use that exact origin plus `/mcp` with manual bearer authentication; OAuth discovery, automatic client registration and universal client compatibility are not implemented. Scopes, consent, budget, expiry and revocation stay enforced. Neither an installation, account nor token grants financial authority. Real deployment, email/session, owner isolation and external-client checks remain separate acceptance work. [Hosted contract](PERSONAL-AGENT-ACCESS.md).

## Own inputs without claiming a verified source

Save the complete values the user supplied in a private JSON file. Choose the strategy and settings explicitly; this synthetic example uses weekly contributions:

```json
{
  "inputMode": "manual",
  "cash": {"available": 3200, "upcomingBills": 400, "monthlyIncome": 2500, "monthlyExpenses": 1800, "currency": "SGD"},
  "goals": [{"id": "my-goal", "name": "My reserve", "targetAmount": 6000, "currentAmount": 1500, "monthlyContribution": 400, "currency": "SGD"}],
  "rules": {"reserve": 2000, "maxSuggestion": 200},
  "strategy": {"id": "weekly-goals", "version": "1.2.0", "settings": {"extraReserve": 0, "periodsPerMonth": 5}}
}
```

Use the current ETag returned by `angbao agent context` for setup, then the new returned ETag for the review:

```sh
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent setup --file "$ANGBAO_PROJECT/context.json" --etag '"0"' --key local-setup-20261024-001
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent review --strategy weekly-goals@1.2.0 --settings '{"extraReserve":0,"periodsPerMonth":5}' --etag '"1"' --key local-first-review-20261024-001
```

Setup saves personal inputs and the chosen strategy in the local workspace. It requires a complete manual declaration, preserves unrelated installed strategies, and does not run a review. In MCP, use `angbao_save_context` with `{declaration, expectedETag, idempotencyKey}`. Setup is local-only; no hosted token is used.

For a later review, inspect current context and confirm whether the values are still current. Save a complete updated declaration first if needed. Then use the exact earlier review ID and the latest ETag:

```sh
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent repeat --review SAVED_REVIEW_UUID --inputs-confirmed yes --etag '"2"' --key local-repeat-20261024-001
```

Repeat uses that review's exact strategy version, settings and goal against current saved inputs. It never restores old balances or substitutes today's installed settings. The result includes the new review and a deterministic comparison of saved snapshots. Missing history or an unsupported original version requires a new explicit choice. Currency/data-mode/version changes are not treated as directly comparable monetary changes. No reported difference is a return or a completed financial action. The CLI reads a bounded 20-review history window.

The optional GUI offers Start first review and Review again, with the same saved inputs and records. Dates shown as due are review prompts; no background job is scheduled. Do not paste bank/provider credentials, keys or private chain of thought. The API validates money, goals/currency and rules. A mode transition in either direction requires complete cash/goals/rules; changing the label alone fails. Merely editing sample fields does not silently mark them manual, and changing mode does not fetch/verify data or replace amounts automatically.

Manual review snapshots are `user-entered-unverified`, with `observedAt:null` and `freshness:"unverified"`. New manual reviews have `demo:false` and `fixtureData:false` for **their input provenance**; application execution/payment restrictions and simulated billing remain. Old sample reviews retain their original immutable labels. No manual declaration grants provider access, verified freshness, financial authority or a paid plan. Hosted data uses the same domain contract with its existing identity/CAS guards; the separate local client does not authenticate to the hosted workspace.

## Same-workspace continuation and release boundaries

Supported continuation includes read-only `agent handoff --review ID` / `--brief ID` and `angbao_read_handoff`, a GUI **Copy for another agent** action, and permission-checked hosted repeats. Discover the tools actually available on the selected running connection; hosted tools remain filtered by their existing scopes and exclude portfolio proposals. Original snapshots/settings and research version links stay intact; writes still require explicit confirmation, revision checks and stable retry identity. A copied reference conveys no credentials or permission. The second local agent uses the existing server; hosted agents each use their own grant.

Current public installation follows the approved manifest. Historical 0.5.7 examples and the separately frozen 0.5.8 candidate do not select the current version; substitute the exact approved version and recorded paths before using an advanced example. The private 0.5.11 candidate requires its own reviewed archive/digest and acceptance before publication. Do not overwrite, repack or relabel any frozen archive. A newer installer or source document does not change the installed package. Same-workspace continuation does not claim ongoing sync, new external-harness acceptance, a deployed hosted acceptance or cross-agent recovery of an uncertain write.


## Local portfolio proposal workflow

Research → Check against portfolio offers guided manual or named synthetic input, inspection and explicit save. The agent retains complete sources, assessment, values, targets, proposal and selected baseline; it grants no financial authority. Use [the packaged portfolio guide](integrations/angbao/references/portfolio-checks.md) for exact typed input/tool contracts and retry/export limits. This is local-only: no new hosted financial scope, source fetch, quote, model, order or schedule is enabled.


The kit includes a separate, default-unavailable owner-funded testnet route. Its explicit operator read grant and later owner wallet action are described in [Owner-funded R1](docs/testnet/OWNER-FUNDED-R1.md). The 0.5.11 candidate also includes the separately reviewed [checkpoint owner profile](docs/product/checkpoint-owner-controller.md); it adopts one canonical journal and requires explicit private operator setup plus separate CREATE and proposal-commit wallet approvals. Installation enables no chain reads or wallet action. Neither route replaces a frozen archive or the current public installer.
