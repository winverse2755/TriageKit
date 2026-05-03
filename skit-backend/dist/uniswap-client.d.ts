import type { RotationQuote } from "./types.js";
export declare function quoteUniswapRotation(args: {
    chainId: number;
    fromToken: string;
    toToken: string;
    amountIn: string;
}): Promise<RotationQuote>;
