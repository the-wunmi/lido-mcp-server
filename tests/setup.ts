/**
 * Global test setup — mocks all external dependencies so tool handlers
 * can be tested in isolation without RPC connections or real SDK calls.
 */
import { vi } from "vitest";

process.env.LIDO_RPC_URL = "https://mock-rpc.test";
process.env.LIDO_PRIVATE_KEY = "0x" + "ab".repeat(32);
process.env.LIDO_CHAIN_ID = "1";

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
  STETH_ADDRESSES: {
    1: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  },
  WSTETH_ADDRESSES: {
    1: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  },
  LDO_ADDRESSES: {
    1: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
  },
  WITHDRAWAL_QUEUE_ADDRESSES: {
    1: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1",
  },
  L2_WSTETH_CHAINS: {
    Arbitrum: { chainId: 42161, rpcUrl: "https://arb1.arbitrum.io/rpc", address: "0x5979D7b546E38E414F7E9822514be443A4800529" },
  },
}));

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
      getStakeLimitInfo: vi.fn().mockResolvedValue({
        isStakingPaused: false,
        isStakingLimitSet: true,
        currentStakeLimit: 150000n * 10n ** 18n,
        maxStakeLimit: 150000n * 10n ** 18n,
      }),
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

vi.mock("../src/monitor/watcher.js", () => ({
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  addWatch: vi.fn().mockResolvedValue({
    address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    name: "TestVault",
    apr: 3.5,
    tvl: "1000",
    tvlRaw: 1000n * 10n ** 18n,
    sharePrice: 10n ** 18n,
    timestamp: 1700000000,
    assetDecimals: 18,
    assetSymbol: "WETH",
  }),
  removeWatch: vi.fn().mockResolvedValue({
    address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    name: "TestVault",
    rules: [{ id: "rule-1", expression: "apy < 3.0", severity: "warning", message: "APY below 3%" }],
    addedAt: 1700000000000,
  }),
  addRule: vi.fn().mockResolvedValue({
    address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    name: "TestVault",
    rules: [{ id: "rule-1", expression: "apy < 3.0", severity: "warning", message: "APY below 3%" }],
    addedAt: 1700000000000,
  }),
  removeRule: vi.fn().mockResolvedValue({
    address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    name: "TestVault",
    rules: [],
    addedAt: 1700000000000,
  }),
  getWatch: vi.fn().mockReturnValue(undefined),
  getWatches: vi.fn().mockReturnValue([]),
  getSnapshots: vi.fn().mockReturnValue(new Map()),
  getLatestSnapshot: vi.fn().mockReturnValue(undefined),
  getLatestAlerts: vi.fn().mockReturnValue([]),
  getBenchmarks: vi.fn().mockReturnValue({ stethApr: 3.1, timestamp: Date.now() }),
  runHealthCheck: vi.fn().mockResolvedValue(undefined),
  runVaultCheck: vi.fn().mockResolvedValue(undefined),
  updateWatchRecipient: vi.fn().mockResolvedValue({
    address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    name: "TestVault",
    rules: [],
    addedAt: 1700000000000,
    recipient: "user@example.com",
  }),
}));

vi.mock("../src/monitor/config.js", () => ({
  monitorConfig: {
    telegram: { enabled: false, botToken: "", chatId: "" },
    email: { enabled: false, host: "", port: 587, secure: false, user: "", pass: "", from: "" },
    mainnetRpcUrl: "https://mock-mainnet-rpc.test",
    mainnetAvailable: true,
    dataDir: ".data",
    dedupCooldownMs: 6 * 60 * 60 * 1000,
    maxAlertHistory: 100,
    anthropic: { enabled: false, apiKey: "", model: "claude-haiku-4-5-20251001" },
  },
  MAINNET_STETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  FETCH_TIMEOUT_MS: 15_000,
  BIGINT_SCALE_18: 10n ** 18n,
  normalizeAddress: (addr: string) => addr.toLowerCase(),
}));

