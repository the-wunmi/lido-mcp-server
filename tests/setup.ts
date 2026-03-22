/**
 * Global test setup — mocks all external dependencies so tool handlers
 * can be tested in isolation without RPC connections or real SDK calls.
 */
import { vi } from "vitest";

// ─── Environment variables (must be set before any config import) ────────────
process.env.LIDO_RPC_URL = "https://mock-rpc.test";
process.env.LIDO_PRIVATE_KEY = "0x" + "ab".repeat(32);
process.env.LIDO_CHAIN_ID = "1";

// ─── Mock: ../config.js ─────────────────────────────────────────────────────
vi.mock("../src/config.js", () => ({
  appConfig: {
    rpcUrl: "https://mock-rpc.test",
    chainId: 1,
    chain: { id: 1, name: "mainnet" },
    isL2: false,
    isL1: true,
    isOptimism: false,
  },
  securityConfig: {
    mode: "full" as const,
    allowedReceivers: null,
    maxTransactionWei: null,
  },
  consumePrivateKey: () => ("0x" + "ab".repeat(32)) as `0x${string}`,
  GOVERNANCE_WARNING_THRESHOLD: 50,
  WSTETH_ADDRESSES: {
    1: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  },
}));

// ─── Mock: ../sdk-factory.js ────────────────────────────────────────────────
const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as const;

