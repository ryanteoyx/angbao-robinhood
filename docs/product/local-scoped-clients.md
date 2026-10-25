# Protected local scoped clients — opt-in read-only runtime

Free local operation requires no Angbao signup, account or card. The reviewed protected composition is included in the private 0.5.11 source candidate and remains explicit opt-in, for a separately confirmed private workspace copy. Final candidate packaging, installed acceptance and publication are separate. Legacy startup remains the default and remains unprotected. Starting a protected listener does not secure a still-running legacy listener. This packet is not in immutable public 0.5.10 and does not certify installed Codex, Claude Code, Grok Bot or any other named harness.

## Start and connect the read-only viewer

First acceptance uses synthetic copied data only, with its existing installation identity, settings and saved records. Do not point this command at a running user's workspace. Keep the confirmed location and original files intact. The data copy must already have a valid local installation (created by the existing local runtime); protected start does not create, convert or save a workspace.

Create a separate physical private access directory outside the workspace folder. Both its owner credential and registry stay outside workspace exports. Set `ANGBAO_BIN` to the actual full installed binary printed by the installer or retained receipt; the manual fallback uses its chosen prefix’s `runtime/bin/angbao`, not an invented versioned path. Set an explicit `ANGBAO_DATA_DIR` to the private copy, then use that binary:

```sh
"$ANGBAO_BIN" start --protected-local --access-dir /absolute/private-access --port 4327
```

The access directory must already exist, be owned by the current OS user and have no group/other access. Newly created files use 0600. The CLI checks matching existing setup receipts and refuses a still-present/uncertain recorded process or an occupied/uncheckable port before creating protected credentials. It never stops another process, rewrites setup metadata or automatically migrates legacy data. Unrecorded listeners using that data cannot be discovered reliably by this bounded check; Main must confirm the separate-copy prerequisite and inspect actual process state. A remaining legacy listener is still a separate unprotected interface.

At the first explicit start, the capability registry is initialized and its owner credential is written to `owner.json`, fsynced before listen. Existing registry plus missing/wrong/insecure owner file fails closed without resetting either. A crash between initial registry commit and owner-file fsync leaves a recovery-required state; there is no automatic owner rotation. Keep original files and use a separately reviewed owner recovery procedure. Do not delete/recreate the registry to resume an existing installation.

With `ANGBAO_API_URL` set to the exact running loopback origin:

```sh
"$ANGBAO_BIN" browser-pair --owner-file /absolute/private-access/owner.json --out /absolute/private-access/browser-connection.json
```

Open the local root. Choose the newly created browser connection file on **Connect this browser**. Do not select or upload the owner/client credential. The file expires after 90 seconds and is accepted once. A new file is required after a failed or expired attempt. Owner and client secrets are never returned by an HTTP body, printed or put in a URL. The browser gets a bounded HttpOnly SameSite=Strict cookie and a separate origin-bound session proof kept only in sessionStorage. Cookie alone, proof alone, cross-port Origin, foreign Host and mixed cookie/bearer credentials cannot read private APIs. Shell assets contain no private data and may load using a valid cookie without proof. All API reads require both. No cookie-only proof recovery route exists. Sessions expire after 15 minutes; logout or runtime restart invalidates them. Re-pairing explicitly replaces a stale cookie. The viewer reconnects locally and never falls back to hosted signup, cached private data or a legacy endpoint.

All financial/workspace mutations, preview/prepare operations, provider calls, jobs and wallet tools are denied in this phase, including for the owner. The UI disables editing and action controls. Saved data, methods, settings, comparisons and sources can be read/exported. Owner credential administration is available only to owner CLI bearer access, never a browser session. Browser proof is an ephemeral session credential, not the root/client credential; do not log or share it.

## Explicit scoped client continuation

Issue each client separately. The expiry is an exact UTC ISO time in the future, at most 30 days. Pick only the needed read scopes:

```sh
"$ANGBAO_BIN" clients issue --owner-file /absolute/private-access/owner.json --name 'Research reader' --scopes research:read --expires-at YYYY-MM-DDTHH:mm:ss.sssZ --credential-out /absolute/private-access/research-client.json
"$ANGBAO_BIN" clients list --owner-file /absolute/private-access/owner.json
"$ANGBAO_BIN" clients revoke --owner-file /absolute/private-access/owner.json --id CLIENT_ID
"$ANGBAO_BIN" memory-reference --owner-file /absolute/private-access/owner.json --kind research-method --id RECORD_ID --out /absolute/private-access/exact-reference.json
```

