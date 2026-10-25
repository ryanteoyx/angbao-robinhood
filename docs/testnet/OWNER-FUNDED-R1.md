# Explicit owner-funded Robinhood testnet transfer

This separate local source branch implements an owner-per-operation ERC-20 test transfer. It does not need a Kernel account, deployment, bundler, paymaster, paid plan or Angbao signup. The hosted candidate and public/frozen packages are separate.

The default local server keeps this route unavailable. Main must first accept the exact token's source/runtime identities and official faucet provenance, the existing workspace and exact saved transfer intent, owner EOA, test ETH/token balances, recipient and raw amount. A ticker or mainnet contract address is insufficient. A beacon token additionally needs reviewed proxy immutables, beacon/implementation addresses and source hashes, combined pause and registry blocklist semantics.

## Private operator run

Use only an independently reviewed, owned private grant file, with its SHA256 recorded outside that file. This is an explicit same-UID operator trust boundary, not a public import or financial/signing authority. Do not use a downloaded JSON file or candidate proof as automatic source acceptance.

```
node scripts/run-owner-funded-testnet.mjs --grant /confirmed/private/reviewed-run.json --reviewed-sha256 EXACT_REVIEWED_SHA256
```

The file schema is `angbao-reviewed-owner-funded-run@1`: `chainId:46630`, existing physical private `dataFile`, existing private `journalDirectory` beside that workspace file, loopback `port`, source-accepted `assets`, exact saved `intentDigests`, and an `expiresAt` no later than 30 minutes ahead. Asset shape is defined by `validateRobinhoodEoaReviewedAsset`; validation alone is not source acceptance. The launcher starts no provider request or wallet action. It does not find credentials/configuration in the environment or modify global agents. Never expose the server publicly.

## Explicit read limits

Each exact intent gets at most one preparation plus one fresh pre-wallet check. A reviewed nonproxy token uses 10+10 requests; a reviewed beacon token uses 17+17, including proxy/beacon/implementation identity, decimals, combined pause, and sender/recipient blocklist checks. These are separate versioned finite scopes. A 20-read grant never silently becomes a 34-read grant.

Every read is reserved durably before the fixed official public RPC request. Each response is capped at 128 KiB; scopes cap response bytes at 1 MiB. Requests time out after five seconds. There is no retry loop or send RPC in the server. Missing source acceptance or read permission stops before provider work. Code, fee, nonce, balance, pause/block and canonical snapshot drift stop preparation.

Receipt checks are explicit, never polled. At most three persistent rounds are allowed, each with up to six canonical transaction/receipt reads and, for a confirmed result, up to two nonproxy or six beacon identity checks. Maximum actual reads per intent are 44 (nonproxy) or 70 (beacon). Original HTTP retry keys reuse the same round rather than create a new budget. Prior snapshots survive restart; imported history is not a fresh grant.

## Wallet and recovery

The app displays the exact owner, testnet, token, raw-token amount, recipient, maximum native test-ETH fee and expiry before wallet approval. The transaction is a zero-native-value type-2 call to that exact token's `transfer(address,uint256)`. Its ten fields must match the displayed review. The private journal reserves the exact owner EOA nonce before requesting approval; a timeout never unlocks it or automatically resends.

Only a later explicit human action in the selected wallet can sign/send. If a wallet returns a public transaction hash after account, network or expiry changes, the hash is saved as an unverified reference first. A lost report response can retry that exact local save; all new direct actions stay locked. A restart can recover the same reference without another wallet request. If no hash is known, inspect the wallet and save its exact reference; do not submit a replacement.

Canonical receipt verification correlates the reviewed transaction envelope, membership, exact token emitter/from/to/raw amount and network fee. Historical observations do not establish current confirmation or finality. Beacon identity at a block is not proof of implementation at every intermediate execution point. Neither a ticker, an event nor test-token units establish economic value, real-share ownership or net balance changes. Raw transaction signatures, raw signed calldata and opaque logs are discarded from history/export.

## Before wallet approval

Finish the exact source pin and official faucet-delivery identity, select a dedicated owner and second owner-controlled test address, establish actual test ETH and token funds, and approve the concrete finite read plan. Then inspect the fresh unsigned review and its fee cap. Faucet claims, wallet connections/signatures, funding, transactions and paid activation require their own explicit human action; none is performed by the offline acceptance suite.

The public research example's USD 95 → USD 77 contribution proposal is a supplied-data allocation comparison. A separately chosen raw-unit test-token transfer is a technical owner-approved test linked to that review; it does not execute that DCA plan, buy the proposal's assets, or convert USD into test TSLA. Keep this separation explicit in the demo and final receipt.

Workspace export includes signature-free test-transfer history. Keep the private journal beside the confirmed workspace; setup import does not recreate that mutable journal or wallet sessions, and no imported record can resume signing or submission.
