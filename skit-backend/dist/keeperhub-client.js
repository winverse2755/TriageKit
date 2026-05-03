/**
 * KeeperHub HTTP adapter — relays execution with exponential retry, optional private gas + audit trail flags.
 * When KEEPERHUB_BASE_URL is unset, falls back to local broadcast and prefixes execution id as `local:{txHash}`.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * POST intent to KeeperHub when configured; on success with txHash from API, use it.
 * If API returns only an execution id/hash, run local send and attach KeeperHub audit id.
 * Retries with exponential backoff on network / 5xx errors.
 */
export async function submitThroughKeeperHub(options) {
    const base = process.env.KEEPERHUB_BASE_URL?.replace(/\/$/, "");
    const apiKey = process.env.KEEPERHUB_API_KEY;
    const maxAttempts = Math.max(1, Number(process.env.KEEPERHUB_MAX_ATTEMPTS ?? "5"));
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
        let lastError;
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
                const json = (await res.json().catch(() => ({})));
                if (!res.ok) {
                    throw new Error(String(json.error ?? json.message ?? `HTTP ${res.status}`));
                }
                const keeperExecutionHash = json.executionHash ??
                    json.execution_id ??
                    json.id;
                const keeperAuditUrl = json.auditUrl;
                const txFromApi = json.txHash ??
                    json.transactionHash;
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
            }
            catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
                if (attempt < maxAttempts - 1) {
                    await sleep(Math.min(30_000, 250 * 2 ** attempt));
                }
            }
        }
        console.warn("[KeeperHub] Exhausted retries or invalid response, falling back to local:", lastError);
    }
    try {
        const txHash = await options.sendLocally();
        return {
            success: true,
            txHash,
            explorerUrl: options.buildExplorerUrl(txHash),
            keeperExecutionHash: `local:${txHash}`,
        };
    }
    catch (e) {
        return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}
