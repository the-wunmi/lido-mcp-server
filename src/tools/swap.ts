import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { appConfig } from "../config.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { validateAmountCap } from "../utils/security.js";

const SWAP_ROUTER_02: Address = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const QUOTER_V2: Address = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const WETH9: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const LDO_TOKEN: Address = "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32";
const POOL_FEE = 3000; // 0.3% tier

const quoterAbi = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const swapRouterAbi = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const erc20BalanceAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function assertMainnet(): void {
  if (appConfig.chainId !== 1) {
    throw new Error(
      "ETH→LDO swaps are only available on Ethereum mainnet (chain ID 1). " +
      `Current chain: ${appConfig.chainId}.`
    );
  }
}

async function getQuote(amountIn: bigint): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  const result = await publicClient.simulateContract({
    address: QUOTER_V2,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: WETH9,
        tokenOut: LDO_TOKEN,
        amountIn,
        fee: POOL_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return {
    amountOut: result.result[0],
    gasEstimate: result.result[3],
  };
}

function computeEffectivePrice(ethIn: bigint, ldoOut: bigint): string {
  if (ldoOut === 0n) return "N/A";
  const price = Number(ethIn) / Number(ldoOut);
  return price.toFixed(8);
}

export const getSwapQuoteToolDef = {
  name: "lido_get_swap_quote",
  description:
    "Get a price quote for swapping ETH to LDO tokens via Uniswap V3. " +
    "Returns the expected LDO output, effective price, and estimated gas cost. " +
    "Mainnet only. Read-only — no transaction is performed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount of ETH to swap (e.g. '0.1', '1.0')",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Get Swap Quote (ETH→LDO)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const swapEthForLdoToolDef = {
  name: "lido_swap_eth_for_ldo",
  description:
    "Swap ETH for LDO tokens via Uniswap V3. LDO is needed to vote on Lido DAO Aragon proposals. " +
    "Uses the 0.3% fee tier pool. Includes slippage protection. " +
    "Mainnet only. Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount of ETH to swap (e.g. '0.1', '1.0')",
      },
      slippage_percent: {
        type: "number",
        description: "Maximum acceptable slippage in percent (default: 0.5, max: 5.0). " +
          "The swap reverts on-chain if the output falls below the minimum.",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only — no transaction sent. Default: true.",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Swap ETH for LDO",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const quoteSchema = z.object({
  amount: ethAmountSchema,
});

const swapSchema = z.object({
  amount: ethAmountSchema,
  slippage_percent: z.number().min(0.01).max(5.0).optional().default(0.5),
  dry_run: z.boolean().optional().default(true),
});

export async function handleGetSwapQuote(args: Record<string, unknown>) {
  try {
    assertMainnet();
    const { amount } = quoteSchema.parse(args);
    const amountIn = parseEther(amount);
    const address = getAccountAddress();

    const [quote, ethBalance, ldoBalance] = await Promise.all([
      getQuote(amountIn),
      publicClient.getBalance({ address }),
      publicClient.readContract({
        address: LDO_TOKEN,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    const gasPrice = await publicClient.getGasPrice();
    const gasCostWei = quote.gasEstimate * gasPrice;

    const lines = [
      "=== ETH → LDO Swap Quote (Uniswap V3) ===",
      "",
      `Input: ${amount} ETH`,
      `Expected output: ${formatEther(quote.amountOut)} LDO`,
      `Effective price: ${computeEffectivePrice(amountIn, quote.amountOut)} ETH/LDO`,
      `Pool fee: 0.3%`,
      "",
      `Estimated swap gas: ${quote.gasEstimate.toString()} units`,
      `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
      "",
      "Your balances:",
      `  ETH: ${formatEther(ethBalance)}`,
      `  LDO: ${formatEther(ldoBalance)}`,
    ];

    if (ethBalance < amountIn + gasCostWei) {
      lines.push(
        "",
        "⚠ Warning: You may not have enough ETH to cover the swap amount plus gas fees.",
      );
    }

    lines.push(
      "",
      "To execute: use lido_swap_eth_for_ldo with the same amount.",
    );

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleSwapEthForLdo(args: Record<string, unknown>) {
  try {
    assertMainnet();
    const { amount, slippage_percent, dry_run } = swapSchema.parse(args);
    const amountIn = parseEther(amount);
    const address = getAccountAddress();

    const capError = validateAmountCap(amountIn);
    if (capError) return errorResult(capError);

    const ethBalance = await publicClient.getBalance({ address });
    if (ethBalance < amountIn) {
      return errorResult(
        `Insufficient ETH balance. You have ${formatEther(ethBalance)} ETH ` +
        `but are trying to swap ${amount} ETH.`,
      );
    }

    const quote = await getQuote(amountIn);
    const slippageMultiplier = BigInt(Math.floor((100 - slippage_percent) * 100));
    const amountOutMinimum = (quote.amountOut * slippageMultiplier) / 10000n;

    const swapParams = {
      tokenIn: WETH9,
      tokenOut: LDO_TOKEN,
      fee: POOL_FEE,
      recipient: address,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    } as const;

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 200_000n;
      let gasEstimateNote = "(using conservative estimate)";

      try {
        await publicClient.simulateContract({
          address: SWAP_ROUTER_02,
          abi: swapRouterAbi,
          functionName: "exactInputSingle",
          args: [swapParams],
          value: amountIn,
          account: address,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: SWAP_ROUTER_02,
          abi: swapRouterAbi,
          functionName: "exactInputSingle",
          args: [swapParams],
          value: amountIn,
          account: address,
        });
        gasEstimateNote = "";
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      const lines = [
        "=== DRY RUN: Swap ETH for LDO (Uniswap V3) ===",
        "",
        `Input: ${amount} ETH`,
        `Expected output: ${formatEther(quote.amountOut)} LDO`,
        `Minimum output (after ${slippage_percent}% slippage): ${formatEther(amountOutMinimum)} LDO`,
        `Effective price: ${computeEffectivePrice(amountIn, quote.amountOut)} ETH/LDO`,
        `Pool fee: 0.3%`,
        "",
        `Gas estimate: ${gasEstimate.toString()}${gasEstimateNote ? ` ${gasEstimateNote}` : ""}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];

      if (simulationError) {
        lines.push(`Simulation note: ${simulationError}`);
      }

      lines.push(
        "",
        "What this does:",
        `  Swaps ${amount} ETH for ~${formatEther(quote.amountOut)} LDO via Uniswap V3.`,
        `  The swap will revert on-chain if output is below ${formatEther(amountOutMinimum)} LDO.`,
        "  LDO tokens are sent to your wallet address.",
        "",
        "Set dry_run=false to execute the swap.",
      );

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: SWAP_ROUTER_02,
      abi: swapRouterAbi,
      functionName: "exactInputSingle",
      args: [swapParams],
      value: amountIn,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const ldoBalance = await publicClient.readContract({
      address: LDO_TOKEN,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [address],
    });

    if (receipt.status !== "success") {
      return errorResult(
        `Swap transaction reverted (tx: ${txHash}). ` +
        "Your ETH was not spent (only gas was consumed). " +
        "The price may have moved beyond your slippage tolerance.",
      );
    }

    const lines = [
      "=== Swap Complete: ETH → LDO (Uniswap V3) ===",
      "",
      `Transaction hash: ${txHash}`,
      `Status: Confirmed`,
      `ETH spent: ${amount}`,
      `Gas used: ${receipt.gasUsed.toString()}`,
      "",
      `Your LDO balance: ${formatEther(ldoBalance)} LDO`,
      "",
      "You can now use lido_vote_on_proposal to vote on Lido DAO proposals.",
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
