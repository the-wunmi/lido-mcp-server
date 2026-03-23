import { describe, it, expect, vi } from "vitest";
import { computeAllocationShift, readAllocations } from "../../src/monitor/allocations.js";
import { hasKnownRegistry } from "../../src/monitor/vault-registry.js";
import { getMainnetClient } from "../../src/monitor/mainnet-client.js";
import type { ProtocolAllocation } from "../../src/monitor/types.js";
import type { Address } from "viem";

const STRETH_VAULT: Address = "0x277C6A642564A91ff78b008022D65683cEE5CCC5";
const EARN_ETH_VAULT: Address = "0x6a37725ca7f4CE81c004c955f7280d5C704a249e";
const EARN_USD_VAULT: Address = "0x014e6DA8F283C4aF65B2AA0f201438680A004452";
const UNKNOWN_VAULT: Address = "0x0000000000000000000000000000000000000000";
const BLOCK_NUMBER = 18000000n;

describe("readAllocations", () => {
  it("returns null for unknown vault addresses", async () => {
    const result = await readAllocations(UNKNOWN_VAULT, BLOCK_NUMBER);
    expect(result).toBeNull();
  });

  it("returns allocation percentages from subvault riskManager.subvaultState (strETH is Core Vault)", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: [500n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },  // Aave
      { status: "success", result: [300n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },  // Morpho
      { status: "success", result: [100n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },  // Pendle
      { status: "success", result: [50n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },   // Gearbox
      { status: "success", result: [30n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },   // Maple
      { status: "success", result: [10n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },   // Reserve
      { status: "success", result: [5n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },    // Ethena
      { status: "success", result: [5n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },    // DVstETH
    ]);

    const result = await readAllocations(STRETH_VAULT, BLOCK_NUMBER);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(8);

    // Sorted descending by percentage
    expect(result![0].protocol).toBe("Aave");
    expect(result![0].percentage).toBe(50);

    expect(result![1].protocol).toBe("Morpho");
    expect(result![1].percentage).toBe(30);

    expect(result![2].protocol).toBe("Pendle");
    expect(result![2].percentage).toBe(10);
  });

  it("returns empty array when all balances are zero", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce(
      Array(8).fill({ status: "success", result: [0n, 1000n] as readonly [bigint, bigint] }),
    );

    const result = await readAllocations(STRETH_VAULT, BLOCK_NUMBER);
    expect(result).toEqual([]);
  });

  it("treats failed subvaultState calls as zero value", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: [1000n * 10n ** 18n, 2000n * 10n ** 18n] as readonly [bigint, bigint] },   // Aave: 100%
      { status: "failure", error: new Error("revert") },    // Morpho: failed
      ...Array(6).fill({ status: "success", result: [0n, 1000n] as readonly [bigint, bigint] }),   // rest: 0
    ]);

    const result = await readAllocations(STRETH_VAULT, BLOCK_NUMBER);

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
    expect(result![0].protocol).toBe("Aave");
    expect(result![0].percentage).toBe(100);
  });

  it("filters out subvaults with zero percentage", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: [1000n * 10n ** 18n, 2000n * 10n ** 18n] as readonly [bigint, bigint] },  // Aave: all
      ...Array(7).fill({ status: "success", result: [0n, 1000n] as readonly [bigint, bigint] }), // rest: nothing
    ]);

    const result = await readAllocations(STRETH_VAULT, BLOCK_NUMBER);

    expect(result!).toHaveLength(1);
    expect(result![0].protocol).toBe("Aave");
    expect(result![0].percentage).toBe(100);
  });

  it("computes correct percentages for equal splits", async () => {
    const client = getMainnetClient();
    const equalValue = 125n * 10n ** 18n;
    vi.mocked(client.multicall).mockResolvedValueOnce(
      Array(8).fill({ status: "success", result: [equalValue, 1000n * 10n ** 18n] as readonly [bigint, bigint] }),
    );

    const result = await readAllocations(STRETH_VAULT, BLOCK_NUMBER);

    expect(result!).toHaveLength(8);
    for (const alloc of result!) {
      expect(alloc.percentage).toBe(12.5);
    }
  });

  it("stores valueWei as string representation of bigint", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: [500n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },
      ...Array(7).fill({ status: "success", result: [0n, 1000n] as readonly [bigint, bigint] }),
    ]);

    const result = await readAllocations(STRETH_VAULT, BLOCK_NUMBER);

    expect(result![0].valueWei).toBe((500n * 10n ** 18n).toString());
  });

  it("uses provided blockNumber for consistent reads", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce(
      Array(8).fill({ status: "success", result: [100n, 1000n] as readonly [bigint, bigint] }),
    );

    await readAllocations(STRETH_VAULT, BLOCK_NUMBER);

    expect(client.multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        blockNumber: BLOCK_NUMBER,
        allowFailure: true,
      }),
    );
  });
});

