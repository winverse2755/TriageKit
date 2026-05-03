'use client';

import { useState } from 'react';
import { FileText, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface RecipeIntent {
  sourceChain: string;
  targetChain: string;
  token: string;
  amount: string;
  maxSlippageTolerance: number;
  maxBridgeDelay: number;
  sourceRpc: string;
  targetRpc: string;
}

interface RecipeBreakdownProps {
  intent: RecipeIntent;
  selectedPoolId?: string;
  rotation?: {
    partialExitAmount: string;
    fromToken: string;
    toToken: string;
    quote?: {
      route?: string[];
      amountOut?: string;
    };
    executionStatus: string;
  };
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8', className)}
      onClick={copy}
      title={copied ? 'Copied!' : 'Copy'}
    >
      <Copy className="h-4 w-4" />
    </Button>
  );
}

function truncateHash(hash: string, start = 8, end = 6) {
  if (hash.length <= start + end) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

function Field({
  label,
  value,
  mono = false,
  copyValue,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  copyValue?: string;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      <div className="flex items-center gap-1">
        <span className={cn('text-base font-semibold text-foreground', mono && 'font-mono')}>
          {value}
        </span>
        {copyValue != null && <CopyButton text={copyValue} />}
      </div>
    </div>
  );
}

export function RecipeBreakdown({ intent, selectedPoolId, rotation }: RecipeBreakdownProps) {
  return (
    <Card
      className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-[8px] overflow-hidden"
      style={{
        background: 'rgba(21,18,40,0.5)',
        borderColor: 'rgba(42,37,69,0.6)',
      }}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xl font-bold">
          <FileText className="h-5 w-5 text-primary" />
          Recipe Breakdown
        </CardTitle>
        <p className="text-[13px] text-muted-foreground">Settlement intent and parameters</p>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Source Chain" value={intent.sourceChain} />
          <Field label="Target Chain" value={intent.targetChain} />
          <Field label="Token" value={intent.token} />
          <Field
            label="Amount"
            value={`${formatAmount(intent.amount)} ${intent.token}`}
            mono
          />
          {selectedPoolId && (
            <div className="md:col-span-2">
              <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                Selected Pool (ID)
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="font-mono text-base font-semibold text-foreground"
                  title={selectedPoolId}
                >
                  {truncateHash(selectedPoolId.startsWith('0x') ? selectedPoolId : `0x${selectedPoolId}`, 8, 6)}
                </span>
                <CopyButton text={selectedPoolId} />
              </div>
            </div>
          )}
          <Field
            label="Max Slippage"
            value={`${(intent.maxSlippageTolerance * 100).toFixed(2)}%`}
          />
          <Field label="Max Bridge Delay" value={`${intent.maxBridgeDelay}ms`} mono />
          {rotation ? (
            <>
              <Field label="rotateCollateral" value="enabled" />
              <Field
                label="Partial Exit Amount"
                value={formatAmount(rotation.partialExitAmount)}
                mono
              />
              <Field
                label="Rotation Pair"
                value={`${rotation.fromToken} -> ${rotation.toToken}`}
              />
              <Field
                label="Rotation Status"
                value={rotation.executionStatus}
              />
            </>
          ) : null}
        </div>
        {rotation?.quote?.route?.length ? (
          <div className="mt-4 text-sm text-muted-foreground">
            Swap route: <span className="font-mono">{rotation.quote.route.join(" -> ")}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
