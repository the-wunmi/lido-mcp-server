# Lido Staking — Agent Mental Model

You have access to a Lido MCP server that lets you stake ETH, wrap/unwrap tokens, manage withdrawals, monitor positions, and participate in governance across all four Lido governance systems — all directly from this conversation. Here's what you need to know to use it well.

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
- **`manage-vault`** — stVaults V3 management: VaultHub overview → list vaults → inspect details → fund/withdraw → verify changes.
- **`participate-governance`** — Comprehensive governance participation: checks voting power across all systems, reviews active proposals/motions (Aragon, Snapshot, Easy Track), and guides through voting or objecting.

## Available Resources

Read these for live structured data (JSON):

- **`lido://position/{address}`** — Staking position snapshot: ETH/stETH/wstETH balances, APR, pending/claimable withdrawals.
- **`lido://protocol/status`** — Protocol status: staking limits, withdrawal queue mode, current APR.
- **`lido://governance/state`** — Governance state: dual governance status, veto signalling, escrow details.
- **`lido://governance/votes`** — Active governance items across all systems: Snapshot proposals, Easy Track motions.

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

## Governance — Four Systems

Lido governance spans four systems. Use `lido_get_governance_timeline` for a unified view of all active items, or `lido_get_voting_power` to see your governance power across all systems.

### 1. Aragon DAO Voting (LDO holders)

LDO token holders govern the Lido DAO through Aragon voting. Proposals cover protocol upgrades, fee changes, treasury allocations, and more.

- **`lido_get_aragon_vote`** — Query DAO votes. Pass a `vote_id` for details on a specific vote, or omit to list recent votes. Shows yea/nay tallies, quorum progress, your voting status, and whether you can vote.
- **`lido_vote_on_proposal`** — Cast your vote on an open proposal. Requires LDO tokens at the vote's snapshot block. Supports dry_run.
- **`lido_analyze_aragon_vote`** — Deep analysis: quorum progress, time remaining, phase (main/objection/ended), pass/fail projection, top voter breakdown.
- **`lido_get_aragon_vote_script`** — Decode the EVM script from a vote into human-readable actions (target contracts, function calls).
- **`lido_get_aragon_vote_timeline`** — Timeline visualization: start, main phase end, objection phase end, progress bar.

**Important**: Your voting power is determined by your LDO balance at the snapshot block when the vote was created, not your current balance.

#### Aragon Vote Phases
Aragon votes have two phases:
1. **Main phase** — Both Yea and Nay votes can be cast.
2. **Objection phase** — Only Nay votes can be cast (prevents last-minute Yea manipulation).

### 2. Snapshot (Off-chain Voting)

Snapshot proposals are off-chain governance votes that don't require gas. They're used for signaling, temperature checks, and decisions that don't need on-chain execution.

- **`lido_get_snapshot_proposals`** — List proposals from the `lido-snapshot.eth` space. Filter by state (active/closed/pending/all), count, search text.
- **`lido_get_snapshot_proposal`** — Full details of one proposal including body, choices, scores, strategies, your vote and voting power.
- **`lido_vote_on_snapshot`** — Cast vote via EIP-712 signed message (no gas required). Supports dry_run validation.

**Key difference from Aragon**: Snapshot votes are off-chain. No gas is needed, but votes don't execute on-chain actions directly.

### 3. Easy Track (Lightweight Governance)

Easy Track handles routine operations (payments, reward programs, node operator management) with a streamlined process. Motions pass automatically unless enough LDO holders object within the objection window.

- **`lido_get_easytrack_motions`** — List motions with status filter (active/all). Shows factory label, creator, objection count/%, time remaining.
- **`lido_get_easytrack_motion`** — Detailed view of one motion including can-object status and objection progress vs threshold.
- **`lido_get_easytrack_config`** — System config: objection threshold, motion duration, motions count limit, registered factories.
- **`lido_get_easytrack_factories`** — All registered EVM script factories with human-readable descriptions.
- **`lido_object_easytrack_motion`** — Object to an active motion. Requires LDO. Supports dry_run.

**How Easy Track works**: A motion is created by an allowed address using a registered factory. If objections remain below the threshold (typically 0.5% of LDO supply) during the motion duration (typically 72h), it auto-enacts. If objections exceed the threshold, the motion is rejected.

