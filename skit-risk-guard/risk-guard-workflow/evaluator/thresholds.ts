// skit-risk-guard/risk-guard-workflow/evaluator/thresholds.ts
// Default thresholds and helper functions for risk evaluation

import type { AgentProfile, ThresholdConfig, CheckSeverity } from "../types";

/**
 * Profile-specific oracle/DEX deviation bands (%).
 * - conservative: treat above exitThreshold as failed (full exit regime)
 * - balanced: warn between rotateAt and exitAt; critical above exitAt
 * - backstop: pass until holdUntil; critical above holdUntil
 */
export const PROFILE_DEVIATION_BANDS: Record<
  AgentProfile,
  {
    /** Deviation % at or below: check passes */
    passMax: number;
    /** For balanced: warning band starts above this */
    rotateAt?: number;
    /** Above this: critical (full exit) */
    exitAt: number;
  }
> = {
  conservative: { passMax: 3, exitAt: 3 },
  balanced: { passMax: 5, rotateAt: 5, exitAt: 10 },
  backstop: { passMax: 20, exitAt: 20 },
};

/**
 * Default threshold configuration.
 * Used when thresholds are not specified in config.
 */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  maxPriceDeviationPercent: 1, // 1% max deviation between oracle and DEX
  criticalSlippageMultiplier: 2, // 2x max slippage = critical
  minLiquidityDepth: "moderate",
  maxPriceStalenessSeconds: 3600, // 1 hour
};

/**
 * Liquidity depth ordering for comparison.
 */
export const LIQUIDITY_DEPTH_ORDER: Record<string, number> = {
  shallow: 0,
  moderate: 1,
  deep: 2,
};

/**
 * Check if liquidity depth meets minimum requirement.
 */
export function meetsLiquidityRequirement(
  actual: "deep" | "moderate" | "shallow",
  minimum: "deep" | "moderate" | "shallow"
): boolean {
  return LIQUIDITY_DEPTH_ORDER[actual] >= LIQUIDITY_DEPTH_ORDER[minimum];
}

/**
 * Determine severity based on how much a value exceeds the threshold.
 * - Within threshold: info (pass)
 * - Exceeds threshold but < critical multiplier: warning
 * - Exceeds critical multiplier: critical
 */
export function determineSeverity(
  actual: number,
  threshold: number,
  criticalMultiplier: number = 2
): { passed: boolean; severity: CheckSeverity } {
  if (actual <= threshold) {
    return { passed: true, severity: "info" };
  }

  if (actual <= threshold * criticalMultiplier) {
    return { passed: false, severity: "warning" };
  }

  return { passed: false, severity: "critical" };
}

/**
 * Calculate minimum liquidity required for a given trade amount.
 * Uses a simple heuristic: amount * 10 for reasonable price impact.
 */
export function calculateMinLiquidity(amount: string): bigint {
  const amountBigInt = BigInt(amount);
  // Require at least 10x the trade amount in liquidity
  return amountBigInt * 10n;
}

/**
 * Calculate price from sqrtPriceX96.
 * price = (sqrtPriceX96 / 2^96)^2
 */
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  const Q96 = 2n ** 96n;
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  return sqrtPrice * sqrtPrice;
}

/**
 * Calculate price deviation percentage.
 */
export function calculatePriceDeviation(
  dexPrice: number,
  oraclePrice: number
): number {
  if (oraclePrice === 0) return 100;
  return Math.abs(dexPrice - oraclePrice) / oraclePrice * 100;
}

/**
 * Estimate slippage for a given trade.
 * Simplified constant product formula approximation.
 */
export function estimateSlippage(
  liquidity: bigint,
  amountIn: string,
  sqrtPriceX96: bigint
): number {
  const amount = BigInt(amountIn);

  if (liquidity === 0n) {
    return 1; // 100% slippage if no liquidity
  }

  const Q96 = 2n ** 96n;
  const effectiveLiquidity = (liquidity * sqrtPriceX96) / Q96;

  if (effectiveLiquidity === 0n) {
    return 1;
  }

  const slippage = Number(amount) / (2 * Number(effectiveLiquidity));
  return Math.min(slippage, 1);
}

/**
 * Check if oracle price is stale.
 */
export function isPriceStale(
  oracleTimestamp: number,
  maxStalenessSeconds: number
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - oracleTimestamp > maxStalenessSeconds;
}

/**
 * Extract Tenderly vnet ID from RPC URL without relying on the `URL` global
 * (not available in the CRE QuickJS runtime).
 * URL format: https://virtual.{chain}.eu.rpc.tenderly.co/{vnet-id}
 */
export function extractTenderlyVnetId(rpcUrl: string): string | undefined {
  try {
    const stripped = rpcUrl.replace(/\/$/, "");
    const lastSlash = stripped.lastIndexOf("/");
    if (lastSlash === -1) return undefined;
    const segment = stripped.slice(lastSlash + 1);
    return segment.length > 0 ? segment : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build Tenderly explorer URL.
 * If baseUrl is the project format (contains /project/testnet/), return baseUrl + /tx/{txHash} when txHash provided, else baseUrl.
 * Otherwise use legacy format: baseUrl/vnetId/transactions[/txHash].
 */
export function buildTenderlyExplorerUrl(
  baseUrl: string,
  vnetId?: string,
  txHash?: string
): string {
  const isProjectUrl = baseUrl.includes("/project/testnet/");
  if (isProjectUrl) {
    return txHash ? `${baseUrl}/tx/${txHash}` : baseUrl;
  }
  const base = vnetId ? `${baseUrl}/${vnetId}/transactions` : baseUrl;
  return txHash ? `${base}/${txHash}` : base;
}
