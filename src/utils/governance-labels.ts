/** Canonical governance state labels — imported by governance.ts and resources.ts */

export const GOVERNANCE_STATE_LABELS: Record<number, string> = {
  0: "NotInitialized",
  1: "Normal",
  2: "VetoSignalling",
  3: "VetoSignallingDeactivation",
  4: "VetoCooldown",
  5: "RageQuit",
};

export const GOVERNANCE_STATE_DESCRIPTIONS: Record<number, string> = {
  0: "Governance system has not been initialized.",
  1: "Normal operation — proposals can be executed without restriction.",
  2: "Stakers are actively signalling a veto. Proposals are blocked until resolved.",
  3: "Veto signalling is winding down. If support drops, governance returns to Normal.",
  4: "Cooldown period after veto signalling. Governance will transition to Normal or back to VetoSignalling.",
  5: "Stakers have triggered a rage quit — stETH is being withdrawn from the protocol en masse.",
};

/** Easy Track motion status labels */
export const EASY_TRACK_STATUS_LABELS: Record<string, string> = {
  active: "Active — open for objection",
  enacted: "Enacted — motion passed and was executed",
  rejected: "Rejected — objection threshold exceeded",
  cancelled: "Cancelled — motion was cancelled by the creator",
};
