import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGetRewards } from "../../src/tools/rewards.js";
import { sdk } from "../../src/sdk-factory.js";
import type { ToolResult } from "../../src/types.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

const defaultRewardsResult = {
  rewards: [{ change: 100000000000000n, apr: 3.5, blockNumber: 18000000n, type: "rebase", balance: 5000100000000000000n, balanceShares: 4500000000000000000n, shareRate: 1111111111111111111n }],
  baseBalance: 5000000000000000000n,
  baseBalanceShares: 4500000000000000000n,
  baseShareRate: 1111111111111111111n,
  totalRewards: 100000000000000n,
  fromBlock: 17900000n,
  toBlock: 18000000n,
};

describe("handleGetRewards", () => {
  beforeEach(() => {
    vi.mocked(sdk.rewards.getRewardsFromChain).mockResolvedValue(defaultRewardsResult as any);
  });

  it("returns rewards with defaults (no args)", async () => {
    const result: ToolResult = await handleGetRewards({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Staking Rewards for");
    expect(text).toContain(MOCK_ADDRESS);
    expect(text).toContain("Total rewards:");
    expect(text).toContain("Base balance:");
  });

  it("returns rewards for a custom address", async () => {
    const addr = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const result = await handleGetRewards({ address: addr });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(addr);
  });

  it("uses from_block when provided", async () => {
    const result = await handleGetRewards({ from_block: 17000000 });

    expect(result.isError).toBeUndefined();
    expect(sdk.rewards.getRewardsFromChain).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { block: 17000000n },
      }),
    );
  });

  it("uses back_days when provided (no from_block)", async () => {
    const result = await handleGetRewards({ back_days: 30 });

    expect(result.isError).toBeUndefined();
    expect(sdk.rewards.getRewardsFromChain).toHaveBeenCalledWith(
      expect.objectContaining({
        back: { days: 30n },
      }),
    );
  });

  it("uses custom step_block", async () => {
    const result = await handleGetRewards({ step_block: 25000 });

    expect(result.isError).toBeUndefined();
    expect(sdk.rewards.getRewardsFromChain).toHaveBeenCalledWith(
      expect.objectContaining({
        stepBlock: 25000,
      }),
    );
  });

  it("shows rebase events in the output", async () => {
    vi.mocked(sdk.rewards.getRewardsFromChain).mockResolvedValueOnce({
      rewards: [
        {
          type: "rebase",
          change: 50000000000000n,
          apr: 3.2,
          blockNumber: 18000000n,
          balance: 5050000000000000000n,
          balanceShares: 4500000000000000000n,
          shareRate: 1111111111111111111n,
        },
      ],
      baseBalance: 5000000000000000000n,
      baseBalanceShares: 4500000000000000000n,
      baseShareRate: 1111111111111111111n,
      totalRewards: 50000000000000n,
      fromBlock: 17900000n,
      toBlock: 18000000n,
    } as any);

    const result = await handleGetRewards({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Rebase events (1):");
    expect(text).toContain("APR:");
    expect(text).toContain("3.20%");
  });

  it("truncates to last 10 events when more exist", async () => {
    const events = Array.from({ length: 15 }, (_, i) => ({
      type: "rebase",
      change: 10000000000000n,
      apr: 3.0 + i * 0.1,
      blockNumber: BigInt(18000000 + i),
      balance: 5000000000000000000n + BigInt(i) * 10000000000000n,
      balanceShares: 4500000000000000000n,
      shareRate: 1111111111111111111n,
    }));

    vi.mocked(sdk.rewards.getRewardsFromChain).mockResolvedValueOnce({
      rewards: events,
      baseBalance: 5000000000000000000n,
      baseBalanceShares: 4500000000000000000n,
      baseShareRate: 1111111111111111111n,
      totalRewards: 150000000000000n,
      fromBlock: 17900000n,
      toBlock: 18000015n,
    } as any);

    const result = await handleGetRewards({});
    const text = result.content[0].text;
    expect(text).toContain("Rebase events (15):");
    expect(text).toContain("... and 5 more events");
  });

  it("returns error for invalid address format", async () => {
    const result = await handleGetRewards({ address: "bad" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for back_days = 0", async () => {
    const result = await handleGetRewards({ back_days: 0 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for back_days > 365", async () => {
    const result = await handleGetRewards({ back_days: 400 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for step_block below 100", async () => {
    const result = await handleGetRewards({ step_block: 50 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK error", async () => {
    vi.mocked(sdk.rewards.getRewardsFromChain).mockRejectedValueOnce(
      new Error("rewards fetch failed"),
    );

    const result = await handleGetRewards({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("rewards fetch failed");
  });
});
