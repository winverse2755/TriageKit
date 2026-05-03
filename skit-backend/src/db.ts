/**
 * SQLite database module for settlement storage
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import type {
  Settlement,
  SettlementIntent,
  SettlementRow,
  SettlementStatus,
  RiskReport,
  Position,
  PositionRow,
  MonitoringReport,
  MonitoringReportRow,
  RebalanceStatus,
  TelegramAlertSetting,
  PositionWithMonitoring,
  AgentProfile,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "settlements.db");

let db: Database.Database;

export function initDatabase(): Database.Database {
  db = new Database(DB_PATH);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      intent TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      risk_report TEXT,
      tx_hash TEXT,
      explorer_url TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_status ON settlements(status);
    CREATE INDEX IF NOT EXISTS idx_created_at ON settlements(created_at);

    CREATE TABLE IF NOT EXISTS positions (
      position_id TEXT PRIMARY KEY,
      pool_address TEXT NOT NULL,
      deposit_amount TEXT NOT NULL,
      chain TEXT NOT NULL,
      rpc_url TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_positions_chain ON positions(chain);

    CREATE TABLE IF NOT EXISTS monitoring_reports (
      report_id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      pool_address TEXT NOT NULL,
      deposit_amount TEXT NOT NULL,
      current_liquidity TEXT NOT NULL,
      status TEXT NOT NULL,
      next_best_pool TEXT,
      next_best_liquidity TEXT,
      reason TEXT NOT NULL,
      chain TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      execution_status TEXT,
      execution_tx_hash TEXT,
      execution_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_monitoring_reports_status ON monitoring_reports(status);
    CREATE INDEX IF NOT EXISTS idx_monitoring_reports_position_id ON monitoring_reports(position_id);
    CREATE INDEX IF NOT EXISTS idx_monitoring_reports_timestamp ON monitoring_reports(timestamp);

    CREATE TABLE IF NOT EXISTS telegram_alert_settings (
      chat_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_profiles (
      chat_id TEXT PRIMARY KEY,
      profile TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  migrateSettlementsColumns(db);
  console.log("[DB] Database initialized at", DB_PATH);
  return db;
}

function migrateSettlementsColumns(database: Database.Database): void {
  const cols = database
    .prepare(`PRAGMA table_info(settlements)`)
    .all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("keeper_execution_hash")) {
    database.exec(
      `ALTER TABLE settlements ADD COLUMN keeper_execution_hash TEXT`
    );
  }
  if (!names.has("keeper_audit_url")) {
    database.exec(`ALTER TABLE settlements ADD COLUMN keeper_audit_url TEXT`);
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/** Next settlement ID in id-index format (e.g. stl-0, stl-1). */
export function getNextSettlementId(): string {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT id FROM settlements WHERE id LIKE 'stl-%'
  `);
  const rows = stmt.all() as Array<{ id: string }>;
  let maxIndex = -1;
  for (const row of rows) {
    const match = row.id.match(/^stl-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxIndex) maxIndex = n;
    }
  }
  return `stl-${maxIndex + 1}`;
}

export function createSettlement(id: string, intent: SettlementIntent): Settlement {
  const db = getDatabase();
  const now = Date.now();
  
  const stmt = db.prepare(`
    INSERT INTO settlements (id, intent, status, created_at, updated_at)
    VALUES (?, ?, 'PENDING', ?, ?)
  `);
  
  stmt.run(id, JSON.stringify(intent), now, now);
  
  return {
    id,
    intent,
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
  };
}

export function getSettlement(id: string): Settlement | null {
  const db = getDatabase();
  
  const stmt = db.prepare(`SELECT * FROM settlements WHERE id = ?`);
  const row = stmt.get(id) as SettlementRow | undefined;
  
  if (!row) {
    return null;
  }
  
  return rowToSettlement(row);
}

export function getSettlementByRecipeId(recipeId: string): Settlement | null {
  const db = getDatabase();
  
  // recipeId format: "risk-{timestamp}" or "settlement-{id}"
  // Try to find by checking if the recipeId contains a settlement id
  // or by matching the full recipeId in the risk_report JSON
  
  const stmt = db.prepare(`
    SELECT * FROM settlements 
    WHERE id = ? 
    OR risk_report LIKE ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  const row = stmt.get(recipeId, `%"recipeId":"${recipeId}"%`) as SettlementRow | undefined;
  
  if (!row) {
    // Try to find the most recent pending settlement
    const pendingStmt = db.prepare(`
      SELECT * FROM settlements 
      WHERE status = 'PENDING' 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    const pendingRow = pendingStmt.get() as SettlementRow | undefined;
    return pendingRow ? rowToSettlement(pendingRow) : null;
  }
  
  return rowToSettlement(row);
}

export function updateSettlementStatus(
  id: string,
  status: SettlementStatus,
  riskReport?: RiskReport,
  txHash?: string,
  explorerUrl?: string,
  keeperExecutionHash?: string,
  keeperAuditUrl?: string
): Settlement | null {
  const db = getDatabase();
  const now = Date.now();
  
  const stmt = db.prepare(`
    UPDATE settlements 
    SET status = ?, 
        risk_report = COALESCE(?, risk_report),
        tx_hash = COALESCE(?, tx_hash),
        explorer_url = COALESCE(?, explorer_url),
        keeper_execution_hash = COALESCE(?, keeper_execution_hash),
        keeper_audit_url = COALESCE(?, keeper_audit_url),
        updated_at = ?
    WHERE id = ?
  `);
  
  stmt.run(
    status,
    riskReport ? JSON.stringify(riskReport) : null,
    txHash ?? null,
    explorerUrl ?? null,
    keeperExecutionHash ?? null,
    keeperAuditUrl ?? null,
    now,
    id
  );
  
  return getSettlement(id);
}

export function getAllSettlements(limit: number = 100): Settlement[] {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT * FROM settlements 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  
  const rows = stmt.all(limit) as SettlementRow[];
  return rows.map(rowToSettlement);
}

export function createOrUpdatePosition(
  position: Omit<Position, "createdAt" | "updatedAt">
): Position {
  const db = getDatabase();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO positions (
      position_id, pool_address, deposit_amount, chain, rpc_url, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(position_id) DO UPDATE SET
      pool_address = excluded.pool_address,
      deposit_amount = excluded.deposit_amount,
      chain = excluded.chain,
      rpc_url = excluded.rpc_url,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    position.positionId,
    position.poolAddress,
    position.depositAmount,
    position.chain,
    position.rpcUrl ?? null,
    position.status,
    now,
    now
  );

  return getPosition(position.positionId)!;
}

export function getPosition(positionId: string): Position | null {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM positions WHERE position_id = ?
  `);
  const row = stmt.get(positionId) as PositionRow | undefined;
  return row ? rowToPosition(row) : null;
}

export function getPositionByPoolAddress(
  poolAddress: string,
  chain?: string
): Position | null {
  const db = getDatabase();
  const normalizedPool = poolAddress.toLowerCase();
  const stmt = chain
    ? db.prepare(`
        SELECT * FROM positions WHERE LOWER(pool_address) = ? AND chain = ?
      `)
    : db.prepare(`
        SELECT * FROM positions WHERE LOWER(pool_address) = ?
      `);
  const row = (chain ? stmt.get(normalizedPool, chain) : stmt.get(normalizedPool)) as
    | PositionRow
    | undefined;
  return row ? rowToPosition(row) : null;
}

function getNextPositionIndex(): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT position_id FROM positions WHERE position_id LIKE 'pos-%'
  `);
  const rows = stmt.all() as Array<{ position_id: string }>;
  let maxIndex = 0;
  for (const row of rows) {
    const match = row.position_id.match(/^pos-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxIndex) maxIndex = n;
    }
  }
  return maxIndex + 1;
}

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
export function addToPositionOrCreate(params: AddToPositionParams): Position {
  const { poolAddress, amount, chain, rpcUrl } = params;
  const db = getDatabase();
  const now = Date.now();
  const normalizedPool = poolAddress.toLowerCase();

  // Prefer matching by pool+chain, but gracefully fall back to pool-only so
  // multiple simulations to the same pool aggregate into a single position
  // even if the chain identifier changes slightly.
  const existing =
    getPositionByPoolAddress(normalizedPool, chain) ??
    getPositionByPoolAddress(normalizedPool);
  if (existing) {
    let newAmount: string;
    try {
      newAmount = (BigInt(existing.depositAmount) + BigInt(amount)).toString();
    } catch (err) {
      console.error(
        "[DB] Failed to aggregate deposit amount for existing position",
        {
          positionId: existing.positionId,
          existingAmount: existing.depositAmount,
          incomingAmount: amount,
          error: err instanceof Error ? err.message : String(err),
        }
      );
      // Fallback: keep existing amount unchanged to avoid corrupting data
      return existing;
    }
    const updateStmt = db.prepare(`
      UPDATE positions
      SET deposit_amount = ?, updated_at = ?
      WHERE position_id = ?
    `);
    updateStmt.run(newAmount, now, existing.positionId);
    return getPosition(existing.positionId)!;
  }

  const positionId = `pos-${getNextPositionIndex()}`;
  const insertStmt = db.prepare(`
    INSERT INTO positions (
      position_id, pool_address, deposit_amount, chain, rpc_url, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `);
  insertStmt.run(positionId, normalizedPool, amount, chain, rpcUrl ?? null, now, now);
  return getPosition(positionId)!;
}

export function getActivePositions(limit: number = 100): Position[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM positions
    WHERE status = 'ACTIVE'
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as PositionRow[];
  return rows.map(rowToPosition);
}

export function updatePositionPool(
  positionId: string,
  nextPoolAddress: string
): Position | null {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE positions
    SET pool_address = ?, updated_at = ?
    WHERE position_id = ?
  `);
  stmt.run(nextPoolAddress, now, positionId);
  return getPosition(positionId);
}

