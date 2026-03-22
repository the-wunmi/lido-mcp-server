import { describe, it, expect, vi, beforeEach } from "vitest";
import { publicClient, walletClient, getAccountAddress } from "../../src/sdk-factory.js";
import {
  handleListVaults,
  handleGetVault,
  handleGetVaultHubStats,
  handleVaultFund,
  handleVaultWithdraw,
  handleVaultPause,
  handleVaultResume,
  handleVaultCreate,
  handleVaultRequestExit,
  listVaultsToolDef,
  getVaultToolDef,
  vaultHubStatsToolDef,
  vaultFundToolDef,
  vaultWithdrawToolDef,
  vaultPauseToolDef,
  vaultResumeToolDef,
  vaultCreateToolDef,
  vaultRequestExitToolDef,
} from "../../src/tools/stvaults.js";

const MOCK_VAULT = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";

describe("stVaults V3 tool definitions", () => {
  it("listVaultsToolDef has correct shape", () => {
    expect(listVaultsToolDef.name).toBe("lido_list_vaults");
    expect(listVaultsToolDef.annotations.readOnlyHint).toBe(true);
    expect(listVaultsToolDef.inputSchema.type).toBe("object");
  });

  it("getVaultToolDef has correct shape", () => {
    expect(getVaultToolDef.name).toBe("lido_get_vault");
    expect(getVaultToolDef.annotations.readOnlyHint).toBe(true);
    expect(getVaultToolDef.inputSchema.required).toContain("vault_address");
  });

  it("vaultHubStatsToolDef has correct shape", () => {
    expect(vaultHubStatsToolDef.name).toBe("lido_get_vault_hub_stats");
    expect(vaultHubStatsToolDef.annotations.readOnlyHint).toBe(true);
  });

  it("vaultFundToolDef has correct shape", () => {
    expect(vaultFundToolDef.name).toBe("lido_vault_fund");
    expect(vaultFundToolDef.annotations.readOnlyHint).toBe(false);
    expect(vaultFundToolDef.inputSchema.required).toContain("vault_address");
    expect(vaultFundToolDef.inputSchema.required).toContain("amount");
  });

  it("vaultWithdrawToolDef has correct shape", () => {
    expect(vaultWithdrawToolDef.name).toBe("lido_vault_withdraw");
    expect(vaultWithdrawToolDef.annotations.readOnlyHint).toBe(false);
    expect(vaultWithdrawToolDef.annotations.destructiveHint).toBe(true);
  });

  it("vaultPauseToolDef has correct shape", () => {
    expect(vaultPauseToolDef.name).toBe("lido_vault_pause_beacon_deposits");
    expect(vaultPauseToolDef.annotations.readOnlyHint).toBe(false);
  });

  it("vaultResumeToolDef has correct shape", () => {
    expect(vaultResumeToolDef.name).toBe("lido_vault_resume_beacon_deposits");
    expect(vaultResumeToolDef.annotations.readOnlyHint).toBe(false);
  });
});

describe("handleGetVaultHubStats", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
  });

  it("returns vault hub stats", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(5n); // vaultsCount

    const result = await handleGetVaultHubStats({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("VaultHub");
    expect(text).toContain("5");
  });

  it("handles RPC errors gracefully", async () => {
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(new Error("rpc error"));

    const result = await handleGetVaultHubStats({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("rpc error");
  });
});

describe("handleListVaults", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
    vi.mocked(publicClient.multicall).mockReset();
  });

  it("returns message when no vaults exist", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleListVaults({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No vaults");
  });

  it("rejects invalid offset", async () => {
    const result = await handleListVaults({ offset: -1 });

    expect(result.isError).toBe(true);
  });
});

describe("handleGetVault", () => {
  beforeEach(() => {
    vi.mocked(publicClient.multicall).mockReset();
    vi.mocked(publicClient.readContract).mockReset();
  });

  it("rejects missing vault_address", async () => {
    const result = await handleGetVault({});

    expect(result.isError).toBe(true);
  });

  it("rejects invalid vault_address", async () => {
    const result = await handleGetVault({ vault_address: "not-an-address" });

    expect(result.isError).toBe(true);
  });

  it("returns vault details via multicall", async () => {
    vi.mocked(publicClient.multicall).mockResolvedValueOnce([
      { status: "success", result: true },
      { status: "success", result: true },
      { status: "success", result: 10n * 10n ** 18n },
      { status: "success", result: 5n * 10n ** 18n },
      { status: "success", result: 3n * 10n ** 18n },
      { status: "success", result: 2n * 10n ** 18n },
      { status: "success", result: "0x1111111111111111111111111111111111111111" },
      { status: "success", result: "0x2222222222222222222222222222222222222222" },
      { status: "success", result: "0x3333333333333333333333333333333333333333" },
      { status: "success", result: false },
      { status: "success", result: "0x0100000000000000000000001111111111111111111111111111111111111111" },
    ] as any);

    const result = await handleGetVault({ vault_address: MOCK_VAULT });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Vault");
    expect(text).toContain("Connected: true");
    expect(text).toContain("Healthy: true");
  });
});

const MOCK_ACCOUNT = getAccountAddress();
const preFlightMock = [
  { status: "success", result: true },
  { status: "success", result: true },
  { status: "success", result: 10n * 10n ** 18n },
  { status: "success", result: 5n * 10n ** 18n },
  { status: "success", result: MOCK_ACCOUNT },
  { status: "success", result: MOCK_ACCOUNT },
  { status: "success", result: MOCK_ACCOUNT },
] as any;

