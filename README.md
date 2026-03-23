# Lido MCP Server

The reference MCP server for Lido — stETH staking, position management, governance, and earn vault monitoring, all natively callable by any AI agent.

Point Claude, Cursor, or any MCP-compatible agent at this server and stake ETH from a conversation. No custom integration code needed.

## Why This Exists

AI agents need to interact with DeFi protocols, but bridging natural language to on-chain transactions is hard — private keys, gas estimation, protocol quirks (stETH rebasing), transaction safety. This MCP server gives agents a structured, safe interface to Lido:

- **Every write operation supports dry-run simulation** — agents preview gas costs and verify transactions before executing
- **A mental model document** (`lido.skill.md`) teaches agents Lido concepts before they act — rebasing mechanics, wstETH vs stETH tradeoffs, safe staking patterns
- **Live vault monitoring with intelligent alerts** — watch Lido Earn vaults for yield changes, TVL shifts, share price anomalies, and protocol allocation shifts (Aave, Morpho, Pendle, Gearbox, Maple), with alerts in plain language via Telegram or email
- **Flexible rule engine** — define alert conditions as readable expressions like `apr < 3.0` or `spread_vs_steth < -0.5`, with automatic stETH benchmark comparison
- **AI-powered explanations** — optionally uses Claude to translate raw vault events into plain-language messages explaining what changed, why, and whether you need to act
- **Security guardrails** — `read-only`, `dry-run-only`, and `full` modes, receiver allowlists, per-transaction ETH caps

## MCP Server

**70+ tools** across staking, governance, vault monitoring, and L2 — every write operation defaults to `dry_run: true`.

| Category | Tools |
|----------|-------|
| **Query** | `lido_get_balances`, `lido_get_staking_apr`, `lido_get_rewards`, `lido_get_protocol_status`, `lido_convert_amounts`, `lido_get_withdrawal_requests`, `lido_get_claimable_eth`, `lido_get_chain_info` |
| **Intelligence** | `lido_analyze_position`, `lido_estimate_withdrawal_time`, `lido_check_steth_rate`, `lido_check_gas_conditions`, `lido_get_swap_quote` |
| **Stake / Wrap / Withdraw** | `lido_stake_eth`, `lido_wrap_steth_to_wsteth`, `lido_wrap_eth_to_wsteth`, `lido_unwrap_wsteth_to_steth`, `lido_request_withdrawal`, `lido_claim_withdrawal`, `lido_swap_eth_for_ldo` |
| **Governance** | Dual governance state + lock/unlock stETH in veto escrow, Aragon DAO vote/analyze/decode, Snapshot proposals + voting, Easy Track motions + objections, voting power + veto thresholds + timeline |
| **Earn Vault Monitor** | `lido_list_earn_vaults`, `lido_watch_vault`, `lido_unwatch_vault`, `lido_add_rule`, `lido_remove_rule`, `lido_check_vault`, `lido_list_watches`, `lido_get_vault_alerts`, `lido_test_notifications` |
| **stVaults V3** | List, inspect, fund, withdraw, pause/resume beacon deposits, mint/burn shares, rebalance, create vault, request validator exit |
| **Protocol Info** | TVL, fee structure, staking modules, node operators, contract addresses |
| **Token Management** | Token info, allowances, approve, transfer, revoke for stETH/wstETH/LDO |
| **Withdrawal NFTs** | Owner lookup, transfer, approve |
| **L2 wstETH** | Balance, transfer, info on Base/Optimism/Arbitrum + cross-chain balances across 11 L2s |
| **L2 stETH** | Rebasing stETH balance + transfer on Optimism |

**6 guided prompts** — multi-step workflows for staking (`stake-eth-safely`), position analysis (`manage-position`), withdrawals (`withdraw-steth`), governance review (`review-governance`), vault management (`manage-vault`), and governance participation (`participate-governance`).

**4 live resources** — `lido://position/{address}`, `lido://protocol/status`, `lido://governance/state`, `lido://governance/votes`.

**Agent mental model** (`lido.skill.md`) — see "Why This Exists" above.

### Key Design Decisions