vi.mock("../src/monitor/rules.js", () => {
  let counter = 0;
  const mockScope = {
    apr: 3.5, apr_prev: 3.4, apr_delta: 0.1,
    apy: 3.5, apy_prev: 3.4, apy_delta: 0.1, tvl: 1000, tvl_prev: 990,
    tvl_change_pct: 1.0, share_price: 1.0, share_price_prev: 0.999,
    share_price_change_pct: 0.1, steth_apr: 3.1, spread_vs_steth: 0.4,
  };
  return {
    validateExpression: vi.fn().mockReturnValue(null),
    evaluateRule: vi.fn().mockReturnValue(false),
    buildScope: vi.fn().mockReturnValue(mockScope),
    renderTemplate: vi.fn().mockImplementation((template: string) => template),
    generateRuleId: vi.fn().mockImplementation(() => `rule-${++counter}`),
    getAvailableVariables: vi.fn().mockReturnValue([
      "apy", "apy_prev", "apy_delta", "tvl", "tvl_prev", "tvl_change_pct",
      "share_price", "share_price_prev", "share_price_change_pct", "steth_apr", "spread_vs_steth",
    ]),
    dryRunRule: vi.fn().mockReturnValue({
      fired: false,
      scope: mockScope,
      renderedMessage: "APR dropped to 3.50%",
    }),
    VARIABLE_DECIMALS: {
      apr: 2, apr_prev: 2, apr_delta: 2, apy: 2, apy_prev: 2, apy_delta: 2,
      tvl: 0, tvl_prev: 0, tvl_change_pct: 2, share_price: 6, share_price_prev: 6,
      share_price_change_pct: 2, steth_apr: 2, spread_vs_steth: 2,
    },
    MAX_EXPRESSION_LENGTH: 500,
    MAX_MESSAGE_LENGTH: 1000,
  };
});

vi.mock("../src/monitor/telegram.js", () => ({
  TelegramChannel: vi.fn().mockImplementation(() => ({
    name: "telegram",
    enabled: false,
    send: vi.fn().mockResolvedValue(undefined),
    sendTest: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

vi.mock("../src/monitor/email.js", () => ({
  EmailChannel: vi.fn().mockImplementation(() => ({
    name: "email",
    enabled: false,
    send: vi.fn().mockResolvedValue(undefined),
    sendTest: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

vi.mock("../src/monitor/notifier.js", () => ({
  sendAlertNotification: vi.fn().mockResolvedValue(undefined),
  testAllChannels: vi.fn().mockResolvedValue([
    { name: "telegram", success: true },
    { name: "email", success: false, error: "Email not configured. Set SMTP_HOST in your environment." },
  ]),
  getChannelStatus: vi.fn().mockReturnValue([
    { name: "telegram", enabled: false },
    { name: "email", enabled: false },
  ]),
}));

vi.mock("../src/monitor/explain.js", () => ({
  explainAlert: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/monitor/db.js", () => ({
  openDb: vi.fn(),
  closeDb: vi.fn(),
  getDb: vi.fn(),
  insertWatch: vi.fn(),
  deleteWatch: vi.fn(),
  updateRecipient: vi.fn(),
  loadWatch: vi.fn().mockReturnValue(undefined),
  loadAllWatches: vi.fn().mockReturnValue([]),
  watchCount: vi.fn().mockReturnValue(0),
  watchExists: vi.fn().mockReturnValue(false),
  insertRule: vi.fn(),
  deleteRule: vi.fn(),
  upsertSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
  loadSnapshot: vi.fn().mockReturnValue(undefined),
  loadAllSnapshots: vi.fn().mockReturnValue(new Map()),
  appendAlerts: vi.fn(),
  loadAlertHistory: vi.fn().mockReturnValue([]),
  loadAlertsByVault: vi.fn().mockReturnValue([]),
  trimAlertHistory: vi.fn(),
  loadDedupTimestamps: vi.fn().mockReturnValue({}),
  saveDedupTimestamps: vi.fn(),
}));

vi.mock("../src/monitor/mainnet-client.js", () => {
  const multicallFn = vi.fn().mockImplementation(({ contracts }: { contracts: unknown[] }) => {
    // Route based on number of contracts in the multicall batch
    const count = contracts.length;
    if (count === 5) {
      // readVaultOnChain batch 1: totalAssets, name, symbol, decimals, asset
      return Promise.resolve([
        { status: "success", result: 1000n * 10n ** 18n },
        { status: "success", result: "TestVault" },
        { status: "success", result: "TV" },
        { status: "success", result: 18 },
        { status: "success", result: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
      ]);
    } else if (count === 1) {
      // readVaultOnChain batch 3: convertToAssets (share price)
      return Promise.resolve([
        { status: "success", result: 10n ** 18n },
      ]);
    } else if (count === 2) {
      // readVaultOnChain batch 2: asset decimals + symbol
      return Promise.resolve([
        { status: "success", result: 18 },
        { status: "success", result: "WETH" },
      ]);
    }
    // Fallback for any other multicall
    return Promise.resolve(contracts.map(() => ({ status: "success", result: 0n })));
  });

  return {
    getMainnetClient: vi.fn().mockReturnValue({
      multicall: multicallFn,
      getBlockNumber: vi.fn().mockResolvedValue(18000000n),
      watchContractEvent: vi.fn().mockReturnValue(() => {}),
    }),
    _resetMainnetClient: vi.fn(),
  };
});

vi.mock("dotenv", () => ({
  config: vi.fn(),
}));
