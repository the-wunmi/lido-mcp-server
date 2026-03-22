import { describe, it, expect, vi } from "vitest";
import { handleConvertAmounts } from "../../src/tools/convert.js";
import { sdk } from "../../src/sdk-factory.js";

function ensureMocks() {
  if (!(sdk.wrap as any).convertStethToWsteth) {
    (sdk.wrap as any).convertStethToWsteth = vi.fn();
  }
  if (!(sdk.wrap as any).convertWstethToSteth) {
    (sdk.wrap as any).convertWstethToSteth = vi.fn();
  }
}

describe("handleConvertAmounts", () => {
  beforeAll(() => {
    ensureMocks();
  });

  beforeEach(() => {
    vi.mocked((sdk.wrap as any).convertStethToWsteth).mockResolvedValue(
      850000000000000000n,
    );
    vi.mocked((sdk.wrap as any).convertWstethToSteth).mockResolvedValue(
      1176000000000000000n,
    );
  });

  it("converts steth_to_wsteth", async () => {
    const result = await handleConvertAmounts({
      amount: "1.0",
      direction: "steth_to_wsteth",
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("1.0 stETH =");
    expect(text).toContain("wstETH");
    expect(text).toContain("at current rate");
  });

  it("converts wsteth_to_steth", async () => {
    const result = await handleConvertAmounts({
      amount: "1.0",
      direction: "wsteth_to_steth",
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("1.0 wstETH =");
    expect(text).toContain("stETH");
    expect(text).toContain("at current rate");
  });

  it("converts fractional amounts", async () => {
    const result = await handleConvertAmounts({
      amount: "0.5",
      direction: "steth_to_wsteth",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("0.5 stETH =");
  });

  it("returns error when amount is missing", async () => {
    const result = await handleConvertAmounts({ direction: "steth_to_wsteth" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error when direction is missing", async () => {
    const result = await handleConvertAmounts({ amount: "1.0" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for invalid direction", async () => {
    const result = await handleConvertAmounts({
      amount: "1.0",
      direction: "eth_to_steth",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for zero amount", async () => {
    const result = await handleConvertAmounts({
      amount: "0",
      direction: "steth_to_wsteth",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for negative amount", async () => {
    const result = await handleConvertAmounts({
      amount: "-1.0",
      direction: "steth_to_wsteth",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for non-numeric amount", async () => {
    const result = await handleConvertAmounts({
      amount: "abc",
      direction: "steth_to_wsteth",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK error from convertStethToWsteth", async () => {
    vi.mocked((sdk.wrap as any).convertStethToWsteth).mockRejectedValueOnce(
      new Error("conversion failed"),
    );

    const result = await handleConvertAmounts({
      amount: "1.0",
      direction: "steth_to_wsteth",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("conversion failed");
  });

  it("handles SDK error from convertWstethToSteth", async () => {
    vi.mocked((sdk.wrap as any).convertWstethToSteth).mockRejectedValueOnce(
      new Error("reverse conversion failed"),
    );

    const result = await handleConvertAmounts({
      amount: "1.0",
      direction: "wsteth_to_steth",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("reverse conversion failed");
  });
});
