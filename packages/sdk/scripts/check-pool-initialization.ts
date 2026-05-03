/**
 * Check Pool Initialization Script
 * 
 * Checks if a Uniswap v4 pool is initialized by calling getPoolState
 * and checking if sqrtPriceX96 > 0.
 * 
 * Usage:
 *   npx ts-node packages/sdk/scripts/check-pool-initialization.ts
 */

import { getPoolManagerAddress } from '../src/utils/pool-utils';
import { encodeAbiParameters, keccak256, type Address } from 'viem';

/**
 * Compute the Uniswap v4 pool ID from pool key parameters.
 */
function computePoolId(poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
}): `0x${string}` {
    const encoded = encodeAbiParameters(
        [
            { type: 'address' },
            { type: 'address' },
            { type: 'uint24' },
            { type: 'int24' },
            { type: 'address' },
        ],
        [
            poolKey.currency0,
            poolKey.currency1,
            poolKey.fee,
            poolKey.tickSpacing,
            poolKey.hooks,
        ]
    );
    return keccak256(encoded);
}

// Pool key components
const POOL_KEY = {
    currency0: '0x0000000000000000000000000000000000000000' as Address, // NATIVE (ETH)
    currency1: '0x31d0220469e10c4e71834a79b1f276d740d3768f' as Address, // USDC
    fee: 3000,      // 0.30%
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000' as Address,
};

// Hardcoded monitoring registry for Unichain Sepolia.
// This replaces single-pool checks so monitoring can rank candidates.
const POOL_REGISTRY = [
    '0x1927686e9757bb312fc499e480536d466c788dcdc86a1b62c82643157f05b603',
    '0x8ebf9a6a4441d3933bac6c3883b281296d35f08a77e7609b465904796493c565',
    '0x2416572822faafe979baf31ef1892753017fc0ccd358b82eba9a93289b8e2565',
] as const satisfies readonly `0x${string}`[];

// Pool Manager ABI for direct state query
const POOL_MANAGER_ABI = [
    {
        name: 'extsload',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'slot', type: 'bytes32' }],
        outputs: [{ name: 'value', type: 'bytes32' }],
    },
] as const;

/**
 * Convert sqrtPriceX96 to human-readable price (ETH in USDC)
 */
function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
    const Q96 = 2n ** 96n;
    const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
    const rawPrice = sqrtPrice * sqrtPrice;
    // Convert from raw to human price: price = rawPrice / 10^-12 = rawPrice * 10^12
    return rawPrice * 1e12;
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║           Uniswap v4 Pool Initialization Check                   ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');

    console.log('Pool Configuration:');
    console.log(`  Pool ID (computed from key): ${computePoolId(POOL_KEY)}`);
    console.log(`  Currency0 (Native): ${POOL_KEY.currency0}`);
    console.log(`  Currency1 (USDC):   ${POOL_KEY.currency1}`);
    console.log(`  Fee: ${POOL_KEY.fee} (${POOL_KEY.fee / 10000}%)`);
    console.log(`  Tick Spacing: ${POOL_KEY.tickSpacing}`);
    console.log(`  Hooks: ${POOL_KEY.hooks}`);
    console.log('');

    try {
        const poolManagerAddress = getPoolManagerAddress('unichainSepolia');
        console.log(`Pool Manager: ${poolManagerAddress}`);
        console.log('Chain: Unichain Sepolia (9991301)');
        console.log(`  Registry pools: ${POOL_REGISTRY.length}`);
        console.log('');

        // Import viem for direct query
        const { createPublicClient, http } = await import('viem');
        const { unichainSepolia } = await import('../src/config/networks');
        
        const publicClient = createPublicClient({
            chain: unichainSepolia,
            transport: http(),
        });

        // In Uniswap v4, the pools mapping is at slot 6
        const POOLS_SLOT = 6n;
        console.log('Querying registry pools via direct extsload...');

        const results = await Promise.all(
            POOL_REGISTRY.map(async (poolId) => {
                const poolStateSlot = keccak256(
                    encodeAbiParameters(
                        [{ type: 'bytes32' }, { type: 'uint256' }],
                        [poolId, POOLS_SLOT]
                    )
                );

                const slot0Value = await publicClient.readContract({
                    address: poolManagerAddress,
                    abi: POOL_MANAGER_ABI,
                    functionName: 'extsload',
                    args: [poolStateSlot],
                });

                // slot0 packs: sqrtPriceX96 (160 bits) + tick (24 bits) + protocolFee (24 bits) + lpFee (24 bits)
                const slot0BigInt = BigInt(slot0Value);
                const sqrtPriceX96 = slot0BigInt & ((1n << 160n) - 1n);
                const tickRaw = Number((slot0BigInt >> 160n) & 0xFFFFFFn);
                const tick = tickRaw > 0x7FFFFF ? tickRaw - 0x1000000 : tickRaw;
                const initialized = sqrtPriceX96 > 0n;
                const price = initialized ? sqrtPriceX96ToPrice(sqrtPriceX96) : 0;

                return {
                    poolId,
                    initialized,
                    sqrtPriceX96,
                    tick,
                    liquidity: 0n,
                    price,
                };
            })
        );

        for (const item of results) {
            console.log('');
            console.log('┌──────────────────────────────────────────────────────────────────┐');
            console.log(`│ Pool: ${item.poolId.slice(0, 56).padEnd(59)}│`);
            console.log('├──────────────────────────────────────────────────────────────────┤');
            if (item.initialized) {
                console.log('│  Status:        ✓ INITIALIZED                                   │');
                console.log(`│  sqrtPriceX96:  ${item.sqrtPriceX96.toString().padEnd(46)}│`);
                console.log(`│  Tick:          ${item.tick.toString().padEnd(46)}│`);
                console.log(`│  Price (ETH):   $${item.price.toFixed(2)} USDC`.padEnd(67) + '│');
            } else {
                console.log('│  Status:        ✗ NOT INITIALIZED                               │');
                console.log('│  sqrtPriceX96:  0                                               │');
                console.log('│                                                                 │');
                console.log('│  The pool needs to be initialized with an initial price.       │');
            }
            console.log('└──────────────────────────────────────────────────────────────────┘');
        }
        console.log('');

        return results;
    } catch (error) {
        console.error('');
        console.error('┌──────────────────────────────────────────────────────────────────┐');
        console.error('│  ERROR: Failed to query pool state                               │');
        console.error('├──────────────────────────────────────────────────────────────────┤');
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`│  ${errorMessage.slice(0, 62).padEnd(62)}│`);
        console.error('└──────────────────────────────────────────────────────────────────┘');
        throw error;
    }
}

// Export for programmatic use
export { main as checkPoolInitialization, POOL_REGISTRY, POOL_KEY };

// Run if executed directly
if (require.main === module) {
    main()
        .then((result) => {
            const allInitialized = result.every((pool) => pool.initialized);
            process.exit(allInitialized ? 0 : 1);
        })
        .catch((error) => {
            console.error('Fatal error:', error);
            process.exit(2);
        });
}
