# Use Angbao with your personal agent

Angbao keeps review inputs, results and research for the agent you already use. Local use needs no account, token or card.

## Choose where your setup stays

The agent first checks whether it can run Angbao and keep your saved setup after restart, without reading personal files or financial details. It explains where the files will stay and who can access them before you choose. The resumable setup records verified progress. If setup cannot continue, it gives one next action and retains the choices you already made. Runtime and package details stay in private diagnostics; the controller cannot wake a computer or download a runtime.

<details><summary>Agent setup details</summary>

The agent verifies its actual execution computer, available tools, Node.js 22.13 or newer and persistent storage. An older runtime pauses installation; it never replaces shared/global Node silently. Private folder permissions do not isolate agents that share one system account. Explain verified shared-host access as part of the storage choice.

</details>

The recommended choice is **Keep with this agent**. Before installation, the agent shows the actual file location and the verified computer that will hold it. If that is a cloud computer, it says so only after verifying it. The agent does not assume it runs on your Mac or computer.

**Keep on my computer** is available only when the agent has a trusted connected tool that can run there and you choose it. A web chat without execution tools cannot install Angbao. Missing tools, compatible Node or persistent storage mean stopping with a clear explanation of what is needed.

Confirm the location before the private archive is transferred or installed. An existing installation or explicitly chosen account connection stays in place. Your earlier storage choice does not need to be confirmed again.

## Ask your agent to set it up

> Check where your execution tools run and where Angbao can keep my setup after restart, without reading personal files. Recommend keeping it with this agent and show the actual data-file location and verified computer. Offer my own computer only if you can really run there. Once I choose the location, verify the private archive against the operator-provided SHA-256, install it in a fresh private project and keep the saved data separate from the program. Reuse any installation or account connection I already chose. No signup, public tunnel or global configuration change is needed. Ask for missing review inputs and run a free review only when I request it.

Use the [private archive instructions](CLI-DISTRIBUTION.md) for the checksum check and exact installation commands. Do not substitute an npm registry package. The command examples below assume that installation is complete on the confirmed computer.

## Open the same saved workspace next time

Use the recorded project path. Start the server once, or reuse the matching server if it is already running:

```sh
ANGBAO_PROJECT='/actual/confirmed/persistent/angbao'
ANGBAO_BIN='/actual/binary/from-your-saved-setup'
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" start --port 4317
```

In a second terminal on that same computer, use the same project and connection:

```sh
ANGBAO_PROJECT='/actual/confirmed/persistent/angbao'
ANGBAO_BIN='/actual/binary/from-your-saved-setup'
env ANGBAO_DATA_DIR="$ANGBAO_PROJECT/data" ANGBAO_API_URL='http://127.0.0.1:4317' "$ANGBAO_BIN" agent doctor
```

Doctor checks the saved installation without reading financial details. Data stays at `$ANGBAO_PROJECT/data/workspace.json`; keep that folder on restart and when updating the program. Keep the recorded full binary path and loopback origin too. If the server uses a different port, change the server port and client origin together. These examples leave global PATH and agent settings alone.

The optional GUI is available only where that computer's loopback address can be reached. A cloud computer's address is not automatically available in your laptop's browser. Do not expose it through a public tunnel. Terminal use works without opening the GUI. Optional stdio MCP follows the tool contract in the installed kit; each named external client still needs its own connection test. The optional testnet route requires separate operator configuration and an explicit owner wallet review.

## First review, then repeat

Choose **Try a savings review** to preview a complete example, then ask to save it. It preserves your actual figures and installed settings. Or supply all your own inputs: cash, income, expenses, currency, goals and limits, and confirm the chosen approach. Saving personal inputs is separate from running a review, and the inputs remain unverified. In the GUI, use **Start first review**. From the agent, use the complete declaration and commands in [the personal-input example](CLI-DISTRIBUTION.md#own-inputs-without-claiming-a-verified-source).

For **Review again**, check whether current inputs are still up to date. Save complete corrections when needed, then request the repeat. It uses the earlier review's exact goal, strategy version and settings against current saved values; it never restores old balances. The result includes the new saved ID and a comparison. Keep the original body, operation key and version for an interrupted save; an uncertain response is not permission to run a duplicate. Due dates are prompts to start a review yourself.

Research offers **New brief**, with a guided form and preview before saving. Advanced JSON is optional. Sources, claims, inferences and gaps stay separate and unverified. Saving does not fetch source links or call a provider/model. Keep credentials and private reasoning out of briefs. [Research memory](integrations/angbao/references/research-memory.md).

## Choose an account feature later

Sign-in is optional. When you choose the available account import, export local setup, sign in to the configured workspace, review the destination and settings, and confirm the one-time import. Keep the original local data until successful readback. Failed or declined sign-in leaves local use available; automatic sync is not implemented.

Hosted agent access requires an explicitly selected connection and scoped expiring grant. Environment credentials alone do not switch local commands to an account. Keep tokens in the agent's secret environment, never in chat or command arguments. [Hosted access](PERSONAL-AGENT-ACCESS.md).

Installation and a local connection test do not establish real hosted email/session, two-owner isolation or named external-client acceptance. Schedules and billing remain simulated, and no account or plan grants financial authority. [Current evidence](LAUNCH-HANDOFF.md).

## What progress should sound like

“I'm preparing Angbao.” “I'm waiting for the setup file.” “I'm checking your saved connection.” “Angbao is ready.” Each message describes a verified stage. Your agent does not call setup ready before the saved workspace is read back, or say a review was saved before receiving its saved record.

The complete **Try a savings review** preset adds no extra reserve beyond the example's protected reserve. Its exact method and numeric settings are recorded internally. Previewing saves nothing; an explicit save adds one labelled example without changing personal context. A repeat of your own review uses its original settings and current confirmed figures. Explain the changed inputs and suggestion first; put record IDs and technical details behind inspection.

## Pick up the same work in another agent

Open a saved review or research brief and choose **Copy for another agent**. Paste it into another agent already connected to the same Angbao workspace. It opens the selected saved version, keeps the original review approach or research sources, and explains what changed before another save. Copying saves nothing and includes no financial figures or credentials.

On the same computer, both agents can use the local workspace without signing up. A separate cloud computer cannot reach that loopback workspace automatically. Optional hosted access uses an account to identify the owner and separate permission for each agent; it does not require changing local data or settings. The current handoff is access to one workspace, not automatic synchronization between installations.

Ask the receiving agent to confirm current figures and sources before continuing. Missing history stays missing; an unconfirmed save must be inspected before another attempt. Use the installed connection’s discovered handoff capability; a copied reference never grants access.


## Check research against your portfolio

Open Research → Check against portfolio. Choose Try a portfolio check for a labelled example, or Use my values. Bring the source text and your agent’s final assessment, enter portfolio values and your targets, then preview the proposal before saving. Your cash-review settings stay unchanged. A split contribution is a proposal; nothing is scheduled, reserved or traded.

Check again keeps the selected targets and shows changes against that exact saved proposal. Target changes need separate review before sizing. Your agent can use the [complete portfolio guide](integrations/angbao/references/portfolio-checks.md), including `agent handoff --portfolio ID`. No signup or financial account connection is needed.
