import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { appConfig, securityConfig } from "../config.js";
import { sanitizeErrorMessage } from "../utils/errors.js";

import { balancesToolDef, handleGetBalances } from "./balances.js";
import { aprToolDef, handleGetStakingApr } from "./apr.js";
import { rewardsToolDef, handleGetRewards } from "./rewards.js";
import { protocolStatusToolDef, handleGetProtocolStatus } from "./protocol-status.js";
import { convertToolDef, handleConvertAmounts } from "./convert.js";
import {
  withdrawalRequestsToolDef,
  claimableEthToolDef,
  withdrawalNftOwnerToolDef,
  transferWithdrawalNftToolDef,
  approveWithdrawalNftToolDef,
  handleGetWithdrawalRequests,
  handleGetClaimableEth,
  handleGetWithdrawalNftOwner,
  handleTransferWithdrawalNft,
  handleApproveWithdrawalNft,
} from "./withdrawal-status.js";
import { governanceToolDef, handleGetGovernanceState } from "./governance.js";
import { positionToolDef, handleAnalyzePosition } from "./position.js";
import { estimateWithdrawalTimeToolDef, handleEstimateWithdrawalTime } from "./withdrawal-time.js";
import { stethRateToolDef, handleCheckStethRate } from "./steth-rate.js";
import { gasToolDef, handleCheckGasConditions } from "./gas.js";
import { stakeToolDef, handleStakeEth } from "./stake.js";
import {
  wrapStethToolDef,
  wrapEthToolDef,
  unwrapToolDef,
  handleWrapSteth,
  handleWrapEth,
  handleUnwrap,
} from "./wrap.js";
import {
  requestWithdrawalToolDef,
  claimWithdrawalToolDef,
  handleRequestWithdrawal,
  handleClaimWithdrawal,
} from "./withdraw.js";
import {
  lockStethGovernanceToolDef,
  unlockStethGovernanceToolDef,
  handleLockStethGovernance,
  handleUnlockStethGovernance,
} from "./governance-actions.js";
import {
  getAragonVoteToolDef,
  voteOnProposalToolDef,
  analyzeAragonVoteToolDef,
  getAragonVoteScriptToolDef,
  getAragonVoteTimelineToolDef,
  handleGetAragonVote,
  handleVoteOnProposal,
  handleAnalyzeAragonVote,
  handleGetAragonVoteScript,
  handleGetAragonVoteTimeline,
} from "./aragon-voting.js";
import {
  getSwapQuoteToolDef,
  swapEthForLdoToolDef,
  handleGetSwapQuote,
  handleSwapEthForLdo,
} from "./swap.js";
import {
  getSnapshotProposalsToolDef,
  getSnapshotProposalToolDef,
  voteOnSnapshotToolDef,
  handleGetSnapshotProposals,
  handleGetSnapshotProposal,
  handleVoteOnSnapshot,
} from "./snapshot.js";
import {
  getEasyTrackMotionsToolDef,
  getEasyTrackMotionToolDef,
  getEasyTrackConfigToolDef,
  getEasyTrackFactoriesToolDef,
  objectEasyTrackMotionToolDef,
  handleGetEasyTrackMotions,
  handleGetEasyTrackMotion,
  handleGetEasyTrackConfig,
  handleGetEasyTrackFactories,
  handleObjectEasyTrackMotion,
} from "./easytrack.js";
import { votingPowerToolDef, handleGetVotingPower } from "./governance.js";
import {
  estimateVetoImpactToolDef,
  getVetoThresholdsToolDef,
  getGovernanceTimelineToolDef,
  getGovernancePositionImpactToolDef,
  handleEstimateVetoImpact,
  handleGetVetoThresholds,
  handleGetGovernanceTimeline,
  handleGetGovernancePositionImpact,
} from "./governance-analysis.js";