### 4. Dual Governance (stETH Holders)

Dual governance protects stETH holders from harmful DAO proposals via veto signalling:

- **`lido_get_governance_state`** — Current state, veto progress, escrow details, configuration.
- **`lido_lock_steth_governance`** — Lock stETH in escrow to signal a veto. Supports dry_run.
- **`lido_unlock_steth_governance`** — Unlock stETH from escrow. Note: minimum lock duration applies.
- **`lido_estimate_veto_impact`** — Given a stETH amount, compute projected veto %, whether it triggers first/second seal, estimated timelock.
- **`lido_get_veto_thresholds`** — Threshold config with context: amounts needed for each seal, current escrow level.

**State machine**: Normal → VetoSignalling → VetoSignallingDeactivation → VetoCooldown → Normal. RageQuit can be entered from VetoSignalling if support exceeds the second seal threshold.

### Cross-System Tools

- **`lido_get_voting_power`** — Your governance power across all systems: LDO balance (Aragon + Easy Track), stETH/wstETH balance (Dual Governance veto power), stETH locked in escrow.
- **`lido_get_governance_timeline`** — Unified timeline: DG state, open Aragon votes, active Easy Track motions, objection windows.
- **`lido_get_governance_position_impact`** — How governance state affects a staking position: risk level, withdrawal queue impact, actionable recommendations.

### Acquiring LDO for Voting

If the wallet has no LDO, you can swap ETH for LDO via Uniswap V3 (mainnet only):

- **`lido_get_swap_quote`** — Get a price quote for an ETH→LDO swap. Shows expected LDO output, effective price, gas estimate, and your balances. Read-only.
- **`lido_swap_eth_for_ldo`** — Execute the swap. Includes slippage protection (default 0.5%, max 5%). The swap reverts on-chain if the output falls below the slippage-adjusted minimum. Supports dry_run.

**Important**: Buying LDO only gives you voting power on **future** votes. For any existing vote, your voting power is locked to your LDO balance at that vote's snapshot block.

### Safe Governance Participation Patterns

#### Aragon Voting
1. `lido_get_aragon_vote` → list open votes
2. `lido_analyze_aragon_vote` → deep analysis of a specific vote
3. `lido_get_aragon_vote_script` → understand what the vote will execute
4. `lido_vote_on_proposal(dry_run)` → preview gas and confirm eligibility
5. `lido_vote_on_proposal` → execute after user confirmation

#### Snapshot Voting
1. `lido_get_snapshot_proposals(state='active')` → find active proposals
2. `lido_get_snapshot_proposal` → full details and your voting power
3. `lido_vote_on_snapshot(dry_run)` → validate eligibility
4. `lido_vote_on_snapshot` → submit (no gas needed)

#### Easy Track Objection
1. `lido_get_easytrack_motions(status='active')` → find active motions
2. `lido_get_easytrack_motion` → detailed view + can-object check
3. `lido_object_easytrack_motion(dry_run)` → preview gas
4. `lido_object_easytrack_motion` → execute after user confirmation

#### Veto Signalling
1. `lido_get_governance_state` → understand current state
2. `lido_estimate_veto_impact` → preview impact of locking stETH
3. `lido_get_veto_thresholds` → see threshold distances
4. `lido_lock_steth_governance(dry_run)` → preview the lock
5. `lido_lock_steth_governance` → execute after user confirmation

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
- Governance actions (Aragon voting, Snapshot voting, Easy Track, veto signalling)
- Swapping ETH for LDO (uses Uniswap V3, mainnet only)

If a user wants to stake or withdraw, they need to bridge wstETH back to L1 first or use a separate L1-configured server instance.

## stVaults V3 (Staking Vaults)

Lido staking vaults (stVaults V3) allow institutional stakers and node operators to run customized staking setups through the VaultHub smart contract.

