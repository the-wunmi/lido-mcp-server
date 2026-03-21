import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { appConfig, securityConfig } from "../config.js";
import { sanitizeErrorMessage } from "../utils/errors.js";

// --- L1 tool imports (staking, wrapping, withdrawals, governance) ---
import { balancesToolDef, handleGetBalances } from "./balances.js";
import { aprToolDef, handleGetStakingApr } from "./apr.js";
import { rewardsToolDef, handleGetRewards } from "./rewards.js";
import { protocolStatusToolDef, handleGetProtocolStatus } from "./protocol-status.js";
import { convertToolDef, handleConvertAmounts } from "./convert.js";
import {
  withdrawalRequestsToolDef,
  claimableEthToolDef,
  handleGetWithdrawalRequests,
  handleGetClaimableEth,
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
  handleGetAragonVote,
  handleVoteOnProposal,
} from "./aragon-voting.js";
import {
  getSwapQuoteToolDef,
  swapEthForLdoToolDef,
  handleGetSwapQuote,
  handleSwapEthForLdo,
} from "./swap.js";

// --- L2 tool imports (wstETH balance, transfer, info) ---
import {
  l2BalanceToolDef,
  l2TransferToolDef,
  l2InfoToolDef,
  handleL2GetBalance,
  handleL2Transfer,
  handleL2GetInfo,
} from "./l2-wsteth.js";

// --- L2 stETH tool imports (Optimism-only, rebasing stETH) ---
import {
  l2StethBalanceToolDef,
  l2StethTransferToolDef,
  handleL2GetStethBalance,
  handleL2TransferSteth,
} from "./l2-steth.js";

// ============================================================
// L1 tool definitions (Ethereum mainnet / Holesky)
// ============================================================

// Read-only L1 tools
const l1ReadToolDefs = [
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
];

// Write L1 tools (excluded in read-only mode)
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
];

const l1ReadHandlers: Record<string, ToolHandler> = {
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
};

// ============================================================
// L2 tool definitions (Base, Optimism, Arbitrum)
// ============================================================

const l2ReadToolDefs = [
  l2BalanceToolDef,
  l2InfoToolDef,
  ...(appConfig.isOptimism ? [l2StethBalanceToolDef] : []),
];

const l2WriteToolDefs = [
  l2TransferToolDef,
  ...(appConfig.isOptimism ? [l2StethTransferToolDef] : []),
];

const l2ReadHandlers: Record<string, ToolHandler> = {
  lido_l2_get_wsteth_balance: handleL2GetBalance,
  lido_l2_get_wsteth_info: handleL2GetInfo,
  ...(appConfig.isOptimism ? { lido_l2_get_steth_balance: handleL2GetStethBalance } : {}),
};

const l2WriteHandlers: Record<string, ToolHandler> = {
  lido_l2_transfer_wsteth: handleL2Transfer,
  ...(appConfig.isOptimism ? { lido_l2_transfer_steth: handleL2TransferSteth } : {}),
};

// ============================================================
// Unified registration
// ============================================================

interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;

// Select tools based on chain type
const readToolDefs = appConfig.isL2 ? l2ReadToolDefs : l1ReadToolDefs;
const writeToolDefs = appConfig.isL2 ? l2WriteToolDefs : l1WriteToolDefs;
const readHandlers = appConfig.isL2 ? l2ReadHandlers : l1ReadHandlers;
const writeHandlers = appConfig.isL2 ? l2WriteHandlers : l1WriteHandlers;

const writeToolNames = new Set(writeToolDefs.map(t => t.name));
const handlers: Record<string, ToolHandler> = { ...readHandlers, ...writeHandlers };

// Mutex to serialize write tool calls (prevents nonce conflicts / double-spend)
let writeMutexPromise: Promise<void> = Promise.resolve();

function withWriteMutex(handler: ToolHandler): ToolHandler {
  return (args: Record<string, unknown>) => {
    const execute = () => handler(args);
    const current = writeMutexPromise.then(execute, execute);
    // Update the mutex chain; swallow errors so the mutex always resolves
    writeMutexPromise = current.then(() => {}, () => {});
    return current;
  };
}

export function registerTools(server: Server) {
  // Determine which tools to expose based on mode
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

    // Block write tools in read-only mode
    if (securityConfig.mode === "read-only" && writeToolNames.has(name)) {
      return {
        content: [{ type: "text" as const, text: "This server is running in read-only mode. Write operations are disabled." }],
        isError: true,
      };
    }

    let resolvedArgs = args ?? {};

    // In dry-run-only mode, force dry_run=true for write tools
    if (securityConfig.mode === "dry-run-only" && writeToolNames.has(name)) {
      resolvedArgs = { ...resolvedArgs, dry_run: true };
    }

    // Serialize write tool calls through mutex
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
