import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStakeEth } from "../../src/tools/stake.js";
import { publicClient, sdk, getAccountAddress } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

describe("handleStakeEth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(publicClient.getBalance).mockResolvedValue(10n * 10n ** 18n);
    vi.mocked(publicClient.getGasPrice).mockResolvedValue(20_000_000_000n);
    vi.mocked(getAccountAddress).mockReturnValue(MOCK_ADDRESS as `0x${string}`);
    vi.mocked(sdk.stake.stakeEthPopulateTx).mockResolvedValue({
      to: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
      from: MOCK_ADDRESS as `0x${string}`,
      value: 1000000000000000000n,
      data: "0xa1903eab",
    });
    vi.mocked(sdk.stake.stakeEthSimulateTx).mockResolvedValue(undefined as never);
    vi.mocked(sdk.stake.stakeEthEstimateGas).mockResolvedValue(100_000n);
    vi.mocked(sdk.stake.stakeEth).mockResolvedValue({
      hash: "0xmocktxhash",
      result: { stethReceived: 1000000000000000000n, sharesReceived: 900000000000000000n },
      confirmations: 1,
    } as never);
  });

  it("performs a dry run by default", async () => {
    const result = await handleStakeEth({ amount: "1.0" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("1.0 ETH");
  });

  it("dry run includes gas estimate and simulation result", async () => {
    const result = await handleStakeEth({ amount: "1.0" });
    const text = result.content[0].text;
    expect(text).toContain("Gas estimate");
    expect(text).toContain("Simulation: SUCCESS");
  });

  it("dry run with explicit dry_run=true", async () => {
    const result = await handleStakeEth({ amount: "2.0", dry_run: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("2.0 ETH");
  });

  it("dry run calls populate, simulate, and estimateGas SDK methods", async () => {
    await handleStakeEth({ amount: "1.0" });
    expect(sdk.stake.stakeEthPopulateTx).toHaveBeenCalled();
    expect(sdk.stake.stakeEthSimulateTx).toHaveBeenCalled();
    expect(sdk.stake.stakeEthEstimateGas).toHaveBeenCalled();
    expect(sdk.stake.stakeEth).not.toHaveBeenCalled();
  });

  it("executes staking when dry_run=false", async () => {
    const result = await handleStakeEth({ amount: "1.0", dry_run: false });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Stake Successful");
    expect(text).toContain("0xmocktxhash");
    expect(text).toContain("stETH received:");
    expect(text).toContain("Shares received:");
    expect(text).toContain("Confirmations: 1");
  });

  it("execute calls sdk.stake.stakeEth", async () => {
    await handleStakeEth({ amount: "1.0", dry_run: false });
    expect(sdk.stake.stakeEth).toHaveBeenCalledWith({
      value: 1000000000000000000n,
    });
  });

  it("returns error when ETH balance is insufficient", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValue(500000000000000000n);
    const result = await handleStakeEth({ amount: "1.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient ETH balance");
    expect(result.content[0].text).toContain("0.5");
  });

  it("returns error when balance is zero", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValue(0n);
    const result = await handleStakeEth({ amount: "0.01" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient ETH balance");
  });

  it("allows amounts within cap (cap is null in test config)", async () => {
    const result = await handleStakeEth({ amount: "5.0" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
  });

  it("accepts a valid referral address matching the wallet", async () => {
    const result = await handleStakeEth({
      amount: "1.0",
      dry_run: false,
      referral_address: MOCK_ADDRESS,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Stake Successful");
  });

  it("passes referral address to SDK", async () => {
    await handleStakeEth({
      amount: "1.0",
      dry_run: false,
      referral_address: MOCK_ADDRESS,
    });
    expect(sdk.stake.stakeEth).toHaveBeenCalledWith({
      value: 1000000000000000000n,
      referralAddress: MOCK_ADDRESS,
    });
  });

  it("rejects referral address that does not match the wallet (no allowlist configured)", async () => {
    const result = await handleStakeEth({
      amount: "1.0",
      referral_address: "0x0000000000000000000000000000000000000001",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not match the configured wallet address");
  });

  it("rejects missing amount", async () => {
    const result = await handleStakeEth({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects zero amount", async () => {
    const result = await handleStakeEth({ amount: "0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects negative amount", async () => {
    const result = await handleStakeEth({ amount: "-1.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects non-numeric amount", async () => {
    const result = await handleStakeEth({ amount: "abc" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects invalid referral address format", async () => {
    const result = await handleStakeEth({
      amount: "1.0",
      referral_address: "not-an-address",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects referral address with wrong length", async () => {
    const result = await handleStakeEth({
      amount: "1.0",
      referral_address: "0x1234",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK errors gracefully during execution", async () => {
    vi.mocked(sdk.stake.stakeEth).mockRejectedValue(new Error("execution reverted\nreason: STAKE_LIMIT"));
    const result = await handleStakeEth({ amount: "1.0", dry_run: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Staking limit reached");
  });

  it("handles paused protocol error", async () => {
    vi.mocked(sdk.stake.stakeEth).mockRejectedValue(new Error("PAUSED"));
    const result = await handleStakeEth({ amount: "1.0", dry_run: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("paused");
  });

  it("handles very small amounts", async () => {
    const result = await handleStakeEth({ amount: "0.000000000000000001" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
  });

  it("handles exact balance amount", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValue(1000000000000000000n);
    const result = await handleStakeEth({ amount: "1.0" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
  });

  it("handles amount exceeding 18 decimal places", async () => {
    const result = await handleStakeEth({ amount: "1.0000000000000000001" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });
});
