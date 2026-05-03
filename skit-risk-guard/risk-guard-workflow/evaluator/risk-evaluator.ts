// skit-risk-guard/risk-guard-workflow/evaluator/risk-evaluator.ts
// Risk evaluation logic with threshold checks

import type {
  SettlementIntent,
  OracleData,
  PoolData,
  BridgeData,
  WorkflowConfig,
  RiskCheck,
  RiskStatus,
  RiskReport,
  TenderlySim,
  OracleDataReport,
  ThresholdConfig,
  PoolKeyReport,
  AgentProfile,
  ProfileAction,
} from "../types";
import {
  DEFAULT_THRESHOLDS,
  PROFILE_DEVIATION_BANDS,
  determineSeverity,
  meetsLiquidityRequirement,
  calculateMinLiquidity,
  sqrtPriceX96ToPrice,
  calculatePriceDeviation,
  estimateSlippage,
  isPriceStale,
  extractTenderlyVnetId,
  buildTenderlyExplorerUrl,
} from "./thresholds";

export class FatalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalStateError";
  }
}

/**
 * Returns true when the chain name looks like a testnet.
 * Matches common testnet suffixes/keywords used in this codebase.
 */
export function effectiveAgentProfile(intent: SettlementIntent): AgentProfile {
  return intent.agentProfile ?? "balanced";
}

/**
 * Maps profile + observed deviation to recommended action and backstop audit flag.
 */
export function deriveProfileMetadata(
  profile: AgentProfile,
  deviationPercent: number | undefined
): {
  profileAction?: ProfileAction;
  stabilizationIntentLogged?: boolean;
} {
  if (deviationPercent === undefined || Number.isNaN(deviationPercent)) {
    return {};
  }
  const bands = PROFILE_DEVIATION_BANDS[profile];

  if (profile === "conservative") {
    if (deviationPercent > bands.exitAt) {
      return { profileAction: "FULL_EXIT" };
    }
    return {};
  }

  if (profile === "balanced") {
    if (deviationPercent > bands.exitAt) {
      return { profileAction: "FULL_EXIT" };
    }
    if (
      bands.rotateAt !== undefined &&
      deviationPercent > bands.rotateAt &&
      deviationPercent <= bands.exitAt
    ) {
      return { profileAction: "PARTIAL_ROTATE_HOLD" };
    }
    return {};
  }

  // backstop
  if (deviationPercent > bands.exitAt) {
    return { profileAction: "FULL_EXIT" };
  }
  return {
    profileAction: "HOLD_LOG_INTENT",
    stabilizationIntentLogged: true,
  };
}

function isTestnetChain(chainName: string): boolean {
  const lower = chainName.toLowerCase();
  return (
    lower.includes("sepolia") ||
    lower.includes("testnet") ||
    lower.includes("goerli") ||
    lower.includes("mumbai") ||
    lower.includes("fuji")
  );
}

/**
 * Evaluates all risk checks for a settlement.
 * Returns an array of RiskCheck results.
 */
export function evaluateRisk(
  intent: SettlementIntent,
  oracle: OracleData,
  pool: PoolData,
  bridge: BridgeData,
  config: WorkflowConfig
): RiskCheck[] {
  const thresholds = config.thresholds ?? DEFAULT_THRESHOLDS;
  const profile = effectiveAgentProfile(intent);
  const checks: RiskCheck[] = [];

  // 1. Slippage Check
  checks.push(evaluateSlippage(intent, pool, thresholds));

  // 2. Liquidity Depth Check
  checks.push(evaluateLiquidity(intent, pool, thresholds));

  // 3. Bridge Delay Check
  checks.push(evaluateBridgeDelay(intent, bridge));

  // 4. Oracle vs DEX Price Deviation Check
  // Skipped on testnet: no real trading activity means the DEX price is
  // meaningless and will always diverge wildly from the oracle.
  if (isTestnetChain(intent.targetChain)) {
    checks.push({
      name: "priceDeviation",
      passed: true,
      actual: "N/A",
      threshold: PROFILE_DEVIATION_BANDS[profile].passMax,
      severity: "info",
      description: `Price deviation check skipped — testnet chain (${intent.targetChain}) has no reliable market price (profile=${profile})`,
    });
  } else {
    checks.push(evaluatePriceDeviation(oracle, pool, profile, thresholds));
  }

  // 5. Price Staleness Check (bonus check)
  checks.push(evaluatePriceStaleness(oracle, thresholds));

  if (!pool || pool.liquidity === 0n) {
    throw new FatalStateError("Pool state unavailable");
 }

  return checks;
}

