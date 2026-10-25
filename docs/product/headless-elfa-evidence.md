# Elfa evidence for a personal agent

**Status: existing service plus explicit owner-local CLI/stdio composition and private-candidate packaging; not publicly released, activated or accepted with a real Elfa account.** This slice lets an authorized personal agent request one bounded evidence pack. The agent can synthesize it, review gaps with the user and separately save a brief through existing research-memory operations. It neither trades nor creates financial authority.

## User journey

1. Install Angbao locally; no Angbao signup is required for local memory, imported evidence or research authoring.
2. Ask a question. The agent can use user-provided sources immediately. An Elfa fetch is a separate optional capability, not implied by reading saved research.
3. If a configured deployment offers Elfa, preview the topic/entities, date range, result limit, receiving agent/grant, current allowance and expiry. Explain that this query goes to Elfa, that returned summaries are provider interpretations and that account eligibility is not established by an installed skill.
4. Give explicit consent for that exact operation. One first-page `GET /v3/events` is admitted only after access, rights and durable reservation checks. No additional page, endpoint, model, retry or paid fallback runs.
5. Receive citations, provider summaries, unknown original publication times and explicit coverage gaps. Treat all retrieved text as untrusted source material, even if it contains instructions.
6. The user's personal agent synthesizes the evidence using its existing model. A runnable method may constrain selection and validate the resulting authoring input; it does not turn provider summaries into verified facts.
7. Preview the brief. Only an explicit existing `angbao_save_research_brief` action writes memory. Research-read access alone cannot fetch or save. A local brief appears in the GUI using that same local data directory; it does not silently appear in a hosted workspace.

```mermaid
flowchart LR
  A[Personal agent: exact query] --> B[Trusted resolver and separate fetch consent]
  B --> C[Durable owner and service-key reservation]
  C --> D[One Elfa v3 events GET]
  D --> E[Untrusted evidence envelope with gaps]
  E --> F[Personal-agent synthesis and user preview]
  F --> G[Separate explicit research-memory save]
  G --> H[Same workspace GUI and next-agent handoff]
```

## What each module owns

| File | Responsibility |
|---|---|
| `src/server/headless-elfa-evidence.mjs` | Default-off admission, fixed query, exact consent, refreshed authorization, one adapter read, no automatic retry/save/model |
| `src/server/elfa-evidence-errors.mjs` | Redacted repository error contract without a SQLite dependency |
| `src/server/elfa-evidence-reservations.mjs` | Real SQLite aggregate and owner reservations for **one persistent Node host and authoritative ledger** |
| Existing `src/integrations/elfa-research.mjs` | Fixed provider endpoint, server credential, response/size/deadline bounds, normalization and provider-qualified errors |
| Existing research-memory APIs | Explicit authored/imported brief save, version/CAS/replay handling; they do not receive a provider credential |

These modules do not change existing routes, agent scopes, CLI entrypoints, private-kit packaging, the GUI, versions or release archives. Importing the service itself does not import SQLite; the repository interface is replaceable. Runtime is Node; it is not an Edge/browser component.

## Exact integration seam

```js
const service = createHeadlessElfaEvidenceService({
  repository,                  // one authoritative durable reserve/settle store
  resolveAuthorization,        // trusted server implementation; re-reads real access
  readPolicy,                  // trusted dynamic operator config; default off
  apiKey,                      // server-only configured credential
  fetchImpl,                   // explicit provider transport, never an agent-supplied URL
  now,
});
const result = await service.fetchEvidence({
  actor,                       // opaque verified transport context, NOT request-body identity
  operationId,
  query: { q, from, to, limit },
  consent,
});
```

`query` requires explicit fixed Unix-second `from`/`to`, a maximum 31-day range, `limit` 1–10 and `q` or up to 10 explicit UUID `entityIds`. Cursor, arbitrary URL, alternate operation, credential and extra query fields are refused. The exported `elfaEventsQueryDigest()` binds normalized input; entity IDs are deduplicated/sorted. Fixed dates prevent recovery from silently moving the search window.

