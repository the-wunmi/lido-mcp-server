import { describe, it, expect } from "vitest";
import {
  serializeSnapshot,
  deserializeSnapshot,
} from "../../src/monitor/types.js";
import type { VaultSnapshot, SerializedSnapshot } from "../../src/monitor/types.js";

function makeSnapshot(overrides: Partial<VaultSnapshot> = {}): VaultSnapshot {
  return {
    address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    name: "TestVault",
    apr: 3.5,
    tvl: "1000.5",
    tvlRaw: 1000500000000000000000n,
    sharePrice: 1001000000000000000n,
    timestamp: 1700000000,
    assetDecimals: 18,
    assetSymbol: "WETH",
    ...overrides,
  };
}

describe("serializeSnapshot / deserializeSnapshot round-trip", () => {
  it("preserves all fields through serialization and deserialization", () => {
    const original = makeSnapshot();
    const serialized = serializeSnapshot(original);
    const deserialized = deserializeSnapshot(serialized);

    expect(deserialized.address).toBe(original.address);
    expect(deserialized.name).toBe(original.name);
    expect(deserialized.apr).toBe(original.apr);
    expect(deserialized.tvl).toBe(original.tvl);
    expect(deserialized.tvlRaw).toBe(original.tvlRaw);
    expect(deserialized.sharePrice).toBe(original.sharePrice);
    expect(deserialized.timestamp).toBe(original.timestamp);
    expect(deserialized.assetDecimals).toBe(original.assetDecimals);
    expect(deserialized.assetSymbol).toBe(original.assetSymbol);
  });

  it("preserves null APY", () => {
    const original = makeSnapshot({ apr: null });
    const serialized = serializeSnapshot(original);
    const deserialized = deserializeSnapshot(serialized);

    expect(deserialized.apr).toBeNull();
  });

  it("preserves large BigInt values", () => {
    const largeTvl = 999999999999999999999999999n;
    const original = makeSnapshot({ tvlRaw: largeTvl });
    const serialized = serializeSnapshot(original);
    const deserialized = deserializeSnapshot(serialized);

    expect(deserialized.tvlRaw).toBe(largeTvl);
  });

  it("preserves zero BigInt values", () => {
    const original = makeSnapshot({ tvlRaw: 0n, sharePrice: 0n });
    const serialized = serializeSnapshot(original);
    const deserialized = deserializeSnapshot(serialized);

    expect(deserialized.tvlRaw).toBe(0n);
    expect(deserialized.sharePrice).toBe(0n);
  });
});

describe("deserializeSnapshot validates BigInt strings", () => {
  it("rejects 'not_a_number' as BigInt", () => {
    const bad: SerializedSnapshot = {
      address: "0x1234",
      name: "Test",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: "not_a_number",
      sharePrice: "1000000000000000000",
      timestamp: 1700000000,
      assetDecimals: 18,
      assetSymbol: "ETH",
    };

    expect(() => deserializeSnapshot(bad)).toThrow('Invalid BigInt value for tvlRaw: "not_a_number"');
  });

  it("rejects decimal strings like '12.34'", () => {
    const bad: SerializedSnapshot = {
      address: "0x1234",
      name: "Test",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: "1000000000000000000",
      sharePrice: "12.34",
      timestamp: 1700000000,
      assetDecimals: 18,
      assetSymbol: "ETH",
    };

    expect(() => deserializeSnapshot(bad)).toThrow('Invalid BigInt value for sharePrice: "12.34"');
  });

  it("rejects scientific notation like '1e18'", () => {
    const bad: SerializedSnapshot = {
      address: "0x1234",
      name: "Test",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: "1e18",
      sharePrice: "1000000000000000000",
      timestamp: 1700000000,
      assetDecimals: 18,
      assetSymbol: "ETH",
    };

    expect(() => deserializeSnapshot(bad)).toThrow('Invalid BigInt value for tvlRaw: "1e18"');
  });

  it("accepts valid positive BigInt strings", () => {
    const good: SerializedSnapshot = {
      address: "0x1234",
      name: "Test",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: "1000000000000000000",
      sharePrice: "999999999999999999",
      timestamp: 1700000000,
      assetDecimals: 18,
      assetSymbol: "ETH",
    };

    const result = deserializeSnapshot(good);
    expect(result.tvlRaw).toBe(1000000000000000000n);
    expect(result.sharePrice).toBe(999999999999999999n);
  });

  it("accepts valid negative BigInt strings", () => {
    const good: SerializedSnapshot = {
      address: "0x1234",
      name: "Test",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: "-500",
      sharePrice: "-1000000000000000000",
      timestamp: 1700000000,
      assetDecimals: 18,
      assetSymbol: "ETH",
    };

    const result = deserializeSnapshot(good);
    expect(result.tvlRaw).toBe(-500n);
    expect(result.sharePrice).toBe(-1000000000000000000n);
  });

  it("accepts '0' as a valid BigInt string", () => {
    const good: SerializedSnapshot = {
      address: "0x1234",
      name: "Test",
      apr: null,
      tvl: "0",
      tvlRaw: "0",
      sharePrice: "0",
      timestamp: 1700000000,
      assetDecimals: 18,
      assetSymbol: "ETH",
    };

    const result = deserializeSnapshot(good);
    expect(result.tvlRaw).toBe(0n);
    expect(result.sharePrice).toBe(0n);
  });
});

describe("deserializeSnapshot defaults", () => {
  it("missing assetDecimals defaults to 18", () => {
    const input = {
      address: "0x1234",
      name: "Test",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: "1000000000000000000",
      sharePrice: "1000000000000000000",
      timestamp: 1700000000,
    } as unknown as SerializedSnapshot;

    const result = deserializeSnapshot(input);
    expect(result.assetDecimals).toBe(18);
  });

  it("missing assetSymbol defaults to 'ETH'", () => {
    const input = {
      address: "0x1234",
      name: "Test",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: "1000000000000000000",
      sharePrice: "1000000000000000000",
      timestamp: 1700000000,
    } as unknown as SerializedSnapshot;

    const result = deserializeSnapshot(input);
    expect(result.assetSymbol).toBe("ETH");
  });

  it("preserves explicitly set assetDecimals and assetSymbol", () => {
    const input: SerializedSnapshot = {
      address: "0x1234",
      name: "Test",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: "1000000",
      sharePrice: "1000000",
      timestamp: 1700000000,
      assetDecimals: 6,
      assetSymbol: "USDC",
    };

    const result = deserializeSnapshot(input);
    expect(result.assetDecimals).toBe(6);
    expect(result.assetSymbol).toBe("USDC");
  });
});