/**
 * Evaluates slippage against maximum tolerance.
 */
function evaluateSlippage(
  intent: SettlementIntent,
  pool: PoolData,
  thresholds: ThresholdConfig
): RiskCheck {
  const simulatedSlippage = estimateSlippage(
    pool.liquidity,
    intent.amount,
    pool.sqrtPriceX96
  );

  const maxSlippage = intent.maxSlippageTolerance;
  const { passed, severity } = determineSeverity(
    simulatedSlippage,
    maxSlippage,
    thresholds.criticalSlippageMultiplier
  );

  return {
    name: "slippage",
    passed,
    actual: Number((simulatedSlippage * 100).toFixed(4)),
    threshold: Number((maxSlippage * 100).toFixed(4)),
    severity,
    description: `Simulated slippage ${(simulatedSlippage * 100).toFixed(2)}% vs max ${(maxSlippage * 100).toFixed(2)}%`,
  };
}

/**
 * Evaluates pool liquidity depth.
 */
function evaluateLiquidity(
  intent: SettlementIntent,
  pool: PoolData,
  thresholds: ThresholdConfig
): RiskCheck {
  const minRequired = calculateMinLiquidity(intent.amount);
  const hasEnoughLiquidity = pool.liquidity >= minRequired;
  const meetsDepthReq = meetsLiquidityRequirement(
    pool.liquidityDepth,
    thresholds.minLiquidityDepth
  );

  const passed = hasEnoughLiquidity && meetsDepthReq;

  // Shallow liquidity is always critical
  let severity: "info" | "warning" | "critical" = "info";
  if (!passed) {
    severity = pool.liquidityDepth === "shallow" ? "critical" : "warning";
  }

  return {
    name: "liquidity",
    passed,
    actual: pool.liquidityDepth,
    threshold: thresholds.minLiquidityDepth,
    severity,
    description: `Pool liquidity ${pool.liquidityDepth}, minimum required ${thresholds.minLiquidityDepth}`,
  };
}

/**
 * Evaluates bridge delay against maximum tolerance.
 */
function evaluateBridgeDelay(
  intent: SettlementIntent,
  bridge: BridgeData
): RiskCheck {
  const estimatedMs = bridge.estimatedConfirmationMs;
  const maxDelayMs = intent.maxBridgeDelay;
  const passed = estimatedMs <= maxDelayMs;

  // Bridge delay exceeding max is warning, not critical
  const severity: "info" | "warning" | "critical" = passed ? "info" : "warning";

  return {
    name: "bridgeDelay",
    passed,
    actual: estimatedMs,
    threshold: maxDelayMs,
    severity,
    description: `Estimated bridge time ${Math.round(estimatedMs / 1000)}s vs max ${Math.round(maxDelayMs / 1000)}s`,
  };
}

/**
 * Evaluates price deviation between oracle and DEX.
 */
