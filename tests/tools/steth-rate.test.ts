import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCheckStethRate } from "../../src/tools/steth-rate.js";
import { sdk } from "../../src/sdk-factory.js";

function ensureMocks() {
  if (!(sdk as any).shares) {
    (sdk as any).shares = {};
  }
  if (!(sdk as any).shares.getShareRate) {
    (sdk as any).shares.getShareRate = vi.fn();
  }
  if (!(sdk as any).shares.getTotalSupply) {
    (sdk as any).shares.getTotalSupply = vi.fn();
  }
  if (!(sdk.wrap as any).convertStethToWsteth) {
    (sdk.wrap as any).convertStethToWsteth = vi.fn();
  }
  if (!(sdk.wrap as any).convertWstethToSteth) {
    (sdk.wrap as any).convertWstethToSteth = vi.fn();
  }
}

describe("handleCheckStethRate", () => {
  beforeEach(() => {
    ensureMocks();

    vi.mocked((sdk as any).shares.getShareRate).mockResolvedValue(1.1234);
    vi.mocked((sdk as any).shares.getTotalSupply).mockResolvedValue({
      totalEther: 9_000_000n * 10n ** 18n,
      totalShares: 8_000_000n * 10n ** 18n,
    });
    vi.mocked((sdk.wrap as any).convertStethToWsteth).mockResolvedValue(
      850000000000000000n,
    );
    vi.mocked((sdk.wrap as any).convertWstethToSteth).mockResolvedValue(
      1176000000000000000n,
    );
  });

  it("returns full stETH rate info", async () => {
    const result = await handleCheckStethRate({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("stETH Protocol Rate");
    expect(text).toContain("Share Rate:");
    expect(text).toContain("1 share =");
    expect(text).toContain("Protocol rate:");
    expect(text).toContain("Pool Composition:");
    expect(text).toContain("Total pooled ETH:");
    expect(text).toContain("Total shares:");
    expect(text).toContain("Conversion Rates:");
    expect(text).toContain("1 stETH");
    expect(text).toContain("wstETH");
    expect(text).toContain("1 wstETH");
    expect(text).toContain("stETH");
    expect(text).toContain("What This Means:");
  });

  it("handles zero shares (uninitialized protocol)", async () => {
    vi.mocked((sdk as any).shares.getTotalSupply).mockResolvedValueOnce({
      totalEther: 0n,
      totalShares: 0n,
    });

    const result = await handleCheckStethRate({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("zero shares");
    expect(text).toContain("not be initialized");
  });

  it("computes protocol rate from total ether and shares", async () => {
    const result = await handleCheckStethRate({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("1.12500000");
  });

  it("handles SDK error from getShareRate", async () => {
    vi.mocked((sdk as any).shares.getShareRate).mockRejectedValueOnce(
      new Error("share rate error"),
    );

    const result = await handleCheckStethRate({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("share rate error");
  });

  it("handles SDK error from getTotalSupply", async () => {
    vi.mocked((sdk as any).shares.getTotalSupply).mockRejectedValueOnce(
      new Error("total supply error"),
    );

    const result = await handleCheckStethRate({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("total supply error");
  });

  it("handles SDK error from convertStethToWsteth", async () => {
    vi.mocked((sdk.wrap as any).convertStethToWsteth).mockRejectedValueOnce(
      new Error("conversion error"),
    );

    const result = await handleCheckStethRate({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("conversion error");
  });

  it("accepts any args (no schema validation needed)", async () => {
    const result = await handleCheckStethRate({ foo: "bar", baz: 123 });
    expect(result.isError).toBeUndefined();
  });
});
