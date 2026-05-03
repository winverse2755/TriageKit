# TriageKit

**Cooperative Risk Response for Agentic DeFi**

TriageKit builds on [SettleKit](https://github.com/winverse2755/SettleKit) to add one thing SettleKit doesn't have: **proportional crisis response**. When SettleKit's risk workflow flags a distressed asset, TriageKit decides *how* to respond based on the user's pre-declared risk profile — rotating collateral instead of panic-exiting, and executing reliably even when the network is under stress.

---

### The Gap TriageKit Fills

SettleKit evaluates risk before settlement and blocks unsafe execution. But `BLOCKED` and `WARNING` only stop the action — they don't tell the agent what to do instead.

When a contagion event hits (a bridge drain, an LRT depeg, a liquidity shock), every agent faces the same binary: exit or do nothing. Mass exits become synchronized bank runs. TriageKit replaces that binary with a third path: **controlled rotation**.

---

### Agent Risk Profiles

Users set a profile once. TriageKit uses it every time the CRE workflow fires a `WARNING` or `BLOCKED`.

| Profile | Trigger | Action |
|---|---|---|
| `conservative` | Deviation > 3% | Full exit |
| `balanced` | Deviation 5–10% | Rotate 50% to safer asset via Uniswap, hold remainder |
| `balanced` | Deviation > 10% | Full exit |
| `backstop` | Deviation > 20% | Hold + log stabilization intent |

Set via Telegram: `/profile balanced`

Thresholds are encoded at setup and cannot be overridden mid-crisis. The agent follows the rule the user agreed to in advance.

---

### Collateral Rotation (Uniswap API)

The balanced profile's core action. Instead of withdrawing, the agent swaps the distressed asset into a safer correlated position.

```typescript
// Triggered: balanced profile + deviation between 5–10%
const quote = await uniswapApi.quote({
  tokenIn:           'rsETH',
  tokenOut:          'wstETH',
  amount:            partialExitAmount,
  slippageTolerance: 0.5
});

await uniswapApi.swap(quote, { signer: agentWallet });
```

Rotation output — amount swapped, route, execution status — is surfaced in the SettleKit Risk Explorer on every settlement.

---

### Reliable Execution (KeeperHub)

Direct transaction submission fails under the exact conditions TriageKit is designed for: gas spikes, mempool congestion, and network stress during a crisis event. All TriageKit actions — exits and rotations — are routed through KeeperHub's MCP.

```typescript
await keeperhubClient.execute({
  recipe,
  retryPolicy: 'exponential',
  gasMode:     'private',
  auditTrail:  true
});
```

KeeperHub provides exponential retry, private gas routing, MEV protection, and a full audit trail. The execution hash is stored in the Risk Explorer alongside the existing Tenderly link.

---

### Architecture

```
User / Agent
     │
     ▼
┌──────────────────────────┐
│   Agent Profile Config    │
│   /profile <type>         │
│   (Telegram or SDK)       │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│   SettleKit SDK           │
│   CRE Risk Workflow       │
│   Risk Report             │
│   { APPROVED |            │
│     WARNING | BLOCKED }   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│   TriageKit Response Engine               │
│                                          │
│   APPROVED + any profile  → execute      │
│   WARNING  + conservative → full exit    │
│   WARNING  + balanced     → rotate 50%   │
│                             + hold rest  │
│   WARNING  + backstop     → hold + log   │
│   BLOCKED  + any profile  → full exit    │
└────────┬─────────────┬────────────────── ┘
         │             │
         ▼             ▼
┌──────────────┐  ┌───────────────────────┐
│  Uniswap API │  │  Direct exit           │
│  Quote +     │  │  (conservative /       │
│  Swap        │  │   BLOCKED)             │
│  rsETH →     │  └──────────┬────────────┘
│  wstETH      │             │
└──────┬───────┘             │
       └──────────┬──────────┘
                  │
                  ▼
┌──────────────────────────────────────────┐
│   KeeperHub Execution Layer               │
│   Exponential retry · Private gas         │
│   MEV protection · Audit trail            │
└────────────┬─────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│   SettleKit Deterministic Executor        │
│   Bridge (CCTP) + Deposit (Uniswap v4)   │
└────────────┬─────────────────────────────┘
             │
             ▼
   Risk Explorer (KeeperHub hash
   + Tenderly tx link + rotation
   output per settlement)
```

---

### New Telegram Commands

| Command | Description |
|---|---|
| `/profile <type>` | Set agent profile: `conservative`, `balanced`, `backstop` |
| `/profile status` | Show current active profile and thresholds |

All existing SettleKit bot commands remain unchanged. See [SettleKit docs](https://github.com/winverse2755/SettleKit) for the full list.

---

### Environment Setup

TriageKit adds two variables to the existing SettleKit `.env`:

```env
KEEPERHUB_API_KEY=...
UNISWAP_API_KEY=...
```

---

### Project Structure

TriageKit adds a single package on top of the SettleKit monorepo:

```
packages/
└── triage/
    ├── profiles.ts          # AgentProfile type + threshold config
    ├── responseEngine.ts    # Profile-aware action dispatcher
    └── rotateCollateral.ts  # Uniswap API collateral rotation
skit-risk-guard/
└── evaluateRisk.ts          # Extended: profile-aware threshold evaluation
backend/
└── executor.ts              # Extended: KeeperHub-routed execution
FEEDBACK.md                  # Uniswap API builder feedback
```

---

### Roadmap

- Live cross-chain bridge invariant monitoring (replace simulated signals)
- Backstop incentive detection when protocols expose crisis yield hooks
- On-chain pre-commitment contracts encoding profile thresholds immutably

---

### License

MIT