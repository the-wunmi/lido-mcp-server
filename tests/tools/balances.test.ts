import { describe, it, expect, vi } from "vitest";
import { handleGetBalances } from "../../src/tools/balances.js";
import { publicClient, sdk } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

describe("handleGetBalances", () => {
  it("returns balances for the default wallet when no address given", async () => {
    const result = await handleGetBalances({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Balances for ${MOCK_ADDRESS}`);
    expect(text).toContain("ETH:");
    expect(text).toContain("stETH:");
    expect(text).toContain("wstETH:");
    expect(text).toContain("10");
    expect(text).toContain("5");
    expect(text).toContain("3");
  });

  it("returns balances for a specified address", async () => {
    const customAddr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const result = await handleGetBalances({ address: customAddr });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Balances for ${customAddr}`);
  });

  it("returns error for invalid address format", async () => {
    const result = await handleGetBalances({ address: "not-an-address" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for address too short", async () => {
    const result = await handleGetBalances({ address: "0x1234" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK error from getBalance", async () => {
    vi.mocked(publicClient.getBalance).mockRejectedValueOnce(
      new Error("RPC connection failed"),
    );

    const result = await handleGetBalances({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("RPC connection failed");
  });

  it("handles SDK error from steth.balance", async () => {
    vi.mocked(sdk.steth.balance).mockRejectedValueOnce(
      new Error("steth balance call failed"),
    );

    const result = await handleGetBalances({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("steth balance call failed");
  });

  it("handles SDK error from wsteth.balance", async () => {
    vi.mocked(sdk.wsteth.balance).mockRejectedValueOnce(
      new Error("wsteth balance call failed"),
    );

    const result = await handleGetBalances({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("wsteth balance call failed");
  });

  it("displays zero balances correctly", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(0n);
    vi.mocked(sdk.steth.balance).mockResolvedValueOnce(0n);
    vi.mocked(sdk.wsteth.balance).mockResolvedValueOnce(0n);

    const result = await handleGetBalances({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("ETH:    0");
    expect(text).toContain("stETH:  0");
    expect(text).toContain("wstETH: 0");
  });

  it("accepts extra unknown properties without error (stripped by zod)", async () => {
    const result = await handleGetBalances({ foo: "bar" });
    expect(result.isError).toBeUndefined();
  });
});
