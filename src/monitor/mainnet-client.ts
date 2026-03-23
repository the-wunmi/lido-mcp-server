import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { publicClient } from "../sdk-factory.js";
import { appConfig } from "../config.js";
import { monitorConfig } from "./config.js";

let _mainnetClient: PublicClient | null = null;

/**
 * Lazy singleton mainnet PublicClient.
 * Reuses the existing publicClient when chainId === 1,
 * otherwise creates one from MAINNET_RPC_URL.
 */
export function getMainnetClient(): PublicClient {
  if (_mainnetClient) return _mainnetClient;

  if (appConfig.chainId === 1) {
    _mainnetClient = publicClient;
    return _mainnetClient;
  }

  const rpcUrl = monitorConfig.mainnetRpcUrl;
  if (!rpcUrl) {
    throw new Error(
      "MAINNET_RPC_URL is required to monitor mainnet vaults when running on a non-mainnet chain."
    );
  }

  _mainnetClient = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { retryCount: 3, retryDelay: 1000, timeout: 30_000 }),
  });

  return _mainnetClient;
}

/** Reset for testing. */
export function _resetMainnetClient(): void {
  _mainnetClient = null;
}
