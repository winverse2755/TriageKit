/**
 * Types for the SettleKit backend server
 * Mirrors types from skit-risk-guard/risk-guard-workflow/types.ts
 */
export type AgentProfile = "conservative" | "balanced" | "backstop";
export type ProfileAction = "FULL_EXIT" | "PARTIAL_ROTATE_HOLD" | "HOLD_LOG_INTENT";
export type RotationExecutionStatus = "NOT_TRIGGERED" | "QUOTED" | "EXECUTED" | "FAILED";
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
export interface SettlementIntent {
    sourceChain: string;
    targetChain: string;
    token: string;
    amount: string;
    maxSlippageTolerance: number;
    maxBridgeDelay: number;
    sourceRpc: string;
    targetRpc: string;
    agentProfile?: AgentProfile;
}
export type CheckSeverity = "info" | "warning" | "critical";
export type RiskStatus = "APPROVED" | "WARNING" | "BLOCKED" | "HEALTHY" | "MOVE_RECOMMENDED";
export type SettlementStatus = "PENDING" | "APPROVED" | "WARNING" | "BLOCKED" | "EXECUTED" | "FAILED";
export type PositionStatus = "ACTIVE" | "CLOSED";
export type MonitoringStatus = "HEALTHY" | "MOVE_RECOMMENDED";
export type RebalanceStatus = "PENDING" | "EXECUTED" | "FAILED";
export interface RiskCheck {
    name: string;
    passed: boolean;
    actual: string | number;
    threshold: string | number;
    severity: CheckSeverity;
    description?: string;
}
export interface TenderlySim {
    success: boolean;
    gasEstimate: string;
    expectedOutput: string;
    vnetId?: string;
    txHash?: string;
}
export interface OracleDataReport {
    ethUsdPrice: string;
    usdcUsdPrice: string;
    timestamp: number;
}
/** Pool key for Uniswap v4 (used by executor when report includes selected pool) */
export interface PoolKeyReport {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
}
export interface RiskReport {
    status: RiskStatus;
    checks: RiskCheck[];
    oracleData: OracleDataReport;
    tenderlySim: TenderlySim;
    explorerUrl: string;
    recipeId: string;
    timestamp: number;
    intent: SettlementIntent;
    /** Resolved pool ID from discovery (Uniswap v4 pool key hash) */
    selectedPoolId?: string;
    /** Resolved pool key for execution (when workflow discovered the pool) */
    selectedPoolKey?: PoolKeyReport;
    metadata?: {
        executionId?: string;
        notes?: string[];
        agentProfile?: AgentProfile;
        profileAction?: ProfileAction;
        stabilizationIntentLogged?: boolean;
        priceDeviationPercent?: number;
        rotation?: RotationMetadata;
    };
}
export interface WebhookPayload {
    event: "RISK_REPORT";
    report: RiskReport;
    sentAt: number;
}
export interface MonitoringReportPayload {
    event: "MONITORING_REPORT";
    report: MonitoringReport;
    sentAt: number;
}
export interface MonitoringReportBatchPayload {
    event: "MONITORING_REPORT_BATCH";
    reports: MonitoringReport[];
    sentAt: number;
}
export interface ExecutorSignal {
    action: "EXECUTE";
    report: RiskReport;
    signalAt: number;
}
export interface RebalanceRequest {
    positionId: string;
    currentPool: string;
    nextBestPool: string;
    depositAmount: string;
    chain?: string;
    reason?: string;
    rpcUrl?: string;
}
export interface Settlement {
    id: string;
    intent: SettlementIntent;
    status: SettlementStatus;
    riskReport?: RiskReport;
    txHash?: string;
    explorerUrl?: string;
    keeperExecutionHash?: string;
    keeperAuditUrl?: string;
    createdAt: number;
    updatedAt: number;
}
export interface Position {
    positionId: string;
    poolAddress: string;
    depositAmount: string;
    chain: string;
    rpcUrl?: string;
    status: PositionStatus;
    createdAt: number;
    updatedAt: number;
}
export interface PositionRow {
    position_id: string;
    pool_address: string;
    deposit_amount: string;
    chain: string;
    rpc_url: string | null;
    status: string;
    created_at: number;
    updated_at: number;
}
export interface MonitoringReport {
    reportId: string;
    positionId: string;
    poolAddress: string;
    depositAmount: string;
    currentLiquidity: string;
    status: MonitoringStatus;
    nextBestPool?: string;
    nextBestLiquidity?: string;
    reason: string;
    chain: string;
    timestamp: number;
    executionStatus?: RebalanceStatus;
    executionTxHash?: string;
    executionError?: string;
}
export interface MonitoringReportRow {
    report_id: string;
    position_id: string;
    pool_address: string;
    deposit_amount: string;
    current_liquidity: string;
    status: string;
    next_best_pool: string | null;
    next_best_liquidity: string | null;
    reason: string;
    chain: string;
    timestamp: number;
    execution_status: string | null;
    execution_tx_hash: string | null;
    execution_error: string | null;
    created_at: number;
    updated_at: number;
}
export interface TelegramAlertSetting {
    chatId: string;
    enabled: boolean;
    updatedAt: number;
}
export interface PositionWithMonitoring extends Position {
    latestMonitoringStatus?: MonitoringStatus;
    latestLiquidity?: string;
    lastScanAt?: number;
}
export interface SettlementRow {
    id: string;
    intent: string;
    status: string;
    risk_report: string | null;
    tx_hash: string | null;
    explorer_url: string | null;
    keeper_execution_hash?: string | null;
    keeper_audit_url?: string | null;
    created_at: number;
    updated_at: number;
}
export interface TriggerResponse {
    settlementId: string;
    status: SettlementStatus;
}
export interface WebhookResponse {
    success: boolean;
    message?: string;
    error?: string;
}
export interface SettlementResponse {
    id: string;
    status: SettlementStatus;
    intent: SettlementIntent;
    riskReport?: RiskReport;
    execution?: {
        txHash: string;
        explorerUrl: string;
        keeperExecutionHash?: string;
        keeperAuditUrl?: string;
    };
    createdAt: number;
    updatedAt: number;
}
