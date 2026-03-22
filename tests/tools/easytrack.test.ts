import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetEasyTrackMotions,
  handleGetEasyTrackMotion,
  handleGetEasyTrackConfig,
  handleGetEasyTrackFactories,
  handleObjectEasyTrackMotion,
} from "../../src/tools/easytrack.js";
import { publicClient, walletClient } from "../../src/sdk-factory.js";

function makeMotion({
  id = 1n,
  evmScriptFactory = "0x648C8Be548F43eca4e482C0801Ebccccfb944931" as `0x${string}`,
  creator = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
  duration = 259200n,
  startDate = BigInt(Math.floor(Date.now() / 1000) - 1000),
  snapshotBlock = 18000000n,
  objectionsThreshold = 500n,
  objectionsAmount = 100000000000000000000n,
  evmScriptHash = "0xabcdef0000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
} = {}) {
  return {
    id,
    evmScriptFactory,
    creator,
    duration,
    startDate,
    snapshotBlock,
    objectionsThreshold,
    objectionsAmount,
    evmScriptHash,
  };
}

describe("handleGetEasyTrackMotions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of motions", async () => {
    const motion = makeMotion();
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([motion] as any) // getMotions
      .mockResolvedValueOnce(1000000000000000000000000n); // LDO totalSupply

    const result = await handleGetEasyTrackMotions({});
    const text = result.content[0].text;

    expect(text).toContain("Easy Track Motions");
    expect(text).toContain("Motion #1:");
    expect(text).toContain("Active");
    expect(text).toContain("Creator:");
    expect(text).toContain("Objections:");
  });

  it("filters active motions when status=active", async () => {
    const activeMotion = makeMotion({ id: 1n });
    // Make an ended motion
    const endedMotion = makeMotion({
      id: 2n,
      startDate: BigInt(Math.floor(Date.now() / 1000) - 500000),
      duration: 100n,
    });
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([activeMotion, endedMotion] as any)
      .mockResolvedValueOnce(1000000000000000000000000n);

    const result = await handleGetEasyTrackMotions({ status: "active" });
    const text = result.content[0].text;

    expect(text).toContain("Motion #1:");
    expect(text).not.toContain("Motion #2:");
  });

  it("returns message when no motions found", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce(1000000000000000000000000n);

    const result = await handleGetEasyTrackMotions({});
    const text = result.content[0].text;

    expect(text).toContain("No Easy Track motions found");
  });

  it("returns message when no active motions", async () => {
    const endedMotion = makeMotion({
      startDate: BigInt(Math.floor(Date.now() / 1000) - 500000),
      duration: 100n,
    });
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([endedMotion] as any)
      .mockResolvedValueOnce(1000000000000000000000000n);

    const result = await handleGetEasyTrackMotions({ status: "active" });
    const text = result.content[0].text;

    expect(text).toContain("No active Easy Track motions");
  });

  it("handles readContract failure", async () => {
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(
      new Error("RPC error")
    );

    const result = await handleGetEasyTrackMotions({});
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleGetEasyTrackMotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns detailed motion info", async () => {
    const motion = makeMotion({ id: 42n });
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([motion] as any) // getMotions
      .mockResolvedValueOnce(500000000000000000n) // LDO balance
      .mockResolvedValueOnce(1000000000000000000000000n) // LDO totalSupply
      .mockResolvedValueOnce(true); // canObjectToMotion

    const result = await handleGetEasyTrackMotion({ motion_id: 42 });
    const text = result.content[0].text;

    expect(text).toContain("Easy Track Motion #42");
    expect(text).toContain("Status: Active");
    expect(text).toContain("Objection Progress");
    expect(text).toContain("Your Status");
    expect(text).toContain("Can object: YES");
  });

  it("returns error when motion not found", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([makeMotion({ id: 1n })] as any)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(1000000000000000000000000n);

    const result = await handleGetEasyTrackMotion({ motion_id: 99 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Motion #99 not found");
  });

  it("returns error for missing motion_id", async () => {
    const result = await handleGetEasyTrackMotion({});
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleGetEasyTrackConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns Easy Track configuration", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(259200n) // motionDuration
      .mockResolvedValueOnce(500n)    // objectionsThreshold (5%)
      .mockResolvedValueOnce(12n)     // motionsCountLimit
      .mockResolvedValueOnce([        // getEVMScriptFactories
        "0x648C8Be548F43eca4e482C0801Ebccccfb944931",
      ] as any);

    const result = await handleGetEasyTrackConfig({});
    const text = result.content[0].text;

    expect(text).toContain("Easy Track Configuration");
    expect(text).toContain("Motion duration:");
    expect(text).toContain("72h");
    expect(text).toContain("Objection threshold:");
    expect(text).toContain("5.00%");
    expect(text).toContain("Motions count limit: 12");
    expect(text).toContain("Registered factories: 1");
  });

  it("handles readContract failure", async () => {
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(
      new Error("RPC timeout")
    );

    const result = await handleGetEasyTrackConfig({});
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleGetEasyTrackFactories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of factories with labels", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([
      "0x648C8Be548F43eca4e482C0801Ebccccfb944931",
      "0x7E8eFfAb3083c1931F5F29cB7F36dC776634BDBd",
    ] as any);

    const result = await handleGetEasyTrackFactories({});
    const text = result.content[0].text;

    expect(text).toContain("Easy Track Factories (2 registered)");
    expect(text).toContain("Reward Program");
  });

  it("handles no factories", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([] as any);

    const result = await handleGetEasyTrackFactories({});
    const text = result.content[0].text;

    expect(text).toContain("Easy Track Factories (0 registered)");
  });
});

describe("handleObjectEasyTrackMotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dry run output for valid objection", async () => {
    const motion = makeMotion({ id: 5n });
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([motion] as any) // getMotions
      .mockResolvedValueOnce(true) // canObjectToMotion
      .mockResolvedValueOnce(1000000000000000000n) // LDO balance
      .mockResolvedValueOnce(1000000000000000000000000n); // LDO totalSupply

    const result = await handleObjectEasyTrackMotion({ motion_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("DRY RUN: Object to Easy Track Motion");
    expect(text).toContain("Motion: #5");
    expect(text).toContain("Your LDO balance:");
    expect(text).toContain("Current objections:");
    expect(text).toContain("Simulation:");
  });

  it("executes objection when dry_run=false", async () => {
    const motion = makeMotion({ id: 5n });
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([motion] as any) // getMotions
      .mockResolvedValueOnce(true) // canObjectToMotion
      .mockResolvedValueOnce(1000000000000000000n) // LDO balance
      .mockResolvedValueOnce(1000000000000000000000000n); // LDO totalSupply

    vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xobjhash" as `0x${string}`);
    vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({
      status: "success",
    } as any);

    const result = await handleObjectEasyTrackMotion({ motion_id: 5, dry_run: false });
    const text = result.content[0].text;

    expect(text).toContain("Objection Recorded on Easy Track");
    expect(text).toContain("Transaction hash: 0xobjhash");
    expect(text).toContain("Status: Confirmed");
  });

  it("returns error when motion not found", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([] as any);

    const result = await handleObjectEasyTrackMotion({ motion_id: 99 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Motion #99 not found");
  });

  it("returns error when motion has ended", async () => {
    const endedMotion = makeMotion({
      id: 5n,
      startDate: BigInt(Math.floor(Date.now() / 1000) - 500000),
      duration: 100n,
    });
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([endedMotion] as any);

    const result = await handleObjectEasyTrackMotion({ motion_id: 5 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("already ended");
  });

  it("returns error when cannot object", async () => {
    const motion = makeMotion({ id: 5n });
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([motion] as any) // getMotions
      .mockResolvedValueOnce(false); // canObjectToMotion = false

    const result = await handleObjectEasyTrackMotion({ motion_id: 5 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Cannot object");
  });

  it("returns error for missing motion_id", async () => {
    const result = await handleObjectEasyTrackMotion({});
    expect(result).toHaveProperty("isError", true);
  });
});
