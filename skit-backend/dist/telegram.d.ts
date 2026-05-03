import type { PositionWithMonitoring, MonitoringReport, Settlement, RiskReport } from "./types.js";
export interface TelegramCommandHandlers {
    onSimulate: (chatId: string, args: string[]) => Promise<string>;
    onStatus: (args: string[]) => Promise<string>;
    onAlerts: (chatId: string, args: string[]) => Promise<string>;
    onProfile: (chatId: string, args: string[]) => Promise<string>;
    onApprove: (args: string[]) => Promise<string>;
    onHistory: () => Promise<string>;
    onForkStatus: () => Promise<string>;
    onPositions: () => Promise<string>;
    onRebalance: (args: string[]) => Promise<string>;
}
/**
 * Parse intent-based message like "send 5 USDC from baseSepolia to unichainSepolia".
 * Returns [amountRaw, fromChain, toChain] for onSimulate, or null if not matched.
 */
export declare function parseIntentMessage(text: string): string[] | null;
export declare class TelegramBotService {
    private readonly token;
    private readonly apiBase;
    private readonly handlers;
    private polling;
    private offset;
    constructor(token: string, handlers: TelegramCommandHandlers);
    startPolling(): void;
    stopPolling(): void;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendBroadcast(chatIds: string[], text: string): Promise<void>;
    private pollLoop;
    private getUpdates;
    private handleUpdate;
}
export declare function formatHistory(settlements: Settlement[]): string;
export declare function formatPositions(positions: PositionWithMonitoring[]): string;
export declare function formatSettlementExecuted(report: RiskReport, txHash?: string, explorerUrl?: string, keeperExecutionHash?: string, keeperAuditUrl?: string): string;
export declare function formatSettlementFailed(report: RiskReport, error?: string): string;
export declare function formatMonitoringAlert(report: MonitoringReport, status: "SUCCESS" | "FAILED", explorerUrl?: string, error?: string): string;
