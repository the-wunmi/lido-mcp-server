import { describe, it, expect, vi } from "vitest";
import { handleGetStakingApr } from "../../src/tools/apr.js";
import { sdk } from "../../src/sdk-factory.js";

describe("handleGetStakingApr", () => {
  it("returns the current APR when no sma_days given", async () => {
    const result = await handleGetStakingApr({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Current Lido Staking APR:");
    expect(text).toContain("3.45%");
    expect(text).not.toContain("SMA APR");
  });

  it("returns both APR and SMA when sma_days is provided", async () => {
    const result = await handleGetStakingApr({ sma_days: 7 });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Current Lido Staking APR:");
    expect(text).toContain("3.45%");
    expect(text).toContain("7-day SMA APR:");
    expect(text).toContain("3.30%");
  });

  it("returns SMA for 30-day period", async () => {
    vi.mocked(sdk.statistics.apr.getSmaApr).mockResolvedValueOnce(3.15);

    const result = await handleGetStakingApr({ sma_days: 30 });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("30-day SMA APR:");
    expect(text).toContain("3.15%");
  });

  it("returns error for sma_days = 0 (below min of 1)", async () => {
    const result = await handleGetStakingApr({ sma_days: 0 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for sma_days = 366 (above max of 365)", async () => {
    const result = await handleGetStakingApr({ sma_days: 366 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for non-integer sma_days", async () => {
    const result = await handleGetStakingApr({ sma_days: 7.5 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for string sma_days", async () => {
    const result = await handleGetStakingApr({ sma_days: "seven" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK error from getLastApr", async () => {
    vi.mocked(sdk.statistics.apr.getLastApr).mockRejectedValueOnce(
      new Error("APR fetch failed"),
    );

    const result = await handleGetStakingApr({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("APR fetch failed");
  });

  it("handles SDK error from getSmaApr", async () => {
    vi.mocked(sdk.statistics.apr.getSmaApr).mockRejectedValueOnce(
      new Error("SMA fetch failed"),
    );

    const result = await handleGetStakingApr({ sma_days: 7 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("SMA fetch failed");
  });

  it("accepts sma_days at boundary value 1", async () => {
    const result = await handleGetStakingApr({ sma_days: 1 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("1-day SMA APR:");
  });

  it("accepts sma_days at boundary value 365", async () => {
    const result = await handleGetStakingApr({ sma_days: 365 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("365-day SMA APR:");
  });
});
