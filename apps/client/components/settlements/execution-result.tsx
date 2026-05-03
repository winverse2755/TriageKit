'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, ExternalLink, Copy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getTenderlyTxUrl } from '@/lib/utils';
import { cn } from '@/lib/utils';

function truncateHash(hash: string, start = 10, end = 8) {
  if (hash.length <= start + end) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

interface ExecutionResultProps {
  txHash: string;
  success?: boolean;
  errorMessage?: string;
  keeperExecutionHash?: string;
  keeperAuditUrl?: string;
  rotation?: {
    partialExitAmount: string;
    fromToken: string;
    toToken: string;
    executionStatus: string;
    executionError?: string;
    quote?: {
      amountOut: string;
      route: string[];
    };
  };
}

export function ExecutionResult({
  txHash,
  success = true,
  errorMessage,
  keeperExecutionHash,
  keeperAuditUrl,
  rotation,
}: ExecutionResultProps) {
  const [copied, setCopied] = useState(false);
  const [copiedKeeper, setCopiedKeeper] = useState(false);
  const hasTxHash = txHash.startsWith('0x');

  const copyHash = () => {
    navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyKeeperHash = () => {
    if (!keeperExecutionHash) return;
    navigator.clipboard.writeText(keeperExecutionHash);
    setCopiedKeeper(true);
    setTimeout(() => setCopiedKeeper(false), 1500);
  };

  return (
    <Card
      className={cn(
        'rounded-xl border border-border/60 bg-card/50 backdrop-blur-[8px] overflow-hidden',
        !success && 'border-destructive/30'
      )}
      style={{
        background: 'rgba(21,18,40,0.5)',
        borderColor: success ? 'rgba(42,37,69,0.6)' : undefined,
      }}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xl font-bold">
          {success ? (
            <CheckCircle2 className="h-5 w-5 text-success" />
          ) : (
            <XCircle className="h-5 w-5 text-destructive" />
          )}
          Execution Result
        </CardTitle>
        <p className="text-[13px] text-muted-foreground">Transaction details</p>
      </CardHeader>
      <CardContent className="pt-2 space-y-4">
        {errorMessage && (
          <div
            className="rounded-lg border-l-4 border-destructive bg-destructive/10 px-4 py-3"
            style={{
              background: 'rgba(248,113,113,0.08)',
              borderLeftColor: 'rgb(248,113,113)',
            }}
          >
            <p className="font-mono text-sm text-destructive">{errorMessage}</p>
          </div>
        )}
        <div>
          <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Transaction Hash
          </div>
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-sm text-foreground"
              title={txHash}
            >
              {truncateHash(txHash)}
            </span>
            {hasTxHash ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={copyHash}
                title={copied ? 'Copied!' : 'Copy hash'}
              >
                <Copy className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasTxHash ? (
            <Button
              variant="outline"
              size="sm"
              className="border-primary text-primary hover:bg-primary/10"
              asChild
            >
              <a
                href={getTenderlyTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                View on Tenderly
              </a>
            </Button>
          ) : null}
          {keeperAuditUrl ? (
            <Button
              variant="outline"
              size="sm"
              className="border-muted-foreground/40"
              asChild
            >
              <a
                href={keeperAuditUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                KeeperHub audit
              </a>
            </Button>
          ) : null}
        </div>
        {keeperExecutionHash ? (
          <div>
            <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              KeeperHub execution hash
            </div>
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-sm text-foreground"
                title={keeperExecutionHash}
              >
                {truncateHash(keeperExecutionHash, 12, 10)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={copyKeeperHash}
                title={copiedKeeper ? 'Copied!' : 'Copy KeeperHub hash'}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
        {rotation ? (
          <div className="rounded-lg border border-border/50 px-3 py-3">
            <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Collateral Rotation
            </div>
            <p className="font-mono text-sm">
              {rotation.fromToken} -&gt; {rotation.toToken} | partialExit={rotation.partialExitAmount}
            </p>
            <p className="font-mono text-xs text-muted-foreground mt-1">
              status={rotation.executionStatus}
              {rotation.quote?.route?.length
                ? ` | route=${rotation.quote.route.join(" -> ")}`
                : ""}
            </p>
            {rotation.executionError ? (
              <p className="font-mono text-xs text-destructive mt-1">
                error={rotation.executionError}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
