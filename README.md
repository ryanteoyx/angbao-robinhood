# Angbao

Financial context for your personal agent. Angbao is a signup-free local CLI, MCP tool layer and browser workspace for research, portfolio proposals, saved decisions and export.

This source snapshot is **personal-local 0.5.11**, pinned to development commit `6e1dc8dd36f64f63e568956928e3fb6bd027f10a`. Its runtime, UI and skill are the exact 143 files distributed in the release archive, plus six contract-build files from that commit. Archive SHA256: `febde006ba467da6b8a7904c44e69039009b79555c3f1d88284d361327ced0f5` (659,174 bytes).

## Run locally

Requires Node.js **22.13.0 or later**. The local runtime has zero npm dependencies. From this repository, choose a new disposable workspace; keep its path for later restarts:

```sh
node cli/angbao.mjs --help
taskReviewData=$(mktemp -d /tmp/angbao-review.XXXXXX)
env ANGBAO_DATA_DIR="$taskReviewData" ANGBAO_API_URL='http://127.0.0.1:4317' node cli/angbao.mjs start --port 4317
```

Open `http://127.0.0.1:4317/`. In a second terminal:

```sh
env ANGBAO_API_URL='http://127.0.0.1:4317' node cli/angbao.mjs status
env ANGBAO_API_URL='http://127.0.0.1:4317' node cli/angbao.mjs review --demo
env ANGBAO_API_URL='http://127.0.0.1:4317' node cli/angbao.mjs export
```

If that port is occupied, use a free port and the same matching `ANGBAO_API_URL` in every client. Preserve existing data and run only one writer for a workspace. Sample proposals are synthetic; these commands do not connect a broker, fetch a model or provider, trade, or enable a wallet.

For personal-agent setup, read [AGENT-QUICKSTART.md](AGENT-QUICKSTART.md) and [the skill](integrations/angbao/SKILL.md). The chosen agent must actually load the skill; installation alone is not a compatibility claim.

## Robinhood Chain checkpoint

The optional owner profile records a fingerprint of a retained proposal on Robinhood Chain Testnet. `AngbaoCommitment` stores a write-once commitment per caller and operation reference. It does not verify private inputs, research truth, policy correctness, performance or financial authority. Contract creation and recording a proposal require separate explicit owner wallet approvals. Normal startup does not activate this profile.

The source/build artifact is separate from transaction and deployment evidence supplied with the project submission. No broker trading or automatic investment execution is claimed. Hosted sync, paid fulfillment, maintained jobs and multiplayer are separate rollout work.

## Reproduce the fixed contract build

The artifact includes literal Solidity source, exact compiler input, ABI, bytecode and provenance. To check it, install the isolated pinned development tools into a temporary directory, leaving runtime dependencies unchanged:

```sh
taskToolingRoot=$(mktemp -d /tmp/angbao-checkpoint-tooling.XXXXXX)
cp scripts/checkpoint-tooling/package.json scripts/checkpoint-tooling/package-lock.json "$taskToolingRoot/"
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --prefix "$taskToolingRoot"
env ANGBAO_CHECKPOINT_TOOLING_DIR="$taskToolingRoot" node scripts/build-angbao-commitment.mjs --check
```

See [build provenance](docs/product/decision-checkpoint-build.md). This is an offline compiler/artifact check, not a live transaction or chain-compatibility proof. Historical build documents mention repository tests omitted from this minimal source snapshot.

Existing source headers and third-party notices are preserved. This snapshot adds no new license grant. It contains no credentials, user workspaces, private opening, transaction journal or private Git history.
