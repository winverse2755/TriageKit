// skit-risk-guard/risk-guard-workflow/types.ts
// Type definitions for the CRE Risk Guard Workflow

/**
 * Agent risk profile: pre-commitment behavior under stress (TriageKit / Risk Guard).
 */
export type AgentProfile = "conservative" | "balanced" | "backstop";

/**
 * Recommended response action derived from profile + observed deviation.
 */
export type ProfileAction =
  | "FULL_EXIT"
  | "PARTIAL_ROTATE_HOLD"
  | "HOLD_LOG_INTENT";

export type RotationExecutionStatus =
  | "NOT_TRIGGERED"
  | "QUOTED"
  | "EXECUTED"
  | "FAILED";

export interface RotationQuote {
  provider: "uniswap";
  chainId: number;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  route: string[];
  raw?: Record<string, unknown>;
}

export interface RotationMetadata {
  shouldRotate: boolean;
  partialExitAmount: string;
  fromToken: string;
  toToken: string;
  quote?: RotationQuote;
  executionStatus: RotationExecutionStatus;
  executionError?: string;
  txHash?: string;
  explorerUrl?: string;
  keeperExecutionHash?: string;
  keeperAuditUrl?: string;
}

/**
 * Settlement intent payload received via HTTP trigger.
 * Contains all parameters needed to assess risk for a cross-chain settlement.
 */
export interface SettlementIntent {
  /** Source chain identifier (e.g., "baseSepolia") */
  sourceChain: string;
  /** Target chain identifier (e.g., "unichainSepolia") */
  targetChain: string;
  /** Token symbol or address to transfer */
  token: string;
  /** Transfer amount in base units (wei) */
  amount: string;
  /** Maximum acceptable slippage as decimal (e.g., 0.01 for 1%) */
  maxSlippageTolerance: number;
  /** Maximum acceptable bridge delay in milliseconds */
  maxBridgeDelay: number;
  /** Tenderly fork RPC endpoint for source chain */
  sourceRpc: string;
  /** Tenderly fork RPC endpoint for target chain */
  targetRpc: string;
  /** Optional agent risk profile (defaults to balanced if omitted) */
  agentProfile?: AgentProfile;
}

/**
 * Oracle price data fetched from Chainlink Data Feeds.
 */
export interface OracleData {
  /** ETH/USD price with 8 decimals */
  ethUsdPrice: bigint;
  /** USDC/USD price with 8 decimals */
  usdcUsdPrice: bigint;
  /** Block timestamp when prices were fetched */
  timestamp: number;
  /** Round ID from latest Chainlink update */
  roundId?: bigint;
}

/**
 * Pool health data from Uniswap v4 PoolManager.
 */
export interface PoolData {
  /** Current sqrt price as Q64.96 fixed point */
  sqrtPriceX96: bigint;
  /** Current tick (log base 1.0001 of price) */
  tick: number;
  /** Available liquidity in the active tick range */
  liquidity: bigint;
  /** Liquidity depth assessment */
  liquidityDepth: "deep" | "moderate" | "shallow";
  /** LP fee tier in basis points (e.g., 3000 = 0.3%) */
  lpFee: number;
  /** Protocol fee if any */
  protocolFee?: number;
}

/**
 * Bridge status data from Circle CCTP API.
 */
export interface BridgeData {
  /** Current attestation status */
  attestationStatus: "pending" | "complete" | "failed" | "unknown";
  /** Estimated time to confirmation in milliseconds */
  estimatedConfirmationMs: number;
  /** Position in attestation queue if available */
  queuePosition?: number;
  /** CCTP domain ID for source chain */
  sourceDomain?: number;
  /** CCTP domain ID for destination chain */
  destinationDomain?: number;
}

/**
 * Aggregated risk data returned by the workflow.
 * Contains all fetched data for downstream threshold evaluation.
 */
