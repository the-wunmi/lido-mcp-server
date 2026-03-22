import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleEstimateVetoImpact,
  handleGetVetoThresholds,
  handleGetGovernanceTimeline,
  handleGetGovernancePositionImpact,
} from "../../src/tools/governance-analysis.js";
import { sdk, publicClient } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

describe("handleEstimateVetoImpact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns impact estimate for a given amount", async () => {
    const result = await handleEstimateVetoImpact({ amount: "100.0" });
    const text = result.content[0].text;

    expect(text).toContain("Veto Impact Estimate");
    expect(text).toContain("Amount to lock: 100.0 stETH");
    expect(text).toContain("Current State");
    expect(text).toContain("Projected After Lock");
    expect(text).toContain("Threshold Analysis");
    expect(text).toContain("First seal threshold:");
    expect(text).toContain("Second seal threshold:");
  });

  it("warns when amount would trigger first seal", async () => {
    vi.mocked(sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress).mockResolvedValueOnce({
      currentSupportPercent: 0.5,
    });
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowLockedAssets).mockResolvedValueOnce({
      totalStETHLockedShares: 0n,
      totalStETHClaimedETH: 0n,
      totalUnstETHUnfinalizedShares: 0n,
      totalUnstETHFinalizedETH: 0n,
    });
    vi.mocked(sdk.dualGovernance.getTotalStETHSupply).mockResolvedValueOnce(
      10000000000000000000000n, // 10,000 stETH
    );
    vi.mocked(sdk.dualGovernance.getDualGovernanceConfig).mockResolvedValueOnce({
      firstSealRageQuitSupport: 10000000000000000n,   // 1%
      secondSealRageQuitSupport: 100000000000000000n, // 10%
      minAssetsLockDuration: 86400n,
      vetoSignallingMinDuration: 259200n,
      vetoSignallingMaxDuration: 2592000n,
      vetoCooldownDuration: 172800n,
      rageQuitExtensionPeriodDuration: 604800n,
    });

    const result = await handleEstimateVetoImpact({ amount: "100.0" });
    const text = result.content[0].text;

    expect(text).toContain("Would trigger first seal: YES");
    expect(text).toContain("activate veto signalling");
  });

  it("warns when amount would trigger second seal", async () => {
    vi.mocked(sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress).mockResolvedValueOnce({
      currentSupportPercent: 0.5,
    });
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowLockedAssets).mockResolvedValueOnce({
      totalStETHLockedShares: 0n,
      totalStETHClaimedETH: 0n,
      totalUnstETHUnfinalizedShares: 0n,
      totalUnstETHFinalizedETH: 0n,
    });
    vi.mocked(sdk.dualGovernance.getTotalStETHSupply).mockResolvedValueOnce(
      10000000000000000000000n, // 10,000 stETH
    );
    vi.mocked(sdk.dualGovernance.getDualGovernanceConfig).mockResolvedValueOnce({
      firstSealRageQuitSupport: 10000000000000000n,
      secondSealRageQuitSupport: 100000000000000000n,
      minAssetsLockDuration: 86400n,
      vetoSignallingMinDuration: 259200n,
      vetoSignallingMaxDuration: 2592000n,
      vetoCooldownDuration: 172800n,
      rageQuitExtensionPeriodDuration: 604800n,
    });

    const result = await handleEstimateVetoImpact({ amount: "1500.0" });
    const text = result.content[0].text;

    expect(text).toContain("Would trigger second seal: YES");
    expect(text).toContain("WARNING");
    expect(text).toContain("rage quit");
  });

  it("shows NO for first seal when amount is too small to trigger it", async () => {
    vi.mocked(sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress).mockResolvedValueOnce({
      currentSupportPercent: 0.0,
    });
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowLockedAssets).mockResolvedValueOnce({
      totalStETHLockedShares: 0n,
      totalStETHClaimedETH: 0n,
      totalUnstETHUnfinalizedShares: 0n,
      totalUnstETHFinalizedETH: 0n,
    });
    vi.mocked(sdk.dualGovernance.getTotalStETHSupply).mockResolvedValueOnce(
      9000000000000000000000000n, // 9,000,000 stETH
    );
    vi.mocked(sdk.dualGovernance.getDualGovernanceConfig).mockResolvedValueOnce({
      firstSealRageQuitSupport: 10000000000000000n,   // 1%
      secondSealRageQuitSupport: 100000000000000000n, // 10%
      minAssetsLockDuration: 86400n,
      vetoSignallingMinDuration: 259200n,
      vetoSignallingMaxDuration: 2592000n,
      vetoCooldownDuration: 172800n,
      rageQuitExtensionPeriodDuration: 604800n,
    });

    const result = await handleEstimateVetoImpact({ amount: "0.001" });
    const text = result.content[0].text;

    expect(text).toContain("Would trigger first seal: NO");
    expect(text).toContain("below first seal");
  });

  it("returns error for invalid amount format", async () => {
    const result = await handleEstimateVetoImpact({ amount: "not-a-number" });
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error for missing amount", async () => {
    const result = await handleEstimateVetoImpact({});
    expect(result).toHaveProperty("isError", true);
  });

  it("handles SDK failure gracefully", async () => {
    vi.mocked(sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress).mockRejectedValueOnce(
      new Error("RPC error")
    );
    const result = await handleEstimateVetoImpact({ amount: "10.0" });
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleGetVetoThresholds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns veto threshold information", async () => {
    const result = await handleGetVetoThresholds({});
    const text = result.content[0].text;

    expect(text).toContain("Dual Governance Veto Thresholds");
    expect(text).toContain("Current governance state:");
    expect(text).toContain("First Seal");
    expect(text).toContain("Second Seal");
    expect(text).toContain("Timing Configuration");
  });

  it("shows EXCEEDED status when first seal is exceeded", async () => {
    // firstSealPct = 10000000000000000 / 1e16 = 1%
    // Set currentSupportPercent to 2.0 which is > 1%
    vi.mocked(sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress).mockResolvedValueOnce({
      currentSupportPercent: 2.0,
    });
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowLockedAssets).mockResolvedValueOnce({
      totalStETHLockedShares: 180000000000000000000000n,
      totalStETHClaimedETH: 0n,
      totalUnstETHUnfinalizedShares: 0n,
      totalUnstETHFinalizedETH: 0n,
    });
    vi.mocked(sdk.dualGovernance.getTotalStETHSupply).mockResolvedValueOnce(
      9000000000000000000000000n,
    );
    vi.mocked(sdk.dualGovernance.getDualGovernanceConfig).mockResolvedValueOnce({
      firstSealRageQuitSupport: 10000000000000000n,
      secondSealRageQuitSupport: 100000000000000000n,
      minAssetsLockDuration: 86400n,
      vetoSignallingMinDuration: 259200n,
      vetoSignallingMaxDuration: 2592000n,
      vetoCooldownDuration: 172800n,
      rageQuitExtensionPeriodDuration: 604800n,
    });
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(2);

    const result = await handleGetVetoThresholds({});
    const text = result.content[0].text;

    expect(text).toContain("EXCEEDED");
    expect(text).toContain("First Seal");
  });

  it("handles SDK failure", async () => {
    vi.mocked(sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress).mockRejectedValueOnce(
      new Error("timeout")
    );
    const result = await handleGetVetoThresholds({});
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleGetGovernanceTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unified governance timeline", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(2n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce([] as any) // getMotions
      .mockResolvedValueOnce([false, false, 1700000000n, 17900000n, 500000000000000000n, 50000000000000000n, 0n, 0n, 0n, "0x"])
      .mockResolvedValueOnce([false, true, 1699900000n, 17800000n, 500000000000000000n, 50000000000000000n, 0n, 0n, 0n, "0x"]);

    const result = await handleGetGovernanceTimeline({});
    const text = result.content[0].text;

    expect(text).toContain("Unified Governance Timeline");
    expect(text).toContain("Dual Governance");
    expect(text).toContain("Aragon DAO Votes");
    expect(text).toContain("Easy Track Motions");
  });

  it("shows action items when votes are open", async () => {
    const now = Math.floor(Date.now() / 1000);

    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(1n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce([] as any) // getMotions
      .mockResolvedValueOnce([true, false, BigInt(now - 1000), 17900000n, 500000000000000000n, 50000000000000000n, 0n, 0n, 0n, "0x"]);

    const result = await handleGetGovernanceTimeline({});
    const text = result.content[0].text;

    expect(text).toContain("Vote #0: OPEN");
    expect(text).toContain("Action Items");
    expect(text).toContain("open Aragon vote");
  });

  it("handles SDK failure", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockRejectedValueOnce(
      new Error("network error")
    );
    const result = await handleGetGovernanceTimeline({});
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleGetGovernancePositionImpact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns position impact for default wallet", async () => {
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValueOnce(
      "0xEscrow0000000000000000000000000000000000" as `0x${string}`
    );
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 0n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });

    const result = await handleGetGovernancePositionImpact({});
    const text = result.content[0].text;

    expect(text).toContain("Governance Impact on Position");
    expect(text).toContain(`Address: ${MOCK_ADDRESS}`);
    expect(text).toContain("Risk level: NORMAL");
    expect(text).toContain("Position Summary");
    expect(text).toContain("Governance Context");
    expect(text).toContain("Withdrawal Queue Impact");
    expect(text).toContain("Recommendations");
  });

  it("shows CRITICAL risk level when in RageQuit state", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(5);
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValueOnce(
      "0xEscrow0000000000000000000000000000000000" as `0x${string}`
    );
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 1000000000000000000n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });

    const result = await handleGetGovernancePositionImpact({});
    const text = result.content[0].text;

    expect(text).toContain("Risk level: CRITICAL");
    expect(text).toContain("Rage quit is in progress");
  });

  it("shows MODERATE risk level in VetoSignalling", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(2);
    vi.mocked(sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress).mockResolvedValueOnce({
      currentSupportPercent: 1.0,
    });
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValueOnce(
      "0xEscrow0000000000000000000000000000000000" as `0x${string}`
    );
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 0n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });

    const result = await handleGetGovernancePositionImpact({});
    const text = result.content[0].text;

    expect(text).toContain("Risk level: MODERATE");
    expect(text).toContain("VetoSignalling");
  });

  it("shows LOW risk level in VetoCooldown state", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(4);
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValueOnce(
      "0xEscrow0000000000000000000000000000000000" as `0x${string}`
    );
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 0n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });

    const result = await handleGetGovernancePositionImpact({});
    const text = result.content[0].text;

    expect(text).toContain("Risk level: LOW");
    expect(text).toContain("cooldown");
  });

  it("shows HIGH risk level when VetoSignalling approaches second seal", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(2);
    // secondSealPct = 100000000000000000 / 1e16 = 10%
    // HIGH threshold = secondSealPct * 0.8 = 8%
    // Set currentSupportPercent to 8.5 which is >= 8%
    vi.mocked(sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress).mockResolvedValueOnce({
      currentSupportPercent: 8.5,
    });
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValueOnce(
      "0xEscrow0000000000000000000000000000000000" as `0x${string}`
    );
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 0n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });

    const result = await handleGetGovernancePositionImpact({});
    const text = result.content[0].text;

    expect(text).toContain("Risk level: HIGH");
    expect(text).toContain("approaching");
  });

  it("accepts custom address", async () => {
    const customAddr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValueOnce(
      "0xEscrow0000000000000000000000000000000000" as `0x${string}`
    );
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 0n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });

    const result = await handleGetGovernancePositionImpact({ address: customAddr });
    const text = result.content[0].text;

    expect(text).toContain(`Address: ${customAddr}`);
  });

  it("returns error for invalid address format", async () => {
    const result = await handleGetGovernancePositionImpact({ address: "invalid" });
    expect(result).toHaveProperty("isError", true);
  });

  it("handles escrow read failure gracefully", async () => {
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockRejectedValueOnce(
      new Error("escrow unavailable")
    );

    const result = await handleGetGovernancePositionImpact({});
    expect(result).not.toHaveProperty("isError");
    const text = result.content[0].text;
    expect(text).toContain("Locked in governance escrow: 0 stETH");
  });
});