Kinds are `research-method`, `research-brief` and `portfolio`; portfolio requires `portfolio:read`, research requires `research:read`. Exact reference export returns the canonical immutable reference and workspace ETag from one selected native record. Ambiguous/missing selections refuse rather than choosing a latest version. Owner CLI reference export saves a new private file. No existing output is overwritten. If credential delivery fails after issuance, inspect the owner grant list and revoke the undelivered grant before explicitly issuing another; no silent retry or replacement occurs.

Give each harness only its own client-file path via `ANGBAO_LOCAL_CLIENT_FILE`. Do not pass raw secrets in arguments, URLs, skill prose or model prompts. The file includes its exact loopback origin; a conflicting `ANGBAO_API_URL` refuses. Hosted flags/credentials are mutually exclusive. Changing port requires explicitly issuing a new origin-bound file; a same-port restart preserves existing unrevoked grants.

```sh
"$ANGBAO_BIN" agent memory read --protected-local-client --reference /absolute/private-access/exact-reference.json
"$ANGBAO_BIN" mcp --protected-local-client
```

Optional CLI `--etag '"N"'` and `--max-age-ms AGE` constrain the originally selected revision and evidence age. Without age, freshness is unverified, not a claim of current truth. Reference files from owner export contain `reference` and `etag`; use the exported ETag explicitly when requiring workspace revision equality. No authority is carried by that file.

Protected MCP exposes exactly `angbao_read_exact_memory(reference,maxAgeMs?,expectedETag?)`. The bridge enforces its initialize/initialized lifecycle and refuses legacy write tools. Client HTTP routes are exactly POST `/api/local/client/memory`, GET `/api/local/client/tools`, and POST `/api/local/client/mcp`. Client routes reauthenticate scope using validated record kind, and discovery uses an actual server-granted read scope. All other routes are owner-only before dispatch, then the owner read-only route policy applies. Requests are bounded to 16 KiB and replies to 1 MiB. Redirects, CORS and anonymous fallback are unavailable. Canonical records with credentials are refused, never redacted or rehashed. After serialization, a final egress guard rechecks revocation/expiry, store certainty and the original freshness window before response headers/bytes. Owner data reads also recheck the current browser session at egress after awaited work.


The following module contract and dated notes preserve the earlier M1c packet. Their source-only and packaging statements describe that historical packet; the current private 0.5.11 candidate includes the reviewed opt-in composition above. Candidate-specific independent installation and named-client acceptance remain separate gates.

## Authority and persistence seam

`openLocalClientAccess({registryFile, dataFile, installationId, now})` opens a separate private SQLite capability registry and returns `{access, bootstrapOwnerToken?}`. First explicit creation generates one owner capability, returned once and stored only as a SHA256 hash. Losing that capability is not silently repaired by reopening the registry. No token is written to workspace/export, stdout or logs. Operator composition must deliver/store it privately outside client environments; later recovery/rotation needs a separately reviewed owner workflow.

Both registry directory and existing data file must be canonical physical paths, private to the current OS user; installation ID is checked against the existing data file. Registry metadata binds installation and SHA256 of canonical physical data path. Every authorization checks registry identity, workspace installation, revocation, expiry and exact scopes. Moving/replacing the workspace with a different installation does not transfer grants. This is same-OS-user operator authority, NOT isolation against a malicious process with unrestricted same-UID filesystem access. Do not give a client the owner credential or owner filesystem access and claim hostile-client isolation.

`access.issue(ownerToken,{name,scopes,expiresAt})`, `list(ownerToken)` and `revoke(ownerToken,id)` require the distinct owner capability. Each client receives an independent 256-bit random credential; only a hash is persisted. Client scopes are research:read, research:write (requires research:read), and portfolio:read. Expiry is explicit, at most 30 days; 64 lifetime grants bound this packet. No automatic pruning, credential export, restored authority, provider access, wallet/signing, billing or hosted scope widening. `access.authorize(token,requiredScopes,{ownerOnly})` synchronously returns server-derived identity; caller-provided identity/scope objects never authorize. Owner bypass is an explicit separate authority role, never inferred from client labels. `close()` closes the registry.