### Vault Tools
- **`lido_get_vault_hub_stats`** — VaultHub overview: total vault count, hub/factory addresses.
- **`lido_list_vaults`** — List vaults with pagination. Shows connection status, health, and total value for each vault.
- **`lido_get_vault`** — Full vault details: VaultHub status (connected, healthy, total value, withdrawable, locked, liability shares) and vault config (owner, node operator, depositor, beacon deposits paused, withdrawal credentials).
- **`lido_vault_fund`** — Deposit ETH into a vault via VaultHub. Supports dry_run.
- **`lido_vault_withdraw`** — Withdraw ETH from a vault. Supports dry_run. Optional recipient address.
- **`lido_vault_pause_beacon_deposits`** — Pause beacon chain deposits for a vault. Supports dry_run.
- **`lido_vault_resume_beacon_deposits`** — Resume beacon chain deposits. Supports dry_run.
- **`lido_vault_create`** — Create a new staking vault via VaultFactory. Deploys a StakingVault + VaultDashboard. Caller becomes vault owner. Supports dry_run.
- **`lido_vault_request_validator_exit`** — Request a validator exit from a vault. Signals the beacon chain to begin the exit process. Requires node operator role. Supports dry_run.

### Safe Vault Management Pattern
1. `lido_get_vault_hub_stats` → check hub health and factory availability
2. `lido_list_vaults` → find available vaults (or `lido_vault_create` to deploy a new one)
3. `lido_get_vault(address)` → inspect a specific vault (roles, health, value)
4. `lido_vault_fund(dry_run)` or `lido_vault_withdraw(dry_run)` → simulate operations
5. Execute after user confirmation

### Vault Roles
Operations are role-gated. The server checks roles before execution and warns if the caller doesn't match:
- **Owner** — withdraw, pause/resume deposits, mint shares
- **Node Operator** — request validator exits
- **Depositor** — fund vault with ETH

## Protocol Infrastructure

- **`lido_get_protocol_info`** — Comprehensive protocol data: total pooled ETH (TVL), buffered ETH, total shares, share rate, current APR, fee structure, staking limits.
- **`lido_get_staking_modules`** — List all staking router modules (Curated, Community, DVT, etc.) with status, fees, and exited validators.
- **`lido_get_node_operators`** — List node operators in the curated staking module. Shows operator name, reward address, active/deposited/exited validator counts. Supports pagination.
- **`lido_get_contract_addresses`** — All known Lido contract addresses for the current chain: stETH, wstETH, Aragon Voting, Easy Track, Staking Router, VaultHub, etc.

## Token Management

Manage stETH, wstETH, and LDO token operations — approvals, transfers, and allowances.

- **`lido_get_token_info`** — Token metadata: name, symbol, decimals, total supply, contract address. Works for stETH, wstETH, or LDO.
- **`lido_get_allowance`** — Check how much of your token a spender is authorized to use.
- **`lido_approve_token`** — Approve a spender to use your tokens. Required before DeFi interactions. Use `amount: 'max'` for unlimited approval. Supports dry_run.
- **`lido_transfer_token`** — Transfer tokens to another address. Validates receiver against security config. Supports dry_run.
- **`lido_revoke_approval`** — Set allowance to 0 for a spender, revoking previous approval. Supports dry_run.

## Withdrawal NFT Operations

Withdrawal requests are ERC-721 NFTs that can be transferred between addresses. The NFT owner can claim the finalized ETH.

- **`lido_get_withdrawal_nft_owner`** — Check who currently owns a withdrawal request NFT by its request ID.
- **`lido_transfer_withdrawal_nft`** — Transfer a withdrawal NFT to another address. The new owner will be able to claim the ETH. Supports dry_run.
- **`lido_approve_withdrawal_nft`** — Approve an address to transfer a specific withdrawal NFT. Supports dry_run.

## Cross-Chain L2 Balances

- **`lido_get_all_l2_balances`** — Query wstETH balances across all 11 supported L2 chains in a single call: Arbitrum, Optimism, Base, Polygon, zkSync Era, Mantle, Linea, Scroll, Mode, BNB Chain, and Zircuit. Uses parallel RPC queries with timeouts. Available from L1 mode.

## Common Mistakes to Avoid