import {
  listVaultsToolDef,
  getVaultToolDef,
  vaultHubStatsToolDef,
  vaultFundToolDef,
  vaultWithdrawToolDef,
  vaultPauseToolDef,
  vaultResumeToolDef,
  vaultMintSharesToolDef,
  vaultBurnSharesToolDef,
  vaultRebalanceToolDef,
  vaultCreateToolDef,
  vaultRequestExitToolDef,
  handleListVaults,
  handleGetVault,
  handleGetVaultHubStats,
  handleVaultFund,
  handleVaultWithdraw,
  handleVaultPause,
  handleVaultResume,
  handleVaultMintShares,
  handleVaultBurnShares,
  handleVaultRebalance,
  handleVaultCreate,
  handleVaultRequestExit,
} from "./stvaults.js";

import {
  protocolInfoToolDef,
  stakingModulesToolDef,
  nodeOperatorsToolDef,
  contractAddressesToolDef,
  handleGetProtocolInfo,
  handleGetStakingModules,
  handleGetNodeOperators,
  handleGetContractAddresses,
} from "./protocol-info.js";

import {
  tokenInfoToolDef,
  allowanceToolDef,
  approveTokenToolDef,
  transferTokenToolDef,
  revokeApprovalToolDef,
  handleGetTokenInfo,
  handleGetAllowance,
  handleApproveToken,
  handleTransferToken,
  handleRevokeApproval,
} from "./tokens.js";

import {
  l2BalanceToolDef,
  l2TransferToolDef,
  l2InfoToolDef,
  l2AllBalancesToolDef,
  handleL2GetBalance,
  handleL2Transfer,
  handleL2GetInfo,
  handleL2GetAllBalances,
} from "./l2-wsteth.js";

import {
  l2StethBalanceToolDef,
  l2StethTransferToolDef,
  handleL2GetStethBalance,
  handleL2TransferSteth,
} from "./l2-steth.js";

import { chainInfoToolDef, handleGetChainInfo } from "./chain-info.js";

const l1ReadToolDefs = [
  chainInfoToolDef,
  balancesToolDef,
  aprToolDef,
  rewardsToolDef,
  protocolStatusToolDef,
  convertToolDef,
  withdrawalRequestsToolDef,
  claimableEthToolDef,
  governanceToolDef,
  positionToolDef,
  estimateWithdrawalTimeToolDef,
  stethRateToolDef,
  gasToolDef,
  getAragonVoteToolDef,
  getSwapQuoteToolDef,
  getSnapshotProposalsToolDef,
  getSnapshotProposalToolDef,
  getEasyTrackMotionsToolDef,
  getEasyTrackMotionToolDef,
  getEasyTrackConfigToolDef,
  getEasyTrackFactoriesToolDef,
  analyzeAragonVoteToolDef,
  getAragonVoteScriptToolDef,
  getAragonVoteTimelineToolDef,
  votingPowerToolDef,
  estimateVetoImpactToolDef,
  getVetoThresholdsToolDef,
  getGovernanceTimelineToolDef,
  getGovernancePositionImpactToolDef,
  listVaultsToolDef,
  getVaultToolDef,
  vaultHubStatsToolDef,
  protocolInfoToolDef,
  stakingModulesToolDef,
  nodeOperatorsToolDef,
  contractAddressesToolDef,
  tokenInfoToolDef,
  allowanceToolDef,
  withdrawalNftOwnerToolDef,
  l2AllBalancesToolDef,
];

const l1WriteToolDefs = [
  stakeToolDef,
  wrapStethToolDef,
  wrapEthToolDef,
  unwrapToolDef,
  requestWithdrawalToolDef,
  claimWithdrawalToolDef,
  lockStethGovernanceToolDef,
  unlockStethGovernanceToolDef,
  voteOnProposalToolDef,
  swapEthForLdoToolDef,
  voteOnSnapshotToolDef,
  objectEasyTrackMotionToolDef,
  vaultFundToolDef,
  vaultWithdrawToolDef,
  vaultPauseToolDef,
  vaultResumeToolDef,
  vaultMintSharesToolDef,
  vaultBurnSharesToolDef,
  vaultRebalanceToolDef,
  vaultCreateToolDef,
  vaultRequestExitToolDef,
  approveTokenToolDef,
  transferTokenToolDef,
  revokeApprovalToolDef,
  transferWithdrawalNftToolDef,
  approveWithdrawalNftToolDef,
];

