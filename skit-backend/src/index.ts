/**
 * SettleKit Backend Server
 * 
 * Provides three endpoints:
 * - POST /trigger - Triggers a new settlement via CRE workflow
 * - POST /webhook - Receives risk reports from CRE workflow
 * - GET /settlement/:id - Retrieves settlement status and details
 */

import "dotenv/config";
import express, { type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  initDatabase,
  createSettlement,
  getSettlement,
  getSettlementByRecipeId,
  getNextSettlementId,
  updateSettlementStatus,
  getAllSettlements,
  getActivePositions,
  getActivePositionsWithMonitoring,
  getPosition,
  createMonitoringReport,
  getLatestMonitoringReportByPosition,
  updateMonitoringReportExecution,
  createOrUpdatePosition,
  addToPositionOrCreate,
  updatePositionPool,
  getEnabledTelegramChatIds,
  setTelegramAlerts,
  getEffectiveTelegramProfile,
  getTelegramProfileRecord,
  setTelegramProfile,
  closeDatabase,
} from "./db.js";
import { getExecutor } from "./executor.js";
import {
  TelegramBotService,
  formatHistory,
  formatMonitoringAlert,
  formatPositions,
  formatSettlementExecuted,
  formatSettlementFailed,
} from "./telegram.js";
import type {
  MonitoringReport,
  MonitoringReportBatchPayload,
  MonitoringReportPayload,
  RebalanceRequest,
  SettlementStatus,
  SettlementIntent,
  WebhookPayload,
  ExecutorSignal,
  TriggerResponse,
  WebhookResponse,
  SettlementResponse,
  RiskReport,
  AgentProfile,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the JSON file used by CRE CLI (@last-telegram-intent.json)
// when simulating the risk-guard workflow with the latest Telegram /simulate intent.
const LAST_TELEGRAM_INTENT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "skit-risk-guard",
  "risk-guard-workflow",
  "last-telegram-intent.json"
);

const PORT = process.env.PORT || 3001;
const CRE_WORKFLOW_URL = process.env.CRE_WORKFLOW_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_VNET_RPC =
  process.env.BASE_VNET_RPC ??
  "https://virtual.base-sepolia.eu.rpc.tenderly.co/eda241e6-2aa8-4abe-9db9-784bd0ceb88d";
const UNICHAIN_VNET_RPC =
  process.env.UNICHAIN_VNET_RPC ??
  "https://virtual.astrochain-sepolia.eu.rpc.tenderly.co/988a84e2-3652-4013-aa50-a563ec925736";

const VALID_AGENT_PROFILES: AgentProfile[] = [
  "conservative",
  "balanced",
  "backstop",
];

const app = express();
app.use(express.json());

// Initialize database
initDatabase();

async function fetchRpcBlockNumber(rpcUrl: string): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: [],
    }),
  });
  const json = (await response.json()) as { result?: string };
  if (!json.result) throw new Error("No block number in RPC response");
  return BigInt(json.result);
}

// Maps settlementId → chatId so the webhook can send a follow-up to the right chat
const pendingSimulations = new Map<string, string>();

let telegramBot: TelegramBotService | null = null;

