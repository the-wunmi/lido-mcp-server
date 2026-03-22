import { z } from "zod";
import { createPublicClient, formatEther, http, parseEther, type Address, type PublicClient } from "viem";
import { publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { appConfig, WSTETH_ADDRESSES, L2_WSTETH_CHAINS } from "../config.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { validateReceiver, validateAmountCap } from "../utils/security.js";
import { erc20Abi } from "../utils/erc20-abi.js";

function getWstethAddress(): Address {
  const addr = WSTETH_ADDRESSES[appConfig.chainId];
  if (!addr) throw new Error(`wstETH not available on chain ${appConfig.chainId}`);
  return addr;
}

export const l2BalanceToolDef = {
  name: "lido_l2_get_wsteth_balance",
  description:
    `Get wstETH and native ETH balances on ${appConfig.chain.name}. ` +
    "wstETH on L2 is a bridged ERC-20 whose value tracks the L1 stETH/ETH rate. " +
    "If no address is provided, uses the configured wallet address.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address (0x...). Defaults to the configured wallet.",
      },
    },
  },
  annotations: {
    title: `Get wstETH Balance (${appConfig.chain.name})`,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const balanceSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function handleL2GetBalance(args: Record<string, unknown>) {
  try {
    const { address: rawAddr } = balanceSchema.parse(args);
    const address = (rawAddr ?? getAccountAddress()) as Address;
    const wstethAddress = getWstethAddress();

    const [ethBalance, wstethBalance] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({
        address: wstethAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    const lines = [
      `Balances for ${address} on ${appConfig.chain.name}:`,
      `  ETH:    ${formatEther(ethBalance)}`,
      `  wstETH: ${formatEther(wstethBalance)}`,
      "",
      "Note: wstETH on L2 is a bridged token whose value tracks the L1 stETH/ETH",
      "exchange rate. To stake ETH or wrap/unwrap stETH, use an L1-configured server.",
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const l2TransferToolDef = {
  name: "lido_l2_transfer_wsteth",
  description:
    `Transfer wstETH to another address on ${appConfig.chain.name}. ` +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      to: {
        type: "string",
        description: "Recipient address (0x...).",
      },
      amount: {
        type: "string",
        description: "Amount of wstETH to transfer (e.g. '1.0').",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only — no transaction sent. Default: true.",
      },
    },
    required: ["to", "amount"],
  },
  annotations: {
    title: `Transfer wstETH (${appConfig.chain.name})`,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const transferSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleL2Transfer(args: Record<string, unknown>) {
  try {
    const { to, amount, dry_run } = transferSchema.parse(args);
    const amountWei = parseEther(amount);
    const wstethAddress = getWstethAddress();
    const sender = getAccountAddress();

    const receiverError = validateReceiver(to);
    if (receiverError) return errorResult(receiverError);

    const capError = validateAmountCap(amountWei);
    if (capError) return errorResult(capError);

    const balance = await publicClient.readContract({
      address: wstethAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [sender],
    });

    if (balance < amountWei) {
      return errorResult(
        `Insufficient wstETH balance on ${appConfig.chain.name}. ` +
        `You have ${formatEther(balance)} wstETH but are trying to transfer ${amount} wstETH.`
      );
    }

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 65_000n;
      let gasEstimateNote = "(using conservative estimate)";

      try {
        await publicClient.simulateContract({
          address: wstethAddress,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, amountWei],
          account: sender,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: wstethAddress,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, amountWei],
          account: sender,
        });
        gasEstimateNote = "";
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      const lines = [
        `=== DRY RUN: Transfer wstETH on ${appConfig.chain.name} ===`,
        "",
        `From: ${sender}`,
        `To: ${to}`,
        `Amount: ${amount} wstETH`,
        `Your balance: ${formatEther(balance)} wstETH`,
        "",
        `Gas estimate: ${gasEstimate.toString()}${gasEstimateNote ? ` ${gasEstimateNote}` : ""}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];

      if (simulationError) {
        lines.push(`Simulation note: ${simulationError}`);
      }

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: wstethAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as Address, amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const lines = [
      `=== wstETH Transfer on ${appConfig.chain.name} ===`,
      `Transaction hash: ${txHash}`,
      `From: ${sender}`,
      `To: ${to}`,
      `Amount: ${amount} wstETH`,
      `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

const l2ChainEntries = Object.entries(L2_WSTETH_CHAINS).map(([name, cfg]) => ({
  name,
  ...cfg,
}));

const l2ClientCache = new Map<number, PublicClient>();

function getL2Client(chainId: number, rpcUrl: string): PublicClient {
  let client = l2ClientCache.get(chainId);
  if (!client) {
    client = createPublicClient({
      transport: http(rpcUrl, { timeout: 10_000, retryCount: 1 }),
    });
    l2ClientCache.set(chainId, client);
  }
  return client;
}

export const l2AllBalancesToolDef = {
  name: "lido_get_all_l2_balances",
  description:
    "Query wstETH balances across all supported L2 chains in a single call. " +
    "Returns balances on Arbitrum, Optimism, Base, Polygon, zkSync, Mantle, Linea, Scroll, Mode, BNB Chain, and Zircuit.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address (0x...). Defaults to the configured wallet.",
      },
    },
  },
  annotations: {
    title: "[L2] All L2 wstETH Balances",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleL2GetAllBalances(args: Record<string, unknown>) {
  try {
    const { address: rawAddr } = balanceSchema.parse(args);
    const address = (rawAddr ?? getAccountAddress()) as Address;

    const results = await Promise.allSettled(
      l2ChainEntries.map(async (chain) => {
        const client = getL2Client(chain.chainId, chain.rpcUrl);
        const balance = await client.readContract({
          address: chain.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
        return { name: chain.name, chainId: chain.chainId, balance };
      })
    );

    const lines = [
      `=== Cross-Chain wstETH Balances for ${address} ===`,
      "",
    ];

    let totalFound = 0;
    for (let i = 0; i < l2ChainEntries.length; i++) {
      const chain = l2ChainEntries[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        const bal = formatEther(result.value.balance);
        lines.push(`  ${chain.name} (${chain.chainId}): ${bal} wstETH`);
        if (result.value.balance > 0n) totalFound++;
      } else {
        lines.push(`  ${chain.name} (${chain.chainId}): query failed`);
      }
    }

    lines.push("");
    lines.push(`Chains with balance: ${totalFound}/${l2ChainEntries.length}`);

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const l2InfoToolDef = {
  name: "lido_l2_get_wsteth_info",
  description:
    `Get wstETH token info on ${appConfig.chain.name}: total bridged supply and contract address. ` +
    "Useful for understanding L2 wstETH liquidity.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: `wstETH Info (${appConfig.chain.name})`,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleL2GetInfo(_args: Record<string, unknown>) {
  try {
    const wstethAddress = getWstethAddress();

    const totalSupply = await publicClient.readContract({
      address: wstethAddress,
      abi: erc20Abi,
      functionName: "totalSupply",
    });

    const lines = [
      `=== wstETH on ${appConfig.chain.name} ===`,
      "",
      `Contract: ${wstethAddress}`,
      `Total bridged supply: ${formatEther(totalSupply)} wstETH`,
      "",
      "About wstETH on L2:",
      "  wstETH is bridged from Ethereum mainnet via canonical bridges.",
      "  It's a standard ERC-20 token whose value tracks the L1 stETH/ETH rate.",
      "  The balance does not rebase — value accrues through the exchange rate.",
      "",
      "What you can do on L2:",
      "  - Hold wstETH (value grows as L1 staking rewards accrue)",
      "  - Transfer wstETH between addresses",
      "  - Use wstETH in L2 DeFi protocols (lending, LP, etc.)",
      "",
      "What requires L1:",
      "  - Staking ETH to get stETH/wstETH",
      "  - Wrapping stETH to wstETH (or unwrapping)",
      "  - Requesting withdrawals back to ETH",
      "  - Governance actions (voting, veto signalling)",
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
