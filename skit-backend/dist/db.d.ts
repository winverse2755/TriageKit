/**
 * SQLite database module for settlement storage
 */
import Database from "better-sqlite3";
import type { Settlement, SettlementIntent, SettlementStatus, RiskReport, Position, MonitoringReport, RebalanceStatus, TelegramAlertSetting, PositionWithMonitoring, AgentProfile } from "./types.js";
export declare function initDatabase(): Database.Database;
export declare function getDatabase(): Database.Database;
/** Next settlement ID in id-index format (e.g. stl-0, stl-1). */
export declare function getNextSettlementId(): string;
export declare function createSettlement(id: string, intent: SettlementIntent): Settlement;
export declare function getSettlement(id: string): Settlement | null;
export declare function getSettlementByRecipeId(recipeId: string): Settlement | null;
export declare function updateSettlementStatus(id: string, status: SettlementStatus, riskReport?: RiskReport, txHash?: string, explorerUrl?: string, keeperExecutionHash?: string, keeperAuditUrl?: string): Settlement | null;
export declare function getAllSettlements(limit?: number): Settlement[];
export declare function createOrUpdatePosition(position: Omit<Position, "createdAt" | "updatedAt">): Position;
export declare function getPosition(positionId: string): Position | null;
export declare function getPositionByPoolAddress(poolAddress: string, chain?: string): Position | null;
export interface AddToPositionParams {
    poolAddress: string;
    amount: string;
    chain: string;
    rpcUrl?: string;
}
/**
 * Add amount to an existing position for the given pool, or create a new position.
 * Uses pos-{index} for new position IDs. Same pool + chain aggregates into one position.
 */
export declare function addToPositionOrCreate(params: AddToPositionParams): Position;
export declare function getActivePositions(limit?: number): Position[];
export declare function updatePositionPool(positionId: string, nextPoolAddress: string): Position | null;
export declare function createMonitoringReport(report: MonitoringReport): MonitoringReport;
export declare function updateMonitoringReportExecution(reportId: string, status: RebalanceStatus, txHash?: string, error?: string): MonitoringReport | null;
export declare function getMonitoringReport(reportId: string): MonitoringReport | null;
export declare function getMonitoringReports(limit?: number): MonitoringReport[];
export declare function getLatestMonitoringReportByPosition(positionId: string): MonitoringReport | null;
export declare function getActivePositionsWithMonitoring(limit?: number): PositionWithMonitoring[];
export declare function setTelegramAlerts(chatId: string, enabled: boolean): TelegramAlertSetting;
export declare function getTelegramAlertSetting(chatId: string): TelegramAlertSetting | null;
export declare function getEnabledTelegramChatIds(): string[];
export declare function setTelegramProfile(chatId: string, profile: AgentProfile): {
    chatId: string;
    profile: AgentProfile;
    updatedAt: number;
};
export declare function getTelegramProfileRecord(chatId: string): {
    chatId: string;
    profile: AgentProfile;
    updatedAt: number;
} | null;
export declare function getEffectiveTelegramProfile(chatId: string): AgentProfile;
export declare function closeDatabase(): void;