- **Real SDK, no mocks** — all operations go through `@lidofinance/lido-ethereum-sdk` and `viem` to actual Ethereum contracts
- **Dry-run by default** — every state-changing tool defaults to `dry_run: true`. Agents must explicitly set `dry_run: false` to execute
- **Protocol-aware errors** — raw blockchain errors (insufficient funds, reverts, nonce conflicts, stake limits, paused) are translated to human-readable messages
- **MCP annotations** — every tool declares `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` so agents know which tools are safe to call without confirmation
- **L2 aware** — set `LIDO_CHAIN_ID` to Base, Optimism, or Arbitrum and the server exposes only wstETH-specific tools; L1-only tools are excluded automatically

## Earn Vault Monitor

Watches Lido Earn vaults (EarnETH, EarnUSD) and tells depositors when something worth knowing has changed — in plain language, not raw data.

### How It Works

1. **Watch a vault** — call `lido_watch_vault` with a vault address (use `lido_list_earn_vaults` to discover them)
2. **Define alert rules** — write conditions as readable expressions evaluated against live vault data
3. **Receive alerts** — get notified via Telegram or email when rules fire, with AI-generated explanations

The monitor runs continuously:
- Subscribes to on-chain **`Deposit`/`Withdraw`** events on each vault and **`TokenRebased`** on stETH for near-real-time reaction
- Runs a **30-second polling** health check as a fallback
- Compares vault APR against the **stETH SMA APR** from the Lido API on every check
- **Detects protocol allocation shifts** across underlying protocols (Aave, Morpho, Pendle, Gearbox, Maple) by reading on-chain subvault balances for known Lido Earn vaults
- Persists all state (watches, snapshots, alerts, dedup) in **SQLite** — survives restarts
- **6-hour dedup** window per rule per vault prevents alert fatigue

### Alert Delivery

- **Telegram** — formatted alerts with severity indicators, vault context, benchmark comparison, and actionable guidance
- **Email** — HTML-formatted alerts with the same context
- **AI explanations** (optional) — when `ANTHROPIC_API_KEY` is set, each alert is passed to Claude which generates a plain-language explanation covering:
  1. What changed — the specific metric that triggered the alert
  2. Why it likely happened — plausible explanations based on the data
  3. What to consider — whether the depositor should act, wait, or investigate

### Rule Engine

Rules aren't a fixed set of predefined alerts — they're **open-ended expressions** you define in natural language through the agent. Tell Claude "alert me if yield drops below 3%" and it writes the rule `apr < 3.0`. Say "notify me if the vault starts underperforming stETH by more than half a percent while TVL is also dropping" and it composes `spread_vs_steth < -0.5 and tvl_change_pct < 0`. The agent translates your intent into a mathjs expression evaluated against live vault metrics:

| Variable | What it is |
|----------|------------|
| `apr` / `apy` | Current vault APR (%) |
| `apr_prev` / `apy_prev` | APR from previous snapshot |
| `apr_delta` / `apy_delta` | APR change between snapshots (percentage points) |
| `tvl` | Total value locked |
| `tvl_prev` | TVL from previous snapshot |
| `tvl_change_pct` | TVL change as a percentage |
| `share_price` | Current share price (asset/share) |
| `share_price_prev` | Share price from previous snapshot |
| `share_price_change_pct` | Share price change as a percentage |
| `steth_apr` | stETH SMA APR benchmark (from Lido API) |
| `spread_vs_steth` | Vault APR minus stETH APR (positive = outperforming) |
| `max_alloc_shift` | Largest protocol allocation change between snapshots (pp) |
| `num_protocols` | Number of protocols with active allocations |
| `top_alloc_pct` | Largest single protocol allocation (%) |

**Example rules:**

