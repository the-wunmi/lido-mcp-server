# Lido Staking — Agent Mental Model

You have access to a Lido MCP server that lets you stake ETH, wrap/unwrap tokens, manage withdrawals, monitor positions, and review governance — all directly from this conversation. Here's what you need to know to use it well.

## Core Concepts

### stETH (Rebasing Token)
- When you stake ETH with Lido, you receive **stETH** 1:1.
- stETH **rebases daily** — your balance grows automatically as staking rewards accrue.
- Under the hood, you hold "shares" of a pool. When the pool earns rewards, each share is worth more ETH, so your stETH balance increases.
- **Fee**: Lido takes a 10% fee on staking rewards, split between node operators and the DAO treasury (the exact ratio varies by staking module — e.g., 5%/5% for the Curated Module). The reported APR is already net of this fee.
- **Caveat**: rebasing can cause 1-2 wei rounding differences. Don't compare balances with exact equality.

### wstETH (Wrapped, Non-Rebasing)
- wstETH wraps stETH into a **non-rebasing** ERC-20 whose balance stays constant but whose value grows vs ETH.
- Use wstETH when you need a stable-balance token: DeFi protocols, L2 bridging, LP positions.
- The stETH↔wstETH exchange rate increases over time as rewards accrue.

### Shares
- Internally, Lido tracks "shares" not stETH balances.
- `stETH_balance = shares × share_rate` — the share rate grows as rewards come in.
- When transferring or withdrawing, rounding can lose 1-2 wei. This is normal.

## Available Prompts

Use these to invoke guided multi-step workflows instead of manually calling tools:

- **`stake-eth-safely`** — Guided staking: checks protocol status → verifies balance → shows APR → dry-runs → executes (with your approval at each step).
- **`manage-position`** — Full position analysis: balances, APR, rewards, withdrawals, governance state, and recommendations. Supports setting monitoring bounds.
- **`withdraw-steth`** — Guided withdrawal: shows balances → checks queue status → handles existing claims → dry-runs → executes.
- **`review-governance`** — Governance analysis: state, veto signalling, escrow details, and plain-language explanation of what it means for your position.

## Available Resources

Read these for live structured data (JSON):

- **`lido://position/{address}`** — Staking position snapshot: ETH/stETH/wstETH balances, APR, pending/claimable withdrawals.
- **`lido://protocol/status`** — Protocol status: staking limits, withdrawal queue mode, current APR.
- **`lido://governance/state`** — Governance state: dual governance status, veto signalling, escrow details.

## Safe Staking Pattern

Follow this sequence for any staking operation:

1. **Check gas** — `lido_check_gas_conditions` to see if gas is reasonable and calculate break-even
2. **Check APR** — `lido_get_staking_apr` to see if current yield is attractive
3. **Check protocol status** — `lido_get_protocol_status` to verify staking isn't paused and limits aren't hit
4. **Check balances** — `lido_get_balances` to verify the wallet has enough ETH
5. **Dry run** — `lido_stake_eth` with `dry_run: true` to see gas cost and verify the tx would succeed
6. **Execute** — `lido_stake_eth` with `dry_run: false` to actually stake

Always do at least step 5 (dry run) before any real transaction.

## Position Monitoring

Use `lido_analyze_position` to monitor a staking position against bounds:

- **`min_apr`** — Alert when APR drops below this threshold (e.g. 3.0 for 3%)
- **`max_position_eth`** — Alert when total staked value exceeds this limit
- **`min_position_eth`** — Alert when position is below target and wallet has ETH to stake

The tool returns actionable recommendations: "stake more", "withdraw excess", "claim pending withdrawals", or "position is healthy". An agent can call this periodically to autonomously monitor and manage a position within human-set bounds.

## Withdrawal Lifecycle

Withdrawals happen in three phases:

1. **Request** — `lido_request_withdrawal` creates one or more withdrawal NFTs. Large amounts are automatically split into multiple requests (max 1000 stETH per request).
2. **Wait** — Use `lido_estimate_withdrawal_time` to predict finalization time based on queue depth and mode. Typically 1-5 days. Check status with `lido_get_withdrawal_requests`.
3. **Claim** — Once finalized, `lido_claim_withdrawal` to receive ETH. Check with `lido_get_claimable_eth` first.

### Withdrawal Time Estimation

`lido_estimate_withdrawal_time` provides three modes:
- **By amount** — estimate how long a hypothetical new withdrawal would take
- **By request IDs** — check finalization progress of existing requests
- **By address** — auto-detect all pending requests and estimate each

The tool explains the calculation method (buffer, bunker, validator exits, etc.) so you understand why a withdrawal might be fast or slow.

## Wrapping & Unwrapping

- **ETH → wstETH** (single tx): Use `lido_wrap_eth_to_wsteth` — stakes + wraps in one transaction, saves gas.
- **stETH → wstETH**: Use `lido_wrap_steth_to_wsteth` — requires stETH approval for the wstETH contract.
- **wstETH → stETH**: Use `lido_unwrap_wsteth_to_steth`.

## Dual Governance