describe("readAllocations (Mellow Core via RiskManager)", () => {
  it("reads earnETH allocations via riskManager.subvaultState", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: [600n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },
      { status: "success", result: [400n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },
    ]);

    const result = await readAllocations(EARN_ETH_VAULT, BLOCK_NUMBER);

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(2);
    expect(result![0].protocol).toBe("Subvault 0");
    expect(result![0].percentage).toBe(60);
    expect(result![1].protocol).toBe("Subvault 1");
    expect(result![1].percentage).toBe(40);
  });

  it("reads earnUSD allocations via riskManager.subvaultState", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: [1000n * 10n ** 6n, 2000n * 10n ** 6n] as readonly [bigint, bigint] },
    ]);

    const result = await readAllocations(EARN_USD_VAULT, BLOCK_NUMBER);

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
    expect(result![0].protocol).toBe("Subvault 0");
    expect(result![0].percentage).toBe(100);
  });

  it("treats negative balance as zero", async () => {
    const client = getMainnetClient();
    vi.mocked(client.multicall).mockResolvedValueOnce([
      { status: "success", result: [-100n, 1000n] as readonly [bigint, bigint] },
      { status: "success", result: [500n * 10n ** 18n, 1000n * 10n ** 18n] as readonly [bigint, bigint] },
    ]);

    const result = await readAllocations(EARN_ETH_VAULT, BLOCK_NUMBER);

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
    expect(result![0].protocol).toBe("Subvault 1");
    expect(result![0].percentage).toBe(100);
  });

  it("has known registry for Core Vaults", () => {
    expect(hasKnownRegistry("0x6a37725ca7f4CE81c004c955f7280d5C704a249e")).toBe(true);
    expect(hasKnownRegistry("0x014e6DA8F283C4aF65B2AA0f201438680A004452")).toBe(true);
  });
});

describe("computeAllocationShift", () => {
  it("detects shifts between two snapshots", () => {
    const previous: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "500", percentage: 50 },
      { protocol: "Morpho", valueWei: "300", percentage: 30 },
      { protocol: "Pendle", valueWei: "200", percentage: 20 },
    ];

    const current: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "300", percentage: 30 },
      { protocol: "Morpho", valueWei: "500", percentage: 50 },
      { protocol: "Pendle", valueWei: "200", percentage: 20 },
    ];

    const result = computeAllocationShift(current, previous);

    expect(result.maxShiftPct).toBe(20);
    expect(result.shifted).toHaveLength(2);

    const aaveShift = result.shifted.find((s) => s.protocol === "Aave");
    expect(aaveShift?.from).toBe(50);
    expect(aaveShift?.to).toBe(30);
    expect(aaveShift?.delta).toBe(-20);

    const morphoShift = result.shifted.find((s) => s.protocol === "Morpho");
    expect(morphoShift?.from).toBe(30);
    expect(morphoShift?.to).toBe(50);
    expect(morphoShift?.delta).toBe(20);
  });

  it("detects new protocols appearing", () => {
    const previous: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "1000", percentage: 100 },
    ];

    const current: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "700", percentage: 70 },
      { protocol: "Morpho", valueWei: "300", percentage: 30 },
    ];

    const result = computeAllocationShift(current, previous);

    expect(result.maxShiftPct).toBe(30);
    expect(result.shifted).toHaveLength(2);

    const morphoShift = result.shifted.find((s) => s.protocol === "Morpho");
    expect(morphoShift?.from).toBe(0);
    expect(morphoShift?.to).toBe(30);
    expect(morphoShift?.delta).toBe(30);
  });

  it("detects protocols disappearing", () => {
    const previous: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "500", percentage: 50 },
      { protocol: "Gearbox", valueWei: "500", percentage: 50 },
    ];

    const current: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "1000", percentage: 100 },
    ];

    const result = computeAllocationShift(current, previous);

    expect(result.maxShiftPct).toBe(50);
    const gearboxShift = result.shifted.find((s) => s.protocol === "Gearbox");
    expect(gearboxShift?.from).toBe(50);
    expect(gearboxShift?.to).toBe(0);
  });

  it("returns zero shift for identical allocations", () => {
    const alloc: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "500", percentage: 50 },
      { protocol: "Morpho", valueWei: "500", percentage: 50 },
    ];

    const result = computeAllocationShift(alloc, alloc);

    expect(result.maxShiftPct).toBe(0);
    expect(result.shifted).toHaveLength(0);
  });

  it("ignores negligible shifts below 0.01pp", () => {
    const previous: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "500", percentage: 50.005 },
      { protocol: "Morpho", valueWei: "500", percentage: 49.995 },
    ];

    const current: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "500", percentage: 50.01 },
      { protocol: "Morpho", valueWei: "500", percentage: 49.99 },
    ];

    const result = computeAllocationShift(current, previous);

    expect(result.shifted).toHaveLength(0);
  });

  it("sorts shifts by absolute delta descending", () => {
    const previous: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "400", percentage: 40 },
      { protocol: "Morpho", valueWei: "300", percentage: 30 },
      { protocol: "Pendle", valueWei: "300", percentage: 30 },
    ];

    const current: ProtocolAllocation[] = [
      { protocol: "Aave", valueWei: "200", percentage: 20 },
      { protocol: "Morpho", valueWei: "250", percentage: 25 },
      { protocol: "Pendle", valueWei: "550", percentage: 55 },
    ];

    const result = computeAllocationShift(current, previous);

    expect(result.shifted[0].protocol).toBe("Pendle");
    expect(Math.abs(result.shifted[0].delta)).toBe(25);
  });
});

describe("hasKnownRegistry", () => {
  it("returns true for strETH vault", () => {
    expect(hasKnownRegistry("0x277C6A642564A91ff78b008022D65683cEE5CCC5")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasKnownRegistry("0x277c6a642564a91ff78b008022d65683cee5ccc5")).toBe(true);
  });

  it("returns false for unknown vaults", () => {
    expect(hasKnownRegistry("0x0000000000000000000000000000000000000000")).toBe(false);
  });
});
