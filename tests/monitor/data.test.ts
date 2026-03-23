import { describe, it, expect, vi, beforeEach } from "vitest";

// Unmock data.js so we can test the real implementation
vi.unmock("../../src/monitor/data.js");

// Mock global fetch for API calls (fetchMellowVaultApy, fetchStethBenchmark)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { computeApr, fetchMellowVaultApr, fetchMellowVaults, fetchStethBenchmark, clearMellowCache, readVaultOnChain, isMellowCoreVault, getAllMellowCoreVaults } from "../../src/monitor/data.js";
import { getMainnetClient } from "../../src/monitor/mainnet-client.js";

describe("computeApr", () => {
  it("returns null when previousSharePrice is 0", () => {
    expect(computeApr(10n ** 18n, 0n, 86400)).toBeNull();
  });

  it("returns null when elapsedSeconds is 0", () => {
    expect(computeApr(10n ** 18n, 10n ** 18n, 0)).toBeNull();
  });

  it("returns null when elapsedSeconds is negative", () => {
    expect(computeApr(10n ** 18n, 10n ** 18n, -100)).toBeNull();
  });

  it("returns null for elapsed < 3600s (minimum threshold)", () => {
    const previous = 10n ** 18n;
    const current = 101n * 10n ** 16n; // 1.01
    // 1800 seconds is below the 3600s minimum
    expect(computeApr(current, previous, 1800)).toBeNull();
  });

  it("computes positive APY correctly", () => {
    // 0.01% gain over 1 day -> ~3.65% annualized (within sanity bounds)
    const previous = 10n ** 18n; // 1.0
    const current = 10001n * 10n ** 14n; // 1.0001
    const elapsed = 86400; // 1 day

    const apy = computeApr(current, previous, elapsed);
    expect(apy).not.toBeNull();
    expect(apy!).toBeCloseTo(3.6525, 0);
  });

  it("computes negative APY when share price decreases", () => {
    // 0.01% loss over 1 day -> ~-3.65% annualized (within sanity bounds)
    const previous = 10n ** 18n;
    const current = 9999n * 10n ** 14n; // 0.9999
    const elapsed = 86400;

    const apy = computeApr(current, previous, elapsed);
    expect(apy).not.toBeNull();
    expect(apy!).toBeLessThan(0);
  });

  it("returns 0 APY when share price is unchanged", () => {
    const price = 10n ** 18n;
    const apy = computeApr(price, price, 86400);
    expect(apy).toBe(0);
  });

  it("scales correctly for longer periods", () => {
    // 0.01% gain — stays within sanity bounds for both periods
    const previous = 10n ** 18n;
    const current = 10001n * 10n ** 14n; // 0.01% gain
    const oneDay = computeApr(current, previous, 86400)!;
    const oneWeek = computeApr(current, previous, 86400 * 7)!;

    // Same absolute gain over 7x longer period -> ~7x lower annualized APY
    expect(oneDay / oneWeek).toBeCloseTo(7, 0);
  });

  it("returns null for extreme APR values (sanity bounds)", () => {
    // 1% gain over 1 day -> ~365% annualized, exceeds MAX_REASONABLE_APR_PCT
    const previous = 10n ** 18n;
    const current = 101n * 10n ** 16n; // 1.01
    const elapsed = 86400;

    expect(computeApr(current, previous, elapsed)).toBeNull();
  });
});

describe("fetchMellowVaultApr", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearMellowCache();
  });

  it("returns API value directly (already in percentage form)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e", apr: 3.5 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBeCloseTo(3.5);
  });

  it("prefers apr field over apy field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e", apr: 2.5, apy: 5.0 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBeCloseTo(2.5);
  });

  it("rejects APY > 100% (sanity cap returns null)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e", apr: 150.0 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBeNull();
  });

  it("allows small negative APR values (temporary yield loss)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e", apr: -1.0 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBe(-1.0);
  });

  it("rejects APR below -20% (sanity floor)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e", apr: -25.0 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBeNull();
  });

  it("returns null for address not found in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x6a37725ca7f4CE81c004c955f7280d5C704a249e", apr: 3.0 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x0000000000000000000000000000000000000000");
    expect(result).toBeNull();
    // Now fetches from API (no whitelist) and returns null when address not found
    expect(mockFetch).toHaveBeenCalled();
  });

  it("returns APR for address present in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x6a37725ca7f4CE81c004c955f7280d5C704a249e", apr: 2.88 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x6a37725ca7f4CE81c004c955f7280d5C704a249e");
    expect(result).toBeCloseTo(2.88);
  });

  it("returns null on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBeNull();
  });

  it("returns null on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBeNull();
  });

  it("returns null when vault not found in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x9999999999999999999999999999999999999999", apy: 0.05 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBeNull();
  });

  it("handles case-insensitive address matching", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x82dc3260f599f4fc4307209a1e3b53ddca4c585e", apr: 4.0 },
      ]),
    });

    const result = await fetchMellowVaultApr("0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(result).toBeCloseTo(4.0);
  });
});

describe("fetchStethBenchmark", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("success path returns stethApr", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { smaApr: 3.25 } }),
    });

    const result = await fetchStethBenchmark();
    expect(result.stethApr).toBe(3.25);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("failure path returns null stethApr on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await fetchStethBenchmark();
    expect(result.stethApr).toBeNull();
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("failure path returns null stethApr on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));

    const result = await fetchStethBenchmark();
    expect(result.stethApr).toBeNull();
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("returns null when data.smaApr is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    });

    const result = await fetchStethBenchmark();
    expect(result.stethApr).toBeNull();
  });
});

