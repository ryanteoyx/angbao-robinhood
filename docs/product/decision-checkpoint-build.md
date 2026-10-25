# Reproducible checkpoint contract and local EVM foundation

This additive development packet builds the existing `contracts/AngbaoCommitment.sol` and executes its creation/runtime bytecode in a disposable JavaScript EVM. It does not modify Solidity, the accepted pure checkpoint modules, root dependencies, application routes, GUI/CLI, existing journals or data. It establishes reproducible local compilation and bounded EVM behavior. It creates no real-chain contract, signed transaction, RPC request, provider grant, public package or submission eligibility.

## Retained provenance

`contracts/angbao-commitment.build.json` contains the fixed virtual source path and full literal source, source SHA-256, compiler long version and `soljson.js` SHA-256, isolated manifest/lockfile hashes, complete Standard JSON input and its SHA-256, raw Standard JSON output SHA-256, ABI/hash, method identifiers, metadata/hash, storage layout, creation/runtime bytes and hashes, and a digest over the complete preceding artifact body. Hashes are SHA-256 of bytes, except explicit ABI selectors/event topics which use Ethereum Keccak-256. JSON field order/UTF-8 serialization is fixed by the script; the artifact is two-space JSON followed by one LF. It contains no absolute checkout path, current timestamp, owner address, secret salt or provider input.

| Item | Fixed value |
|---|---|
| Source SHA-256 | `20af25cd73f46f497bbc398dd75664b1e0ff050ef6a7f4a0c9c68532c2b013b0` |
| Compiler | `solc 0.8.30+commit.73712a01.Emscripten.clang` |
| Compiler soljson SHA-256 | `3bb491a777f76dff9b2fe73ce29ca20e21a971b59a2f2cf8f73415424f00be06` |
| Optimizer | enabled, 200 runs; `viaIR:false` |
| EVM target/model | explicit `shanghai` |
| Metadata | IPFS bytecode hash, appended CBOR, literal source content |
| Libraries/remappings | empty; no external imports, linking or immutables |
| Creation bytes / SHA-256 | 508 / `4027b07c4a3fc57d6a578ea22ea39759a6b9eb146dd1f148f216111f5c19e76f` |
| Runtime bytes / SHA-256 | 480 / `d494186e8cfe35cbe7d8c1cbcc5ff815944517ae9cd300eb5a648c91ee5f586f` |
| Standard input SHA-256 | `2b5a144406643597628cc7235c4732087d42d335ed9e62fc53047c36f76d5d14` |
| Standard output SHA-256 | `92b83ae4053ea1cc00398fa9c052e4f8ff44f149e2afddbafeb0136bd97807ec` |
| Build digest | `680511489b111e193bc1463111ee611dc08a09ff30a93633a27cb851e08f6415` |

The eight-file packet is based on accepted pure checkpoint `59d9ca7c98fb2d2395a3236f07d328e8e6db11c6`. The historical compile note used the same compiler and optimizer but did not retain this full input or a runtime artifact. Its 508-byte size is not an identity assertion. This new artifact explicitly pins EVM target, metadata, source path and all bytes; no historical archive is rewritten. Compiler metadata changes alter bytecode hashes even when behavior is unchanged.

The tooling is pinned in `scripts/checkpoint-tooling/`, with installation to a temporary external prefix. Follow [the isolated tooling instructions](../../scripts/checkpoint-tooling/README.md). `node scripts/build-angbao-commitment.mjs --check` independently recompiles and compares the entire artifact; `--write` is an explicit developer regeneration command. Compiler diagnostics, including warnings, fail this fixed build. There is no import callback, remote compiler loading or automatic dependency installation.