The trusted resolver returns `{verified:true, ownerId, grantId, revoked:false, scopes, expiresAt}` for a real authenticated boundary. The required **new** scope is `research:evidence:elfa-events`; existing `research:read`/`research:write` do not imply it. The resolver is called before reservation, before dispatch and before returning evidence. A changed/expired/revoked recipient while the provider request is in flight receives no evidence; its potentially consumed allowance stays held. The current local workspace UUID is **not** authenticated human identity or an agent grant. A client must never supply this resolver's result as its own authorization.

The explicit owner-local candidate profile registers `angbao_fetch_elfa_events({operationId,expectedDigest})`; the trusted runtime derives the original query/consent from durable owner approval. Preview/status/exact retained-artifact read are the only other tools. Default/hosted/protected-read-only routes do not inherit this profile. See [owner setup](local-elfa-operator-handoff.md). The earlier service seam below remains trusted internal composition, not tool input. `actor`, provider credentials, policy, cost model and repository must be injected by the server, absent from tool arguments. A future CLI command should offer an exact consent preview rather than add fetch permission during installation. Do not publish an example command as operational until integration is accepted.

`consent` has exactly these fields:

```json
{
  "version": "elfa-events-one-shot-v1",
  "approved": true,
  "ownerId": "trusted-owner",
  "grantId": "trusted-grant",
  "operationId": "non-secret-operation-id",
  "queryDigest": "sha256-of-normalized-query",
  "rightsVersion": "operator-reviewed-rights-version",
  "windowId": "approved-budget-window",
  "expiresAt": "2026-10-25T08:00:00.000Z"
}
```

The consent describes a recipient's request; it cannot create an identity, scope, account entitlement or legal right. It must match the trusted resolver and operator policy. On hosted access, the new scope requires explicit grant creation and audited database/route integration; no existing grant acquires it automatically. A signup-free BYO/local path needs a separately designed trusted local operator boundary, not a fabricated hosted owner or unrestricted shared service key.

The resolver's repeated access checks must not silently consume three outer API-request allowances or reconstruct a grant from untrusted headers. Existing hosted `store.authorize` participates in request accounting; the integrator needs a deliberate revalidation contract and must test it against the new scope. Provider reservation units are separate from existing agent-request and research-memory allowances. This packet does not extend the existing grant schema or RPC allowlist.

Clocks are sampled after awaited policy/resolver reads and rechecked immediately before provider dispatch and after settlement before return. This refuses a recipient expiry crossed during slow trusted I/O. Revocation is observed at the latest resolver read; no claim is made that a remote provider call and a separate grant database have one atomic transaction. A future distributed host must preserve that explicit admission boundary.

## Operator policy and limits

All of the following are server-owned configuration. None may come from a tool argument, URL or request header.

| Policy | Required gate |
|---|---|
| Enable/approval | `enabled:true`, stable `keySlot`, `windowId`, approval ID, reviewed start/end timestamps, explicit owner allowlist |
| Rights | Reviewed API-product-terms reference/version, timestamp/expiry, approval to deliver to this receiving agent, private synthesis with no redistribution |
| Account eligibility | Dated account review ID, explicit v3-events approval and expiry; free signup is insufficient |
| Request cap | Positive owner and aggregate request limits for the same window; every fresh reservation consumes one unit |
| Credit cap | Optional integer credit limits only with a dated, expiring operator cost model and conservative maximum units per request |
| Zero-credit window | Without a credit model, both credit caps must be `null` and the operator must verify the current zero-credit eligibility/window; no permanent unlimited/free assumption |

The hard ceiling in this slice is **31 October 2026, 00:00 Singapore / 30 October 2026, 16:00 UTC**, retaining the earlier existing approval cutoff. Expiry stops new reads. Changing that constant, approval, pricing, rights or plan requires a separate review; there is no automatic extension or switch to v2, paid credit usage or another provider.