Lido uses a dual governance system to protect stakers:
- `lido_get_governance_state` shows the current governance state, configuration, veto signalling progress, and warning status.
- In normal operation, the state is "Normal". If stakers disagree with a governance proposal, they can lock stETH in an escrow to signal a veto.
- Common path: Normal → VetoSignalling → VetoSignallingDeactivation → VetoCooldown → Normal. RageQuit can be entered directly from VetoSignalling or VetoSignallingDeactivation if support exceeds the second seal threshold.
- **Warning status** indicates whether governance is "Normal", "Warning" (approaching veto threshold), or "Blocked" (proposals cannot execute).
- The governance config shows the rage-quit thresholds, lock durations, and cooldown periods.

### Governance Actions

#### Aragon DAO Voting (LDO holders)

LDO token holders govern the Lido DAO through Aragon voting. Proposals cover protocol upgrades, fee changes, treasury allocations, and more.

- **`lido_get_aragon_vote`** — Query DAO votes. Pass a `vote_id` for details on a specific vote, or omit to list recent votes. Shows yea/nay tallies, quorum progress, your voting status, and whether you can vote.
- **`lido_vote_on_proposal`** — Cast your vote on an open proposal. Requires LDO tokens at the vote's snapshot block. Supports dry_run.

**Important**: Your voting power is determined by your LDO balance at the snapshot block when the vote was created, not your current balance.

#### Acquiring LDO for Voting

If the wallet has no LDO, you can swap ETH for LDO via Uniswap V3 (mainnet only):

- **`lido_get_swap_quote`** — Get a price quote for an ETH→LDO swap. Shows expected LDO output, effective price, gas estimate, and your balances. Read-only.
- **`lido_swap_eth_for_ldo`** — Execute the swap. Includes slippage protection (default 0.5%, max 5%). The swap reverts on-chain if the output falls below the slippage-adjusted minimum. Supports dry_run.

**Important**: Buying LDO only gives you voting power on **future** votes. For any existing vote, your voting power is locked to your LDO balance at that vote's snapshot block.

#### Safe Swap Pattern
1. **Get quote** — `lido_get_swap_quote` to see the expected output and price
2. **Dry run** — `lido_swap_eth_for_ldo` with `dry_run: true` to verify the swap would succeed and see gas cost
3. **Execute** — `lido_swap_eth_for_ldo` with `dry_run: false` after user confirmation
4. **Verify** — `lido_get_balances` or `lido_get_aragon_vote` to confirm LDO balance

#### Safe Voting Pattern
1. **List votes** — `lido_get_aragon_vote` to see recent/open votes
2. **Review details** — `lido_get_aragon_vote` with `vote_id` to understand the proposal
3. **Dry run** — `lido_vote_on_proposal` with `dry_run: true` to confirm eligibility and preview gas
4. **Execute** — `lido_vote_on_proposal` with `dry_run: false` after user confirmation
5. **Verify** — `lido_get_aragon_vote` with `vote_id` to see updated tally

#### Dual Governance Veto (stETH holders)

stETH holders can participate in governance by locking/unlocking stETH in the veto signalling escrow:

- **`lido_lock_steth_governance`** — Lock stETH in the escrow to signal a veto against DAO proposals. This is the core governance action. When enough stETH is locked (exceeding the first seal threshold), governance enters VetoSignalling and proposals are blocked.
- **`lido_unlock_steth_governance`** — Unlock your stETH from the escrow and return it to your wallet. Note: there is a minimum lock duration before unlocking is allowed.

#### Safe Veto Participation Pattern
1. **Review state** — `lido_get_governance_state` to understand current governance status
2. **Check position** — `lido_get_balances` to see available stETH
3. **Dry run** — `lido_lock_steth_governance` with `dry_run: true` to preview the lock
4. **Execute** — `lido_lock_steth_governance` with `dry_run: false` after user confirmation
5. **Verify** — `lido_get_governance_state` again to see updated veto support

## stETH Rate & Gas Intelligence

### Protocol Rate (`lido_check_steth_rate`)
Shows the current share rate (how much ETH backs each stETH), pool composition, and wstETH conversion rate. Use this to understand:
- The fair value of stETH — at protocol level, 1 stETH = 1 ETH (redeemable via withdrawal)
- Whether buying stETH on a DEX at a discount is cheaper than staking directly
- The current wstETH↔stETH exchange rate

### Gas Conditions (`lido_check_gas_conditions`)
Shows current gas price with contextual tier (Very Low → Very High), estimated costs for every Lido operation, and a **break-even analysis** for staking — how many days of yield it takes to recoup the gas cost. Use this before any transaction to avoid overpaying for gas.

## L2 wstETH (Base, Optimism, Arbitrum)

When the server is configured for an L2 chain (`LIDO_CHAIN_ID=8453/10/42161`), it runs in **L2 mode** with a focused set of wstETH tools.

### What wstETH is on L2
- wstETH on L2 is a **bridged ERC-20 token** — it's minted on L2 when wstETH is locked on the L1 canonical bridge.
- Its value tracks the L1 stETH/ETH exchange rate, so you earn staking rewards implicitly (the wstETH/ETH rate grows).
- The balance **does not rebase** — it stays constant while the underlying ETH value grows.