export function createMonitoringReport(report: MonitoringReport): MonitoringReport {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO monitoring_reports (
      report_id, position_id, pool_address, deposit_amount, current_liquidity, status,
      next_best_pool, next_best_liquidity, reason, chain, timestamp,
      execution_status, execution_tx_hash, execution_error,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    report.reportId,
    report.positionId,
    report.poolAddress,
    report.depositAmount,
    report.currentLiquidity,
    report.status,
    report.nextBestPool ?? null,
    report.nextBestLiquidity ?? null,
    report.reason,
    report.chain,
    report.timestamp,
    report.executionStatus ?? null,
    report.executionTxHash ?? null,
    report.executionError ?? null,
    now,
    now
  );

  return getMonitoringReport(report.reportId)!;
}

export function updateMonitoringReportExecution(
  reportId: string,
  status: RebalanceStatus,
  txHash?: string,
  error?: string
): MonitoringReport | null {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE monitoring_reports
    SET execution_status = ?, execution_tx_hash = COALESCE(?, execution_tx_hash),
        execution_error = COALESCE(?, execution_error), updated_at = ?
    WHERE report_id = ?
  `);
  stmt.run(status, txHash ?? null, error ?? null, now, reportId);
  return getMonitoringReport(reportId);
}

export function getMonitoringReport(reportId: string): MonitoringReport | null {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM monitoring_reports WHERE report_id = ?
  `);
  const row = stmt.get(reportId) as MonitoringReportRow | undefined;
  return row ? rowToMonitoringReport(row) : null;
}

