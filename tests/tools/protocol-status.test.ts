import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGetProtocolStatus } from "../../src/tools/protocol-status.js";
import { sdk } from "../../src/sdk-factory.js";
import type { ToolResult } from "../../src/types.js";

function ensureMocks() {
  if (!sdk.stake.getStakeLimitInfo) {
    (sdk.stake as any).getStakeLimitInfo = vi.fn();
  }
  if (!sdk.withdraw.views.isPaused) {
    (sdk.withdraw.views as any).isPaused = vi.fn();
  }
  if (!sdk.withdraw.views.isBunkerModeActive) {
    (sdk.withdraw.views as any).isBunkerModeActive = vi.fn();
  }
  if (!sdk.withdraw.views.isTurboModeActive) {
    (sdk.withdraw.views as any).isTurboModeActive = vi.fn();
  }
  if (!sdk.withdraw.views.minStethWithdrawalAmount) {
    (sdk.withdraw.views as any).minStethWithdrawalAmount = vi.fn();
  }
  if (!sdk.withdraw.views.maxStethWithdrawalAmount) {
    (sdk.withdraw.views as any).maxStethWithdrawalAmount = vi.fn();
  }
  if (!sdk.withdraw.views.getUnfinalizedStETH) {
    (sdk.withdraw.views as any).getUnfinalizedStETH = vi.fn();
  }
  if (!(sdk as any).shares) {
    (sdk as any).shares = {};
  }
  if (!((sdk as any).shares as any).getTotalSupply) {
    (sdk as any).shares.getTotalSupply = vi.fn();
  }
}

function setDefaultMockReturns() {
  vi.mocked((sdk.stake as any).getStakeLimitInfo).mockResolvedValue({
    isStakingPaused: false,
    isStakingLimitSet: true,
    currentStakeLimit: 150000n * 10n ** 18n,
    maxStakeLimit: 150000n * 10n ** 18n,
  });
  vi.mocked((sdk.withdraw.views as any).isPaused).mockResolvedValue(false);
  vi.mocked((sdk.withdraw.views as any).isBunkerModeActive).mockResolvedValue(false);
  vi.mocked((sdk.withdraw.views as any).isTurboModeActive).mockResolvedValue(true);
  vi.mocked((sdk.withdraw.views as any).minStethWithdrawalAmount).mockResolvedValue(
    100000000000000n,
  );
  vi.mocked((sdk.withdraw.views as any).maxStethWithdrawalAmount).mockResolvedValue(
    1000n * 10n ** 18n,
  );
  vi.mocked((sdk.withdraw.views as any).getUnfinalizedStETH).mockResolvedValue(
    500n * 10n ** 18n,
  );
  vi.mocked((sdk as any).shares.getTotalSupply).mockResolvedValue({
    totalEther: 9_000_000n * 10n ** 18n,
    totalShares: 8_000_000n * 10n ** 18n,
  });
}

describe("handleGetProtocolStatus", () => {
  beforeEach(() => {
    ensureMocks();
    setDefaultMockReturns();
  });

  it("returns full protocol status in normal operation", async () => {
    const result = await handleGetProtocolStatus({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Lido Protocol Status");
    expect(text).toContain("Total Value Locked (TVL):");
    expect(text).toContain("Staking paused: false");
    expect(text).toContain("Stake limit set: true");
    expect(text).toContain("Mode: Turbo");
    expect(text).toContain("Min withdrawal:");
    expect(text).toContain("Max withdrawal:");
    expect(text).toContain("Unfinalized stETH:");
  });

  it("shows PAUSED mode when isPaused is true", async () => {
    vi.mocked((sdk.withdraw.views as any).isPaused).mockResolvedValueOnce(true);

    const result = await handleGetProtocolStatus({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Mode: PAUSED");
  });

  it("shows Bunker mode when isBunker is true", async () => {
    vi.mocked((sdk.withdraw.views as any).isBunkerModeActive).mockResolvedValueOnce(true);
    vi.mocked((sdk.withdraw.views as any).isTurboModeActive).mockResolvedValueOnce(false);

    const result = await handleGetProtocolStatus({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Mode: Bunker");
  });

  it("shows Normal mode when neither paused, bunker, nor turbo", async () => {
    vi.mocked((sdk.withdraw.views as any).isTurboModeActive).mockResolvedValueOnce(false);

    const result = await handleGetProtocolStatus({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Mode: Normal");
  });

  it("handles SDK error from getStakeLimitInfo", async () => {
    vi.mocked((sdk.stake as any).getStakeLimitInfo).mockRejectedValueOnce(
      new Error("stake limit error"),
    );

    const result = await handleGetProtocolStatus({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("stake limit error");
  });

  it("handles SDK error from getTotalSupply", async () => {
    vi.mocked((sdk as any).shares.getTotalSupply).mockRejectedValueOnce(
      new Error("total supply error"),
    );

    const result = await handleGetProtocolStatus({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("total supply error");
  });
});
