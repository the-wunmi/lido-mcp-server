import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleAnalyzePosition } from "../../src/tools/position.js";
import { sdk, publicClient } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

function ensureMocks() {
  if (!(sdk.wrap as any).convertWstethToSteth) {
    (sdk.wrap as any).convertWstethToSteth = vi.fn();
  }
  if (!(sdk.withdraw as any).requestsInfo) {
    (sdk.withdraw as any).requestsInfo = {};
  }
  if (!(sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo) {
    (sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo = vi.fn();
  }
}

function setDefaultMocks() {
  vi.mocked((sdk.wrap as any).convertWstethToSteth).mockResolvedValue(
    3500000000000000000n,
  );

  vi.mocked((sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo).mockResolvedValue({
    claimableInfo: {
      claimableRequests: [
        { id: 1n, amountOfStETH: 1000000000000000000n, isClaimed: false },
      ],
      claimableAmountStETH: 1000000000000000000n,
    },
    pendingInfo: {
      pendingRequests: [
        { id: 2n, amountOfStETH: 2000000000000000000n, timestamp: 1700000000n },
      ],
      pendingAmountStETH: 2000000000000000000n,
    },
    claimableETH: {
      ethSum: 1000000000000000000n,
    },
  });
}

describe("handleAnalyzePosition", () => {
  beforeEach(() => {
    ensureMocks();
    setDefaultMocks();
  });

  it("returns full position analysis with defaults", async () => {
    const result = await handleAnalyzePosition({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Position Analysis for ${MOCK_ADDRESS}`);
    expect(text).toContain("Balances:");
    expect(text).toContain("ETH (unstaked):");
    expect(text).toContain("stETH:");
    expect(text).toContain("wstETH:");
    expect(text).toContain("Total staked:");
    expect(text).toContain("Yield:");
    expect(text).toContain("Current APR: 3.45%");
    expect(text).toContain("7-day SMA APR: 3.30%");
    expect(text).toContain("Withdrawals:");
    expect(text).toContain("Pending requests: 1");
    expect(text).toContain("Claimable requests: 1");
  });

  it("returns position for a custom address", async () => {
    const addr = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const result = await handleAnalyzePosition({ address: addr });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(addr);
  });

  it("recommends unstaking when APR is below min_apr", async () => {
    const result = await handleAnalyzePosition({ min_apr: 4.0 });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Recommendations:");
    expect(text).toContain("APR is 3.45%");
    expect(text).toContain("below your minimum of 4.00%");
  });

  it("does not recommend unstaking when APR is above min_apr", async () => {
    const result = await handleAnalyzePosition({ min_apr: 3.0 });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).not.toContain("below your minimum");
  });

  it("recommends withdrawal when position exceeds max_position_eth", async () => {
    const result = await handleAnalyzePosition({ max_position_eth: 5 });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Recommendations:");
    expect(text).toContain("exceeds your max of 5 ETH");
    expect(text).toContain("Consider withdrawing");
  });

  it("recommends staking more when position is below min_position_eth", async () => {
    const result = await handleAnalyzePosition({ min_position_eth: 15 });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Recommendations:");
    expect(text).toContain("below your min of 15 ETH");
    expect(text).toContain("Consider staking");
  });

  it("recommends claiming claimable withdrawals", async () => {
    const result = await handleAnalyzePosition({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("withdrawal request(s) ready to claim");
    expect(text).toContain("lido_claim_withdrawal");
  });

  it("shows 'no action needed' when within bounds and no claimable", async () => {
    vi.mocked((sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo).mockResolvedValueOnce({
      claimableInfo: { claimableRequests: [], claimableAmountStETH: 0n },
      pendingInfo: { pendingRequests: [], pendingAmountStETH: 0n },
      claimableETH: { ethSum: 0n },
    });

    const result = await handleAnalyzePosition({
      min_apr: 2.0,
      max_position_eth: 100,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No action needed");
  });

  it("skips withdrawal info when check_claimable is false", async () => {
    vi.mocked(
      (sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo,
    ).mockClear();

    const result = await handleAnalyzePosition({ check_claimable: false });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).not.toContain("Withdrawals:");
    expect(
      (sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo,
    ).not.toHaveBeenCalled();
  });

  it("handles withdrawal info failure gracefully when check_claimable is true", async () => {
    vi.mocked(
      (sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo,
    ).mockRejectedValueOnce(new Error("withdrawal info unavailable"));

    const result = await handleAnalyzePosition({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Could not fetch withdrawal data");
  });

  it("returns error for invalid address", async () => {
    const result = await handleAnalyzePosition({ address: "bad" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error when min_position_eth > max_position_eth", async () => {
    const result = await handleAnalyzePosition({
      min_position_eth: 100,
      max_position_eth: 50,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK error from getBalance", async () => {
    vi.mocked(publicClient.getBalance).mockRejectedValueOnce(
      new Error("balance error"),
    );

    const result = await handleAnalyzePosition({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("balance error");
  });

  it("handles zero wstETH balance (skips conversion)", async () => {
    vi.mocked(sdk.wsteth.balance).mockResolvedValueOnce(0n);

    const result = await handleAnalyzePosition({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("wstETH:          0");
    expect(text).toContain("wstETH (as stETH): 0");
  });

  it("accepts min_apr of 0", async () => {
    const result = await handleAnalyzePosition({ min_apr: 0 });
    expect(result.isError).toBeUndefined();
  });

  it("returns error for negative min_apr", async () => {
    const result = await handleAnalyzePosition({ min_apr: -1 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });
});
