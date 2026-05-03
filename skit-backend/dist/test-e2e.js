/**
 * End-to-end test for the SettleKit backend
 *
 * Tests the full flow:
 * 1. POST /trigger - Create a settlement
 * 2. POST /webhook - Simulate anomaly-driven WARNING report
 * 3. Backend rotates collateral through KeeperHub + updates settlement
 * 4. GET /settlement/:id - Verify rotation output is visible
 */
import "dotenv/config";
const BACKEND_URL = process.env.BACKEND_URL || "https://seedier-reese-nomographic.ngrok-free.dev";
// Test settlement intent (matches test-payload.json from CRE workflow)
const testIntent = {
    sourceChain: "baseSepolia",
    targetChain: "unichainSepolia",
    token: "USDC",
    amount: "1000000", // 1 USDC (6 decimals)
    maxSlippageTolerance: 0.01,
    maxBridgeDelay: 1200000,
    sourceRpc: "https://virtual.base-sepolia.eu.rpc.tenderly.co/eda241e6-2aa8-4abe-9db9-784bd0ceb88d",
    targetRpc: "https://virtual.astrochain-sepolia.eu.rpc.tenderly.co/988a84e2-3652-4013-aa50-a563ec925736"
};
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function testHealthEndpoint() {
    console.log("\n=== Testing /health endpoint ===");
    try {
        const response = await fetch(`${BACKEND_URL}/health`);
        const data = await response.json();
        console.log("Health check response:", JSON.stringify(data, null, 2));
        if (data.status !== "ok") {
            console.error("Health check failed: status is not 'ok'");
            return false;
        }
        if (!data.executorAddress) {
            console.warn("WARNING: No executor address - execution will be disabled");
        }
        return true;
    }
    catch (error) {
        console.error("Health check failed:", error);
        return false;
    }
}
async function testTriggerEndpoint() {
    console.log("\n=== Testing POST /trigger endpoint ===");
    try {
        const response = await fetch(`${BACKEND_URL}/trigger`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(testIntent),
        });
        const data = await response.json();
        console.log("Trigger response:", JSON.stringify(data, null, 2));
        if (!data.settlementId) {
            console.error("Trigger failed: no settlementId returned");
            return null;
        }
        console.log(`Settlement created: ${data.settlementId}`);
        return data.settlementId;
    }
    catch (error) {
        console.error("Trigger failed:", error);
        return null;
    }
}
async function testWebhookEndpoint(settlementId) {
    console.log("\n=== Testing POST /webhook endpoint (WARNING + rotateCollateral) ===");
    // Create a mock WARNING risk report that should trigger collateral rotation.
    const mockReport = {
        status: "WARNING",
        checks: [
            {
                name: "slippage",
                passed: true,
                actual: "0.5%",
                threshold: "1%",
                severity: "warning",
                description: "Slippage within acceptable range"
            },
            {
                name: "liquidity",
                passed: true,
                actual: "deep",
                threshold: "moderate",
                severity: "critical",
                description: "Pool liquidity is sufficient"
            },
            {
                name: "bridgeDelay",
                passed: true,
                actual: "300000",
                threshold: "1200000",
                severity: "warning",
                description: "Bridge delay within acceptable range"
            },
            {
                name: "priceDeviation",
                passed: false,
                actual: 6.2,
                threshold: "pass<=5% / rotate 5-10% / exit>10%",
                severity: "warning",
                description: "Balanced profile rotate band triggered"
            }
        ],
        oracleData: {
            ethUsdPrice: "250000000000",
            usdcUsdPrice: "100000000",
            timestamp: Date.now()
        },
        tenderlySim: {
            success: true,
            gasEstimate: "250000",
            expectedOutput: "995000"
        },
        explorerUrl: "https://dashboard.tenderly.co/winverse/project/testnet/22cbc0df-919d-4cdc-927b-436480a7129f",
        recipeId: `risk-${Date.now()}`,
        timestamp: Date.now(),
        intent: testIntent,
        metadata: {
            executionId: `exec-${Date.now()}`,
            notes: ["E2E warning rotation simulation"],
            agentProfile: "balanced",
            profileAction: "PARTIAL_ROTATE_HOLD",
            priceDeviationPercent: 6.2
        }
    };
    const webhookPayload = {
        event: "RISK_REPORT",
        report: mockReport,
        sentAt: Date.now()
    };
    try {
        console.log("Sending webhook with WARNING status (rotation path)...");
        const response = await fetch(`${BACKEND_URL}/webhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webhookPayload),
        });
        const data = await response.json();
        console.log("Webhook response:", JSON.stringify(data, null, 2));
        return data.success === true;
    }
    catch (error) {
        console.error("Webhook failed:", error);
        return false;
    }
}
async function testGetSettlement(settlementId) {
    console.log(`\n=== Testing GET /settlement/${settlementId} ===`);
    try {
        const response = await fetch(`${BACKEND_URL}/settlement/${settlementId}`);
        const data = await response.json();
        console.log("Settlement details:", JSON.stringify(data, null, 2));
        if (data.status === "EXECUTED" && data.execution?.txHash) {
            console.log("\n" + "=".repeat(60));
            console.log("SUCCESS! Settlement executed on Tenderly VNet");
            console.log("=".repeat(60));
            console.log(`Transaction Hash: ${data.execution.txHash}`);
            console.log(`Explorer URL: ${data.execution.explorerUrl}`);
            console.log("=".repeat(60));
        }
        else if (data.status === "FAILED") {
            console.log("\nExecution FAILED - check executor logs");
        }
        else {
            console.log(`\nSettlement status: ${data.status}`);
        }
    }
    catch (error) {
        console.error("Get settlement failed:", error);
    }
}
async function testListSettlements() {
    console.log("\n=== Testing GET /settlements ===");
    try {
        const response = await fetch(`${BACKEND_URL}/settlements`);
        const data = await response.json();
        console.log(`Found ${data.length} settlement(s)`);
        if (data.length > 0) {
            console.log("\nLatest settlement:");
            console.log(JSON.stringify(data[0], null, 2));
        }
    }
    catch (error) {
        console.error("List settlements failed:", error);
    }
}
async function runE2ETest() {
    console.log("=".repeat(60));
    console.log("  SettleKit Backend E2E Test");
    console.log("=".repeat(60));
    console.log(`Backend URL: ${BACKEND_URL}`);
    console.log("=".repeat(60));
    // 1. Health check
    const healthy = await testHealthEndpoint();
    if (!healthy) {
        console.error("\nBackend is not healthy. Make sure it's running:");
        console.error("  cd skit-backend && npm run dev");
        process.exit(1);
    }
    // 2. Trigger settlement
    const settlementId = await testTriggerEndpoint();
    if (!settlementId) {
        console.error("\nFailed to create settlement");
        process.exit(1);
    }
    // 3. Check initial settlement status
    await testGetSettlement(settlementId);
    console.log("\nFlow target:");
    console.log("profile set -> anomaly triggered -> WARNING fired -> rotation executed -> Risk Explorer updated -> Telegram alerted");
    // 4. Simulate CRE webhook with WARNING status and balanced rotate action
    const webhookSuccess = await testWebhookEndpoint(settlementId);
    if (!webhookSuccess) {
        console.error("\nWebhook processing failed");
    }
    // 5. Wait a moment for rotation execution to complete
    console.log("\nWaiting for execution to complete...");
    await sleep(3000);
    // 6. Check final settlement status
    await testGetSettlement(settlementId);
    // 7. List all settlements
    await testListSettlements();
    console.log("\n" + "=".repeat(60));
    console.log("  E2E Test Complete");
    console.log("=".repeat(60));
}
runE2ETest().catch(console.error);