| Expression | Fires when |
|------------|-----------|
| `apr < 3.0` | Yield drops below 3% — a simple yield floor |
| `spread_vs_steth < 0` | Vault underperforms raw stETH staking |
| `spread_vs_steth < -0.5` | Vault underperforms stETH by more than 0.5pp |
| `tvl_change_pct < -10` | TVL drops >10% between checks — capital flight |
| `share_price_change_pct < -0.1` | Share price drop — possible exploit or depeg |
| `apr < 3.0 and tvl_change_pct < -5` | Yield dropped AND capital leaving |
| `abs(apr_delta) > 2.0` | Large APR swing in either direction |
| `apr < steth_apr - 1.0` | Falls more than 1pp behind stETH benchmark |
| `apr > apr_prev * 1.5` | APR spiked to 1.5x its previous value |
| `max_alloc_shift > 10` | Protocol allocation shifted by more than 10pp |
| `top_alloc_pct > 80` | Single protocol holds >80% of vault capital |

Supports `and`/`or`/`not` boolean logic, comparison operators (`<`, `>`, `<=`, `>=`, `==`, `!=`), arithmetic (`+`, `-`, `*`, `/`), and safe math functions (`abs`, `min`, `max`, `round`, `floor`, `ceil`, `sqrt`).

Each rule includes a **message template** with `{{variable}}` interpolation:

```
APR dropped to {{apr}}%, below your 3% floor. stETH is at {{steth_apr}}%.
```

If no message is provided, one is auto-generated from the expression pattern.

The rule engine is **sandboxed** — expressions are parsed into an AST and validated against an allowlist of variables, functions, and node types. No arbitrary code execution.

### Protocol Allocation Detection

For known Lido Earn vaults (strETH/EarnETH), the monitor reads on-chain balances across each vault subvault to determine how capital is distributed across underlying protocols — Aave, Morpho, Pendle, Gearbox, Maple, and others. Each health check compares the current allocation to the previous snapshot and detects shifts.

