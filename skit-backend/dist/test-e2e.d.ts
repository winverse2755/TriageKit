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
