# Angbao local and optional hosted commands

The locally packed `angbao-personal-local` kit requires Node.js >=22.13.0. Obtain the exact version/archive digest from the approved public manifest or separately trusted private-candidate review; the kit is not an npm registry release. Follow [connection setup](connection.md), preserve the confirmed data location, and use the absolute installed binary. `angbao` below is shorthand, not an instruction to change global PATH.

The skill destination must be fresh, absolute, named `angbao`, and have existing non-symlink parent directories. Existing files/directories and symlink ancestors are refused. The installer copies only this skill and its packaged references/templates/evaluation prompts. It never discovers harness directories, modifies `AGENTS.md`, changes MCP configuration, or writes credentials.

The default `angbao agent` commands use the already running private local workspace, without an Angbao account or token. Start `angbao start`; `ANGBAO_API_URL` may select a different exact loopback HTTP origin. Context and history carry a quoted ETag, and local writes use the same CAS/idempotency arguments shown below. Use `angbao export --claim --out /chosen/new-file.json` for a later explicit hosted import. Restart with the same data directory to retain the installation, pins/settings, reviews and authored research.

For separately chosen authenticated hosted use, add `--hosted` to each command below or pass an explicit `--origin`. Environment credentials alone never select hosted mode. Supply `ANGBAO_REMOTE_ORIGIN` as the exact HTTPS origin, without trailing slash, path, query, fragment or embedded credentials. `--origin HTTPS_ORIGIN` explicitly overrides it for that invocation. There is no implicit hosted default or fallback to `ANGBAO_API_URL`.

Supply `ANGBAO_AGENT_TOKEN` through the harness's secret mechanism. There is no token flag or credential file. `--key` below means a non-secret **operation idempotency identifier**, not the bearer token.

| CLI | Backend tool | Access/effect |
| --- | --- | --- |
| `angbao agent doctor` or `capabilities` | MCP initialize, initialized notification, tools/list | Local installation/capability discovery; no financial read. Hosted: authentication/discovery, three metered requests |
| `angbao agent strategies` | `angbao_list_strategies` | Supported built-in pins/settings; no private context |
| `angbao agent context` | `angbao_read_workspace` | `workspace:read`; bounded context and quoted ETag |
| `angbao agent history --limit 10` | `angbao_read_history` | `history:read`; 1–20 retained reviews plus associated decisions/feedback and quoted ETag |
| `angbao agent setup --file CONTEXT.json --etag '"N"' --key OPERATION_ID` | `angbao_save_context` | Local only; explicit complete manual inputs and chosen strategy/settings, no review |
| `angbao agent repeat --review ID --inputs-confirmed yes --etag '"N"' --key OPERATION_ID` | Read exact handoff, then `angbao_run_strategy` | Local or separately authorized hosted; original review pin/settings/goal against confirmed current inputs, with snapshot comparison |
| `angbao agent review ...` | `angbao_run_strategy` | `reviews:create` and `workspace:read`; saves one calculation review |
| `angbao agent feedback ...` | `angbao_submit_feedback` | `feedback:write`; saves the explicitly chosen rating |

For a saved brief, local `agent research-portfolio preview|save --file FILE` maps to `angbao_preview_research_portfolio` / `angbao_save_research_portfolio`. Inspect the complete preview before explicitly saving with its original body, quoted ETag and non-secret operation key. Existing portfolio read/handoff returns the full retained record. The local `agent archive list|preview|save|export|import-preview|import` commands preserve active/archived native history; discover their exact schemas. Both families are refused in hosted mode before connecting. See [portfolio checks](portfolio-checks.md).

For first use with personal values, save a private file with the complete user-supplied declaration. This synthetic example shows its shape:

```json
{
  "inputMode": "manual",
  "cash": {"available":3200,"upcomingBills":400,"monthlyIncome":2500,"monthlyExpenses":1800,"currency":"SGD"},
  "goals": [{"id":"reserve","name":"Reserve","targetAmount":6000,"currentAmount":1500,"monthlyContribution":400,"currency":"SGD"}],
  "rules": {"reserve":2000,"maxSuggestion":200},
  "strategy": {"id":"weekly-goals","version":"1.2.0","settings":{"extraReserve":0,"periodsPerMonth":5}}
}
```

