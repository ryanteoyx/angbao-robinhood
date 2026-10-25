# Prepared research and saved answers — 0.5.5 candidate

This increment completes a supplied-evidence method loop in the local application. An agent prepares selected sources using the pinned `evidence-review@1.0.0` method, inspects the resulting citations and gaps, and explicitly saves that prepared work. The agent or user then authors a concise answer, previews it against the exact saved run, and explicitly saves the answer. Preparation and preview do not save or contact a provider/model. Neither a saved answer nor schema validation establishes factual support.

The normal research brief remains the answer record. Its server-owned `methodRunRef` links a separate bounded work record containing the full run, method/settings, source-pack digests, evidence selection/omissions, reference time, gaps and original authored output. The GUI Research → Research work view displays prepared sources separately from an answer. Guided authoring and Advanced JSON share the same preview/save contract. Saved answers can reopen their approach. Copy for another agent resolves the selected work through its workspace and digest; it never silently chooses a newer record.

## Local agent commands

Use the actual installed binary and the same confirmed data directory and loopback origin. Local use needs no signup. Discover the tools before using them; older programs do not acquire these operations automatically.

```sh
angbao agent method prepare --file /private/supplied-method-input.json
angbao agent method save --file /private/prepared-result.json --etag '"N"' --key prepare-001
angbao agent method read --id WORK_UUID
angbao agent handoff --work WORK_UUID
angbao agent method preview --id WORK_UUID --file /private/authored-answer.json
angbao agent method complete --id WORK_UUID --file /private/authored-answer.json --etag '"N"' --key answer-001
```

The prepare input follows [the pinned method contract](runnable-research-method.md). Files are bounded regular JSON data. `prepare --previous WORK_UUID --file /private/new-evidence.json` repeats a completed work with its exact method, resolved settings and question; the file supplies only new evidence packs/reference time. The authored repeat must select that work's saved answer as both predecessor and baseline. Missing earlier work is an explicit error. An ordinary brief save cannot strip method lineage from a successor.

MCP equivalents are `angbao_prepare_research_work` (`{input,previousWorkId?}`), `angbao_read_research_work` (`{workId?}`), `angbao_save_research_work` (`{memory,expectedETag,idempotencyKey}`), `angbao_preview_research_work` (`{workId,brief}`) and `angbao_complete_research_work` (`{workId,brief,expectedETag,idempotencyKey}`). Save accepts the prepared memory only, before an authored output exists. Read without an ID lists summaries. Preview does not revise the workspace. The existing handoff tool accepts `kind:research-method`.

Each write needs the exact current quoted ETag and a non-secret operation key. Retain the original body/key/ETag for a deliberate retry after an uncertain response. The durable replay result contains compact work ID/digest and the normal answer when completed, rather than another full method run. A missing retained record is unavailable; a retry does not regenerate evidence or silently rerun a method. There are no automatic retries.

## Storage and permissions

Retention is at most eight work records, with a 12 KiB prepared run and 28 KiB complete record. Existing answer limits remain 12 KiB/version and twenty retained versions. Before a work save/completion, the selected portable workspace must fit the 1 MiB export budget. Hosted writes additionally retain the existing 2 MiB whole-envelope limit. Oversized input is rejected before commit. No automatic method-work deletion is implemented.

Portable manifests use version 2 only when method work is present. Version 1 remains supported for existing workspaces. Import remaps owned work/answer UUIDs and restamps record digests while preserving original run IDs/digests, method/settings, source provenance and authored output. Imported answer labels remain `imported`; original authored provenance stays in method memory. Existing data/settings follow the chosen import policy. Client context writes cannot erase method work.

Hosted agent preparation/read/preview requires `research:read`; save/completion requires `research:write` with `research:read`, using existing explicit v2 research-memory consent. These scopes do not read holdings/cash or enable Elfa. Independent grants, owner binding, expiry/revocation, CAS and compact replay are exercised through local service-handler fixtures. SQL migration `20261024000500_research_method_work.sql` extends the service-role-only atomic mutation contract and preserves grants, locking and request/review limits. It has not been applied or accepted against an actual Postgres service in this workspace. Do not claim a hosted deployment from handler tests.

## Boundaries and next acceptance

The Elfa reservation module is a separate, disabled integration foundation. No route in this loop fetches evidence, activates a provider, incurs costs, runs a model, connects an account or wallet, or places an order. Source text remains untrusted data. Supplied provider labels/digests are not proof of live retrieval. Any portfolio-aware sizing proposal needs separate owned portfolio inputs and policy, with financial context scopes kept separate from research memory.

Local automated acceptance exercises the real CLI, HTTP server, GUI event handlers, temporary storage, restart, exact replay, handoff and portable import. GUI tests use a minimal DOM fixture, not a native/browser session. Hosted tests use scoped store fixtures, not a deployed database. Angbao Test's frozen 0.5.4 acceptance is separate; its last verified actual version remains 0.5.3 after a desktop input failure. The 0.5.4 archive is unchanged. This 0.5.5 source candidate requires its own later installed-kit and real-client acceptance.

## Review closure receipt

Independent source review failed at a777fcf for malformed rehashed source selections and contradictory retained answer/work links. The exact seven original transforms all reject at98d7497; valid full-memory import and exact handoff still pass. The later f174c12 GUI closure checks the same work/digest/answer linkage during uncertain completion recovery. All502tests, TypeScript and the production Webpack build passed; local installed-package and minimal-DOM GUI/HTTP tests remain distinct from actual Postgres, native/browser or named external-client acceptance. [Dated candidate receipt](research-work-candidate-2026-10-24.md).