describe("handleVaultFund", () => {
  beforeEach(() => {
    vi.mocked(publicClient.multicall).mockReset();
    vi.mocked(publicClient.simulateContract).mockReset();
    vi.mocked(walletClient.writeContract).mockReset();
    vi.mocked(publicClient.waitForTransactionReceipt).mockReset();
  });

  it("rejects missing vault_address", async () => {
    const result = await handleVaultFund({ amount: "1.0" });

    expect(result.isError).toBe(true);
  });

  it("rejects missing amount", async () => {
    const result = await handleVaultFund({ vault_address: MOCK_VAULT });

    expect(result.isError).toBe(true);
  });

  it("performs dry run by default", async () => {
    vi.mocked(publicClient.multicall).mockResolvedValueOnce(preFlightMock);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: undefined } as any);
    vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(100_000n);

    const result = await handleVaultFund({ vault_address: MOCK_VAULT, amount: "1.0" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("Connected: true");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("handles simulation failure gracefully", async () => {
    vi.mocked(publicClient.multicall).mockResolvedValueOnce(preFlightMock);
    vi.mocked(publicClient.simulateContract).mockRejectedValueOnce(new Error("sim fail"));

    const result = await handleVaultFund({ vault_address: MOCK_VAULT, amount: "1.0" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("FAILED");
  });
});

describe("handleVaultWithdraw", () => {
  beforeEach(() => {
    vi.mocked(publicClient.multicall).mockReset();
    vi.mocked(publicClient.simulateContract).mockReset();
    vi.mocked(walletClient.writeContract).mockReset();
  });

  it("rejects missing vault_address", async () => {
    const result = await handleVaultWithdraw({ amount: "1.0", receiver: getAccountAddress() });

    expect(result.isError).toBe(true);
  });

  it("performs dry run by default", async () => {
    vi.mocked(publicClient.multicall).mockResolvedValueOnce(preFlightMock);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: undefined } as any);
    vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(100_000n);

    const result = await handleVaultWithdraw({
      vault_address: MOCK_VAULT,
      amount: "1.0",
      receiver: getAccountAddress(),
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
  });
});

describe("handleVaultPause", () => {
  beforeEach(() => {
    vi.mocked(publicClient.multicall).mockReset();
    vi.mocked(publicClient.simulateContract).mockReset();
  });

  it("rejects missing vault_address", async () => {
    const result = await handleVaultPause({});

    expect(result.isError).toBe(true);
  });

  it("performs dry run by default with role check", async () => {
    vi.mocked(publicClient.multicall).mockResolvedValueOnce(preFlightMock);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: undefined } as any);

    const result = await handleVaultPause({ vault_address: MOCK_VAULT });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("Connected: true");
  });

  it("warns when caller is not vault owner", async () => {
    const wrongOwnerMock = [
      ...preFlightMock.slice(0, 4),
      { status: "success", result: "0x0000000000000000000000000000000000000001" }, // different owner
      ...preFlightMock.slice(5),
    ] as any;
    vi.mocked(publicClient.multicall).mockResolvedValueOnce(wrongOwnerMock);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: undefined } as any);

    const result = await handleVaultPause({ vault_address: MOCK_VAULT });

    expect(result.content[0].text).toContain("WARNING");
    expect(result.content[0].text).toContain("not the vault owner");
  });
});

describe("handleVaultResume", () => {
  beforeEach(() => {
    vi.mocked(publicClient.multicall).mockReset();
    vi.mocked(publicClient.simulateContract).mockReset();
  });

  it("rejects missing vault_address", async () => {
    const result = await handleVaultResume({});

    expect(result.isError).toBe(true);
  });

  it("performs dry run by default with role check", async () => {
    vi.mocked(publicClient.multicall).mockResolvedValueOnce(preFlightMock);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: undefined } as any);

    const result = await handleVaultResume({ vault_address: MOCK_VAULT });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("Connected: true");
  });
});

describe("handleVaultCreate", () => {
  beforeEach(() => {
    vi.mocked(publicClient.simulateContract).mockReset();
    vi.mocked(walletClient.writeContract).mockReset();
  });

  it("rejects missing node_operator", async () => {
    const result = await handleVaultCreate({});

    expect(result.isError).toBe(true);
  });

  it("performs dry run by default", async () => {
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
      ],
    } as any);

    const result = await handleVaultCreate({
      node_operator: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("Create Staking Vault");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});

describe("handleVaultRequestExit", () => {
  beforeEach(() => {
    vi.mocked(publicClient.multicall).mockReset();
    vi.mocked(publicClient.simulateContract).mockReset();
    vi.mocked(walletClient.writeContract).mockReset();
  });

  it("rejects missing vault_address", async () => {
    const result = await handleVaultRequestExit({
      validator_pubkey: "0x" + "ab".repeat(48),
    });

    expect(result.isError).toBe(true);
  });

  it("rejects invalid validator pubkey length", async () => {
    const result = await handleVaultRequestExit({
      vault_address: MOCK_VAULT,
      validator_pubkey: "0xabcd", // too short
    });

    expect(result.isError).toBe(true);
  });

  it("performs dry run with role check", async () => {
    vi.mocked(publicClient.multicall).mockResolvedValueOnce(preFlightMock);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: undefined } as any);

    const result = await handleVaultRequestExit({
      vault_address: MOCK_VAULT,
      validator_pubkey: "0x" + "ab".repeat(48),
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("Request Validator Exit");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});