vi.mock("../src/sdk-factory.js", () => ({
  publicClient: {
    getBalance: vi.fn().mockResolvedValue(10n * 10n ** 18n), // 10 ETH
    getGasPrice: vi.fn().mockResolvedValue(20_000_000_000n), // 20 gwei
    getChainId: vi.fn().mockResolvedValue(1),
    readContract: vi.fn().mockResolvedValue(0n),
    call: vi.fn().mockResolvedValue({ data: "0x" }),
    getLogs: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 1700000000n, number: 18000000n }),
    getBlockNumber: vi.fn().mockResolvedValue(18000000n),
    multicall: vi.fn().mockResolvedValue([]),
    estimateGas: vi.fn().mockResolvedValue(100_000n),
    simulateContract: vi.fn().mockResolvedValue({ result: [0n, 0n, 0, 0n] }),
    estimateContractGas: vi.fn().mockResolvedValue(100_000n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", gasUsed: 80_000n }),
  },
  walletClient: {
    account: { address: MOCK_ADDRESS },
    signTypedData: vi.fn().mockResolvedValue("0xmocksig"),
    writeContract: vi.fn().mockResolvedValue("0xmocktxhash"),
  },
  sdk: {
    steth: {
      balance: vi.fn().mockResolvedValue(5n * 10n ** 18n),
    },
    wsteth: {
      balance: vi.fn().mockResolvedValue(3n * 10n ** 18n),
      convertToSteth: vi.fn().mockResolvedValue(3500000000000000000n),
      convertToWsteth: vi.fn().mockResolvedValue(2800000000000000000n),
    },
    statistics: {
      apr: {
        getLastApr: vi.fn().mockResolvedValue(3.45),
        getSmaApr: vi.fn().mockResolvedValue(3.30),
      },
    },
    rewards: {
      getRewardsFromChain: vi.fn().mockResolvedValue({
        rewards: [{ change: 100000000000000n, apr: 3.5, blockNumber: 18000000n }],
        baseBalance: 5000000000000000000n,
        baseBalanceShares: 4500000000000000000n,
        baseShareRate: 1111111111111111111n,
        totalRewards: 100000000000000n,
      }),
    },
    stake: {
      stakeEth: vi.fn().mockResolvedValue({
        hash: "0xmocktxhash",
        result: { stethReceived: 1000000000000000000n, sharesReceived: 900000000000000000n },
        confirmations: 1,
      }),
      stakeEthPopulateTx: vi.fn().mockResolvedValue({
        to: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
        from: MOCK_ADDRESS,
        value: 1000000000000000000n,
        data: "0xa1903eab",
      }),
      stakeEthSimulateTx: vi.fn().mockResolvedValue(undefined),
      stakeEthEstimateGas: vi.fn().mockResolvedValue(100_000n),
    },
    dualGovernance: {
      getDualGovernanceState: vi.fn().mockResolvedValue(1),
      calculateCurrentVetoSignallingThresholdProgress: vi.fn().mockResolvedValue({
        currentSupportPercent: 0.5,
      }),
      getVetoSignallingEscrowLockedAssets: vi.fn().mockResolvedValue({
        totalStETHLockedShares: 1000000000000000000n,
        totalStETHClaimedETH: 0n,
        totalUnstETHUnfinalizedShares: 0n,
        totalUnstETHFinalizedETH: 0n,
      }),
      getTotalStETHSupply: vi.fn().mockResolvedValue(9000000000000000000000000n),
      getDualGovernanceConfig: vi.fn().mockResolvedValue({
        firstSealRageQuitSupport: 10000000000000000n,
        secondSealRageQuitSupport: 100000000000000000n,
        minAssetsLockDuration: 86400n,
        vetoSignallingMinDuration: 259200n,
        vetoSignallingMaxDuration: 2592000n,
        vetoCooldownDuration: 172800n,
        rageQuitExtensionPeriodDuration: 604800n,
      }),
      getGovernanceWarningStatus: vi.fn().mockResolvedValue({
        state: "Normal",
      }),
      getVetoSignallingEscrowAddress: vi.fn().mockResolvedValue("0xEscrow0000000000000000000000000000000000"),
      getStETHAddress: vi.fn().mockResolvedValue("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"),
    },
    shares: {
      getPooledEthByShares: vi.fn().mockResolvedValue(1100000000000000000n),
      getTotalSupply: vi.fn().mockResolvedValue(8000000000000000000000000n),
      getShareRate: vi.fn().mockResolvedValue(1100000000000000000n),
    },
    wrap: {
      getStethForWrapAllowance: vi.fn().mockResolvedValue(10n * 10n ** 18n),
      convertWstethToSteth: vi.fn().mockResolvedValue(3500000000000000000n),
      approveStethForWrap: vi.fn().mockResolvedValue(undefined),
      wrapSteth: vi.fn().mockResolvedValue({
        hash: "0xmockwraphash",
        result: { stethWrapped: 1000000000000000000n, wstethReceived: 850000000000000000n },
      }),
      wrapStethPopulateTx: vi.fn().mockResolvedValue({
        to: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
        from: MOCK_ADDRESS,
        value: 0n,
        data: "0xea598cb0",
      }),
      wrapStethSimulateTx: vi.fn().mockResolvedValue(undefined),
      wrapStethEstimateGas: vi.fn().mockResolvedValue(80_000n),
      wrapEth: vi.fn().mockResolvedValue({
        hash: "0xmockwrapethhash",
        result: { stethWrapped: 1000000000000000000n, wstethReceived: 850000000000000000n },
      }),
      wrapEthPopulateTx: vi.fn().mockResolvedValue({
        to: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
        from: MOCK_ADDRESS,
        value: 1000000000000000000n,
        data: "0x",
      }),
      wrapEthSimulateTx: vi.fn().mockResolvedValue(undefined),
      wrapEthEstimateGas: vi.fn().mockResolvedValue(120_000n),
      unwrap: vi.fn().mockResolvedValue({
        hash: "0xmockunwraphash",
        result: { wstethUnwrapped: 1000000000000000000n, stethReceived: 1170000000000000000n },
      }),
      unwrapPopulateTx: vi.fn().mockResolvedValue({
        to: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
        from: MOCK_ADDRESS,
        value: 0n,
        data: "0xde0e9a3e",
      }),
      unwrapSimulateTx: vi.fn().mockResolvedValue(undefined),
      unwrapEstimateGas: vi.fn().mockResolvedValue(70_000n),
    },
    withdraw: {
      request: {
        requestWithdrawal: vi.fn().mockResolvedValue({
          hash: "0xmockwithdrawhash",
          result: { requests: [{ requestId: 1n, amountOfStETH: 1000000000000000000n }] },
        }),
        requestWithdrawalPopulateTx: vi.fn().mockResolvedValue({
          to: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1",
          from: MOCK_ADDRESS,
          value: 0n,
          data: "0x",
        }),
        requestWithdrawalSimulateTx: vi.fn().mockResolvedValue(undefined),
        requestWithdrawalEstimateGas: vi.fn().mockResolvedValue(200_000n),
        splitAmountToRequests: vi.fn().mockReturnValue([1000000000000000000n]),
      },
      approval: {
        getAllowance: vi.fn().mockResolvedValue(10n * 10n ** 18n), // 10 stETH allowance
        approve: vi.fn().mockResolvedValue(undefined),
      },
      requestsInfo: {
        getClaimableRequestsETHByAccount: vi.fn().mockResolvedValue({
          ethSum: 1000000000000000000n,
          sortedIds: [1n],
          hints: [100n],
        }),
      },
      claim: {
        claimRequests: vi.fn().mockResolvedValue({
          hash: "0xmockclaimhash",
          result: undefined,
        }),
        claimRequestsPopulateTx: vi.fn().mockResolvedValue({
          to: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1",
          from: MOCK_ADDRESS,
          value: 0n,
          data: "0x",
        }),
        claimRequestsSimulateTx: vi.fn().mockResolvedValue(undefined),
        claimRequestsEstimateGas: vi.fn().mockResolvedValue(150_000n),
      },
      views: {
        getWithdrawalRequestsInfo: vi.fn().mockResolvedValue([
          { id: 1n, amountOfStETH: 1000000000000000000n, isFinalized: true, isClaimed: false },
        ]),
        getClaimableEther: vi.fn().mockResolvedValue([1000000000000000000n]),
        getWithdrawalRequestsStatus: vi.fn().mockResolvedValue([
          { isFinalized: true, isClaimed: false, amountOfStETH: 1000000000000000000n },
        ]),
        getLastCheckpointIndex: vi.fn().mockResolvedValue(100n),
        findCheckpointHints: vi.fn().mockResolvedValue([100n]),
      },
    },
  },
  getAccountAddress: vi.fn().mockReturnValue(MOCK_ADDRESS),
  validateChainId: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock: dotenv ────────────────────────────────────────────────────────────
vi.mock("dotenv", () => ({
  config: vi.fn(),
}));