export function getMonitoringReports(limit: number = 100): MonitoringReport[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM monitoring_reports
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as MonitoringReportRow[];
  return rows.map(rowToMonitoringReport);
}

export function getLatestMonitoringReportByPosition(
  positionId: string
): MonitoringReport | null {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM monitoring_reports
    WHERE position_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `);
  const row = stmt.get(positionId) as MonitoringReportRow | undefined;
  return row ? rowToMonitoringReport(row) : null;
}

export function getActivePositionsWithMonitoring(
  limit: number = 100
): PositionWithMonitoring[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT
      p.position_id,
      p.pool_address,
      p.deposit_amount,
      p.chain,
      p.rpc_url,
      p.status,
      p.created_at,
      p.updated_at,
      mr.status AS latest_monitoring_status,
      mr.current_liquidity AS latest_liquidity,
      mr.timestamp AS last_scan_at
    FROM positions p
    LEFT JOIN monitoring_reports mr
      ON mr.report_id = (
        SELECT report_id FROM monitoring_reports
        WHERE position_id = p.position_id
        ORDER BY timestamp DESC
        LIMIT 1
      )
    WHERE p.status = 'ACTIVE'
    ORDER BY p.updated_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(limit) as Array<PositionRow & {
    latest_monitoring_status?: string | null;
    latest_liquidity?: string | null;
    last_scan_at?: number | null;
  }>;

  return rows.map((row) => ({
    positionId: row.position_id,
    poolAddress: row.pool_address,
    depositAmount: row.deposit_amount,
    chain: row.chain,
    rpcUrl: row.rpc_url ?? undefined,
    status: row.status as PositionWithMonitoring["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestMonitoringStatus:
      (row.latest_monitoring_status as PositionWithMonitoring["latestMonitoringStatus"]) ??
      undefined,
    latestLiquidity: row.latest_liquidity ?? undefined,
    lastScanAt: row.last_scan_at ?? undefined,
  }));
}

export function setTelegramAlerts(
  chatId: string,
  enabled: boolean
): TelegramAlertSetting {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO telegram_alert_settings (chat_id, enabled, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  stmt.run(chatId, enabled ? 1 : 0, now);
  return { chatId, enabled, updatedAt: now };
}

export function getTelegramAlertSetting(chatId: string): TelegramAlertSetting | null {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT chat_id, enabled, updated_at
    FROM telegram_alert_settings
    WHERE chat_id = ?
  `);
  const row = stmt.get(chatId) as
    | { chat_id: string; enabled: number; updated_at: number }
    | undefined;
  if (!row) return null;
  return {
    chatId: row.chat_id,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at,
  };
}