if (TELEGRAM_BOT_TOKEN) {
  telegramBot = new TelegramBotService(TELEGRAM_BOT_TOKEN, {
    onSimulate: async (chatId, args) => {
      if (args.length < 3) {
        return "Usage: /simulate <amount> <from_chain> <to_chain>";
      }
      const [amount, fromChain, toChain] = args;
      const agentProfile = getEffectiveTelegramProfile(chatId);
      const intent: SettlementIntent = {
        sourceChain: fromChain,
        targetChain: toChain,
        token: "USDC",
        amount,
        maxSlippageTolerance: 0.01,
        maxBridgeDelay: 1_200_000,
        sourceRpc: BASE_VNET_RPC,
        targetRpc: UNICHAIN_VNET_RPC,
        agentProfile,
      };

      const settlementId = getNextSettlementId();
      createSettlement(settlementId, intent);

      // Register this chat so the webhook handler can send a follow-up message
      // once CRE completes the risk assessment and calls back.
      pendingSimulations.set(settlementId, chatId);

      // Persist the latest Telegram /simulate intent so it can be reused
      // by the CRE CLI as @last-telegram-intent.json.
      try {
        fs.mkdirSync(path.dirname(LAST_TELEGRAM_INTENT_PATH), { recursive: true });
        fs.writeFileSync(
          LAST_TELEGRAM_INTENT_PATH,
          JSON.stringify(intent, null, 2),
          "utf-8"
        );
        console.log(
          "[/simulate] Wrote latest intent to",
          LAST_TELEGRAM_INTENT_PATH
        );
      } catch (err) {
        console.error("[/simulate] Failed to write last-telegram-intent.json:", err);
      }

      if (CRE_WORKFLOW_URL) {
        fetch(CRE_WORKFLOW_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent),
        }).catch((err) =>
          console.error("[/simulate] Failed to forward to CRE:", err)
        );
      }

      return [
        "Simulation submitted ✅",
        `settlementId=${settlementId}`,
        `agentProfile=${agentProfile}`,
        `status=PENDING`,
        "",
        "CRE is running the risk assessment. You will receive a follow-up message here once the result arrives.",
        CRE_WORKFLOW_URL
          ? `Trigger: cre simulate --target sim-settings`
          : "⚠️  CRE_WORKFLOW_URL not set — trigger CRE manually, then use /status to check.",
      ].join("\n");
    },
    onStatus: async (args) => {
      if (args.length < 1) return "Usage: /status <recipeId>";
      const settlement = getSettlementByRecipeId(args[0]);
      if (!settlement) return "Settlement not found for recipeId.";
      const report = settlement.riskReport;
      const activeFlags =
        report?.checks.filter((c) => !c.passed).map((c) => c.name).join(", ") ??
        "none";
      return [
        `settlementId=${settlement.id}`,
        `status=${settlement.status}`,
        `executionStep=${settlement.status}`,
        `activeRiskFlags=${activeFlags || "none"}`,
        `tenderly=${settlement.explorerUrl ?? report?.explorerUrl ?? "n/a"}`,
      ].join("\n");
    },
    onAlerts: async (chatId, args) => {
      const mode = args[0]?.toLowerCase();
      if (mode !== "on" && mode !== "off") return "Usage: /alerts on|off";
      setTelegramAlerts(chatId, mode === "on");
      return `Alerts ${mode === "on" ? "enabled" : "disabled"}.`;
    },
    onProfile: async (chatId, args) => {
      if (args.length === 0) {
        const p = getEffectiveTelegramProfile(chatId);
        const rec = getTelegramProfileRecord(chatId);
        return [
          `Current agent profile: ${p}`,
          rec
            ? `(saved for this chat)`
            : `(default — use /profile conservative|balanced|backstop to save)`,
        ].join("\n");
      }
      const raw = args[0]?.toLowerCase();
      if (!VALID_AGENT_PROFILES.includes(raw as AgentProfile)) {
        return "Usage: /profile [conservative|balanced|backstop]";
      }
      const profile = raw as AgentProfile;
      setTelegramProfile(chatId, profile);
      return `Agent profile set to ${profile}. Future /simulate intents will use this pre-commitment.`;
    },
    onApprove: async (args) => {
      if (args.length < 1) return "Usage: /approve <recipeId>";
      const settlement = getSettlementByRecipeId(args[0]);
      if (!settlement) return "Settlement not found.";
      if (settlement.status === "BLOCKED") {
        return "Cannot approve BLOCKED settlement until failing condition resolves.";
      }
      if (settlement.status !== "WARNING") {
        return `Settlement is ${settlement.status}, only WARNING can be approved.`;
      }
      if (!settlement.riskReport) {
        return "No risk report found for this settlement.";
      }
      const approvedReport = { ...settlement.riskReport, status: "APPROVED" as const };
      updateSettlementStatus(settlement.id, "APPROVED", approvedReport);
      const result = await getExecutor().executeSettlement(approvedReport);
      if (result.success) {
        updateSettlementStatus(
          settlement.id,
          "EXECUTED",
          undefined,
          result.txHash,
          result.explorerUrl,
          result.keeperExecutionHash,
          result.keeperAuditUrl
        );
        return `Approved and executed ✅\nsettlementId=${settlement.id}\ntx=${result.explorerUrl ?? result.txHash}\nkeeperHub=${result.keeperExecutionHash ?? "n/a"}`;
      }
      updateSettlementStatus(settlement.id, "FAILED");
      return `Approval execution failed ❌\nreason=${result.error ?? "unknown"}`;
    },
    onHistory: async () => formatHistory(getAllSettlements(5)),
    onForkStatus: async () => {
      const [baseBlock, uniBlock] = await Promise.all([
        fetchRpcBlockNumber(BASE_VNET_RPC),
        fetchRpcBlockNumber(UNICHAIN_VNET_RPC),
      ]);
      return [
        "Fork status:",
        `baseVnetBlock=${baseBlock.toString()}`,
        `unichainVnetBlock=${uniBlock.toString()}`,
      ].join("\n");
    },
    onPositions: async () => formatPositions(getActivePositionsWithMonitoring()),
    onRebalance: async (args) => {
      if (args.length < 1) return "Usage: /rebalance <positionId>";
      const positionId = args[0];
      const position = getPosition(positionId);
      if (!position) return "Position not found.";
      const latestReport = getLatestMonitoringReportByPosition(positionId);
      if (!latestReport?.nextBestPool) {
        return "No nextBestPool found from monitoring report for this position.";
      }
      const result = await getExecutor().executeRebalance({
        positionId,
        currentPool: position.poolAddress,
        nextBestPool: latestReport.nextBestPool,
        depositAmount: position.depositAmount,
        chain: position.chain,
      });
      if (result.success) {
        updatePositionPool(positionId, latestReport.nextBestPool);
        return `Manual rebalance executed ✅\nposition=${positionId}\ntx=${result.explorerUrl ?? result.txHash}\nkeeperHub=${result.keeperExecutionHash ?? "n/a"}`;
      }
      return `Manual rebalance failed ❌\nposition=${positionId}\nreason=${result.error ?? "unknown"}`;
    },
  });
}