1. **Staking dust amounts** — Gas costs on small stakes (< 0.01 ETH) can exceed the rewards. Check the dry_run gas estimate first.
2. **Exact balance comparisons** — stETH rebases cause 1-2 wei rounding. Use >= checks, not ==.
3. **Forgetting to claim** — Withdrawal requests don't auto-claim. Users must call `lido_claim_withdrawal` after finalization.
4. **Staking when paused** — Check `lido_get_protocol_status` first. If staking is paused, transactions will revert.
5. **Ignoring gas costs** — Always dry_run first. L1 gas can be significant, especially for wrap/withdrawal operations.
6. **Skipping position analysis** — Before any action, use `lido_analyze_position` to understand the full position context.
7. **Confusing Snapshot and Aragon votes** — Snapshot is off-chain (no gas), Aragon is on-chain (requires gas). Use the appropriate tools for each.
8. **Ignoring Easy Track objection windows** — Motions auto-enact if no one objects. Check `lido_get_easytrack_motions` regularly.

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
| **Governance overview** | `lido_get_governance_timeline` (unified view of all active governance) |
| **Check voting power** | `lido_get_voting_power` (LDO + stETH across all systems) |
| **Governance risk** | `lido_get_governance_position_impact` (how governance affects your position) |
| Governance review | `lido_get_governance_state` |
| List DAO votes | `lido_get_aragon_vote` |
| **Analyze DAO vote** | `lido_analyze_aragon_vote` → `lido_get_aragon_vote_script` → `lido_get_aragon_vote_timeline` |
| Get LDO for voting | `lido_get_swap_quote` → `lido_swap_eth_for_ldo(dry_run)` → `lido_swap_eth_for_ldo` |
| Vote on Aragon proposal | `lido_get_aragon_vote(vote_id)` → `lido_vote_on_proposal(dry_run)` → `lido_vote_on_proposal` |
| **Snapshot proposals** | `lido_get_snapshot_proposals` → `lido_get_snapshot_proposal` |
| **Vote on Snapshot** | `lido_vote_on_snapshot(dry_run)` → `lido_vote_on_snapshot` |
| **Easy Track motions** | `lido_get_easytrack_motions` → `lido_get_easytrack_motion` |
| **Object to motion** | `lido_object_easytrack_motion(dry_run)` → `lido_object_easytrack_motion` |
| **Veto impact analysis** | `lido_estimate_veto_impact` → `lido_get_veto_thresholds` |
| Signal governance veto | `lido_get_governance_state` → `lido_lock_steth_governance(dry_run)` → `lido_lock_steth_governance` |
| Withdraw governance lock | `lido_unlock_steth_governance(dry_run)` → `lido_unlock_steth_governance` |
| **L2: Check wstETH** | `lido_l2_get_wsteth_balance` |
| **L2: Transfer wstETH** | `lido_l2_transfer_wsteth(dry_run)` → `lido_l2_transfer_wsteth` |
| **L2: Token info** | `lido_l2_get_wsteth_info` |
| **L2: Check stETH (OP)** | `lido_l2_get_steth_balance` |
| **L2: Transfer stETH (OP)** | `lido_l2_transfer_steth(dry_run)` → `lido_l2_transfer_steth` |
| **L2: All balances** | `lido_get_all_l2_balances` (cross-chain query) |
| **Create vault** | `lido_vault_create(dry_run)` → `lido_vault_create` → `lido_get_vault` |
| **Vault management** | `lido_get_vault_hub_stats` → `lido_list_vaults` → `lido_get_vault` → `lido_vault_fund(dry_run)` |
| **Validator exit** | `lido_get_vault` → `lido_vault_request_validator_exit(dry_run)` → `lido_vault_request_validator_exit` |
| **Protocol info** | `lido_get_protocol_info` + `lido_get_staking_modules` + `lido_get_node_operators` |
| **Contract addresses** | `lido_get_contract_addresses` |
| **Token info** | `lido_get_token_info` |
| **Check allowance** | `lido_get_allowance` |
| **Approve token** | `lido_approve_token(dry_run)` → `lido_approve_token` |
| **Transfer token** | `lido_transfer_token(dry_run)` → `lido_transfer_token` |
| **Revoke approval** | `lido_revoke_approval(dry_run)` → `lido_revoke_approval` |
| **Withdrawal NFT owner** | `lido_get_withdrawal_nft_owner` |
| **Transfer withdrawal NFT** | `lido_transfer_withdrawal_nft(dry_run)` → `lido_transfer_withdrawal_nft` |