`authorizeLocalRequest(request,{access,origin,clientRoutes})` is the global guard seam for protected mode. Exact method/path allowlist entries carry required client scopes, limited to /api/local/client/memory, /api/local/client/tools and /api/local/client/mcp; all other paths remain owner-only even if accidentally added to the allowlist. Missing credentials fail, including state/export/legacy local endpoints. A client credential cannot bootstrap, list or revoke grants, nor access unlisted owner routes. Origin is exact loopback HTTP with cross-origin/browser rejection; query strings do not change route authority. Offchain must call the guard BEFORE dispatching every protected endpoint and must not fall back to anonymous legacy routing. Its allowlist must not include owner/state/export/legacy routes. No self-service grant endpoint or owner credential delivery is implemented here. Static GUI bootstrap and secure owner session transport remain Offchain responsibilities; never place owner credentials in URLs or browser local storage.

## Memory seam

`await createLocalClientMemoryBinding({access,readState,historyStore,now})` creates a binding with `resolveExact(token, reference, {maxAgeMs?, expectedETag?})`. Runtime-provided installation determines owner/workspace scope. Research and portfolio scopes stay separate. Exact accepted Memory validators and native records/digests are reused; hydrated archives are collected with the accepted archive-preserving helper. Missing research history stays missing; a prepared work overwritten by completion is not recreated.

The binding checks authorization and store certainty before/after every awaited snapshot/resolution, repeats the selected-record lookup, then synchronously checks current authorization and freshness window. Expected ETag, if provided, must match both snapshots. Changed/removed records return no old content. No financial mutation or `validateResult` side effect occurs. The final check is a read linearization point, not an ability to retract an already delivered response. Future native writes MUST enforce the current capability, original operation key and existing expectedETag at the native serialized mutation boundary; research:write in this registry alone wires no write tool.

## Acceptance scope

Only synthetic temporary registries/records are used here. No real owner/client credential activation, provider/model/wallet call, hosted operation or change to legacy runtime data. Source tests must establish independent revocation/expiry, hash-only persistence/reopen, scope/owner/installation/location rejection, protected route default-deny, post-await rejection, exact archives and stale ETag/freshness failure.

Next: Main reviews the exact pin; Offchain serially integrates protected-mode routing and token plumbing after R2. Then two named installed harnesses must load the skill/tool surface, use independently scoped credentials for useful exact-record work, return after restart, and prove revoked-client/stale-write rejection. Codex/Claude executable presence, fixture clients and curl success do not close that gate.

## Packet verification — 25 October 2026

Base `694331f6baf9357a810995e5b5d88f8c63d4b483`; checkout `.worktrees/local-scoped-clients`, branch `codex/local-scoped-clients`. Only the five reserved new files changed. The binding imports native record validators so later integrated format support remains owned by those validators; no R2 schema is duplicated here.

Focused command: `node --test tests/local-client-access.test.mjs tests/local-client-memory.test.mjs tests/financial-memory-binding.test.mjs tests/financial-memory-contract.test.mjs tests/financial-memory-resolver.test.mjs` — 38 passing cases, including 14 local-capability/Memory cases and 24 previously accepted Memory cases. Temporary real SQLite and financial archive files are isolated, synthetic, private and removed after tests. No deployed credentials or original workspace files were changed. A read-only reviewer found no blocking issues and independently passed the initial 12 local cases; its recommended second-simultaneous-handle revocation case was added and passed. A bounded-error regression additionally checks corrupted storage cannot reflect private content.

Data responses are bounded to 300 KiB and must still pass exact Memory/native validators. Capability storage errors are mapped to bounded codes. Owner bootstrap and client issue intentionally return one-time secrets only to the trusted owner composition; do not log these return values. Capability labels reject credential-shaped values. The guard verifies an explicit Host header against the configured loopback origin when present. SQLite transactions serialize issue/revoke; no financial store or model/provider effect is introduced.

Remaining integration obligations: protect every route before dispatch; securely deliver a separate owner session/capability; expose a narrow client tool allowlist with per-tool scope and native serialized write checks; keep credential environments separate across clients; carry the memory response/ETag without changing native identity; reject unknown tools/paths without anonymous fallback. No release packaging or actual two-harness claim is made until these are reviewed and tested in the joined runtime.

## Independent review correction — async option capture

Main/Onchain found that the original `47fc2d1e583f2895c69fc721ad213929de64b996` retained the caller's options object across awaits. A caller could mutate expectedETag alongside a changed runtime revision, incorrectly refreshing the originally selected revision; maxAgeMs could similarly change the freshness policy. That pin is preserved as original evidence and was not accepted for integration.

