# Isolated checkpoint compiler and local EVM

Development dependencies only: `solc@0.8.30`, `@ethereumjs/evm@10.1.2`, `@ethereumjs/common@10.1.2`, `@ethereumjs/util@10.1.2`. The v3 lockfile pins every transitive package, official npm registry URL and SHA-512 package integrity. Transitive versions can differ from the four direct pins; the full lockfile is authoritative. No root dependency/lockfile change, lifecycle script, application package inclusion, provider or wallet is required.

From the repository root, install exact copies of these manifests to a disposable external directory:

```sh
taskToolingRoot=$(mktemp -d /tmp/angbao-checkpoint-tooling.XXXXXX)
cp scripts/checkpoint-tooling/package.json scripts/checkpoint-tooling/package-lock.json "$taskToolingRoot/"
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --prefix "$taskToolingRoot"
export ANGBAO_CHECKPOINT_TOOLING_DIR="$taskToolingRoot"
node scripts/build-angbao-commitment.mjs --check
ANGBAO_CHECKPOINT_EVM_REQUIRED=1 node --test tests/angbao-commitment-evm.test.mjs
```

The build tool requires the external manifests to be byte-identical to the tracked manifests and checks direct installed versions, compiler version and pinned registry/integrity entries. `npm ci` verifies package tarball integrity. The artifact also records the compiler's `soljson.js` SHA-256. It is still a software supply-chain trust boundary, not an independent formal verification of the compiler or all installed code.

The default command reads and checks the retained artifact byte for byte. `--write` explicitly regenerates **only** `contracts/angbao-commitment.build.json` from the fixed existing source/settings; inspect any diff before accepting it. It never installs tools, fetches imports, loads a remote compiler, talks to a node or activates a source registry. A changed source hash or compiler version is rejected. `--check` works independently of the shell working directory when invoked by absolute path.

Without installed optional tooling, the root application's broad test glob reports these local EVM tests as explicitly skipped; that is not EVM acceptance. The required environment flag above converts missing tooling into a hard failure. Main/reviewers must use it for this packet's acceptance. With tooling present, build or execution failures always fail the tests.

The default lookup is this directory, but the external prefix is recommended to keep generated dependencies out of Git. Installed tools under `/tmp` can be removed after review, after confirming the exact chosen directory; they contain development dependencies, not application data. Do not remove existing Angbao runtime, journal or salt data.

See [the build contract](../../docs/product/decision-checkpoint-build.md) for provenance, local-only proof limits and remaining product integration.
