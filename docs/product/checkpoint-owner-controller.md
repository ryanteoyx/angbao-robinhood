# Private owner checkpoint review

This optional local profile records a fingerprint of one saved portfolio proposal on Robinhood Testnet. It does not place a trade, verify the input sources or require signup. CREATE and recording the proposal are two distinct owner wallet actions. The profile is default-off. Ordinary CLI, hosted service, protected viewer and MCP grants cannot turn it on.

## Operator preparation

Main must first accept the exact source/build, selected saved proposal, owner, existing workspace identity, canonical journal and opening vault. Before adopting an original sender's journal, preserve the files and stop its original writer. Use ONE original journal. The @2 native workspace and canonical journal may live in different reviewed private directories; neither is copied or moved to make them match. @1 retains its existing beside-workspace rule. Do not run another real sender from a copied journal.

The independently reviewed private grant format is `angbao-reviewed-owner-funded-run@2`, `profile:"checkpoint-owner"`. Exact fields and validation live in `validateCheckpointOwnerGrant` in `src/server/local-checkpoint-controller.mjs`. It binds the physical workspace, installation and real data-location hash, owner, native record/decision digests, build, stable vault ID, two distinct operation IDs/parents/caps/discovery keys, finite phase keys/budgets, separate preparation/recovery expiry and an existing private revocation file. Unknown fields and mixed @1/@2 policy are refused. No credential search, imported grant or browser boolean establishes authority.

Each read-policy operation contains explicit discovery/review/before-wallet/observation keys. Initial caps are at most 36 CREATE and 38 commit requests across four scopes each: discovery8; CREATE review10+before-wallet10; commit review11+before-wallet11; one observation up to8. Actual successful receipt observation currently needs7, pending3. The same canonical journal accounts for all reserved packets, including interrupted attempts. No polling or automatic retry. A cold process needs a separately approved fresh CREATE observation before preparing/observing commit; a new grant can add a new key and up to8 requests while preserving all old counters and holds. Per-operation hard ceilings remain eight scopes/80 requests/three observations, shared journal20 rows/1MiB. Large rows may reach storage limits earlier.

Revocation file exact fields: `{format:"angbao-checkpoint-owner-revocation@1",grantId,revision,preparationRevoked,readsRevoked,recoveryRevoked}`. All booleans are explicit. Current policy is checked around awaited actions and packets/dispatch. Revoking preparation or reads does not erase a known hash: separately current recovery rights permit only local exact reporting/read/export, no reads from the chain. Recovery revocation or expiry stops that access too. Missing/corrupt policy/storage stops; never replace it with empty state.

## Launch

```
node scripts/run-owner-funded-testnet.mjs --grant /private/reviewed-owner-run.json --reviewed-sha256 EXACT_SHA256
```

Only the existing private workspace/journal/vault are opened. Launch starts no chain read, wallet request, provisioning or restore. The process binds `127.0.0.1` at the reviewed port. Keep it private. @1 direct-transfer launch behavior remains separate and unchanged.

Open checkpoint progress. Prepare the selected proposal, refresh and inspect the review, then choose Review in wallet. Check owner, Robinhood Testnet, target, maximum test-ETH fee and expiry. The server durably reserves the exact challenge before returning it. The browser uses the strict C1 validator with independently pinned server review context. It invokes the selected wallet only after a separate explicit click. The final synchronous server guard checks current preparation/read revocation, expiry, workspace, exact selection and accepted build before returning the challenge. This is a delivery-time check; it cannot cancel an already opened wallet prompt or promise continuing authorization until a later owner approval. CREATE never automatically starts commit.

After a returned hash, save the original reference even if the wallet context or review expiry changed. Receipt checks are separate explicit actions under current finite read permission. Rejection, timeout, lost acknowledgement, expiry and observed revert do not free a nonce or permit a replacement send. If no reference is known, inspect original wallet activity. Local validation failure says only this attempt did not invoke the wallet. A provider-reported4001 does not prove no other broadcast occurred.

Restart invalidates the process CSRF token; reopen progress for a new token. Local progress reads do not contact the chain. New routes require the exact loopback Host/Origin and per-process token. The token is not signing authority or protection from malicious processes running as the same OS user. Protected viewers retain their existing authentication/read-only boundary; new browser modules/codecs are public source files behind the same shell asset authentication.

## Separate private operator commands

No private-opening backup/restore route exists in the browser or MCP. The script supports explicit operator mode, with exactly seven positional arguments:

```
node scripts/run-owner-funded-testnet.mjs operator provision /private/grant.json EXACT_SHA256 - - -
node scripts/run-owner-funded-testnet.mjs operator backup /private/grant.json EXACT_SHA256 - /private/new-opening-backup.json 'EXACT_PRIVATE_HANDLE_JSON'
node scripts/run-owner-funded-testnet.mjs operator restore /private/grant.json EXACT_SHA256 /private/opening-backup.json - -
```

Use the exact handle returned to the private operator by the custody API, not the illustrative shape above. Provision requires already created owned0700 directories, an existing selected workspace and knowingly absent journal/vault. Existing files are refused. If a canonical journal already exists, do not use combined provision. Main must review a separate vault-only create-only operation against that validated journal; never delete or recreate the journal to make provisioning succeed. Partial provisioning remains a recovery stop; nothing is deleted to undo it. Backup is exclusive0600, never overwrites and does not print the sensitive contents. Restore validates original workspace/vault/request, preserves existing inventory and keeps incomplete restored inventory recovery-only. It does not recreate a transaction journal, grant execution or clear uncertainty. Keep the original private opening separately from public receipts and native workspace exports.

## Evidence boundaries

Public receipt export contains only the anchor, build, chain, contract, transaction hashes, historical observed blocks/times/fees and false current-confirmation/input-truth/financial-authority flags. It excludes native IDs/snapshots, salt, custody handles, paths, signatures and provider internals. A public receipt is not a private backup or a new signing grant.

Synthetic controller/HTTP/process/installed tests do not establish actual browser, MetaMask/Rabby, provider, chain or owner approval acceptance. Main owns those gates. No live reads or real data are part of source implementation; public artifacts and release versions stay unchanged.
