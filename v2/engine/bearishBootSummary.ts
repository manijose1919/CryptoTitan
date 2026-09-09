/**
 * Honest one-line summary of which bearish wrappers are actually active.
 */
export function describeBearishBootSummary(cfg: {
  SHORT_ENABLED: boolean;
  STAKING_ENABLED: boolean;
  ARB_ENABLED: boolean;
  DCA_SIM_ONLY: boolean;
  DCA_FEAR_ENABLED: boolean;
}): string {
  const shorts = cfg.SHORT_ENABLED ? 'on' : 'off';
  const staking = cfg.STAKING_ENABLED ? 'on' : 'off';
  const arb = cfg.ARB_ENABLED ? 'on' : 'off';
  let dca = 'off';
  if (cfg.DCA_FEAR_ENABLED) {
    dca = cfg.DCA_SIM_ONLY ? 'sim' : 'live-gated';
  }
  return `shorts=${shorts} staking=${staking} arb=${arb} dca=${dca}`;
}
