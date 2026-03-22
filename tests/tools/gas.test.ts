import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCheckGasConditions } from "../../src/tools/gas.js";
import { publicClient, sdk } from "../../src/sdk-factory.js";

describe("handleCheckGasConditions", () => {
  beforeEach(() => {
    vi.mocked(publicClient.getGasPrice).mockResolvedValue(20_000_000_000n);
  });

  it("returns gas conditions with default stake_amount", async () => {
    const result = await handleCheckGasConditions({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Gas Conditions");
    expect(text).toContain("20.00 Gwei");
    expect(text).toContain("Low");
    expect(text).toContain("Estimated costs at current gas price:");
    expect(text).toContain("Stake ETH");
    expect(text).toContain("Wrap stETH");
    expect(text).toContain("Unwrap wstETH");
    expect(text).toContain("Request withdrawal");
    expect(text).toContain("Claim withdrawal");
  });

  it("returns gas conditions with custom stake_amount", async () => {
    const result = await handleCheckGasConditions({ stake_amount: "5.0" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Break-even analysis for staking 5.0 ETH:");
    expect(text).toContain("Gas cost:");
    expect(text).toContain("Current APR:");
    expect(text).toContain("Daily yield:");
    expect(text).toContain("Days to recoup gas:");
  });

  it("shows Very Low tier for gas < 10 gwei", async () => {
    vi.mocked(publicClient.getGasPrice).mockResolvedValueOnce(5_000_000_000n);

    const result = await handleCheckGasConditions({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Very Low");
    expect(result.content[0].text).toContain("Excellent time");
  });

  it("shows Moderate tier for gas 25-50 gwei", async () => {
    vi.mocked(publicClient.getGasPrice).mockResolvedValueOnce(35_000_000_000n);

    const result = await handleCheckGasConditions({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Moderate");
    expect(result.content[0].text).toContain("Consider waiting");
  });

  it("shows High tier for gas 50-100 gwei", async () => {
    vi.mocked(publicClient.getGasPrice).mockResolvedValueOnce(75_000_000_000n);

    const result = await handleCheckGasConditions({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("High");
  });

  it("shows Very High tier for gas >= 100 gwei", async () => {
    vi.mocked(publicClient.getGasPrice).mockResolvedValueOnce(150_000_000_000n);

    const result = await handleCheckGasConditions({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Very High");
    expect(result.content[0].text).toContain("Strongly recommend waiting");
  });

  it("falls back to conservative gas estimate when stakeEthEstimateGas fails", async () => {
    vi.mocked(sdk.stake.stakeEthEstimateGas).mockRejectedValueOnce(
      new Error("estimate failed"),
    );

    const result = await handleCheckGasConditions({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("conservative estimate");
  });

  it("returns error for invalid stake_amount format", async () => {
    const result = await handleCheckGasConditions({ stake_amount: "abc" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for negative stake_amount", async () => {
    const result = await handleCheckGasConditions({ stake_amount: "-1.0" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles getGasPrice SDK error", async () => {
    vi.mocked(publicClient.getGasPrice).mockRejectedValueOnce(
      new Error("gas price error"),
    );

    const result = await handleCheckGasConditions({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("gas price error");
  });

  it("includes break-even analysis with APR warning for small stakes", async () => {
    vi.mocked(publicClient.getGasPrice).mockResolvedValueOnce(100_000_000_000n);

    const result = await handleCheckGasConditions({ stake_amount: "0.01" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Break-even analysis");
  });

  it("skips break-even analysis when getLastApr fails", async () => {
    vi.mocked(sdk.statistics.apr.getLastApr).mockRejectedValueOnce(
      new Error("APR unavailable"),
    );

    const result = await handleCheckGasConditions({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Gas Conditions");
    expect(text).not.toContain("Break-even analysis");
  });
});
