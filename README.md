# Lido MCP Server

The reference MCP server for Lido — making stETH staking, position management, and governance natively callable by any AI agent.

Point Claude, Cursor, or any MCP-compatible agent at this server and stake ETH from a conversation. No custom integration code needed.

## Why This Exists

AI agents need to interact with DeFi protocols, but bridging the gap between natural language and on-chain transactions is hard. You need to handle private keys, gas estimation, protocol-specific quirks (like stETH rebasing), and transaction safety — all without the agent making a costly mistake.

This MCP server solves that by giving agents a structured, safe interface to the Lido protocol:

- **Every write operation supports dry-run simulation** — agents always preview gas costs and verify transactions before executing
- **A mental model document** (`lido.skill.md`) teaches agents Lido-specific concepts before they act — rebasing mechanics, wstETH vs stETH tradeoffs, safe staking patterns
- **Position monitoring with bounds** — agents can autonomously manage staking positions within human-set parameters
- **Guided workflows via MCP prompts** — pre-built multi-step workflows for staking, withdrawing, and governance review

## What's Included

| Category | Tool | Description |
|----------|------|-------------|
| **Query** | `lido_get_balances` | ETH, stETH, wstETH balances for any address |
| | `lido_get_staking_apr` | Current APR + N-day SMA |
| | `lido_get_rewards` | Historical staking rewards with configurable lookback |
| | `lido_get_protocol_status` | Stake limits, queue mode, withdrawal bounds |
| | `lido_convert_amounts` | stETH ↔ wstETH rate conversion |
| | `lido_get_withdrawal_requests` | All withdrawal NFTs and their status |
| | `lido_get_claimable_eth` | Total ETH available to claim |
| | `lido_get_governance_state` | Dual governance state, config, veto signalling, warning status |
| **Intelligence** | `lido_analyze_position` | Position analysis with bounds checking and recommendations |
| | `lido_estimate_withdrawal_time` | Predict withdrawal finalization time from queue depth and mode |
| | `lido_check_steth_rate` | Share rate, pool composition, DEX discount detection |
| | `lido_check_gas_conditions` | Gas price tiers, operation costs, break-even analysis |
| **Stake** | `lido_stake_eth` | Stake ETH → stETH (with dry_run) |
| **Wrap** | `lido_wrap_steth_to_wsteth` | Wrap stETH → wstETH (with dry_run) |
| | `lido_wrap_eth_to_wsteth` | Stake + wrap in one tx (with dry_run) |
| | `lido_unwrap_wsteth_to_steth` | Unwrap wstETH → stETH (with dry_run) |
| **Withdraw** | `lido_request_withdrawal` | Request withdrawal with auto-splitting (with dry_run) |
| | `lido_claim_withdrawal` | Claim finalized withdrawals (with dry_run) |
| **Governance** | `lido_get_aragon_vote` | Query Aragon DAO votes — recent list or specific vote details |
| | `lido_vote_on_proposal` | Cast vote on DAO proposal (with dry_run) |
| | `lido_lock_steth_governance` | Lock stETH in veto signalling escrow (with dry_run) |
| | `lido_unlock_steth_governance` | Unlock stETH from governance escrow (with dry_run) |
| **L2 wstETH** | `lido_l2_get_wsteth_balance` | wstETH + ETH balances on Base, Optimism, or Arbitrum |
| | `lido_l2_transfer_wsteth` | Transfer wstETH on L2 (with dry_run) |
| | `lido_l2_get_wsteth_info` | L2 wstETH contract info + total bridged supply |
| **L2 stETH** | `lido_l2_get_steth_balance` | Rebasing stETH + ETH balances on Optimism |
| *(Optimism only)* | `lido_l2_transfer_steth` | Transfer rebasing stETH on Optimism (with dry_run) |

### 4 Prompts (Guided Workflows)

| Prompt | What It Does |
|--------|-------------|
| `stake-eth-safely` | Walks through protocol check → balance check → APR review → dry run → execution |
| `manage-position` | Comprehensive position analysis with monitoring bounds setup |
| `withdraw-steth` | Full withdrawal lifecycle: request → monitor → claim |
| `review-governance` | Governance state analysis with plain-language interpretation |

### 3 Resources (Live Data)

| Resource URI | Description |
|-------------|-------------|
| `lido://position/{address}` | JSON snapshot of a staking position |
| `lido://protocol/status` | Protocol status: limits, queue mode, APR |
| `lido://governance/state` | Governance state, veto signalling, escrow |

### Agent Mental Model (`lido.skill.md`)

A structured document that teaches AI agents Lido-specific knowledge:
- stETH rebasing mechanics and the shares model
- wstETH vs stETH tradeoffs and when to use each
- Safe staking patterns (always dry-run first)
- Withdrawal lifecycle (request → wait → claim)
- Dual governance states and what they mean for stakers
- Common mistakes to avoid (dust amounts, exact comparisons, forgetting claims)

## Setup

### Prerequisites
- Node.js 18+
- An Ethereum RPC URL (Alchemy, Infura, etc.)
- A private key for the wallet that will execute transactions

### Install

```bash
git clone <repo-url>
cd lido-mcp-server
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
LIDO_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
LIDO_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
LIDO_CHAIN_ID=1
```

**L1 (full Lido SDK — staking, wrapping, governance):**
- `LIDO_CHAIN_ID=1` for Ethereum mainnet
- `LIDO_CHAIN_ID=17000` for Holesky testnet
- `LIDO_CHAIN_ID=560048` for Hoodi testnet (recommended for testing)