const l1ReadHandlers: Record<string, ToolHandler> = {
  lido_get_chain_info: handleGetChainInfo,
  lido_get_balances: handleGetBalances,
  lido_get_staking_apr: handleGetStakingApr,
  lido_get_rewards: handleGetRewards,
  lido_get_protocol_status: handleGetProtocolStatus,
  lido_convert_amounts: handleConvertAmounts,
  lido_get_withdrawal_requests: handleGetWithdrawalRequests,
  lido_get_claimable_eth: handleGetClaimableEth,
  lido_get_governance_state: handleGetGovernanceState,
  lido_analyze_position: handleAnalyzePosition,
  lido_estimate_withdrawal_time: handleEstimateWithdrawalTime,
  lido_check_steth_rate: handleCheckStethRate,
  lido_check_gas_conditions: handleCheckGasConditions,
  lido_get_aragon_vote: handleGetAragonVote,
  lido_get_swap_quote: handleGetSwapQuote,
  lido_get_snapshot_proposals: handleGetSnapshotProposals,
  lido_get_snapshot_proposal: handleGetSnapshotProposal,
  lido_get_easytrack_motions: handleGetEasyTrackMotions,
  lido_get_easytrack_motion: handleGetEasyTrackMotion,
  lido_get_easytrack_config: handleGetEasyTrackConfig,
  lido_get_easytrack_factories: handleGetEasyTrackFactories,
  lido_analyze_aragon_vote: handleAnalyzeAragonVote,
  lido_get_aragon_vote_script: handleGetAragonVoteScript,
  lido_get_aragon_vote_timeline: handleGetAragonVoteTimeline,
  lido_get_voting_power: handleGetVotingPower,
  lido_estimate_veto_impact: handleEstimateVetoImpact,
  lido_get_veto_thresholds: handleGetVetoThresholds,
  lido_get_governance_timeline: handleGetGovernanceTimeline,
  lido_get_governance_position_impact: handleGetGovernancePositionImpact,
  lido_list_vaults: handleListVaults,
  lido_get_vault: handleGetVault,
  lido_get_vault_hub_stats: handleGetVaultHubStats,
  lido_get_protocol_info: handleGetProtocolInfo,
  lido_get_staking_modules: handleGetStakingModules,
  lido_get_node_operators: handleGetNodeOperators,
  lido_get_contract_addresses: handleGetContractAddresses,
  lido_get_token_info: handleGetTokenInfo,
  lido_get_allowance: handleGetAllowance,
  lido_get_withdrawal_nft_owner: handleGetWithdrawalNftOwner,
  lido_get_all_l2_balances: handleL2GetAllBalances,
};

