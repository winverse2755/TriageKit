'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './status-badge';
import { StatusTimeline } from './status-timeline';
import { RecipeBreakdown } from './recipe-breakdown';
import { OraclePrices } from './oracle-prices';
import { RiskCheckResults } from './risk-check-results';
import { TenderlySimulation } from './tenderly-simulation';
import { ExecutionResult } from './execution-result';
import { getTenderlyTxUrl } from '@/lib/utils';
import { fadeUp } from '@/lib/animations';

export function formatTimestamp(ts: number) {
  return new Date(ts).toLocaleString();
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
  agentProfile?: 'conservative' | 'balanced' | 'backstop';
}

export interface RiskCheck {
  name: string;
  passed: boolean;
  actual: string | number;
  threshold: string | number;
  severity: string;
  description?: string;
}

export interface OracleDataReport {
  ethUsdPrice: string;
  usdcUsdPrice: string;
  timestamp: number;
}

export interface TenderlySim {
  success: boolean;
  gasEstimate: string;
  expectedOutput: string;
  vnetId?: string;
  txHash?: string;
}

export interface RiskReport {
  status: string;
  checks: RiskCheck[];
  oracleData: OracleDataReport;
  tenderlySim: TenderlySim;
  explorerUrl: string;
  recipeId: string;
  timestamp: number;
  intent: SettlementIntent;
  selectedPoolId?: string;
  metadata?: {
    executionId?: string;
    notes?: string[];
    agentProfile?: string;
    profileAction?: string;
    stabilizationIntentLogged?: boolean;
    priceDeviationPercent?: number;
    rotation?: {
      shouldRotate: boolean;
      partialExitAmount: string;
      fromToken: string;
      toToken: string;
      executionStatus: string;
      executionError?: string;
      quote?: {
        amountOut: string;
        route: string[];
      };
      txHash?: string;
    };
  };
}

export interface Settlement {
  id: string;
  intent: SettlementIntent;
  status: string;
  riskReport?: RiskReport;
  execution?: {
    txHash: string;
    explorerUrl: string;
    keeperExecutionHash?: string;
    keeperAuditUrl?: string;
  };
  txHash?: string;
  explorerUrl?: string;
  keeperExecutionHash?: string;
  keeperAuditUrl?: string;
  createdAt: number;
  updatedAt: number;
}

interface SettlementDetailProps {
  settlement: Settlement;
}

export function SettlementDetail({ settlement }: SettlementDetailProps) {
  const [copied, setCopied] = useState(false);
  const report = settlement.riskReport;
  const txHash = settlement.execution?.txHash || settlement.txHash;
  const explorerUrl = txHash
    ? getTenderlyTxUrl(txHash)
    : report?.explorerUrl || settlement.explorerUrl;

  const copyId = () => {
    navigator.clipboard.writeText(settlement.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="container mx-auto px-4 lg:px-8 py-12">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        transition={{ duration: 0.3 }}
      >
        <Button variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground hover:text-foreground" asChild>
          <Link href="/settlements" className="flex items-center gap-2 text-sm">
            <ArrowLeft className="h-4 w-4" />
            Back to Settlements
          </Link>
        </Button>
      </motion.div>

      <motion.div
        className="mb-6"
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-[28px] md:text-[32px] font-bold text-foreground">
            {settlement.id}
          </h1>
          <StatusBadge status={settlement.status as any} size="lg" showDot />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={copyId}
            title={copied ? 'Copied!' : 'Copy settlement ID'}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[13px] text-foreground-faint font-mono mt-2">
          Created: {formatTimestamp(settlement.createdAt)} • Updated: {formatTimestamp(settlement.updatedAt)}
        </p>
      </motion.div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="mb-8"
      >
        <StatusTimeline
          status={settlement.status}
          failedStep={settlement.status === 'FAILED' ? 'execution' : null}
        />
      </motion.div>

      <div className="grid gap-6">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          transition={{ duration: 0.3, delay: 0.5 }}
        >
          <RecipeBreakdown
            intent={settlement.intent}
            selectedPoolId={report?.selectedPoolId}
            rotation={report?.metadata?.rotation}
          />
        </motion.div>

        {report && (
          <>
            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              transition={{ duration: 0.3, delay: 0.65 }}
            >
              <OraclePrices oracleData={report.oracleData} />
            </motion.div>

            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              transition={{ duration: 0.3, delay: 0.8 }}
            >
              <RiskCheckResults checks={report.checks} />
            </motion.div>

            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              transition={{ duration: 0.3, delay: 1.1 }}
            >
              <TenderlySimulation
                tenderlySim={report.tenderlySim}
                explorerUrl={explorerUrl}
              />
            </motion.div>
          </>
        )}

        {(txHash || settlement.execution || report?.metadata?.rotation) && (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.3, delay: 1.25 }}
          >
            <ExecutionResult
              txHash={txHash ?? report?.metadata?.rotation?.txHash ?? "n/a"}
              success={settlement.status !== 'FAILED'}
              keeperExecutionHash={
                settlement.execution?.keeperExecutionHash ??
                settlement.keeperExecutionHash
              }
              keeperAuditUrl={
                settlement.execution?.keeperAuditUrl ?? settlement.keeperAuditUrl
              }
              rotation={report?.metadata?.rotation}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}
