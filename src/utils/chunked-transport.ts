/**
 * A viem custom transport that intercepts eth_getLogs requests and
 * automatically chunks them into smaller block ranges to work within
 * RPC provider limits (e.g. dRPC free tier caps at 10k blocks).
 */
import { custom, type EIP1193RequestFn, type Transport } from "viem";

const MAX_BLOCK_RANGE = 5_000n;

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

function bigIntToHex(n: bigint): string {
  return "0x" + n.toString(16);
}

/**
 * Create a chunked transport that wraps an inner transport.
 * All RPC calls pass through unchanged except eth_getLogs,
 * which is split into sub-requests of MAX_BLOCK_RANGE blocks.
 */
export function chunkedTransport(innerTransport: Transport): Transport {
  return (params) => {
    const inner = innerTransport(params);

    const chunkedRequest: EIP1193RequestFn = async (args) => {
      if (args.method !== "eth_getLogs") {
        return inner.request(args);
      }

      const logParams = (args.params as unknown[])?.[0] as Record<string, unknown> | undefined;
      if (!logParams) {
        return inner.request(args);
      }

      const fromBlockRaw = logParams.fromBlock;
      const toBlockRaw = logParams.toBlock;

      // Only chunk when both fromBlock and toBlock are explicit hex numbers
      if (
        typeof fromBlockRaw !== "string" || !fromBlockRaw.startsWith("0x") ||
        typeof toBlockRaw !== "string" || !toBlockRaw.startsWith("0x")
      ) {
        // If toBlock is missing or "latest", we need to resolve it
        if (typeof fromBlockRaw === "string" && fromBlockRaw.startsWith("0x")) {
          const from = hexToBigInt(fromBlockRaw);

          // Get latest block number to compute range
          const latestHex = await inner.request({ method: "eth_blockNumber" }) as string;
          const latest = hexToBigInt(latestHex);
          const to = typeof toBlockRaw === "string" && toBlockRaw.startsWith("0x")
            ? hexToBigInt(toBlockRaw)
            : latest;

          if (to - from > MAX_BLOCK_RANGE) {
            return chunkGetLogs(inner.request, logParams, from, to);
          }
        }
        return inner.request(args);
      }

      const from = hexToBigInt(fromBlockRaw);
      const to = hexToBigInt(toBlockRaw);

      if (to - from <= MAX_BLOCK_RANGE) {
        return inner.request(args);
      }

      return chunkGetLogs(inner.request, logParams, from, to);
    };

    return {
      ...inner,
      request: chunkedRequest,
    };
  };
}

async function chunkGetLogs(
  request: EIP1193RequestFn,
  baseParams: Record<string, unknown>,
  from: bigint,
  to: bigint,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let cursor = from;

  while (cursor <= to) {
    const chunkEnd = cursor + MAX_BLOCK_RANGE > to ? to : cursor + MAX_BLOCK_RANGE;
    const chunk = await request({
      method: "eth_getLogs",
      params: [{
        ...baseParams,
        fromBlock: bigIntToHex(cursor),
        toBlock: bigIntToHex(chunkEnd),
      }],
    }) as unknown[];
    results.push(...chunk);
    cursor = chunkEnd + 1n;
  }

  return results;
}