Use the current quoted ETag from `angbao agent context` and a new operation key with `angbao agent setup --file /chosen/context.json --etag ... --key ...`. Then read the saved setup and run the separately requested review using its new ETag. The declaration is `{inputMode:"manual",cash,goals,rules,strategy:{id,version,settings}}`; use values explicitly supplied by the user and the selected supported strategy. Save it with `setup` before the first review. Never convert sample values into personal inputs by changing their label. Setup is local-only. Hosted repeats require history read, workspace read and review creation scopes. In MCP, the setup arguments are `{declaration,expectedETag,idempotencyKey}`. Hosted tools retain their existing permissions and do not gain context-write access.

For repeat use, the user must confirm current inputs. `repeat` reads the saved original review and uses its exact pin/settings/goal; it does not replace current financial context. Preserve the original review ID, key, request body and ETag for uncertain recovery. No matching amount or similar timestamp proves replay identity. Comparisons describe saved inputs and calculated suggestions, with no financial execution or performance claim. Missing/legacy snapshots show an explicit unavailable result.

After the user asks for a review, read the owner's installed exact pin and saved settings from consented context. Cross-check the catalogue; do not substitute another supported pin, silently upgrade, invent settings or fall back to defaults. If the chosen installed pin/settings cannot be established, resolve the choice with the user before writing. The following example applies only when this pin and setting are the owner's confirmed installed configuration:

```sh
angbao agent review --strategy cash-buffer@1.1.0 --settings '{"extraReserve":100}' --etag '"7"' --key review-20261024-001
```

Settings are validated by the backend against the exact manifest. Do not copy the example configuration merely because the catalogue supports it. Omitting settings is safe only when the exact installed configuration is established and server resolution is intended; retain the exact original request for recovery. Optional `--goal GOAL_ID` chooses a saved goal. No `--managed`, source, owner, policy, billing or financial-authority override is supported.

Only after the user explicitly rates that review:

```sh
angbao agent feedback --review REVIEW_ID --rating useful --reason 'User supplied reason' --etag '"8"' --key feedback-20261024-001
```

Ratings are `useful`, `not-useful`, or `unclear`. The CLI does not choose a rating. It prints JSON results; credentials matching the Angbao token format are redacted even if a malformed server response echoes them.

Writes require an exact quoted numeric ETag and a non-secret 8–128 character operation key. There are no automatic retries. An uncertain response does not prove a write failed: preserve the same key/payload/ETag for an intentional recovery. If any original component is lost, safe replay cannot be established; do not reconstruct it from a similar history row or matching amount, invent another key, or silently run again. A replay returns the original result, even after workspace receipt rotation; it must not consume another review allowance. A changed payload under the same key conflicts. A stale revision is a conflict, not permission to overwrite.

401: token invalid, expired or revoked. 403: scope or deployment protection denied. 409/412: inspect operation/revision conflict. 429: grant allowance or rate limit. 5xx or HTML: hosted service unavailable/unconfigured, not successful local execution. The CLI does not bypass deployment protection or automatically switch origin.

Each grant has expiry, revocation, request/review budgets and a 30-per-fixed-minute request limit. Discovery, reads and retries consume request allowance; unique committed reviews consume review allowance. New requests and write commits check revocation/expiry. Reads already authorized can finish; committed writes are not undone. These are not monetary or model-spend permissions.

`angbao start`, `status`, `review --demo|--manual`, `export`, default `angbao agent` and default `angbao mcp` all use the local file-backed workspace. Configuring a hosted token does not switch, merge or sync it. Hosted claims require the separate authenticated preview and explicit owner confirmation.

Research memory commands and the authoring schema are documented in [research-memory.md](research-memory.md). Local memory needs no account; hosted memory requires explicit research scopes. Both preserve CAS/replay identity, and do not fetch Elfa or invoke a model.

## Complete sample preset

