/**
 * Easy Track factory address → human-readable label mapping.
 * These are the registered EVM script factories on Ethereum mainnet.
 * Maintained manually as new factories are registered by DAO votes.
 */

const MAINNET_FACTORY_LABELS: Record<string, string> = {
  // Reward programs
  "0x648C8Be548F43eca4e482C0801Ebccccfb944931": "Reward Program: Add reward program",
  "0x7E8eFfAb3083c1931F5F29cB7F36dC776634BDBd": "Reward Program: Remove reward program",
  "0xFeBd8FAC16De88206d4b18764e826AF38546AfE0": "Reward Program: Top up reward programs",

  // stETH transfers
  "0x1dCFc37719A99d73a0ce25CeEcbeFbF39938cF2C": "Finance: Top up allowed recipients (stETH)",
  "0x935cb3366Faf2cFC415B2099d1F974Fd27202b77": "Finance: Add allowed recipient (stETH)",
  "0x22010d1747CaFc370b1f1FBBa61022A313c5693b": "Finance: Remove allowed recipient (stETH)",

  // DAI transfers
  "0x84f74733ede9bFD53c1B3Ea96338867C94EC313e": "Finance: Top up allowed recipients (DAI)",
  "0x4E6D3A5023A38cE2C4c5456d3760357fD93a22cD": "Finance: Add allowed recipient (DAI)",
  "0xd8f9B72Cd97388f23814ECF429cd18815F6352c1": "Finance: Remove allowed recipient (DAI)",

  // LDO transfers
  "0x77781A93C4824d2299a38AC8bBB11eb3cd6Bc3B7": "Finance: Top up allowed recipients (LDO)",
  "0x929547490Ceb6AeEdD7d72F1Ab8957c0210b6E51": "Finance: Add allowed recipient (LDO)",
  "0xE550c24C1bF448a2AC6634C87Ce79C09d8e72c69": "Finance: Remove allowed recipient (LDO)",

  // Gas supply
  "0x200dA0b6a9905A377CF8D469664C65dB267009d1": "Gas Supply: Top up gas supply",
  "0x49D1363B5544eFbBe8B85Ae0cFb7A07C55405a73": "Gas Supply: Add gas supply recipient",
  "0x48c135Ff690C2Aa7F5B11C539104B5855A4f9252": "Gas Supply: Remove gas supply recipient",

  // Referral partners
  "0x54058ee0E0c87Ad813C002262cD75B98A7F59218": "Referral Program: Add referral partner",
  "0xE9eb838fb3A288bF59E9275Ccd7e124fDff48a44": "Referral Program: Remove referral partner",
  "0xBd2b6dC189EefD51B273F0cb2133eDB2E5D0e73e": "Referral Program: Top up referral partners",

  // Node operators
  "0xE225C3a3e440aE0285a363a81b72d28780FB1ae7": "Node Operators: Increase staking limit",
  "0x8B2b74bCE428e41067f468Ac4B0C20d41C98e45F": "Node Operators: Set name/reward address",

  // Sandbox (for testing new motions)
  "0x6D09C905a701c1AA0C39F1dC548Ee72c12Ff5Cf1": "Sandbox: Add allowed recipient",
  "0xdfeEd546f33cA7e1E8FE3A9bb7FE11957856FD2a": "Sandbox: Remove allowed recipient",
  "0x6d5cF2d7D40deE229e97968930FEEFd31E990f33": "Sandbox: Top up allowed recipients",

  // Alliance
  "0xD5fFd25fEe7D97aB8A2a9C78915E2ACA1AEdf462": "Alliance: Add allowed recipient",
  "0x80A270396e8b66e9F4f87C38F993e5Be22B44620": "Alliance: Remove allowed recipient",
  "0x76D3f00A10c396892FD561BeAE087717EB7a4A81": "Alliance: Top up allowed recipients",
};

const HOLESKY_FACTORY_LABELS: Record<string, string> = {
  // Holesky uses different addresses for testnet factories
};

const FACTORY_LABELS: Record<number, Record<string, string>> = {
  1: MAINNET_FACTORY_LABELS,
  17000: HOLESKY_FACTORY_LABELS,
};

/**
 * Get human-readable label for an Easy Track factory address.
 * Returns the address itself if no label is found.
 */
export function getFactoryLabel(chainId: number, factoryAddress: string): string {
  const labels = FACTORY_LABELS[chainId] ?? {};
  return labels[factoryAddress] ?? `Unknown factory (${factoryAddress})`;
}

/**
 * Get all known factory labels for a chain.
 */
export function getAllFactoryLabels(chainId: number): Record<string, string> {
  return FACTORY_LABELS[chainId] ?? {};
}