export function getEnabledTelegramChatIds(): string[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT chat_id FROM telegram_alert_settings WHERE enabled = 1
  `);
  const rows = stmt.all() as Array<{ chat_id: string }>;
  return rows.map((r) => r.chat_id);
}

const VALID_PROFILES: AgentProfile[] = [
  "conservative",
  "balanced",
  "backstop",
];

export function setTelegramProfile(
  chatId: string,
  profile: AgentProfile
): { chatId: string; profile: AgentProfile; updatedAt: number } {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO telegram_profiles (chat_id, profile, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      profile = excluded.profile,
      updated_at = excluded.updated_at
  `);
  stmt.run(chatId, profile, now);
  return { chatId, profile, updatedAt: now };
}

export function getTelegramProfileRecord(
  chatId: string
): { chatId: string; profile: AgentProfile; updatedAt: number } | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT chat_id, profile, updated_at FROM telegram_profiles WHERE chat_id = ?`
    )
    .get(chatId) as
    | { chat_id: string; profile: string; updated_at: number }
    | undefined;
  if (!row) return null;
  const p = row.profile as AgentProfile;
  if (!VALID_PROFILES.includes(p)) return null;
  return { chatId: row.chat_id, profile: p, updatedAt: row.updated_at };
}

export function getEffectiveTelegramProfile(chatId: string): AgentProfile {
  return getTelegramProfileRecord(chatId)?.profile ?? "balanced";
}

function rowToSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    intent: JSON.parse(row.intent) as SettlementIntent,
    status: row.status as SettlementStatus,
    riskReport: row.risk_report ? JSON.parse(row.risk_report) as RiskReport : undefined,
    txHash: row.tx_hash ?? undefined,
    explorerUrl: row.explorer_url ?? undefined,
    keeperExecutionHash: row.keeper_execution_hash ?? undefined,
    keeperAuditUrl: row.keeper_audit_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPosition(row: PositionRow): Position {
  return {
    positionId: row.position_id,
    poolAddress: row.pool_address,
    depositAmount: row.deposit_amount,
    chain: row.chain,
    rpcUrl: row.rpc_url ?? undefined,
    status: row.status as Position["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMonitoringReport(row: MonitoringReportRow): MonitoringReport {
  return {
    reportId: row.report_id,
    positionId: row.position_id,
    poolAddress: row.pool_address,
    depositAmount: row.deposit_amount,
    currentLiquidity: row.current_liquidity,
    status: row.status as MonitoringReport["status"],
    nextBestPool: row.next_best_pool ?? undefined,
    nextBestLiquidity: row.next_best_liquidity ?? undefined,
    reason: row.reason,
    chain: row.chain,
    timestamp: row.timestamp,
    executionStatus: row.execution_status as RebalanceStatus | undefined,
    executionTxHash: row.execution_tx_hash ?? undefined,
    executionError: row.execution_error ?? undefined,
  };
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log("[DB] Database closed");
  }
}
