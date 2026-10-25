# Development and release guide

[← Angbao](../README.md) · [Getting started](getting-started.md) · [Architecture](architecture.md) · [Evidence](submission-evidence.md)

This repository is a deliberately clean submission snapshot. It contains the distributable local app and an independently reproducible fixed contract build, not the private development history, deployment configuration, full test suite or user data. Its package is marked `private`; it is not published to npm.

## Repository layout

```text
cli/                         CLI, setup, local/hosted clients, stdio bridge
integrations/angbao/          Project skill, tool references, templates
server/server.mjs            Local HTTP/runtime composition
src/domain/                  Pure financial/research/record protocols
src/server/                  Persistence, access, operator and recovery bindings
src/integrations/            Provider, chain and wallet adapters
src/vendor/                  Pinned codecs and third-party notices
ui/                          Local inspection/control app
contracts/                   Solidity source and fixed build artifact
scripts/checkpoint-tooling/  Isolated compiler/EVM development dependencies
scripts/build-angbao-commitment.mjs
examples/                    Typed source/research/portfolio inputs
```

Runtime: **Node >=22.13**, built-in modules, zero npm runtime dependencies. Start with `node cli/angbao.mjs --help` and `node cli/angbao.mjs agent help`. There is no top-level `npm test`, `npm start` or build script in this minimal snapshot.

## Reproduce the local path

Follow [getting started](getting-started.md) with a new synthetic workspace. Exercise preview → explicit save → history → exact handoff → stop/restart with the same data directory → export. Use a distinct free loopback port and stop only the process you started. Keep the original workspace and program separate.

Source-mode CLI/HTTP success is **not** acceptance of a browser, installed archive, named personal agent, live provider or wallet. Each surface needs its own actual check. A test harness using fake transport is useful regression coverage and must remain labelled simulated.

## Reproduce the fixed contract build

The source, exact compiler input, ABI, bytecode and provenance are in [`contracts/angbao-commitment.build.json`](../contracts/angbao-commitment.build.json). Install only the isolated pinned tools into a new temporary directory:

```sh
taskToolingRoot=$(mktemp -d /tmp/angbao-checkpoint-tooling.XXXXXX)
cp scripts/checkpoint-tooling/package.json scripts/checkpoint-tooling/package-lock.json "$taskToolingRoot/"
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --prefix "$taskToolingRoot"
env ANGBAO_CHECKPOINT_TOOLING_DIR="$taskToolingRoot" node scripts/build-angbao-commitment.mjs --check
```

`npm ci` downloads the pinned development tooling; it does not install runtime dependencies into the app. `--check` compiles offline against the retained input and compares the artifact. It does **not** connect to RPC, create a wallet, deploy, sign or send a transaction. Detailed [build provenance](product/decision-checkpoint-build.md) and [tooling guide](../scripts/checkpoint-tooling/README.md) are retained. Historical references to private repository tests in those packaged documents are not runnable from this minimal snapshot.

## API and persistence rules

- Discover the actual local capabilities/tools; do not assume a hosted connection exposes the same set.
- Keep canonical domain validation separate from transport, persistence and GUI presentation.
- Treat source/provider content as untrusted data. Preserve missing fields, source classification and dates; do not invent holdings or upgrade a summary into original text.
- Preview/normalization is pure; saving is explicit. Writes require the exact expected ETag and non-secret idempotency key.
- Preserve an uncertain write's key, payload, ETag and result history. Never silently convert an uncertain external action into a new retry.
- Keep one writer per workspace/store and one canonical owner-operation journal. Do not clone a live sender's journal to run two controllers.
- Imported/exported history is inspectable data, not signing authority. Credentials, grants and private openings are outside ordinary exports.
- Signing, provider activation and payments are separate capabilities with their own owner review; an authenticated agent is not automatically authorized to spend.

## A practical change workflow

1. Identify the exact source/release and existing owner of the files before editing. Read current interfaces and implementations rather than creating duplicate adapters.
2. Use one branch/worktree per simultaneous bounded packet. Separate UI copy/docs from shared runtime edits. Agree on named files and an interface seam.
3. Preserve original data and frozen archives. Start checks with a fresh synthetic copy; no secrets or personal source material in fixtures.
4. Run checks appropriate to the change, then validate the actual joined path. Do not substitute another backend script when the missing gate is a browser/wallet/client.
5. Hand off the checkout, branch, base/result commit, exact files, interface, checks/proof boundaries, blockers and next owner. Integrate reviewed commits serially.
6. For release, build into a new allowlisted directory; compare packaged files against the pinned source and manifest. Do not overwrite a published version.
7. Verify the actual served bytes, fresh/repeat installation, retained-data upgrade, return/restart/export and any advertised named harness. Publish only claims supported by that exact artifact.

## Release identity and public snapshot

| Identity | Meaning |
| --- | --- |
| `6e1dc8dd36f64f63e568956928e3fb6bd027f10a` | Private development source pin for accepted personal-local 0.5.11 |
| `40cded3d7bd43100b378fb391a7676362175b75f` | Initial clean public snapshot: released files plus fixed contract tooling; no private history |
| Archive SHA-256 `febde006ba467da6b8a7904c44e69039009b79555c3f1d88284d361327ced0f5` | Exact 659,174-byte accepted 0.5.11 package |
| Later documentation commit | Can improve these guides without changing the frozen program/archive or its onchain evidence |

The public live [release manifest](https://www.angbao.money/release.json), not an old embedded example version, selects the current installation artifact. Packaged operational manuals preserve wording from their source date, including earlier “candidate”/0.5.10 statements. Use the dated [submission status](submission-evidence.md) and actual live manifest for release status; do not alter frozen archives to fix history.

## Security and privacy when contributing

Do not commit `.env` files, API/RPC credentials, bearer tokens, provider exports, personal portfolio snapshots, private opening/salt, a transaction journal, browser state or private Git history. Logs and screenshots can also disclose these. A public transaction hash and a private operation journal are different artifacts.

Use a clean allowlist and inspect staged files before publication. Retain all third-party headers/provenance. The repository has no general license grant beyond existing per-file notices; obtain an explicit project licensing decision before treating it as an unrestricted open-source dependency.

For a security finding, contact the maintainer through an agreed private channel rather than publishing secrets or exploit-sensitive user data in an issue. A formal vulnerability disclosure program and security audit are not claimed.

## What remains before a managed production launch

The local submission and testnet checkpoint are working bounded products. They are not a launched managed financial service. Hosted production additionally needs:

- Accepted authentication/email/callbacks and real two-owner data isolation.
- Durable service supervision, private volume, backup/restore/deletion, monitoring and incident ownership.
- Conflict-aware multi-installation synchronization and migration with explicit owner review.
- A fulfilled entitlement/refund lifecycle before accepting subscriptions.
- Bounded job mandates, provider/model budgets, cancellation/revocation and uncertain-effect reconciliation.
- Chain/asset/venue-specific acceptance for any real funds action, with execution-enforced limits and separately reviewed operational/compliance obligations.

These gates should be accepted in their own scope; they must not be inferred from a login page, setup account, test credit or passing mocked request.
