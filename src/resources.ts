import { formatEther } from "viem";
import type { Address } from "viem";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { sdk, publicClient, getAccountAddress } from "./sdk-factory.js";
import { sanitizeErrorMessage } from "./utils/errors.js";
import { GOVERNANCE_WARNING_THRESHOLD } from "./config.js";
import { GOVERNANCE_STATE_LABELS } from "./utils/governance-labels.js";

async function getPositionData(address: Address): Promise<string> {
  const [ethBalance, stethBalance, wstethBalance, lastApr, smaApr] = await Promise.all([
    publicClient.getBalance({ address }),
    sdk.steth.balance(address),
    sdk.wsteth.balance(address),
    sdk.statistics.apr.getLastApr(),
    sdk.statistics.apr.getSmaApr({ days: 7 }),
  ]);

  let wstethInSteth = 0n;
  if (wstethBalance > 0n) {
    wstethInSteth = await sdk.wrap.convertWstethToSteth(wstethBalance);
  }

  const totalStaked = stethBalance + wstethInSteth;

  let pendingCount = 0;
  let claimableCount = 0;
  let claimableEth = 0n;
  try {
    const info = await sdk.withdraw.requestsInfo.getWithdrawalRequestsInfo({ account: address });
    pendingCount = info.pendingInfo.pendingRequests.length;
    claimableCount = info.claimableInfo.claimableRequests.filter((r) => !r.isClaimed).length;
    claimableEth = info.claimableETH.ethSum;
  } catch {
    // withdrawal info may not be available
  }

  const data = {
    address,
    balances: {
      eth: formatEther(ethBalance),
      steth: formatEther(stethBalance),
      wsteth: formatEther(wstethBalance),
      wsteth_as_steth: formatEther(wstethInSteth),
      total_staked_eth_equivalent: formatEther(totalStaked),
    },
    yield: {
      current_apr_percent: lastApr.toFixed(2),
      sma_7d_apr_percent: smaApr.toFixed(2),
    },
    withdrawals: {
      pending_requests: pendingCount,
      claimable_requests: claimableCount,
      claimable_eth: formatEther(claimableEth),
    },
  };

  return JSON.stringify(data, null, 2);
}

async function getProtocolStatusData(): Promise<string> {
  const [stakeLimitInfo, isPaused, isBunker, isTurbo, minSteth, maxSteth, unfinalizedStETH, lastApr] =
    await Promise.all([
      sdk.stake.getStakeLimitInfo(),
      sdk.withdraw.views.isPaused(),
      sdk.withdraw.views.isBunkerModeActive(),
      sdk.withdraw.views.isTurboModeActive(),
      sdk.withdraw.views.minStethWithdrawalAmount(),
      sdk.withdraw.views.maxStethWithdrawalAmount(),
      sdk.withdraw.views.getUnfinalizedStETH(),
      sdk.statistics.apr.getLastApr(),
    ]);

  let queueMode = "Normal";
  if (isPaused) queueMode = "Paused";
  else if (isBunker) queueMode = "Bunker";
  else if (isTurbo) queueMode = "Turbo";

  const data = {
    staking: {
      paused: stakeLimitInfo.isStakingPaused,
      limit_set: stakeLimitInfo.isStakingLimitSet,
      current_limit_eth: formatEther(stakeLimitInfo.currentStakeLimit),
      max_limit_eth: formatEther(stakeLimitInfo.maxStakeLimit),
    },
    withdrawal_queue: {
      mode: queueMode,
      min_withdrawal_steth: formatEther(minSteth),
      max_withdrawal_steth: formatEther(maxSteth),
      unfinalized_steth: formatEther(unfinalizedStETH),
    },
    yield: {
      current_apr_percent: lastApr.toFixed(2),
    },
  };

  return JSON.stringify(data, null, 2);
}

async function getGovernanceData(): Promise<string> {
  const [state, vetoProgress, escrowDetails, totalStETHSupply, warningStatus] = await Promise.all([
    sdk.dualGovernance.getDualGovernanceState(),
    sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress(),
    sdk.dualGovernance.getVetoSignallingEscrowLockedAssets(),
    sdk.dualGovernance.getTotalStETHSupply(),
    sdk.dualGovernance.getGovernanceWarningStatus({ triggerPercent: GOVERNANCE_WARNING_THRESHOLD }),
  ]);

  const stateNum = typeof state === "number" ? state : Number(state);

  const data = {
    state: GOVERNANCE_STATE_LABELS[stateNum] ?? `Unknown(${stateNum})`,
    warning_status: warningStatus.state,
    veto_signalling_support_percent: vetoProgress.currentSupportPercent.toFixed(2),
    escrow: {
      total_steth_locked_shares: formatEther(escrowDetails.totalStETHLockedShares),
      total_steth_claimed_eth: formatEther(escrowDetails.totalStETHClaimedETH),
      total_unsteth_unfinalized_shares: formatEther(escrowDetails.totalUnstETHUnfinalizedShares),
      total_unsteth_finalized_eth: formatEther(escrowDetails.totalUnstETHFinalizedETH),
    },
    total_steth_supply: formatEther(totalStETHSupply),
  };

  return JSON.stringify(data, null, 2);
}

export function registerResources(server: Server) {
  // List static resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "lido://protocol/status",
        name: "Lido Protocol Status",
        description:
          "Live protocol status: staking limits, withdrawal queue mode, current APR.",
        mimeType: "application/json",
      },
      {
        uri: "lido://governance/state",
        name: "Lido Governance State",
        description:
          "Current dual governance state, veto signalling progress, escrow details.",
        mimeType: "application/json",
      },
    ],
  }));

  // List resource templates (parameterized resources)
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: "lido://position/{address}",
        name: "Lido Staking Position",
        description:
          "Live staking position data for an Ethereum address: " +
          "ETH/stETH/wstETH balances, APR, pending withdrawals.",
        mimeType: "application/json",
      },
    ],
  }));

  // Read resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      // Match lido://position/{address}
      const positionMatch = uri.match(/^lido:\/\/position\/?(0x[a-fA-F0-9]{40})?$/);
      if (positionMatch) {
        const address = (positionMatch[1] ?? getAccountAddress()) as Address;
        const text = await getPositionData(address);
        return {
          contents: [{ uri, mimeType: "application/json", text }],
        };
      }

      // Match lido://protocol/status
      if (uri === "lido://protocol/status") {
        const text = await getProtocolStatusData();
        return {
          contents: [{ uri, mimeType: "application/json", text }],
        };
      }

      // Match lido://governance/state
      if (uri === "lido://governance/state") {
        const text = await getGovernanceData();
        return {
          contents: [{ uri, mimeType: "application/json", text }],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    } catch (error) {
      const safeMessage = error instanceof Error
        ? sanitizeErrorMessage(error.message)
        : "Unknown error reading resource";
      throw new Error(`Failed to read resource ${uri}: ${safeMessage}`);
    }
  });
}