/**
 * POST /trigger
 * 
 * Triggers a new settlement workflow.
 * Creates a pending settlement record and optionally forwards to CRE workflow.
 */
app.post("/trigger", async (req: Request, res: Response) => {
  console.log("\n[/trigger] Received settlement request");
  
  try {
    const intent = req.body as SettlementIntent;
    
    // Validate required fields
    if (!intent.sourceChain || !intent.targetChain || !intent.amount) {
      res.status(400).json({
        error: "Missing required fields: sourceChain, targetChain, amount",
      });
      return;
    }
    
    // Generate unique settlement ID (id-index format: stl-0, stl-1, ...)
    const settlementId = getNextSettlementId();
    console.log(`[/trigger] Created settlement: ${settlementId}`);
    
    // Store in database
    const settlement = createSettlement(settlementId, intent);
    console.log(`[/trigger] Settlement stored with status: ${settlement.status}`);
    
    // Optionally forward to CRE workflow if URL is configured
    if (CRE_WORKFLOW_URL) {
      console.log(`[/trigger] Forwarding to CRE workflow: ${CRE_WORKFLOW_URL}`);
      try {
        const creResponse = await fetch(CRE_WORKFLOW_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent),
        });
        console.log(`[/trigger] CRE response status: ${creResponse.status}`);
      } catch (error) {
        console.error(`[/trigger] Failed to forward to CRE:`, error);
      }
    }
    
    const response: TriggerResponse = {
      settlementId,
      status: settlement.status,
    };
    
    res.status(201).json(response);
  } catch (error) {
    console.error("[/trigger] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /webhook
 * 
 * Receives risk/monitoring reports from CRE workflows.
 */
app.post("/webhook", async (req: Request, res: Response) => {
  console.log("\n[/webhook] Received webhook");
  
  try {
    // Handle settlement and monitoring events.
    const body = req.body as
      | WebhookPayload
      | MonitoringReportPayload
      | MonitoringReportBatchPayload
      | ExecutorSignal
      | RiskReport;

    if ("event" in body && body.event === "MONITORING_REPORT_BATCH") {
      const reports = (body as MonitoringReportBatchPayload).reports ?? [];
      console.log(`[/webhook] Received MONITORING_REPORT_BATCH event (${reports.length} reports)`);

      for (const report of reports) {
        console.log(`[/webhook] Processing report ${report.reportId} status=${report.status}`);
        createMonitoringReport(report);

        if (report.status === "MOVE_RECOMMENDED" && report.nextBestPool) {
          console.log(`[/webhook] MOVE_RECOMMENDED - triggering immediate rebalance`);
          const executor = getExecutor();
          const rebalanceRequest: RebalanceRequest = {
            positionId: report.positionId,
            currentPool: report.poolAddress,
            nextBestPool: report.nextBestPool,
            depositAmount: report.depositAmount,
            chain: report.chain,
            reason: report.reason,
          };

          const result = await executor.executeRebalance(rebalanceRequest);
          const alertChatIds = getEnabledTelegramChatIds();
          if (result.success) {
            updateMonitoringReportExecution(
              report.reportId,
              "EXECUTED",
              result.txHash
            );
            updatePositionPool(report.positionId, report.nextBestPool);
            if (telegramBot && alertChatIds.length > 0) {
              await telegramBot.sendBroadcast(
                alertChatIds,
                formatMonitoringAlert(report, "SUCCESS", result.explorerUrl)
              );
            }
          } else {
            updateMonitoringReportExecution(
              report.reportId,
              "FAILED",
              undefined,
              result.error
            );
            if (telegramBot && alertChatIds.length > 0) {
              await telegramBot.sendBroadcast(
                alertChatIds,
                formatMonitoringAlert(report, "FAILED", result.explorerUrl, result.error)
              );
            }
          }
        }
      }

      const response: WebhookResponse = {
        success: true,
        message: `Monitoring report batch processed (${reports.length} reports)`,
      };
      res.status(200).json(response);
      return;
    }

    if ("event" in body && body.event === "MONITORING_REPORT") {
      const report = body.report as MonitoringReport;
      console.log(`[/webhook] Received MONITORING_REPORT event`);
      console.log(`[/webhook] Monitoring status: ${report.status}`);
      console.log(`[/webhook] Position ID: ${report.positionId}`);

      createMonitoringReport(report);

      if (report.status === "MOVE_RECOMMENDED" && report.nextBestPool) {
        console.log(`[/webhook] MOVE_RECOMMENDED - triggering immediate rebalance`);
        const executor = getExecutor();
        const rebalanceRequest: RebalanceRequest = {
          positionId: report.positionId,
          currentPool: report.poolAddress,
          nextBestPool: report.nextBestPool,
          depositAmount: report.depositAmount,
          chain: report.chain,
          reason: report.reason,
        };

        const result = await executor.executeRebalance(rebalanceRequest);
        const alertChatIds = getEnabledTelegramChatIds();
        if (result.success) {
          updateMonitoringReportExecution(
            report.reportId,
            "EXECUTED",
            result.txHash
          );
          updatePositionPool(report.positionId, report.nextBestPool);
          if (telegramBot && alertChatIds.length > 0) {
            await telegramBot.sendBroadcast(
              alertChatIds,
              formatMonitoringAlert(report, "SUCCESS", result.explorerUrl)
            );
          }
        } else {
          updateMonitoringReportExecution(
            report.reportId,
            "FAILED",
            undefined,
            result.error
          );
          if (telegramBot && alertChatIds.length > 0) {
            await telegramBot.sendBroadcast(
              alertChatIds,
              formatMonitoringAlert(report, "FAILED", result.explorerUrl, result.error)
            );
          }
        }
      }

      const response: WebhookResponse = {
        success: true,
        message: `Monitoring report ${report.reportId} processed`,
      };
      res.status(200).json(response);
      return;
    }

    let report: RiskReport;
    if ("event" in body && body.event === "RISK_REPORT") {
      report = body.report;
      console.log(`[/webhook] Received RISK_REPORT event`);
    } else if ("action" in body && body.action === "EXECUTE") {
      report = body.report;
      console.log(`[/webhook] Received EXECUTE signal`);
    } else {
      report = body as RiskReport;
    }
    
    console.log(`[/webhook] Report status: ${report.status}`);
    console.log(`[/webhook] Recipe ID: ${report.recipeId}`);

    if (
      report.status !== "APPROVED" &&
      report.status !== "WARNING" &&
      report.status !== "BLOCKED"
    ) {
      res.status(400).json({
        success: false,
        error: `Unsupported settlement risk status: ${report.status}`,
      } as WebhookResponse);
      return;
    }
    const settlementStatus: SettlementStatus = report.status;
    
    // Find the matching settlement
    let settlement = getSettlementByRecipeId(report.recipeId);
    
    if (!settlement) {
      console.log(`[/webhook] No matching settlement found, creating new one`);
      const settlementId = getNextSettlementId();
      settlement = createSettlement(settlementId, report.intent);
    }
    
    console.log(`[/webhook] Updating settlement: ${settlement.id}`);
    
    // Update settlement with risk report
    let updatedSettlement = updateSettlementStatus(
      settlement.id,
      settlementStatus,
      report
    );

    if ((report.status === "WARNING" || report.status === "BLOCKED") && telegramBot) {
      const alertChatIds = getEnabledTelegramChatIds();
      // Also notify the chat that originally triggered /simulate, if any.
      const simChatId = pendingSimulations.get(settlement.id);
      const targets = simChatId
        ? [...new Set([...alertChatIds, simChatId])]
        : alertChatIds;
      if (targets.length > 0) {
        const failedChecks = report.checks
          .filter((c) => !c.passed)
          .map((c) => `${c.name}(${c.actual}/${c.threshold})`)
          .join(", ");
        const text = [
          `Risk alert ${report.status === "BLOCKED" ? "🚫" : "⚠️"}`,
          `recipeId=${report.recipeId}`,
          `status=${report.status}`,
          `reason=${failedChecks || "n/a"}`,
          `tenderly=${report.explorerUrl}`,
        ].join("\n");
        await telegramBot.sendBroadcast(targets, text);
      }
    }

    if (
      report.status === "WARNING" &&
      report.metadata?.agentProfile === "balanced" &&
      report.metadata?.profileAction === "PARTIAL_ROTATE_HOLD"
    ) {
      const priceDeviation = report.metadata?.priceDeviationPercent;
      if (priceDeviation === undefined || (priceDeviation >= 5 && priceDeviation <= 10)) {
        console.log(
          "[/webhook] WARNING + balanced PARTIAL_ROTATE_HOLD - triggering collateral rotation"
        );
        const executor = getExecutor();
        const rotationResult = await executor.executeCollateralRotation(report);
        const rotatedReport: RiskReport = {
          ...report,
          metadata: {
            ...report.metadata,
            rotation: rotationResult.rotation,
          },
        };
        updatedSettlement = updateSettlementStatus(
          settlement.id,
          rotationResult.success ? "EXECUTED" : "FAILED",
          rotatedReport,
          rotationResult.txHash,
          rotationResult.explorerUrl,
          rotationResult.keeperExecutionHash,
          rotationResult.keeperAuditUrl
        );
        if (telegramBot) {
          const alertChatIds = getEnabledTelegramChatIds();
          const simChatId = pendingSimulations.get(settlement.id);
          const targets = simChatId
            ? [...new Set([...alertChatIds, simChatId])]
            : alertChatIds;
          if (targets.length > 0) {
            if (rotationResult.success) {
              await telegramBot.sendBroadcast(
                targets,
                formatSettlementExecuted(
                  rotatedReport,
                  rotationResult.txHash,
                  rotationResult.explorerUrl,
                  rotationResult.keeperExecutionHash,
                  rotationResult.keeperAuditUrl
                )
              );
            } else {
              await telegramBot.sendBroadcast(
                targets,
                formatSettlementFailed(rotatedReport, rotationResult.error)
              );
            }
          }
        }
        pendingSimulations.delete(settlement.id);
      }
    }

    // If approved, execute the settlement and broadcast the outcome.
    if (report.status === "APPROVED") {
      console.log(`[/webhook] Settlement APPROVED - triggering execution`);

      const executor = getExecutor();
      const result = await executor.executeSettlement(report);

      if (result.success) {
        console.log(`[/webhook] Execution successful: ${result.txHash}`);
        updatedSettlement = updateSettlementStatus(
          settlement.id,
          "EXECUTED",
          undefined,
          result.txHash,
          result.explorerUrl,
          result.keeperExecutionHash,
          result.keeperAuditUrl
        );
        try {
          addToPositionOrCreate({
            poolAddress: report.selectedPoolId ?? "",
            amount: report.intent.amount,
            chain: report.intent.targetChain ?? "unichainSepolia",
            rpcUrl: report.intent.targetRpc ?? UNICHAIN_VNET_RPC,
          });
        } catch (posErr) {
          console.error(`[/webhook] addToPositionOrCreate failed:`, posErr);
        }
        if (telegramBot) {
          const alertChatIds = getEnabledTelegramChatIds();
          const simChatId = pendingSimulations.get(settlement.id);
          const targets = simChatId
            ? [...new Set([...alertChatIds, simChatId])]
            : alertChatIds;
          if (targets.length > 0) {
            await telegramBot.sendBroadcast(
              targets,
              formatSettlementExecuted(
                report,
                result.txHash,
                result.explorerUrl,
                result.keeperExecutionHash,
                result.keeperAuditUrl
              )
            );
          }
        }
      } else {
        console.log(`[/webhook] Execution failed: ${result.error}`);
        updatedSettlement = updateSettlementStatus(
          settlement.id,
          "FAILED",
          undefined,
          undefined,
          undefined,
          undefined,
          undefined
        );
        if (telegramBot) {
          const alertChatIds = getEnabledTelegramChatIds();
          const simChatId = pendingSimulations.get(settlement.id);
          const targets = simChatId
            ? [...new Set([...alertChatIds, simChatId])]
            : alertChatIds;
          if (targets.length > 0) {
            await telegramBot.sendBroadcast(
              targets,
              formatSettlementFailed(report, result.error)
            );
          }
        }
      }
      pendingSimulations.delete(settlement.id);
    }

    if (report.status === "BLOCKED") {
      pendingSimulations.delete(settlement.id);
    }
    
    const response: WebhookResponse = {
      success: true,
      message: `Settlement ${settlement.id} updated to ${updatedSettlement?.status}`,
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error("[/webhook] Error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    } as WebhookResponse);
  }
});

/**
 * GET /settlement/:id
 * 
 * Retrieves settlement details by ID.
 */
app.get("/settlement/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  console.log(`\n[/settlement/${id}] Fetching settlement`);
  
  try {
    const settlement = getSettlement(id);
    
    if (!settlement) {
      res.status(404).json({ error: "Settlement not found" });
      return;
    }
    
    const response: SettlementResponse = {
      id: settlement.id,
      status: settlement.status,
      intent: settlement.intent,
      riskReport: settlement.riskReport,
      execution: settlement.txHash
        ? {
            txHash: settlement.txHash,
            explorerUrl: settlement.explorerUrl || "",
            keeperExecutionHash: settlement.keeperExecutionHash,
            keeperAuditUrl: settlement.keeperAuditUrl,
          }
        : undefined,
      createdAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error(`[/settlement/${id}] Error:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /settlements
 * 
 * Lists all settlements (for debugging/monitoring).
 */
app.get("/settlements", (_req: Request, res: Response) => {
  console.log("\n[/settlements] Fetching all settlements");
  
  try {
    const settlements = getAllSettlements();
    res.status(200).json(settlements);
  } catch (error) {
    console.error("[/settlements] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /positions
 *
 * Lists active deposited positions used by the monitoring workflow.
 */
app.get("/positions", (_req: Request, res: Response) => {
  console.log("\n[/positions] Fetching active positions");
  try {
    const positions = getActivePositionsWithMonitoring();
    res.status(200).json(positions);
  } catch (error) {
    console.error("[/positions] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /rebalance
 *
 * Manual rebalance trigger for operations testing.
 */
app.post("/rebalance", async (req: Request, res: Response) => {
  console.log("\n[/rebalance] Received rebalance request");
  try {
    const request = req.body as RebalanceRequest;
    if (
      !request.positionId ||
      !request.currentPool ||
      !request.nextBestPool ||
      !request.depositAmount
    ) {
      res.status(400).json({
        error:
          "Missing required fields: positionId, currentPool, nextBestPool, depositAmount",
      });
      return;
    }

    // Ensure the position exists/updates before execution starts.
    createOrUpdatePosition({
      positionId: request.positionId,
      poolAddress: request.currentPool,
      depositAmount: request.depositAmount,
      chain: request.chain ?? "unichainSepolia",
      rpcUrl: request.rpcUrl,
      status: "ACTIVE",
    });

    const executor = getExecutor();
    const result = await executor.executeRebalance(request);

    if (result.success) {
      updatePositionPool(request.positionId, request.nextBestPool);
    }

    res.status(result.success ? 200 : 500).json({
      success: result.success,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      error: result.error,
    });
  } catch (error) {
    console.error("[/rebalance] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /health
 * 
 * Health check endpoint.
 */
app.get("/health", (_req: Request, res: Response) => {
  const executor = getExecutor();
  res.status(200).json({
    status: "ok",
    timestamp: Date.now(),
    executorAddress: executor.getAccountAddress(),
  });
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  telegramBot?.stopPolling();
  closeDatabase();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  telegramBot?.stopPolling();
  closeDatabase();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("  SettleKit Backend Server");
  console.log("=".repeat(60));
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /trigger          - Trigger new settlement`);
  console.log(`  POST /webhook          - Receive CRE risk reports`);
  console.log(`  GET  /settlement/:id   - Get settlement details`);
  console.log(`  GET  /settlements      - List all settlements`);
  console.log(`  GET  /positions        - List active positions`);
  console.log(`  POST /rebalance        - Trigger manual rebalance`);
  console.log(`  GET  /health           - Health check`);
  console.log("=".repeat(60));
  
  const executor = getExecutor();
  const address = executor.getAccountAddress();
  if (address) {
    console.log(`Executor wallet: ${address}`);
  } else {
    console.log("WARNING: No PRIVATE_KEY configured - execution disabled");
  }
  if (telegramBot) {
    telegramBot.startPolling();
    console.log("Telegram bot polling started");
  } else {
    console.log("Telegram bot disabled (set TELEGRAM_BOT_TOKEN to enable)");
  }
  console.log("=".repeat(60));
});
