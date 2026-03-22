import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGetGovernanceState, handleGetVotingPower } from "../../src/tools/governance.js";
import { sdk, publicClient } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

describe("handleGetGovernanceState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns governance state with default warning threshold", async () => {
    const result = await handleGetGovernanceState({});
    const text = result.content[0].text;

    expect(text).toContain("Lido Dual Governance State");
    expect(text).toContain("State: Normal");
    expect(text).toContain("Warning status: Normal");
    expect(text).toContain("threshold: 50%");
    expect(text).toContain("Veto signalling support:");
    expect(text).toContain("Escrow Details:");
    expect(text).toContain("Total stETH supply:");
    expect(text).toContain("Governance Configuration:");
  });

  it("respects custom warning_threshold", async () => {
    const result = await handleGetGovernanceState({ warning_threshold: 30 });
    const text = result.content[0].text;

    expect(text).toContain("threshold: 30%");
    expect(vi.mocked(sdk.dualGovernance.getGovernanceWarningStatus)).toHaveBeenCalledWith({
      triggerPercent: 30,
    });
  });

  it("returns error for invalid warning_threshold (>100)", async () => {
    const result = await handleGetGovernanceState({ warning_threshold: 150 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for invalid warning_threshold (<0)", async () => {
    const result = await handleGetGovernanceState({ warning_threshold: -5 });
    expect(result).toHaveProperty("isError", true);
  });

  it("handles SDK errors gracefully", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockRejectedValueOnce(
      new Error("RPC failed")
    );
    const result = await handleGetGovernanceState({});
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("RPC failed");
  });

  it("shows VetoSignalling state when state is 2", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(2);
    const result = await handleGetGovernanceState({});
    const text = result.content[0].text;
    expect(text).toContain("State: VetoSignalling");
  });

  it("shows RageQuit state when state is 5", async () => {
    vi.mocked(sdk.dualGovernance.getDualGovernanceState).mockResolvedValueOnce(5);
    const result = await handleGetGovernanceState({});
    const text = result.content[0].text;
    expect(text).toContain("State: RageQuit");
  });
});

describe("handleGetVotingPower", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns voting power for default wallet address", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(
      2000000000000000000n, // 2 LDO
    );
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValueOnce(
      "0xEscrow0000000000000000000000000000000000" as `0x${string}`
    );
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 500000000000000000n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });

    const result = await handleGetVotingPower({});
    const text = result.content[0].text;

    expect(text).toContain("Governance Voting Power");
    expect(text).toContain(`Address: ${MOCK_ADDRESS}`);
    expect(text).toContain("LDO balance:");
    expect(text).toContain("Free stETH:");
    expect(text).toContain("wstETH:");
    expect(text).toContain("Total veto power:");
    expect(text).toContain("You can participate in Aragon voting");
    expect(text).toContain("You can lock stETH for Dual Governance");
  });

  it("uses provided address instead of default wallet", async () => {
    const customAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockResolvedValueOnce(
      "0xEscrow0000000000000000000000000000000000" as `0x${string}`
    );
    vi.mocked(publicClient.readContract).mockResolvedValueOnce({
      unstETHIdsCount: 0n,
      stETHLockedShares: 0n,
      unstETHLockedShares: 0n,
      lastAssetsLockTimestamp: 0n,
    });
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(0n);
    vi.mocked(sdk.wsteth.balance).mockResolvedValueOnce(0n);

    const result = await handleGetVotingPower({ address: customAddress });
    const text = result.content[0].text;

    expect(text).toContain(`Address: ${customAddress}`);
    expect(text).toContain("No governance power detected");
  });

  it("returns error for invalid address format", async () => {
    const result = await handleGetVotingPower({ address: "not-an-address" });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles escrow read failure gracefully (lockedShares = 0)", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(
      1000000000000000000n, // 1 LDO
    );
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockRejectedValueOnce(
      new Error("Escrow unavailable")
    );

    const result = await handleGetVotingPower({});
    const text = result.content[0].text;

    expect(result).not.toHaveProperty("isError");
    expect(text).toContain("Locked in escrow: 0 stETH");
  });

  it("shows no governance power message when all balances are zero", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(0n);
    vi.mocked(sdk.wsteth.balance).mockResolvedValueOnce(0n);
    vi.mocked(sdk.dualGovernance.getVetoSignallingEscrowAddress).mockRejectedValueOnce(
      new Error("no escrow"),
    );

    const result = await handleGetVotingPower({});
    const text = result.content[0].text;

    expect(text).toContain("No governance power detected");
    expect(text).toContain("Get LDO with lido_swap_eth_for_ldo");
  });
});
