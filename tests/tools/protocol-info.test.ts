import { describe, it, expect, vi, beforeEach } from "vitest";
import { publicClient, sdk } from "../../src/sdk-factory.js";
import {
  handleGetProtocolInfo,
  handleGetStakingModules,
  handleGetNodeOperators,
  handleGetContractAddresses,
  protocolInfoToolDef,
  stakingModulesToolDef,
  nodeOperatorsToolDef,
  contractAddressesToolDef,
} from "../../src/tools/protocol-info.js";

describe("protocol-info tool definitions", () => {
  it("protocolInfoToolDef has correct shape", () => {
    expect(protocolInfoToolDef.name).toBe("lido_get_protocol_info");
    expect(protocolInfoToolDef.annotations.readOnlyHint).toBe(true);
    expect(protocolInfoToolDef.inputSchema.type).toBe("object");
  });

  it("stakingModulesToolDef has correct shape", () => {
    expect(stakingModulesToolDef.name).toBe("lido_get_staking_modules");
    expect(stakingModulesToolDef.annotations.readOnlyHint).toBe(true);
  });

  it("nodeOperatorsToolDef has correct shape", () => {
    expect(nodeOperatorsToolDef.name).toBe("lido_get_node_operators");
    expect(nodeOperatorsToolDef.annotations.readOnlyHint).toBe(true);
  });

  it("contractAddressesToolDef has correct shape", () => {
    expect(contractAddressesToolDef.name).toBe("lido_get_contract_addresses");
    expect(contractAddressesToolDef.annotations.readOnlyHint).toBe(true);
  });
});

describe("handleGetProtocolInfo", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
    vi.mocked(sdk.shares.getTotalSupply).mockReset();
    vi.mocked(sdk.shares.getShareRate).mockReset();
    vi.mocked(sdk.statistics.apr.getLastApr).mockReset();
    vi.mocked(sdk.stake.getStakeLimitInfo).mockReset();
  });

  it("returns protocol info", async () => {
    vi.mocked(sdk.stake.getStakeLimitInfo).mockResolvedValueOnce({
      isStakingPaused: false,
      isStakingLimitSet: true,
      currentStakeLimit: 150000n * 10n ** 18n,
      maxStakeLimit: 150000n * 10n ** 18n,
    } as any);
    vi.mocked(sdk.statistics.apr.getLastApr).mockResolvedValueOnce(3.45);
    vi.mocked(sdk.shares.getTotalSupply).mockResolvedValueOnce({
      totalEther: 9_000_000n * 10n ** 18n,
      totalShares: 8_000_000n * 10n ** 18n,
    } as any);
    vi.mocked(sdk.shares.getShareRate).mockResolvedValueOnce(1.125 as any);
    // Mock the direct contract reads (totalPooled, buffered, fee)
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(9_000_000n * 10n ** 18n) // getTotalPooledEther
      .mockResolvedValueOnce(10_000n * 10n ** 18n)    // getBufferedEther
      .mockResolvedValueOnce(1000);                    // getFee (10.00%)

    const result = await handleGetProtocolInfo({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Lido Protocol Info");
    expect(text).toContain("Total pooled ETH");
    expect(text).toContain("Protocol fee");
    expect(text).toContain("Paused: false");
  });

  it("handles errors gracefully", async () => {
    vi.mocked(sdk.stake.getStakeLimitInfo).mockRejectedValueOnce(new Error("sdk error"));

    const result = await handleGetProtocolInfo({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("sdk error");
  });
});

describe("handleGetStakingModules", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
    vi.mocked(publicClient.multicall).mockReset();
  });

  it("returns message when no modules found", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleGetStakingModules({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No staking modules");
  });

  it("returns module list via multicall", async () => {
    // First call: getStakingModulesCount (readContract)
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(1n);
    // Second call: multicall for getStakingModule(1)
    vi.mocked(publicClient.multicall).mockResolvedValueOnce([
      {
        status: "success",
        result: [
          1,                                              // id
          "0x1111111111111111111111111111111111111111",   // address
          500,                                            // moduleFee (5%)
          500,                                            // treasuryFee (5%)
          10000,                                          // stakeShareLimit
          0,                                              // status (Active)
          "Curated Module",                               // name
          1700000000n,                                    // lastDepositAt
          18000000n,                                      // lastDepositBlock
          100n,                                           // exitedValidatorsCount
        ],
      },
    ] as any);

    const result = await handleGetStakingModules({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Staking Modules");
    expect(text).toContain("Curated Module");
    expect(text).toContain("Active");
  });

  it("handles RPC errors", async () => {
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(new Error("rpc fail"));

    const result = await handleGetStakingModules({});

    expect(result.isError).toBe(true);
  });
});

describe("handleGetNodeOperators", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
    vi.mocked(publicClient.multicall).mockReset();
  });

  it("returns message when no operators found", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleGetNodeOperators({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No node operators");
  });

  it("returns operator list via multicall", async () => {
    // readContract: getNodeOperatorsCount
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(1n);
    // multicall: getNodeOperator(0, true)
    vi.mocked(publicClient.multicall).mockResolvedValueOnce([
      {
        status: "success",
        result: [
          true,                                             // active
          "Lido Node Op",                                   // name
          "0x1111111111111111111111111111111111111111",     // rewardAddress
          100n,                                             // totalVettedValidators
          10n,                                              // totalExitedValidators
          150n,                                             // totalAddedValidators
          90n,                                              // totalDepositedValidators
        ],
      },
    ] as any);

    const result = await handleGetNodeOperators({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Node Operators");
    expect(text).toContain("Lido Node Op");
    expect(text).toContain("Active: true");
  });

  it("validates count parameter", async () => {
    const result = await handleGetNodeOperators({ count: 100 });

    expect(result.isError).toBe(true);
  });
});

describe("handleGetContractAddresses", () => {
  it("returns contract addresses for mainnet", async () => {
    const result = await handleGetContractAddresses({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Lido Contract Addresses");
    expect(text).toContain("stETH");
    expect(text).toContain("wstETH");
    expect(text).toContain("0x");
  });
});