const l1WriteHandlers: Record<string, ToolHandler> = {
  lido_stake_eth: handleStakeEth,
  lido_wrap_steth_to_wsteth: handleWrapSteth,
  lido_wrap_eth_to_wsteth: handleWrapEth,
  lido_unwrap_wsteth_to_steth: handleUnwrap,
  lido_request_withdrawal: handleRequestWithdrawal,
  lido_claim_withdrawal: handleClaimWithdrawal,
  lido_lock_steth_governance: handleLockStethGovernance,
  lido_unlock_steth_governance: handleUnlockStethGovernance,
  lido_vote_on_proposal: handleVoteOnProposal,
  lido_swap_eth_for_ldo: handleSwapEthForLdo,
  lido_vote_on_snapshot: handleVoteOnSnapshot,
  lido_object_easytrack_motion: handleObjectEasyTrackMotion,
  lido_vault_fund: handleVaultFund,
  lido_vault_withdraw: handleVaultWithdraw,
  lido_vault_pause_beacon_deposits: handleVaultPause,
  lido_vault_resume_beacon_deposits: handleVaultResume,
  lido_vault_mint_shares: handleVaultMintShares,
  lido_vault_burn_shares: handleVaultBurnShares,
  lido_vault_rebalance: handleVaultRebalance,
  lido_vault_create: handleVaultCreate,
  lido_vault_request_validator_exit: handleVaultRequestExit,
  lido_approve_token: handleApproveToken,
  lido_transfer_token: handleTransferToken,
  lido_revoke_approval: handleRevokeApproval,
  lido_transfer_withdrawal_nft: handleTransferWithdrawalNft,
  lido_approve_withdrawal_nft: handleApproveWithdrawalNft,
};

const l2ReadToolDefs = [
  chainInfoToolDef,
  l2BalanceToolDef,
  l2InfoToolDef,
  ...(appConfig.isOptimism ? [l2StethBalanceToolDef] : []),
];

const l2WriteToolDefs = [
  l2TransferToolDef,
  ...(appConfig.isOptimism ? [l2StethTransferToolDef] : []),
];

const l2ReadHandlers: Record<string, ToolHandler> = {
  lido_get_chain_info: handleGetChainInfo,
  lido_l2_get_wsteth_balance: handleL2GetBalance,
  lido_l2_get_wsteth_info: handleL2GetInfo,
  ...(appConfig.isOptimism ? { lido_l2_get_steth_balance: handleL2GetStethBalance } : {}),
};

const l2WriteHandlers: Record<string, ToolHandler> = {
  lido_l2_transfer_wsteth: handleL2Transfer,
  ...(appConfig.isOptimism ? { lido_l2_transfer_steth: handleL2TransferSteth } : {}),
};

interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;

const readToolDefs = appConfig.isL2 ? l2ReadToolDefs : l1ReadToolDefs;
const writeToolDefs = appConfig.isL2 ? l2WriteToolDefs : l1WriteToolDefs;
const readHandlers = appConfig.isL2 ? l2ReadHandlers : l1ReadHandlers;
const writeHandlers = appConfig.isL2 ? l2WriteHandlers : l1WriteHandlers;

const writeToolNames = new Set(writeToolDefs.map(t => t.name));
const handlers: Record<string, ToolHandler> = { ...readHandlers, ...writeHandlers };

let writeMutexPromise: Promise<void> = Promise.resolve();

function withWriteMutex(handler: ToolHandler): ToolHandler {
  return (args: Record<string, unknown>) => {
    const execute = () => handler(args);
    const current = writeMutexPromise.then(execute, execute);
    writeMutexPromise = current.then(() => {}, () => {});
    return current;
  };
}

export function registerTools(server: Server) {
  const toolDefs = securityConfig.mode === "read-only"
    ? readToolDefs
    : [...readToolDefs, ...writeToolDefs];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefs,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];

    if (!handler) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    if (securityConfig.mode === "read-only" && writeToolNames.has(name)) {
      return {
        content: [{ type: "text" as const, text: "This server is running in read-only mode. Write operations are disabled." }],
        isError: true,
      };
    }

    let resolvedArgs = args ?? {};

    if (securityConfig.mode === "dry-run-only" && writeToolNames.has(name)) {
      resolvedArgs = { ...resolvedArgs, dry_run: true };
    }

    if (writeToolNames.has(name)) {
      try {
        return await withWriteMutex(handler)(resolvedArgs);
      } catch (error) {
        const msg = error instanceof Error ? sanitizeErrorMessage(error.message) : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }

    try {
      return await handler(resolvedArgs);
    } catch (error) {
      const msg = error instanceof Error ? sanitizeErrorMessage(error.message) : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });
}