export interface RiskDataFetch {
  /** Oracle price data */
  oracle: OracleData;
  /** Pool health data */
  pool: PoolData;
  /** Bridge status data */
  bridge: BridgeData;
  /** Original settlement intent */
  intent: SettlementIntent;
  /** Fetch metadata */
  metadata: {
    /** Timestamp when data was fetched */
    fetchedAt: number;
    /** Whether all fetches succeeded */
    complete: boolean;
    /** Any errors encountered */
    errors?: string[];
  };
}

/**
 * Chainlink Data Feed addresses per chain.
 */
export interface ChainlinkFeedConfig {
  /** ETH/USD price feed address */
  ETH_USD: string;
  /** USDC/USD price feed address */
  USDC_USD: string;
  /** Additional feeds can be added here */
  [key: string]: string;
}

/**
 * Threshold configuration for risk evaluation.
 */
export interface ThresholdConfig {
  /** Maximum acceptable price deviation between oracle and DEX (e.g., 1 for 1%) */
  maxPriceDeviationPercent: number;
  /** Multiplier for critical slippage threshold (e.g., 2 means 2x max = critical) */
  criticalSlippageMultiplier: number;
  /** Minimum required liquidity depth */
  minLiquidityDepth: "deep" | "moderate" | "shallow";
  /** Maximum acceptable price staleness in seconds */
  maxPriceStalenessSeconds: number;
}

/**
 * Workflow configuration loaded from config.staging.json.
 */
export interface WorkflowConfig {
  /** Authorized wallet addresses for HTTP trigger */
  authorizedKeys: string[];
  /** Chainlink feed addresses by chain */
  chainlinkFeeds: {
    baseSepolia: ChainlinkFeedConfig;
    [chain: string]: ChainlinkFeedConfig;
  };
  /** Uniswap v4 PoolManager address */
  poolManagerAddress: string;
  /** Circle CCTP API base URL */
  cctpApiUrl: string;
  /** CCTP domain IDs for cross-chain messaging */
  cctpDomains?: {
    [chain: string]: number;
  };
  /** Backend webhook URL for BLOCKED/WARNING reports */
  webhookUrl?: string;
  /** Deterministic executor URL for APPROVED reports */
  executorUrl?: string;
  /** Tenderly explorer base URL */
  tenderlyExplorerBase?: string;
  /** Risk evaluation thresholds */
  thresholds?: ThresholdConfig;
}

/**
 * HTTP trigger response structure.
 */
export interface WorkflowResponse {
  /** Whether the workflow completed successfully */
  success: boolean;
  /** Risk data if successful */
  data?: RiskDataFetch;
  /** Error message if failed */
  error?: string;
  /** Workflow execution ID for tracing */
  executionId?: string;
}

/**
 * Chainlink AggregatorV3 latestRoundData response.
 */
export interface AggregatorRoundData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

/**
 * CCTP API response for message status.
 */
export interface CCTPMessageStatus {
  status: string;
  attestation?: string;
  message?: string;
  eventNonce?: string;
  sourceDomain?: number;
  destinationDomain?: number;
}

/**
 * Risk threshold configuration for evaluation.
 */
export interface RiskThresholds {
  /** Maximum acceptable slippage */
  maxSlippage: number;
  /** Maximum acceptable price impact */
  maxPriceImpact: number;
  /** Minimum required liquidity depth */
  minLiquidityDepth: "deep" | "moderate" | "shallow";
  /** Maximum acceptable bridge delay in ms */
  maxBridgeDelayMs: number;
  /** Maximum price staleness in seconds */
  maxPriceStalenessSeconds: number;
}

/**
 * Risk evaluation result after threshold checks.
 */
export interface RiskEvaluation {
  /** Overall recommendation */
  action: "execute" | "wait" | "abort";
  /** Confidence score 0-1 */
  confidence: number;
  /** Individual check results */
  checks: {
    slippageOk: boolean;
    priceImpactOk: boolean;
    liquidityOk: boolean;
    bridgeDelayOk: boolean;
    priceFreshnessOk: boolean;
  };
  /** Human-readable summary */
  summary: string;
}

