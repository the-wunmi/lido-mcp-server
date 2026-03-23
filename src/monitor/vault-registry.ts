import type { Address } from "viem";
import { normalizeAddress } from "./config.js";
import type { VaultType } from "./types.js";

export interface SubvaultEntry {
  address: Address;
  protocol: string;
}

export interface MellowCoreVaultConfig {
  vault: Address;
  displayName: string;
  displaySymbol: string;
  shareManager: Address;
  oracle: Address;
  riskManager: Address;
  asset: Address;
  assetDecimals: number;
  assetSymbol: string;
  subvaults: SubvaultEntry[];
}

export interface Erc4626VaultConfig {
  vault: Address;
  subvaults: SubvaultEntry[];
}

export type VaultConfig =
  | { type: "mellow_core"; config: MellowCoreVaultConfig }
  | { type: "erc4626"; config: Erc4626VaultConfig };

/**
 * Single source of truth for all known vault configurations.
 *
 * Protocol names are trusted strings used in LLM prompts —
 * never source them from on-chain data without sanitization.
 */
const VAULT_REGISTRY: Record<string, VaultConfig> = {
  // strETH — Mellow Core (stRATEGY Vault)
  // Verified via docs.mellow.finance/strategy-vault/streth-deployment
  [normalizeAddress("0x277C6A642564A91ff78b008022D65683cEE5CCC5")]: {
    type: "mellow_core",
    config: {
      vault: "0x277C6A642564A91ff78b008022D65683cEE5CCC5",
      displayName: "strETH",
      displaySymbol: "strETH",
      shareManager: "0xcd3c0F51798D1daA92Fb192E57844Ae6cEE8a6c7",
      oracle: "0x8a78e6b7E15C4Ae3aeAeE3bf0DE4F2de4078c1cD",
      riskManager: "0x4f6bc03537C6F74E250f57a9a7238087caBF1c6D",
      asset: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
      assetDecimals: 18,
      assetSymbol: "WETH",
      subvaults: [
        { address: "0x90c983DC732e65DB6177638f0125914787b8Cb78", protocol: "Aave" },
        { address: "0x893aa69FBAA1ee81B536f0FbE3A3453e86290080", protocol: "Morpho" },
        { address: "0x181cB55f872450D16aE858D532B4e35e50eaA76D", protocol: "Pendle" },
        { address: "0x9938A09FeA37bA681A1Bd53D33ddDE2dEBEc1dA0", protocol: "Gearbox" },
        { address: "0x3883d8CdCdda03784908cFa2F34ED2cF1604e4d7", protocol: "Maple" },
        { address: "0xECf3BDE9f50F71edE67E05050123b64b519DF55C", protocol: "Reserve" },
        { address: "0xCDfA7EfE670869c6b6be4375654E0b206eF49c89", protocol: "Ethena" },
        { address: "0x888d2A3E9B600F360a3386c9D2fEdFa658E7fA29", protocol: "DVstETH" },
      ],
    },
  },
  // earnETH — Mellow Core
  // Verified on-chain via vault.shareManager(), vault.oracle(), vault.riskManager()
  [normalizeAddress("0x6a37725ca7f4CE81c004c955f7280d5C704a249e")]: {
    type: "mellow_core",
    config: {
      vault: "0x6a37725ca7f4CE81c004c955f7280d5C704a249e",
      displayName: "Earn ETH",
      displaySymbol: "earnETH",
      shareManager: "0xBBFC8683C8fE8cF73777feDE7ab9574935fea0A4",
      oracle: "0xAda1f4c24603aB2fe5aBd35BCD12370e98A20358",
      riskManager: "0xa2a4C4ecE27229aF51c546844AB752824Ccb557e",
      asset: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
      assetDecimals: 18,
      assetSymbol: "WETH",
      subvaults: [
        { address: "0xC5901C2481ca9C26398A9Da258b13717894bfebF", protocol: "Subvault 0" },
        { address: "0x7F515C80fA4C1FCFF34F0329141A9C3b20468FE5", protocol: "Subvault 1" },
      ],
    },
  },
  // earnUSD — Mellow Core
  // Verified on-chain via vault.shareManager(), vault.oracle(), vault.riskManager()
  [normalizeAddress("0x014e6DA8F283C4aF65B2AA0f201438680A004452")]: {
    type: "mellow_core",
    config: {
      vault: "0x014e6DA8F283C4aF65B2AA0f201438680A004452",
      displayName: "Earn USD",
      displaySymbol: "earnUSD",
      shareManager: "0x4Ce1ac8F43E0E5BD7A346A98aF777bF8fbeA1981",
      oracle: "0x827044735c9708a2cf850e7Ea37EBa43bc786028",
      riskManager: "0x7b1e06C46d4510277FC37a37bBeF65F3794fdDE4",
      asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
      assetDecimals: 6,
      assetSymbol: "USDC",
      subvaults: [
        { address: "0x77B9441d5Cb89fca435190A9B6D108ad4B00ccFd", protocol: "Subvault 0" },
      ],
    },
  },
};

export function getVaultConfig(address: string): VaultConfig | null {
  return VAULT_REGISTRY[normalizeAddress(address)] ?? null;
}

export function isMellowCoreVault(address: string): boolean {
  const entry = VAULT_REGISTRY[normalizeAddress(address)];
  return entry?.type === "mellow_core";
}

export function getMellowCoreConfig(address: string): MellowCoreVaultConfig | undefined {
  const entry = VAULT_REGISTRY[normalizeAddress(address)];
  if (entry?.type === "mellow_core") return entry.config;
  return undefined;
}

export function getAllMellowCoreVaults(): MellowCoreVaultConfig[] {
  return Object.values(VAULT_REGISTRY)
    .filter((v): v is { type: "mellow_core"; config: MellowCoreVaultConfig } => v.type === "mellow_core")
    .map((v) => v.config);
}

export function hasKnownRegistry(address: string): boolean {
  return normalizeAddress(address) in VAULT_REGISTRY;
}

export function getVaultType(address: string): VaultType {
  const entry = VAULT_REGISTRY[normalizeAddress(address)];
  if (entry?.type === "mellow_core") return "mellow_core";
  return "erc4626";
}