The corrected binding validates exact own enumerable data descriptors and captures expectedETag/maxAgeMs as scalars synchronously before its first await. Subsequent work never reads the caller options object. Unknown, accessor, hidden, symbol and inherited fields fail before a snapshot read; getters are not invoked. Regressions mutate the caller ETag during the second snapshot after the workspace revision changed and require 412 against the original ETag, and mutate maxAgeMs in both widening and narrowing directions without changing original freshness semantics. Existing authority/selected-record/final-window checks remain intact. The same focused five-file test command now passes 41 cases. Only the reserved Memory binding, its test and this document changed; Main's stable-pin re-review remains required before protected route integration or actual-client runs.

## Joined-source acceptance and Main handoff

Author tests are in `tests/protected-local-{http,session,client}.test.mjs` plus the existing client-contract suite. They use private synthetic copies, real loopback HTTP/SQLite and child CLI/stdio processes. Child fixtures are not named external-client acceptance. Legacy/source-wide checks remain necessary before a clean candidate is handed to Main. Neither package allowlists nor public artifacts are changed in this packet; default server loading imports protected modules only when explicitly enabled, so the existing default release path does not require these source-only files.

Main browser checklist at the final clean pin:

1. Create a new private synthetic copy, record original hashes/settings and confirm no legacy process shares that copy. Start protected mode on a free loopback port with separate private access files.
2. Anonymous root opens Connect this browser; anonymous health/state/export are denied. Issue a pairing file with owner CLI and select it. Browser gets saved data and the read-only notice. No root token enters browser UI, URL or storage.
3. Inspect saved research/method settings, sources/gaps and a repeat portfolio comparison, including archived baseline resolution. Editing, new reviews/previews/saves, account claiming, billing and wallet/provider actions are unavailable. Download a read-only export and compare original records/settings.
4. Refresh the page in the same tab, then logout and confirm private APIs fail. Re-pair; restart only the disposable protected runtime on the same port. Old session fails, root/client files remain unchanged, and explicit new pairing reopens the same records. Check expired/replayed pairing and session expiry messages remain natural.
5. Using temporary per-run configs, separately run actual authenticated Codex and Claude Code with distinct read credentials, loaded guidance and exact reference files. Obtain useful research/portfolio continuation, original method/settings/source readback and an explicit return after same-port restart. Revoke A and verify A denied while B still reads. Record actual harness versions/tool calls; fixture names and executable presence do not satisfy this step. Main owns shared browser/named-client final acceptance. No global agent configuration or paid activation.

Independent Main acceptance, actual browser walkthrough and the two named harnesses remain gates; a clean source candidate alone does not complete them. This viewer is for local exact-read continuation, not protected write continuation, managed sync, a supervisor or financial authority. Isolation against unrestricted same-UID filesystem access is not claimed.


## Native MCP optional transport metadata correction

Main's actual Codex0.163 native-MCP read attempt found a P2 envelope incompatibility at joined source7378589: tools/call parameters included `_meta` alongside `name` and `arguments`. The strict two-field transport envelope rejected the call with HTTP400, although the same exact reference and quoted ETag resolved without metadata. Earlier source/child fixture passes did not certify this native harness.

The correction accepts optional plain-object `_meta` only in protected tools/call parameters and discards it before business dispatch. Metadata is limited to2KiB,128 visited JSON values and nesting depth4; optional progressToken is a string up to200characters or a finite number. Null/array/scalar metadata, invalid progress tokens, prototype/executable fields and larger/deeper metadata fail. Other params, top-level envelope and exact business argument allowlists stay unchanged. Metadata is never echoed, logged, persisted, merged into arguments, used as identity or treated as authority. Claimed owner/scope/write authority in metadata cannot bypass the original credential, reference owner/workspace, ETag, expiry, revocation, tool allowlist or final egress checks. No progress notification is promised.

The regression sends native-shaped `_meta` through the actual child stdio bridge and isolated HTTP runtime, compares the exact metadata-free result/ETag, and checks unchanged workspace/registry bytes and absent metadata in stdout/stderr. Negative cases cover malformed/oversized metadata, unknown fields, stale revision, fake authority, forbidden tools, scope/owner mismatch and expiry/revocation. Main must independently review the clean correction pin, preserve and restart its synthetic reviewer runtime explicitly, then rerun the actual named harness. This author test is a native-shaped fixture, not renewed Codex/Claude acceptance. No live runtime, key, provider, wallet, release or package was changed by this correction.