Allocation data appears in:
- **Health reports** (`lido_check_vault`) — shows per-protocol percentage breakdown
- **Alert context** — when any rule fires, the alert includes allocation shift details (protocol name, from/to percentages, delta)
- **AI explanations** — the LLM receives allocation shift data and can explain rebalancing events in plain language
- **Rule variables** — `max_alloc_shift`, `num_protocols`, and `top_alloc_pct` let you write rules like `max_alloc_shift > 10` (alert when any protocol's share shifts by more than 10pp)

### MCP-Callable Vault Health

Other agents can query vault health programmatically — the monitor isn't just a notification service, it's a building block:

- **`lido_check_vault`** — on-demand health check for any ERC-4626 vault (no watch required). Returns APR, TVL, share price, and stETH benchmark spread
- **`lido_list_earn_vaults`** — discover available Mellow earn vaults from the live API
- **`lido_get_vault_alerts`** — query alert history programmatically

## Target Use Cases

### 1. Developer stakes ETH via Claude — zero integration code

```
User: "Stake 1 ETH with Lido"

Claude: Let me walk you through this safely.
  → Checks protocol status (not paused, limits ok)
  → Checks your balance (1.5 ETH available)
  → Shows current APR (3.4%, 7-day SMA 3.3%)
  → Dry-runs the transaction (gas: 0.002 ETH)
  → "Ready to stake 1 ETH. Gas cost ~0.002 ETH. Confirm?"

User: "Yes"

Claude: → Executes stake
  → "Done. TX: 0xabc... You received 1.0 stETH."
```

### 2. Depositor gets a Telegram message explaining why EarnETH yield dropped overnight

```
User: "Watch the EarnETH vault. Alert me if yield drops below 4%
       or it falls behind raw stETH staking."

Claude: → Discovers vault via lido_list_earn_vaults
  → Calls lido_watch_vault with rules:
    - apr < 4.0 [warning]
    - spread_vs_steth < 0 [critical]
  → "Watching EarnETH (0x...). APR: 5.2%, TVL: 12,450 ETH.
     You'll get a Telegram alert if APR drops below 4%
     or the vault underperforms stETH."

[Overnight, APR drops to 3.6%]

Telegram: 🚨 EarnETH — Warning

  APR dropped to *3.60%*, down from 5.20%.

  The vault's yield fell 1.6pp since the last check. This likely
  reflects a rotation in the underlying strategy or temporary
  market conditions. The vault is still outperforming direct stETH
  staking (3.40%) by 0.20pp, so no immediate action is needed —
  but worth monitoring if the trend continues.

  • Current APR: 3.60%
  • Previous APR: 5.20%
  • stETH benchmark: 3.40%
  • Spread vs stETH: 0.20pp above

  View on Etherscan
```

### 3. Agent queries vault health before deciding to deposit

```
Agent: → Calls lido_check_vault(address="0x...")

Response:
  === Vault Health: EarnETH ===
  TVL: 12,450.00 ETH
  Share Price: 1.034521 ETH/share
  APR: 5.20%

  --- Benchmark ---
  stETH APR (SMA): 3.40%
  Spread: 1.80pp above stETH benchmark

  --- Protocol Allocations ---
  Aave: 32.1%
  Morpho: 28.4%
  Pendle: 18.7%
  Gearbox: 12.3%
  Maple: 8.5%

  Last checked: 2025-03-23T14:30:00.000Z

Agent: → Diversified allocation, positive spread — decides to deposit
```

### 4. Natural-language rule configuration

```
User: "I want to know if the vault starts doing worse than just
       holding stETH, especially if people are also pulling money out.
       And give me a heads up if the share price ever drops suddenly —
       that could mean something bad happened."

Claude: I'll set up three rules for you.
  → Calls lido_add_rule: "spread_vs_steth < 0 and tvl_change_pct < -5" [warning]
    Message: "Vault underperforming stETH (spread {{spread_vs_steth}}pp)
              while TVL dropped {{tvl_change_pct}}%"
  → Calls lido_add_rule: "share_price_change_pct < -0.1" [critical]
    Message: "Share price dropped {{share_price_change_pct}}% — investigate immediately"
  → Calls lido_add_rule: "spread_vs_steth < -1.0" [critical]
    Message: "Vault is {{spread_vs_steth}}pp behind stETH — significant underperformance"

  "Done. Three rules active:
   1. Warning if the vault trails stETH while TVL is declining
   2. Critical alert on any sudden share price drop (>0.1%)
   3. Critical if the vault falls more than 1pp behind stETH

   Dry-ran all three against current data — none would fire right now
   (APR 5.2% vs stETH 3.4%, TVL stable). You'll get alerts the
   moment any condition is met."
```

### 5. DAO contributor queries and votes on governance proposals

```
User: "Show me the latest Lido DAO votes"

Claude: → Calls lido_get_aragon_vote
  → "Vote #185: Open — Yea 15.2M LDO (92%), Nay 1.3M LDO (8%)
     Vote #184: Executed — passed with 98% support ..."

User: "Vote yes on #185"

Claude: → Calls lido_vote_on_proposal (dry_run=true)
  → "Dry run: Vote Yea on #185. You have 5,000 LDO. Gas: ~0.001 ETH. Confirm?"

User: "Yes"

Claude: → Executes vote
  → "Done. Voted Yea on #185. TX: 0xabc..."
```

### 6. Staker signals opposition via Dual Governance

```
User: "I want to signal opposition to the latest proposal."

Claude: → Calls lido_get_governance_state
  → "Governance is in Normal state. Veto signalling is at 0.12%,
     well below the first seal threshold of 1%."
  → Dry-runs lock of 10 stETH in escrow
  → "Ready to lock 10 stETH for governance. Gas: ~0.003 ETH. Confirm?"

User: "Yes"

Claude: → Approves stETH for escrow + locks
  → "Done. 10 stETH locked in veto signalling escrow. TX: 0xdef..."
```

## Setup

```bash
git clone <repo-url>
cd lido-mcp-server
cp .env.example .env  # edit with your RPC URL, private key, chain ID
npm install && npm run build && npm start
```

See `.env.example` for all configuration options (chain ID, security mode, Telegram, SMTP, Anthropic).

### Connect to Claude / Cursor

```json
{
  "mcpServers": {
    "lido": {
      "command": "bash",
      "args": ["/path/to/lido-mcp-server/start.sh"],
      "env": {
        "LIDO_RPC_URL": "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
        "LIDO_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY",
        "LIDO_CHAIN_ID": "1"
      }
    }
  }
}
```

## License

MIT
