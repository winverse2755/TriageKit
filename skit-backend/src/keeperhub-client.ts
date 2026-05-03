/**
 * KeeperHub HTTP adapter — relays execution with exponential retry, optional private gas + audit trail flags.
 * When KEEPERHUB_BASE_URL is unset, falls back to local broadcast and prefixes execution id as `local:{txHash}`.
 */

import type { Address, Hash } from "viem";

export type KeeperHubExecutionResult = {
  success: boolean;
  txHash?: Hash;
  explorerUrl?: string;
  keeperExecutionHash?: string;
  keeperAuditUrl?: string;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SubmitThroughKeeperHubOptions = {
  chainId: number;
  to: Address;
  data: Hash;
  value?: bigint;
  from: Address;
  recipeId?: string;
  sendLocally: () => Promise<Hash>;
  buildExplorerUrl: (txHash: Hash) => string;
};

/**
 * POST intent to KeeperHub when configured; on success with txHash from API, use it.
 * If API returns only an execution id/hash, run local send and attach KeeperHub audit id.
 * Retries with exponential backoff on network / 5xx errors.
 */
export async function submitThroughKeeperHub(
  options: SubmitThroughKeeperHubOptions
): Promise<KeeperHubExecutionResult> {
  const base = process.env.KEEPERHUB_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.KEEPERHUB_API_KEY;
  const maxAttempts = Math.max(
    1,
    Number(process.env.KEEPERHUB_MAX_ATTEMPTS ?? "5")
  );

  const payload = {
    chainId: options.chainId,
    to: options.to,
    data: options.data,
    value: (options.value ?? 0n).toString(),
    from: options.from,
    metadata: {
      recipeId: options.recipeId,
    },
    execution: {
      exponentialRetry: true,
      privateGasRouting: true,
      auditTrail: true,
    },
  };

  if (base) {
    let lastError: string | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(`${base}/v1/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const json = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;

        if (!res.ok) {
          throw new Error(
            String(json.error ?? json.message ?? `HTTP ${res.status}`)
          );
        }

        const keeperExecutionHash =
          (json.executionHash as string | undefined) ??
          (json.execution_id as string | undefined) ??
          (json.id as string | undefined);

        const keeperAuditUrl = json.auditUrl as string | undefined;

        const txFromApi =
          (json.txHash as Hash | undefined) ??
          (json.transactionHash as Hash | undefined);

        if (txFromApi) {
          return {
            success: true,
            txHash: txFromApi,
            explorerUrl: options.buildExplorerUrl(txFromApi),
            keeperExecutionHash: keeperExecutionHash ?? `kh:${txFromApi}`,
            keeperAuditUrl,
          };
        }

        if (keeperExecutionHash) {
          const txHash = await options.sendLocally();
          return {
            success: true,
            txHash,
            explorerUrl: options.buildExplorerUrl(txHash),
            keeperExecutionHash,
            keeperAuditUrl,
          };
        }

        lastError = "KeeperHub response missing executionHash and txHash";
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt < maxAttempts - 1) {
          await sleep(Math.min(30_000, 250 * 2 ** attempt));
        }
      }
    }

    console.warn(
      "[KeeperHub] Exhausted retries or invalid response, falling back to local:",
      lastError
    );
  }

  try {
    const txHash = await options.sendLocally();
    return {
      success: true,
      txHash,
      explorerUrl: options.buildExplorerUrl(txHash),
      keeperExecutionHash: `local:${txHash}`,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