`angbao agent sample preview --preset try-savings` reads the complete **Try a savings review** preset without saving. It pins `cash-buffer@1.1.0` and explicitly selects `extraReserve: 0`: no additional reserve beyond the example's protected reserve. Show the example result and explain that the figures are made up.

When the user asks to save it, use `angbao agent sample save --preset try-savings --etag '"N"' --key UNIQUE_OPERATION_ID`. The operation adds one labelled sample review while preserving the actual saved cash, goals, limits and installed settings. Keep the original request/key/revision for an uncertain retry. A sample goal is separate from the user's goals; a normal repeat never restores the sample figures over personal inputs. Hosted selection is refused for this local preset.

## Exact saved-work continuation

`angbao agent handoff --review REVIEW_ID` or `angbao agent handoff --brief VERSION_ID` reads one saved version without saving anything. In a second connected agent use the returned reference checks:

```sh
angbao agent handoff --review REVIEW_ID --workspace WORKSPACE_REF --digest RECORD_DIGEST --etag '"N"'
```

MCP/HTTP tool: `angbao_read_handoff` with `{kind,recordId,workspaceId,digest,baseETag}`. The first lookup needs only kind and recordId; recipient lookups should include all reference checks. The server validates workspace and record digest before returning content. Workspace revision changes are reported; the original record remains selected. Recheck current inputs rather than automatically advancing a stale save. The GUI can copy the same reference from a saved review or brief.

Review repeat writes may use `angbao_run_strategy` with the original `repeatOfReviewId`, exact `goalId` and strategy/settings, plus expectedETag/idempotencyKey. Both local and hosted servers recheck these at commit. Research successors use normal `angbao_save_research_brief` with `previousVersionId` and an explicit `baselineId`; concurrent/stale predecessors are rejected. Hosted handoff access is read-only and uses existing scopes. No source fetch, model call, account creation, data migration, background job or authority transfer occurs. Never copy an access token into a handoff. Another agent's unconfirmed write remains inspect-only.


## Optional owner-local Elfa

Default local and protected-read-only tools never inherit provider authority. First run `"$ANGBAO_BIN" elfa guide` to read the canonical packaged owner-setup checklist without any operator file, key or source activation. After that checklist, the actual installed binary offers `elfa provision|preview|approve|fetch|status|revoke|evidence read --operator-file PRIVATE_FILE ...`. Provision is disabled; a reviewed enabled configuration/key must be separately owner-provisioned. No raw key argument/output, global configuration, automatic enablement or paid fallback.

Use `elfa preview --operator-file /private/operator.json --operation OP --query-file /private/query.json`; show the exact disclosure and its digest. Only a separate owner `elfa approve --operator-file /private/operator.json --operation OP --preview-digest DIGEST` marks it approved. Then `elfa fetch` with those exact operation/digest options attempts one fixed events read and retains the normalized delivery privately. The agent must not self-approve or infer approval from installation/general research access. No native brief/portfolio save happens inside fetch.

`elfa status` uses the same exact options and does no network/key read/ledger creation. Use `elfa evidence read` for an explicit retained historical artifact; it is not current source truth or renewed approval. Completed provider state does not prove a delivered/saved answer. Keep uncertain holds and original locks/files. Do not use a new operation ID or another endpoint/provider as a retry.

Explicit `mcp --local-elfa-operator` uses only `ANGBAO_LOCAL_ELFA_OPERATOR_FILE` (a private descriptor path). Tools: `angbao_preview_elfa_events({operationId,query})`, `angbao_fetch_elfa_events({operationId,expectedDigest})`, `angbao_read_elfa_operation({operationId,expectedDigest})`, `angbao_read_elfa_evidence({operationId,expectedDigest})`. There is no approval/provision/save tool. Hosted/origin/protected-client credentials cannot be mixed with this profile. Query contains fixed Unix-second from/to, limit1–10 and q or entity UUIDs, no URL/cursor/key/actor/policy/consent/path. Optional bounded native transport metadata is discarded. Test the actual binary and loaded guidance in the named harness; a fixture/client label is not compatibility proof.