### L2 wstETH Tools (all L2 chains)
- **`lido_l2_get_wsteth_balance`** — Check wstETH and native ETH balance on the L2.
- **`lido_l2_transfer_wsteth`** — Transfer wstETH to another address (with dry_run support).
- **`lido_l2_get_wsteth_info`** — Contract address, total bridged supply, and what operations are available.

### L2 Rebasing stETH (Optimism only)

Rebasing stETH launched on OP Mainnet in October 2024. When the server is configured for Optimism (`LIDO_CHAIN_ID=10`), two additional stETH tools are available alongside the wstETH tools:

- **`lido_l2_get_steth_balance`** — Check rebasing stETH and native ETH balance on Optimism. The stETH balance grows automatically as staking rewards accrue via the L1 oracle rate.
- **`lido_l2_transfer_steth`** — Transfer rebasing stETH on Optimism (with dry_run support). Note: transferred amounts may differ by 1-2 wei due to share-based accounting.

**Key differences from wstETH:**
- stETH **rebases** — your balance increases over time as the L1 oracle pushes rate updates.
- wstETH **does not rebase** — value accrues through the exchange rate while the balance stays constant.
- Both earn the same staking rewards; the difference is UX (growing balance vs growing rate).

### What requires L1
These operations are only available when the server is connected to Ethereum mainnet, Holesky, or Hoodi:
- Staking ETH to get stETH/wstETH
- Wrapping/unwrapping stETH ↔ wstETH
- Requesting withdrawals back to ETH
- Governance actions (Aragon voting, veto signalling)
- Swapping ETH for LDO (uses Uniswap V3, mainnet only)

If a user wants to stake or withdraw, they need to bridge wstETH back to L1 first or use a separate L1-configured server instance.

## Common Mistakes to Avoid

1. **Staking dust amounts** — Gas costs on small stakes (< 0.01 ETH) can exceed the rewards. Check the dry_run gas estimate first.
2. **Exact balance comparisons** — stETH rebases cause 1-2 wei rounding. Use >= checks, not ==.
3. **Forgetting to claim** — Withdrawal requests don't auto-claim. Users must call `lido_claim_withdrawal` after finalization.
4. **Staking when paused** — Check `lido_get_protocol_status` first. If staking is paused, transactions will revert.
5. **Ignoring gas costs** — Always dry_run first. L1 gas can be significant, especially for wrap/withdrawal operations.
6. **Skipping position analysis** — Before any action, use `lido_analyze_position` to understand the full position context.

## Tool Usage Quick Reference

| Goal | Tools to use (in order) |
|------|------------------------|
| Stake ETH | `lido_check_gas_conditions` → `lido_get_protocol_status` → `lido_get_balances` → `lido_stake_eth(dry_run)` → `lido_stake_eth` |
| Get wstETH from ETH | `lido_wrap_eth_to_wsteth(dry_run)` → `lido_wrap_eth_to_wsteth` |
| Check rewards | `lido_get_staking_apr` + `lido_get_rewards` |
| Withdraw to ETH | `lido_request_withdrawal(dry_run)` → `lido_request_withdrawal` → (wait) → `lido_get_claimable_eth` → `lido_claim_withdrawal` |
| Portfolio check | `lido_analyze_position` (comprehensive) or `lido_get_balances` + `lido_get_staking_apr` + `lido_get_withdrawal_requests` |
| Monitor position | `lido_analyze_position` with bounds (min_apr, max_position_eth, min_position_eth) |
| Estimate withdrawal wait | `lido_estimate_withdrawal_time` (by amount, request ID, or address) |
| Check stETH value | `lido_check_steth_rate` (share rate, pool composition, DEX discount check) |
| Check gas timing | `lido_check_gas_conditions` (gas price, operation costs, break-even analysis) |
| Convert between tokens | `lido_convert_amounts` (read-only rate check) |
| Governance review | `lido_get_governance_state` |
| List DAO votes | `lido_get_aragon_vote` |
| Get LDO for voting | `lido_get_swap_quote` → `lido_swap_eth_for_ldo(dry_run)` → `lido_swap_eth_for_ldo` |
| Vote on proposal | `lido_get_aragon_vote(vote_id)` → `lido_vote_on_proposal(dry_run)` → `lido_vote_on_proposal` |
| Signal governance veto | `lido_get_governance_state` → `lido_lock_steth_governance(dry_run)` → `lido_lock_steth_governance` |
| Withdraw governance lock | `lido_unlock_steth_governance(dry_run)` → `lido_unlock_steth_governance` |
| **L2: Check wstETH** | `lido_l2_get_wsteth_balance` |
| **L2: Transfer wstETH** | `lido_l2_transfer_wsteth(dry_run)` → `lido_l2_transfer_wsteth` |
| **L2: Token info** | `lido_l2_get_wsteth_info` |
| **L2: Check stETH (OP)** | `lido_l2_get_steth_balance` |
| **L2: Transfer stETH (OP)** | `lido_l2_transfer_steth(dry_run)` → `lido_l2_transfer_steth` |