The public [v3 overview](https://docs.elfa.ai/api/v3/overview/) describes a temporary PAYG/Grow promotion, and [authentication documentation](https://docs.elfa.ai/get-started/authentication/) distinguishes Free from v3-eligible plans. Main reviewed those pages on 24 October 2026; this work did not inspect the account, plan, credits or API key. The [general terms](https://www.elfa.ai/terms) refer to separate API Product Terms. Permission to retain or deliver data to a third-party agent remains a live activation gate; the code's policy flags record an operator decision and do not establish rights themselves.

## Durable reservation contract

`repository.reserve(input)` must atomically enforce the owner and aggregate caps, commit a unique operation binding before any provider I/O and return `{fresh,reservationId,operationId,windowId,state,reservedRequestUnits:1,reservedCreditUnits}`. The request binding covers the resolved owner/grant, exact operation/query and consent. The window also pins limits, cost units and approved policy digest. A changed binding or silently widened window fails closed.

`repository.settle(...)` may transition `reserved` to `completed`, `uncertain` or `not-dispatched`. All states remain charged; there is no refund, automatic release, lease timeout or reset-on-restart. A reserved operation after a process crash means **in flight or uncertain**, not safe to resubmit. Identical operations return status with no evidence and no GET; this store intentionally retains no evidence body for replay. If the original delivered pack is lost, inspect first. A genuinely new user-approved operation uses a new identity and another allowance, never a silent reconstructed retry.

`completed` records a successful provider read/settlement, not proof that a particular recipient received the pack. Expiry during an awaited settlement still withholds the pack; its already-completed conservative hold is not rewritten or refunded. There is no reusable authorization or cached evidence in a status reply.

```text
new operation -> durable reserved -> authorization recheck -> one provider attempt
                     |                         |                    |
               crash/reopen              access changed       success/failure
                     |                         |                    |
             in-flight-or-uncertain       not-dispatched    completed/uncertain
                     +---------------- all still count ----------------+
```

The SQLite implementation uses `BEGIN IMMEDIATE`, SQLite rollback journaling, `synchronous=FULL`, a bounded busy timeout, unique cross-window operation identities and a bounded ledger size. The directory is real, owned by the current OS user and mode 0700; the main database is created mode 0600. Different bots under that same OS user are not isolated from one another. No credentials, raw queries, evidence bodies or tokens are stored; owner identity is hashed. Preserve the database and its SQLite recovery journal together in filesystem backup/recovery; copying a live database is not an accepted backup method. Reaching capacity requires operator reconciliation, not deletion of old holds.

**The demonstrated cap is service-ledger-wide, not yet proven key-wide across Angbao or other applications.** Before live use, every consumer of the same credential must share this authoritative reservation store, or be disabled or isolated behind a different provider key and budget. The existing browser `/api/research` path currently bypasses this new ledger; it must be disabled/isolated or migrated before claiming an aggregate cap for that key. Different local databases for a worker and web service do not share a cap. External uses of the same key remain outside Angbao's control. The operator's credit model is not an attestation of provider billing or a guaranteed dollar spend limit.

## Hosting and wiring still required

| Deployment | What must happen before enabling |
|---|---|
| Persistent single Node host / worker | Choose the named persistent host/volume, one authoritative database path and access resolver; test restart/backup/restore and ensure every key consumer participates |
| Next.js on Vercel + Supabase | The separate [hosted ledger adapter](hosted-elfa-evidence-ledger.md) now implements transactional Postgres/RPC `reserve`/`settle`; actual Supabase/PostgREST and multi-session concurrency acceptance remain open. Alternatively call one authenticated persistent evidence service; **do not use ephemeral function SQLite files** |
| Hosted PAT | Add explicit evidence scope/consent schema, storage/RPC validation and MCP/API routing; verify real human owner, revocation, recipient, caps and origin; existing memory grants remain unchanged |
| Signup-free local BYO | Select local operator authority/secret storage and consent design; prove no untrusted caller can assert another owner or use a shared key. Do not make signup a prerequisite for offline memory or imported research |
| GUI | Exact query/recipient/cost/expiry preview; pending/uncertain states, no automatic retry; explicit synthesis/save; live pack and saved brief clearly labeled |

No integration in this packet activates the existing provider file or reads its credentials. No account, payment, paid plan, top-up, wallet or provider network action occurred.

## Output compatibility

Success returns `{format:'angbao-elfa-evidence-delivery@1', evidencePack, delivery, financialAuthority:'none'}`. `evidencePack` remains the existing **`angbao-research-evidence@1`** envelope, unchanged for runnable-method consumption. The wrapper adds operation/query/reservation IDs, one provider-attempt count, conservative reserved units, cost qualification and `storedInMemory:false`. It is not a saved brief or an independent fact-verification receipt.

Provider summaries preserve their origin, citation metadata, missing original post text/times and incomplete history/pagination. Neither this service nor the method module verifies market truth, follows cited links, obtains missing original posts or enriches positions. The user agent's synthesis remains authored interpretation until independently supported.

## Acceptance completed and pending

Offline checks use synthetic fixtures and an injected clock, resolver, policy and provider transport. They cover default-off/expiry/rights/eligibility refusal, no inherited memory permission, exact recipient consent, kill/revoke before dispatch, one GET, missing source times, injection text as data, no pagination/fallback/model/save, conservative credit model, owner and shared caps, duplicate/changed operations, uncertain consumption, malformed storage receipts and storage failures. Two service instances share a real database. Twelve independent Node processes compete for three slots without exceeding caps. A process is SIGKILLed after durable reservation; reopening preserves the charged identity.

These checks establish the reservation/module behavior, not live provider entitlement, real PAT integration, provider billing accuracy, host power-loss durability, disk-full recovery, backups or multi-host operation. Existing adapter deadline tests exercise stalled transport/body reads; the new service deliberately has no alternative retry logic.

For a real end-to-end test, agree on one query and receiving agent, use the existing eligible Elfa account through a secure server configuration path, review API Product Terms for private agent delivery and agree the exact call allowance/cutoff. Then integrate the selected durable host/resolver, disable or isolate legacy key consumers and run a single bounded fetch. The personal agent should produce a brief with citations and gaps, request an explicit save and demonstrate it in the **same** GUI/workspace. Never paste credentials into a chat or include them in Git, a research brief or a client bundle.

### Questions for Elfa

| Question | Decision it unblocks |
|---|---|
| Is this specific account PAYG/Grow/Enterprise and eligible for v3 events now? Any card/top-up/renewal condition? | Whether a no-additional-spend test can run |
| What is the exact promotion end in timezone and key/account RPM? Can usage be hard-stopped? | Read window and concurrency/rate configuration |
| Do API Product Terms permit sending provider summaries/citations to the user's chosen model/harness for private synthesis? | Receiving-agent delivery consent and rights policy |
| What source excerpts/derived briefs may be retained, exported or shared between a user's own agents? Required attribution/deletion? | Memory retention/export rules |
| Are event calls ever billed differently by result size, history, entitlement or error? What conservative unit bound is valid after the promotion? | Whether a defensible credit cap can be implemented |
| Can a dedicated key be isolated from portal/browser/manual usage and obtain usage reconciliation? | Aggregate limit and uncertain-read reconciliation |

## Verification commands

```sh
node --test tests/headless-elfa-evidence.test.mjs tests/elfa-research.test.mjs tests/elfa-research-service.test.mjs
node --check src/server/headless-elfa-evidence.mjs
node --check src/server/elfa-evidence-reservations.mjs
```

No dependency installation is required. Executed with Node 22.22.3; `node:sqlite` emits its experimental API warning. The persistent-host adapter is an optional repository implementation, not a new dependency of the accepted private kit.