**L2 (wstETH balance queries + transfers):**
- `LIDO_CHAIN_ID=8453` for Base
- `LIDO_CHAIN_ID=10` for Optimism (also supports rebasing stETH)
- `LIDO_CHAIN_ID=42161` for Arbitrum

### Build & Run

```bash
npm run build
npm start
```

### Connect to Claude / Cursor

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "lido": {
      "command": "node",
      "args": ["/path/to/lido-mcp-server/dist/index.js"],
      "env": {
        "LIDO_RPC_URL": "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
        "LIDO_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY",
        "LIDO_CHAIN_ID": "1"
      }
    }
  }
}
```

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

### 2. Agent monitors and manages position within bounds

```
User: "Monitor my Lido position. Alert me if APR drops below 3%
       or my staked amount exceeds 100 ETH."

Claude: → Calls lido_analyze_position with min_apr=3.0, max_position_eth=100
  → "Position: 85.2 ETH staked, APR 3.4%. All within bounds."

[Later, APR drops]

Claude: → Calls lido_analyze_position again
  → "⚠ APR is 2.8% — below your minimum of 3.0%.
     7-day SMA is 3.1%, suggesting this may be temporary.
     Recommend: wait 24h and re-check before withdrawing."
```

### 3. DAO contributor queries and votes on governance proposals

```
User: "Show me the latest Lido DAO votes"

Claude: → Calls lido_get_aragon_vote
  → "5 most recent votes:
     Vote #185: Open — Yea 15.2M LDO (92%), Nay 1.3M LDO (8%)
     Vote #184: Executed — passed with 98% support
     ..."

User: "Vote yes on #185"

Claude: → Calls lido_vote_on_proposal (dry_run=true)
  → "Dry run: Vote Yea on #185. You have 5,000 LDO. Gas: ~0.001 ETH. Confirm?"

User: "Yes"

Claude: → Calls lido_vote_on_proposal (dry_run=false)
  → "Done. Voted Yea on #185. TX: 0xabc..."
```

### 4. Staker signals opposition via Dual Governance

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

### 5. L2 wstETH management on Base

```
User: "Check my wstETH balance on Base"

Claude: → Calls lido_l2_get_wsteth_balance
  → "Balances on Base:
     ETH: 0.5
     wstETH: 10.0
     Note: wstETH on L2 is a bridged token whose value tracks the L1 rate."
```

## Architecture

```
src/
├── index.ts              MCP server entry — registers tools, prompts, resources
├── config.ts             Environment validation (RPC, private key, chain)
├── sdk-factory.ts        Viem clients + Lido SDK initialization
├── types.ts              Shared TypeScript types
├── prompts.ts            MCP prompt definitions (guided workflows)
├── resources.ts          MCP resource definitions (live data endpoints)
├── tools/
│   ├── index.ts          Tool router (registration + dispatch)
│   ├── apr.ts            Staking APR queries
│   ├── balances.ts       ETH/stETH/wstETH balance queries
│   ├── convert.ts        Token amount conversion
│   ├── gas.ts            Gas price analysis + break-even calculator
│   ├── governance.ts     Dual governance state + config + warnings
│   ├── aragon-voting.ts  Query & vote on Aragon DAO proposals
│   ├── governance-actions.ts Lock/unlock stETH in veto signalling escrow
│   ├── position.ts       Position analysis with bounds checking
│   ├── protocol-status.ts Stake limits, queue status
│   ├── steth-rate.ts     Share rate + pool composition monitor
│   ├── rewards.ts        Historical staking rewards
│   ├── stake.ts          Stake ETH → stETH
│   ├── withdraw.ts       Request & claim withdrawals
│   ├── withdrawal-status.ts Check withdrawal request status
│   ├── withdrawal-time.ts  Withdrawal finalization time estimator
│   ├── wrap.ts           Wrap/unwrap stETH ↔ wstETH
│   ├── l2-wsteth.ts      L2 wstETH balance, transfer, info (Base/Optimism/Arbitrum)
│   └── l2-steth.ts       L2 rebasing stETH balance + transfer (Optimism only)
└── utils/
    ├── dry-run.ts        Transaction simulation engine
    ├── errors.ts         Protocol-aware error translation
    ├── format.ts         Formatting utilities + Zod schemas
    ├── governance-labels.ts Shared governance state labels
    └── security.ts       Receiver allowlist + amount cap validation
```

**Key design decisions:**
- **Real SDK, no mocks** — all operations go through `@lidofinance/lido-ethereum-sdk` and `viem` to actual Ethereum contracts
- **Dry-run by default** — every state-changing tool defaults to `dry_run: true` (simulation only). Agents must explicitly set `dry_run: false` to execute real transactions
- **Protocol-aware errors** — raw blockchain errors (insufficient funds, reverts, nonce conflicts, stake limits, paused) are translated to human-readable messages
- **Zod validation** — all tool inputs are validated before any SDK call
- **MCP annotations** — every tool declares `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` so agents know which tools are safe to call without confirmation
- **Parallel queries** — tools that need multiple data points use `Promise.all` for performance
- **L2 aware** — set `LIDO_CHAIN_ID` to Base (8453), Optimism (10), or Arbitrum (42161) and the server exposes wstETH-specific tools. On Optimism, rebasing stETH tools are also available. L1-only tools (staking, governance) are excluded automatically

## License

MIT