function evaluatePriceDeviation(
  oracle: OracleData,
  pool: PoolData,
  profile: AgentProfile,
  _thresholds: ThresholdConfig
): RiskCheck {
  // Calculate DEX price from pool state
  const dexPrice = sqrtPriceX96ToPrice(pool.sqrtPriceX96);

  // Oracle price (8 decimals for Chainlink)
  const oraclePrice = Number(oracle.ethUsdPrice) / 1e8;

  // Calculate deviation percentage
  const deviation = calculatePriceDeviation(dexPrice, oraclePrice);
  const bands = PROFILE_DEVIATION_BANDS[profile];

  let passed: boolean;
  let severity: "info" | "warning" | "critical" = "info";

  if (profile === "balanced") {
    passed = deviation <= bands.passMax;
    if (deviation > bands.exitAt) {
      severity = "critical";
    } else if (deviation > (bands.rotateAt ?? bands.passMax)) {
      severity = "warning";
    }
  } else {
    // conservative & backstop: single pass band up to passMax (= exitAt)
    passed = deviation <= bands.passMax;
    if (!passed) {
      severity = "critical";
    }
  }

  const thresholdLabel =
    profile === "balanced"
      ? `pass≤${bands.passMax}% / rotate ${bands.rotateAt}-${bands.exitAt}% / exit>${bands.exitAt}%`
      : `pass≤${bands.passMax}%`;

  return {
    name: "priceDeviation",
    passed,
    actual: Number(deviation.toFixed(4)),
    threshold: thresholdLabel,
    severity,
    description: `Oracle/DEX deviation ${deviation.toFixed(2)}% (${profile} profile: ${thresholdLabel})`,
  };
}

/**
 * Evaluates oracle price staleness.
 */
function evaluatePriceStaleness(
  oracle: OracleData,
  thresholds: ThresholdConfig
): RiskCheck {
  const isStale = isPriceStale(
    oracle.timestamp,
    thresholds.maxPriceStalenessSeconds
  );

  const now = Math.floor(Date.now() / 1000);
  const age = now - oracle.timestamp;

  return {
    name: "priceStaleness",
    passed: !isStale,
    actual: age,
    threshold: thresholds.maxPriceStalenessSeconds,
    severity: isStale ? "warning" : "info",
    description: `Oracle price age ${age}s vs max ${thresholds.maxPriceStalenessSeconds}s`,
  };
}

/**
 * Determines overall risk status from check results.
 */
export function determineStatus(checks: RiskCheck[]): RiskStatus {
  const criticalFails = checks.filter(
    (c) => !c.passed && c.severity === "critical"
  );
  const warningFails = checks.filter(
    (c) => !c.passed && c.severity === "warning"
  );

  if (criticalFails.length > 0) return "BLOCKED";
  if (warningFails.length > 0) return "WARNING";
  return "APPROVED";
}

/**
 * Builds the complete risk report.
 */
