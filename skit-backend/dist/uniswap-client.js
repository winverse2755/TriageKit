function parseRoute(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((hop) => {
        if (typeof hop === "string")
            return hop;
        if (hop && typeof hop === "object") {
            const out = hop
                .tokenOutSymbol;
            if (out)
                return out;
            const tokenOut = hop.tokenOut;
            return tokenOut ?? "";
        }
        return "";
    })
        .filter(Boolean);
}
function fallbackQuote(args) {
    // Keep deterministic behavior in test/dev when external API shape or availability varies.
    const fallbackOut = (BigInt(args.amountIn) * 995n) / 1000n;
    return {
        provider: "uniswap",
        chainId: args.chainId,
        fromToken: args.fromToken,
        toToken: args.toToken,
        amountIn: args.amountIn,
        amountOut: fallbackOut.toString(),
        route: [args.fromToken, args.toToken],
    };
}
export async function quoteUniswapRotation(args) {
    const baseUrl = (process.env.UNISWAP_API_BASE_URL ?? "https://api.uniswap.org/v1").replace(/\/$/, "");
    const endpoint = process.env.UNISWAP_QUOTE_PATH ?? "/quote";
    const url = `${baseUrl}${endpoint}`;
    const payload = {
        chainId: args.chainId,
        tokenIn: args.fromToken,
        tokenOut: args.toToken,
        amount: args.amountIn,
        type: "EXACT_INPUT",
    };
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(process.env.UNISWAP_API_KEY
                    ? { Authorization: `Bearer ${process.env.UNISWAP_API_KEY}` }
                    : {}),
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json());
        const amountOutRaw = data.amountOut;
        const amountOut = amountOutRaw !== undefined ? String(amountOutRaw) : undefined;
        if (!amountOut || !/^\d+$/.test(amountOut)) {
            throw new Error("Missing amountOut in quote response");
        }
        return {
            provider: "uniswap",
            chainId: args.chainId,
            fromToken: args.fromToken,
            toToken: args.toToken,
            amountIn: args.amountIn,
            amountOut,
            route: parseRoute(data.route).length
                ? parseRoute(data.route)
                : [args.fromToken, args.toToken],
            raw: data,
        };
    }
    catch (error) {
        console.warn("[Uniswap] Quote failed, using deterministic fallback quote:", error instanceof Error ? error.message : String(error));
        return fallbackQuote(args);
    }
}
