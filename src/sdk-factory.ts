import { LidoSDK } from "@lidofinance/lido-ethereum-sdk";
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { appConfig, consumePrivateKey } from "./config.js";
import { chunkedTransport } from "./utils/chunked-transport.js";

// SDK expects `PublicClient & { [key: string]: any }` and `WalletClient & { [key: string]: any }`.
// The intersection with `{ [key: string]: any }` makes direct assignment incompatible
// with viem's strictly-typed clients, so we use a targeted type assertion.
type SDKPublicClient = PublicClient & { [key: string]: unknown };
type SDKWalletClient = WalletClient & { [key: string]: unknown };

// Private key is consumed (read + scrubbed from env) in a single call.
// It is never stored on any exported object.
const account = privateKeyToAccount(consumePrivateKey());

// Wrap the HTTP transport with auto-chunking for eth_getLogs to work
// within RPC provider block range limits (e.g. dRPC free tier = 10k blocks).
const transport = chunkedTransport(
  http(appConfig.rpcUrl, {
    retryCount: 3,
    retryDelay: 1000,
    timeout: 30_000,
  }),
);

export const publicClient = createPublicClient({
  chain: appConfig.chain,
  transport,
});

export const walletClient = createWalletClient({
  account,
  chain: appConfig.chain,
  transport: http(appConfig.rpcUrl),
});

/**
 * The Lido SDK is only initialized on L1 chains (mainnet, Holesky, Hoodi).
 * On L2, the tools/index.ts registration layer ensures L1-only tools are never called,
 * so the null cast below is safe — it will never be dereferenced at runtime on L2.
 */
export const sdk: LidoSDK = appConfig.isL1
  ? new LidoSDK({
      chainId: appConfig.chainId as 1 | 17000 | 560048,
      rpcProvider: publicClient as unknown as SDKPublicClient,
      web3Provider: walletClient as unknown as SDKWalletClient,
      logMode: "none",
    })
  : (null as unknown as LidoSDK);

export function getAccountAddress() {
  return account.address;
}

export async function validateChainId(): Promise<void> {
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== appConfig.chainId) {
    throw new Error(
      `Chain ID mismatch: LIDO_CHAIN_ID is ${appConfig.chainId} but the RPC endpoint ` +
      `returned chain ID ${rpcChainId}. This could send transactions to the wrong network.`
    );
  }
  if (rpcChainId === 1) {
    console.error("WARNING: Running on Ethereum mainnet. Real funds at risk.");
  }
}