describe("isMellowCoreVault", () => {
  it("returns true for earnETH address", () => {
    expect(isMellowCoreVault("0x6a37725ca7f4CE81c004c955f7280d5C704a249e")).toBe(true);
  });

  it("returns true for earnUSD address", () => {
    expect(isMellowCoreVault("0x014e6DA8F283C4aF65B2AA0f201438680A004452")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMellowCoreVault("0x6a37725ca7f4ce81c004c955f7280d5c704a249e")).toBe(true);
  });

  it("returns false for unknown vaults", () => {
    expect(isMellowCoreVault("0x0000000000000000000000000000000000000000")).toBe(false);
  });
});

describe("getAllMellowCoreVaults", () => {
  it("returns all known Mellow Core vaults (strETH, earnETH, earnUSD)", () => {
    const configs = getAllMellowCoreVaults();
    expect(configs).toHaveLength(3);
    const symbols = configs.map((c) => c.assetSymbol).sort();
    expect(symbols).toEqual(["USDC", "WETH", "WETH"]);
  });
});

describe("readVaultOnChain (Mellow Core)", () => {
  const EARN_ETH = "0x6a37725ca7f4CE81c004c955f7280d5C704a249e" as `0x${string}`;
  const EARN_USD = "0x014e6DA8F283C4aF65B2AA0f201438680A004452" as `0x${string}`;

  it("reads Core Vault data via shareManager + oracle multicall", async () => {
    const client = getMainnetClient();
    const priceD18 = 10n ** 18n; // 1.0 share price (18-dec)
    const totalShares = 1000n * 10n ** 18n;

    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: totalShares },
      { status: "success", result: "Earn ETH" },
      { status: "success", result: "earnETH" },
      { status: "success", result: 18 },
      { status: "success", result: [priceD18, 1700000000, false] as readonly [bigint, number, boolean] },
    ]);

    const result = await readVaultOnChain(EARN_ETH, "mellow_core");

    expect(result.name).toBe("Earn ETH");
    expect(result.symbol).toBe("earnETH");
    expect(result.assetDecimals).toBe(18);
    expect(result.assetSymbol).toBe("WETH");
    // sharePrice = priceD18 for 18-dec assets
    expect(result.sharePrice).toBe(priceD18);
    // TVL = totalShares * priceD18 / 1e18 = 1000 * 1e18
    expect(result.totalAssets).toBe(1000n * 10n ** 18n);
  });

  it("converts priceD18 to 6-dec for USDC (earnUSD)", async () => {
    const client = getMainnetClient();
    // priceD18 = 1.0 (1e18) means 1 share = 1 USDC
    const priceD18 = 10n ** 18n;
    const totalShares = 1000n * 10n ** 18n;

    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: totalShares },
      { status: "success", result: "Earn USD" },
      { status: "success", result: "earnUSD" },
      { status: "success", result: 18 },
      { status: "success", result: [priceD18, 1700000000, false] as readonly [bigint, number, boolean] },
    ]);

    const result = await readVaultOnChain(EARN_USD, "mellow_core");

    expect(result.assetDecimals).toBe(6);
    expect(result.assetSymbol).toBe("USDC");
    // sharePrice = priceD18 / 1e12 = 1e6 (1.0 USDC)
    expect(result.sharePrice).toBe(10n ** 6n);
    // TVL = 1000 * 1e6 USDC
    expect(result.totalAssets).toBe(1000n * 10n ** 6n);
  });

  it("auto-detects Core Vault without explicit vaultType", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: 500n * 10n ** 18n },
      { status: "success", result: "Earn ETH" },
      { status: "success", result: "earnETH" },
      { status: "success", result: 18 },
      { status: "success", result: [10n ** 18n, 1700000000, false] as readonly [bigint, number, boolean] },
    ]);

    const result = await readVaultOnChain(EARN_ETH);

    expect(result.name).toBe("Earn ETH");
    expect(result.assetSymbol).toBe("WETH");
  });

  it("throws on totalShares failure instead of returning 0", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "failure", error: new Error("revert") },
      { status: "success", result: "Earn ETH" },
      { status: "success", result: "earnETH" },
      { status: "success", result: 18 },
      { status: "success", result: [10n ** 18n, 1700000000, false] as readonly [bigint, number, boolean] },
    ]);

    await expect(readVaultOnChain(EARN_ETH, "mellow_core")).rejects.toThrow("totalShares()");
  });

  it("throws on oracle failure instead of returning 0", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: 1000n * 10n ** 18n },
      { status: "success", result: "Earn ETH" },
      { status: "success", result: "earnETH" },
      { status: "success", result: 18 },
      { status: "failure", error: new Error("revert") },
    ]);

    await expect(readVaultOnChain(EARN_ETH, "mellow_core")).rejects.toThrow("oracle.getReport()");
  });

  it("throws when oracle reports suspicious price", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: 1000n * 10n ** 18n },
      { status: "success", result: "Earn ETH" },
      { status: "success", result: "earnETH" },
      { status: "success", result: 18 },
      { status: "success", result: [10n ** 18n, 1700000000, true] as readonly [bigint, number, boolean] },
    ]);

    await expect(readVaultOnChain(EARN_ETH, "mellow_core")).rejects.toThrow("suspicious");
  });

  it("throws when oracle returns zero price", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: 1000n * 10n ** 18n },
      { status: "success", result: "Earn ETH" },
      { status: "success", result: "earnETH" },
      { status: "success", result: 18 },
      { status: "success", result: [0n, 1700000000, false] as readonly [bigint, number, boolean] },
    ]);

    await expect(readVaultOnChain(EARN_ETH, "mellow_core")).rejects.toThrow("zero price");
  });
});

