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
export declare function submitThroughKeeperHub(options: SubmitThroughKeeperHubOptions): Promise<KeeperHubExecutionResult>;