// ============================================================================
// Risk Report Types (Phase 2: Threshold Evaluation & Report Emission)
// ============================================================================

/**
 * Severity level for risk checks.
 * - info: Informational, does not affect status
 * - warning: Non-critical, results in WARNING status
 * - critical: Critical failure, results in BLOCKED status
 */
export type CheckSeverity = "info" | "warning" | "critical";

/**
 * Risk report status.
 * - APPROVED: All checks pass, settlement can proceed
 * - WARNING: Some non-critical checks failed, needs review
 * - BLOCKED: Critical checks failed, settlement should not proceed
 */
export type RiskStatus = "APPROVED" | "WARNING" | "BLOCKED";

/**
 * Individual risk check result.
 */
export interface RiskCheck {
  /** Check name (e.g., "slippage", "liquidity", "bridgeDelay", "priceDeviation") */
  name: string;
  /** Whether the check passed */
  passed: boolean;
  /** Actual value observed */
  actual: string | number;
  /** Threshold value for comparison */
  threshold: string | number;
  /** Severity level of this check */
  severity: CheckSeverity;
  /** Human-readable description */
  description?: string;
}

/**
 * Tenderly simulation result data.
 */
export interface TenderlySim {
  /** Whether the simulation succeeded */
  success: boolean;
  /** Estimated gas for the transaction */
  gasEstimate: string;
  /** Expected output amount from the swap */
  expectedOutput: string;
  /** Tenderly Virtual TestNet ID (extracted from RPC URL) */
  vnetId?: string;
  /** Transaction hash if simulation was executed */
  txHash?: string;
}

/**
 * Oracle data in serializable format for the report.
 */
export interface OracleDataReport {
  /** ETH/USD price as string (bigint serialized) */
  ethUsdPrice: string;
  /** USDC/USD price as string (bigint serialized) */
  usdcUsdPrice: string;
  /** Block timestamp when prices were fetched */
  timestamp: number;
}

/** Pool key for Uniswap v4 (for executor when workflow discovers the pool) */
export interface PoolKeyReport {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

/**
 * Complete risk report emitted by the workflow.
 */
export interface RiskReport {
  /** Overall risk status */
  status: RiskStatus;
  /** Individual check results */
  checks: RiskCheck[];
  /** Oracle data used in evaluation */
  oracleData: OracleDataReport;
  /** Tenderly simulation results */
  tenderlySim: TenderlySim;
  /** Tenderly explorer URL for traceability */
  explorerUrl: string;
  /** Unique recipe/settlement ID */
  recipeId: string;
  /** Report generation timestamp */
  timestamp: number;
  /** Original settlement intent */
  intent: SettlementIntent;
  /** Resolved pool ID from discovery (keccak256 of pool key) */
  selectedPoolId?: string;
  /** Resolved pool key for execution */
  selectedPoolKey?: PoolKeyReport;
  /** Additional metadata */
  metadata?: {
    /** Workflow execution ID */
    executionId?: string;
    /** Any warnings or notes */
    notes?: string[];
    /** Effective agent profile used for this evaluation */
    agentProfile?: AgentProfile;
    /** Derived action when deviation triggers a profile-specific response */
    profileAction?: ProfileAction;
    /** Backstop: stabilization intent recorded for audit */
    stabilizationIntentLogged?: boolean;
    /** Observed oracle/DEX deviation % at evaluation (mainnet pools only) */
    priceDeviationPercent?: number;
    /** Rotation details for PARTIAL_ROTATE_HOLD profile action */
    rotation?: RotationMetadata;
  };
}

/**
 * Webhook payload for backend notification.
 */
export interface WebhookPayload {
  /** Event type */
  event: "RISK_REPORT";
  /** The risk report */
  report: RiskReport;
  /** Webhook timestamp */
  sentAt: number;
}

/**
 * Executor signal payload for approved settlements.
 */
export interface ExecutorSignal {
  /** Signal type */
  action: "EXECUTE";
  /** The risk report */
  report: RiskReport;
  /** Signal timestamp */
  signalAt: number;
}
