import type { V2Mode } from '../pipeline/types.ts';

export function resolveV2Mode(
  requestedMode: string | undefined,
  liveConfirmation: string | undefined,
): V2Mode {
  if (requestedMode === 'live') {
    return liveConfirmation === 'yes' ? 'live' : 'paper';
  }
  if (requestedMode === 'paper' || requestedMode === 'shadow') {
    return requestedMode;
  }
  return 'shadow';
}

/** Dual interlock: live only when V2_MODE=live and V2_LIVE_CONFIRMED=yes. */
export function isLiveTradingConfirmed(
  requestedMode: string | undefined = process.env.V2_MODE,
  liveConfirmation: string | undefined = process.env.V2_LIVE_CONFIRMED,
): boolean {
  return resolveV2Mode(requestedMode, liveConfirmation) === 'live';
}

/**
 * Defense-in-depth for exchange adapters / side services that can place
 * real orders. Call at the top of every place/cancel path.
 */
export function assertLiveOrdersAllowed(
  requestedMode: string | undefined = process.env.V2_MODE,
  liveConfirmation: string | undefined = process.env.V2_LIVE_CONFIRMED,
): void {
  if (!isLiveTradingConfirmed(requestedMode, liveConfirmation)) {
    throw new Error(
      'Live exchange orders blocked: require V2_MODE=live and V2_LIVE_CONFIRMED=yes',
    );
  }
}