export function buildReport(
  status: RiskStatus,
  checks: RiskCheck[],
  oracle: OracleData,
  pool: PoolData,
  intent: SettlementIntent,
  config: WorkflowConfig,
  executionId?: string,
  selectedPoolId?: string,
  selectedPoolKey?: PoolKeyReport
): RiskReport {
  const agentProfile = effectiveAgentProfile(intent);
  const priceDeviationCheck = checks.find((c) => c.name === "priceDeviation");
  let priceDeviationPercent: number | undefined;
  if (
    priceDeviationCheck &&
    typeof priceDeviationCheck.actual === "number"
  ) {
    priceDeviationPercent = priceDeviationCheck.actual;
  }
  const { profileAction, stabilizationIntentLogged } = deriveProfileMetadata(
    agentProfile,
    priceDeviationPercent
  );
  // Serialize oracle data for JSON
  const oracleData: OracleDataReport = {
    ethUsdPrice: oracle.ethUsdPrice.toString(),
    usdcUsdPrice: oracle.usdcUsdPrice.toString(),
    timestamp: oracle.timestamp,
  };

  // Build Tenderly simulation data
  const vnetId = extractTenderlyVnetId(intent.targetRpc);
  const tenderlySim: TenderlySim = {
    success: pool.sqrtPriceX96 > 0n, // Pool readable = sim success
    gasEstimate: "250000", // Estimated gas for swap
    expectedOutput: calculateExpectedOutput(intent, pool),
    // Omit vnetId entirely when undefined — CRE's QuickJS serializer
    // cannot wrap undefined values and will throw at return time.
    ...(vnetId !== undefined ? { vnetId } : {}),
  };

  // Build explorer URL (project format: .../winverse/project/testnet/{id}/tx/{txHash})
  const explorerBase =
    config.tenderlyExplorerBase ??
    "https://dashboard.tenderly.co/winverse/project/testnet/22cbc0df-919d-4cdc-927b-436480a7129f";
  const explorerUrl = buildTenderlyExplorerUrl(explorerBase, vnetId);

  // Generate recipe ID
  const recipeId = generateRecipeId(intent, executionId);

  // Collect any notes
  const notes: string[] = [];
  const failedChecks = checks.filter((c) => !c.passed);
  if (failedChecks.length > 0) {
    notes.push(
      `Failed checks: ${failedChecks.map((c) => c.name).join(", ")}`
    );
  }

  const metaNotes = [...notes];
  if (profileAction) {
    metaNotes.push(`Profile action: ${profileAction}`);
  }
  if (stabilizationIntentLogged) {
    metaNotes.push("Backstop stabilization intent logged for future incentive hooks");
  }

  return {
    status,
    checks,
    oracleData,
    tenderlySim,
    explorerUrl,
    recipeId,
    timestamp: Date.now(),
    intent,
    ...(selectedPoolId !== undefined ? { selectedPoolId } : {}),
    ...(selectedPoolKey !== undefined ? { selectedPoolKey } : {}),
    metadata: {
      executionId,
      agentProfile,
      ...(profileAction !== undefined ? { profileAction } : {}),
      ...(stabilizationIntentLogged !== undefined
        ? { stabilizationIntentLogged }
        : {}),
      ...(priceDeviationPercent !== undefined
        ? { priceDeviationPercent }
        : {}),
      // Omit notes when empty — undefined inside objects crashes CRE's serializer.
      ...(metaNotes.length > 0 ? { notes: metaNotes } : {}),
    },
  };
}

/**
 * Calculate expected output from swap (simplified).
 */
function calculateExpectedOutput(
  intent: SettlementIntent,
  pool: PoolData
): string {
  const price = sqrtPriceX96ToPrice(pool.sqrtPriceX96);
  const amountIn = BigInt(intent.amount);

  // Simplified: amount * price (assumes token0 -> token1)
  // In reality, this depends on swap direction and fee
  const expectedOutput = Number(amountIn) * price;

  return Math.floor(expectedOutput).toString();
}

/**
 * Generate a unique recipe ID.
 */
function generateRecipeId(
  intent: SettlementIntent,
  executionId?: string
): string {
  const base = `${intent.sourceChain}-${intent.targetChain}-${intent.amount}`;
  const timestamp = Date.now().toString(36);
  const suffix = executionId?.slice(-8) ?? Math.random().toString(36).slice(2, 10);
  return `recipe-${base}-${timestamp}-${suffix}`;
}

/**
 * Get a human-readable summary of the risk evaluation.
 */
export function getSummary(status: RiskStatus, checks: RiskCheck[]): string {
  const passedCount = checks.filter((c) => c.passed).length;
  const totalCount = checks.length;

  switch (status) {
    case "APPROVED":
      return `Settlement approved. All ${totalCount} checks passed.`;
    case "WARNING":
      const warningChecks = checks
        .filter((c) => !c.passed && c.severity === "warning")
        .map((c) => c.name);
      return `Settlement requires review. ${passedCount}/${totalCount} checks passed. Warnings: ${warningChecks.join(", ")}`;
    case "BLOCKED":
      const criticalChecks = checks
        .filter((c) => !c.passed && c.severity === "critical")
        .map((c) => c.name);
      return `Settlement blocked. ${passedCount}/${totalCount} checks passed. Critical failures: ${criticalChecks.join(", ")}`;
  }
}
