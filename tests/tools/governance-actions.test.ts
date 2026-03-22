import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleLockStethGovernance,
  handleUnlockStethGovernance,
} from "../../src/tools/governance-actions.js";
import { sdk, publicClient, walletClient } from "../../src/sdk-factory.js";

const MOCK_ESCROW = "0xEscrow0000000000000000000000000000000000";
const MOCK_STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";

describe("handleLockStethGovernance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValue(
      MOCK_ESCROW as `0x${string}`
    );
    vi.mocked(sdk.dualGovernance.getStETHAddress).mockResolvedValue(
      MOCK_STETH as `0x${string}`
    );
  });

  it("returns dry run output with approval needed", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(0n) // allowance
      .mockResolvedValueOnce({
        unstETHIdsCount: 0n,
        stETHLockedShares: 0n,
        unstETHLockedShares: 0n,
        lastAssetsLockTimestamp: 0n,
      });

    const result = await handleLockStethGovernance({ amount: "1.0" });
    const text = result.content[0].text;

    expect(text).toContain("DRY RUN: Lock stETH for Governance");
    expect(text).toContain("Amount to lock: 1.0 stETH");
    expect(text).toContain("Approval needed: YES");
    expect(text).toContain("Simulation: SKIPPED");
  });

  it("returns dry run output without approval needed", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(5000000000000000000n) // allowance
      .mockResolvedValueOnce({
        unstETHIdsCount: 0n,
        stETHLockedShares: 500000000000000000n,
        unstETHLockedShares: 0n,
        lastAssetsLockTimestamp: 0n,
      });

    const result = await handleLockStethGovernance({ amount: "1.0" });
    const text = result.content[0].text;

    expect(text).toContain("Approval needed: No");
    expect(text).toContain("Simulation: SUCCESS");
  });

  it("blocks lock when governance is in RageQuit state", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(5);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(10000000000000000000n);

    const result = await handleLockStethGovernance({ amount: "1.0" });
    const text = result.content[0].text;

    expect(text).toContain("Cannot lock stETH: governance is in RageQuit state");
  });

  it("returns error for insufficient stETH balance", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(500000000000000000n);

    const result = await handleLockStethGovernance({ amount: "1.0" });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Insufficient stETH balance");
  });

  it("executes lock transaction when dry_run=false (with approval)", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n); // allowance = 0
    vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xapprovehash" as `0x${string}`);
    vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({
      status: "success",
    } as any);
    vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xlockhash" as `0x${string}`);
    vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({
      status: "success",
    } as any);

    const result = await handleLockStethGovernance({ amount: "1.0", dry_run: false });
    const text = result.content[0].text;

    expect(text).toContain("stETH Locked for Governance");
    expect(text).toContain("Transaction hash: 0xlockhash");
    expect(text).toContain("Amount locked: 1.0 stETH");
    expect(text).toContain("Status: Confirmed");
    expect(text).toContain("stETH approval was granted automatically");
  });

  it("executes lock transaction when dry_run=false (no approval needed)", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(10000000000000000000n); // allowance
    vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xlockhash" as `0x${string}`);
    vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({
      status: "success",
    } as any);

    const result = await handleLockStethGovernance({ amount: "1.0", dry_run: false });
    const text = result.content[0].text;

    expect(text).toContain("stETH Locked for Governance");
    expect(text).not.toContain("stETH approval was granted automatically");
  });

  it("returns error for invalid amount", async () => {
    const result = await handleLockStethGovernance({ amount: "abc" });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for zero amount", async () => {
    const result = await handleLockStethGovernance({ amount: "0" });
    expect(result).toHaveProperty("isError", true);
  });

  it("defaults to dry_run=true when not specified", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10000000000000000000n) // allowance
      .mockResolvedValueOnce({
        unstETHIdsCount: 0n,
        stETHLockedShares: 0n,
        unstETHLockedShares: 0n,
        lastAssetsLockTimestamp: 0n,
      });

    const result = await handleLockStethGovernance({ amount: "1.0" });
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
  });
});

describe("handleUnlockStethGovernance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValue(
      MOCK_ESCROW as `0x${string}`
    );
  });

  it("returns dry run output when stETH is locked", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 2000000000000000000n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });
    vi.mocked(sdk.shares.getPooledEthByShares).mockResolvedValueOnce(2200000000000000000n);

    const result = await handleUnlockStethGovernance({});
    const text = result.content[0].text;

    expect(text).toContain("DRY RUN: Unlock stETH from Governance");
    expect(text).toContain("stETH locked:");
    expect(text).toContain("Escrow address:");
    expect(text).toContain("Gas estimate:");
  });

  it("blocks unlock when governance is in RageQuit state", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(5);

    const result = await handleUnlockStethGovernance({});
    const text = result.content[0].text;

    expect(text).toContain("Cannot unlock stETH: governance is in RageQuit state");
  });

  it("reports when no stETH is locked", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 0n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });

    const result = await handleUnlockStethGovernance({});
    const text = result.content[0].text;

    expect(text).toContain("No stETH is currently locked");
  });

  it("executes unlock transaction when dry_run=false", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 2000000000000000000n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });
    vi.mocked(sdk.shares.getPooledEthByShares).mockResolvedValueOnce(2200000000000000000n);
    vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xunlockhash" as `0x${string}`);
    vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({
      status: "success",
    } as any);

    const result = await handleUnlockStethGovernance({ dry_run: false });
    const text = result.content[0].text;

    expect(text).toContain("stETH Unlocked from Governance");
    expect(text).toContain("Transaction hash: 0xunlockhash");
    expect(text).toContain("Status: Confirmed");
    expect(text).toContain("Your stETH has been returned to your wallet");
  });

  it("shows simulation failure note in dry run", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(1);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 2000000000000000000n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });
    vi.mocked(sdk.shares.getPooledEthByShares).mockResolvedValueOnce(2200000000000000000n);
    vi.mocked(publicClient.simulateContract).mockRejectedValueOnce(
      new Error("lock duration not met")
    );

    const result = await handleUnlockStethGovernance({});
    const text = result.content[0].text;

    expect(text).toContain("Simulation: FAILED");
    expect(text).toContain("lock duration not met");
    expect(text).toContain("minimum lock duration");
  });

  it("handles general SDK errors", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockRejectedValueOnce(
      new Error("connection lost")
    );

    const result = await handleUnlockStethGovernance({});
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("connection lost");
  });
});