The Standard JSON and EVM target choices follow the [Solidity 0.8.30 compiler interface](https://docs.soliditylang.org/en/v0.8.30/using-the-compiler.html). The EVM harness uses the [EthereumJS bytecode execution library](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/evm), pinned through the official npm registry. SHA/package-integrity checks and local compiler reproduction preserve a reviewable supply-chain boundary; they do not prove that the compiler/library itself is correct.

## What the local execution proves

`tests/helpers/angbao-commitment-evm.mjs` creates an EthereumJS EVM using explicit Shanghai rules, its ephemeral in-memory state manager and default mock blockchain. Two fixed synthetic addresses receive artificial local balances. The harness executes the retained init code in memory, requires the resulting runtime bytes to equal the compiled artifact exactly, and performs direct unsigned EVM message calls. No wallet key, signed transaction, HTTP listener, remote node or chain fork is involved. The model's Ethereum Mainnet chain configuration supplies local opcode rules only; it is not Mainnet or Robinhood execution evidence.

The tests cover deterministic repeated compilation; a fresh compiler process from a different working directory; exact manifest/version enforcement; required-tooling failure; init-code/runtime equality; initially empty state; exact `Committed` emitter/topics/data; getter plus independently calculated nested-mapping storage slot; exact native saved-decision calldata; nonzero-value rejection and value rollback; zero reference/commitment; duplicate rejection and preservation of the original commitment; account and operation isolation; malformed/unknown/plain-transfer calls; static-call and out-of-gas rollback; and no fetch request. Error selectors are independently derived from Keccak signatures in the pinned tooling, and events are checked against the existing ABI constants.

The mapping is write-once per caller and nonzero operation reference. Two callers can use the same reference independently. Nothing in this contract validates a private portfolio opening, research truth, performance, policy correctness, identity ownership or reputation. The native checkpoint test proves local calldata compatibility, while its authority flags remain false. Gas recorded by the EVM is message execution gas, not a real transaction estimate, chain fee, sponsor quote or billing evidence. Local account balances and contract addresses are fixtures.

Without optional compiler/EVM dependencies the root test glob reports explicit skips. Packet acceptance requires `ANGBAO_CHECKPOINT_EVM_REQUIRED=1`, which hard-fails when tools are missing. No skipped test run may be described as real EVM acceptance. Main owns independent review and serial source integration; this artifact is not automatically trusted by the existing source registry or receipt observer.

Author validation on Node `v22.22.3`: all 91 selected tests passed with zero skips, including 16 actual compiler/EVM cases and 75 unchanged pure checkpoint/chain regression cases. Artifact `--check`, syntax checks and Git whitespace checks passed. A separate optional-tooling-absent run explicitly skipped all 16 EVM tests as designed; the required-mode negative independently failed instead of skipping. Reproduce the accepted focused run after installing the isolated tools:

```sh
ANGBAO_CHECKPOINT_EVM_REQUIRED=1 node --test tests/angbao-commitment-evm.test.mjs tests/decision-checkpoint.test.mjs tests/decision-checkpoint-reconciliation.test.mjs tests/chain-operation.test.mjs tests/chain-control.test.mjs tests/chain-journal.test.mjs
```

## Next product seam: private opening and durable intent

The current checkpoint module intentionally leaves the private salt with its caller. Before any owner-facing approval feature, Main must select a private-salt custody/recovery contract and Offchain must bind it serially to the existing native persistence and durable transaction journal. Do not add a second financial writer or treat a fixture permission transition as approval.

The proposed next bounded seam should:

1. Bind an explicitly selected unchanged native record/reference, checkpoint digest, build digest, owner, chain, target and operation reference. Never silently replace the record with the latest proposal.
2. Atomically retain the private opening under an owner-controlled protected local store, separate from the public anchor/history projection; define file permissions, encryption/key ownership, backup/export consent, corruption and lost-secret behavior before implementation. Never reuse a wallet seed or ask for secrets in chat. A missing/unreadable opening must block progress and remain recoverable, without generating a replacement salt for an existing operation.
3. Retain a non-authoritative opening handle/digest in the operation's durable state so restart, lost-response retry and export can recover the exact original binding. Public export must never silently include the secret. Preserve original snapshots and existing history.
4. Require independent source/build/runtime/deployment acceptance, fresh trusted chain facts and a separate authenticated expiring owner intent. The present build artifact and historical checkpoint JSON confer none of those permissions. A real target address, signer, nonce, gas policy and wallet request remain unimplemented gates.
5. Reuse the real serialized journal for nonce reservation, uncertain-send holds, late hash reporting, rejected/expired requests, recovery and receipt correlation; never activate a fixture coordinator or use a new nonce to evade an unresolved outcome.
6. Test actual private-file process restart/export, wallet-free GUI/installed-agent review and failure recovery before requesting a separate owner action. A subsequent live deployment or transaction still requires explicit human authorization and fresh pre-sign verification.

This document proposes that interface boundary; it does not implement the store, encryption, nonce reservation, owner approval, browser flow, deployment observer or any real-chain operation. Organizer deployment eligibility remains unresolved.
