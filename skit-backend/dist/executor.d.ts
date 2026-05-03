/**
 * Settlement executor - wraps UniswapLiquidityExecutor for approved settlements
 */
import { type Address } from "viem";
import type { RebalanceRequest, RiskReport, RotationMetadata } from "./types.js";
export interface ExecutionResult {
    success: boolean;
    txHash?: string;
    explorerUrl?: string;
    keeperExecutionHash?: string;
    keeperAuditUrl?: string;
    error?: string;
}
export interface RotationExecutionResult extends ExecutionResult {
    rotation?: RotationMetadata;
}
export declare class SettlementExecutor {
    private publicClient;
    private walletClient;
    private account;
    private explorerForTx;
    /** Encode + route contract writes through KeeperHub when configured. */
    private relayEncodedCall;
    private relaySendTransaction;
    constructor(privateKey?: `0x${string}`);
    executeSettlement(report: RiskReport): Promise<ExecutionResult>;
    executeCollateralRotation(report: RiskReport): Promise<RotationExecutionResult>;
    executeRebalance(request: RebalanceRequest): Promise<ExecutionResult>;
    /**
     * Find the tokenId of an existing position minted to this account.
     * Uses Transfer(from=0, to=owner) mint events from the PositionManager.
     * Returns the most recently minted tokenId, which matches the position
     * created by the last executeSettlement call on this VNet.
     */
    private findExistingPositionTokenId;
    getAccountAddress(): Address | null;
    /**
     * Execute a simple USDC transfer as a fallback when pool doesn't exist.
     * This demonstrates the execution flow on Tenderly VNet.
     */
    private executeSimpleTransfer;
}
export declare function getExecutor(): SettlementExecutor;
