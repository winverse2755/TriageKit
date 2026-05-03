# Uniswap Integration Feedback

## Context
- Feature: balanced-profile collateral rotation (`rsETH -> wstETH`) during `WARNING` settlements in the 5-10% deviation band.
- Integration points: quote from Uniswap API, execution routed through KeeperHub, surfaced in Risk Explorer.

## API Friction Notes
- **Quote endpoint variability**: Uniswap quote response fields differ across environments (some responses include `amountOut`, some nest it), so strict parsing breaks quickly.
- **Route schema inconsistency**: Route hops can be plain strings in some APIs and objects in others, which required a tolerant parser.
- **Execution payload mismatch**: Quote responses do not always include directly executable tx calldata for this backend flow, so KeeperHub execution currently uses a deterministic relay transaction while still preserving retry/private routing behavior.
- **Auth uncertainty**: API key requirements vary by deployment (`Authorization: Bearer` expected in some contexts); integration needs fallback behavior when credentials are absent.

## Recommended Improvements
- Lock to a specific Uniswap API version and schema contract before prize submission.
- Add a backend adapter test fixture with multiple realistic response variants.
- Add a dedicated `swap-calldata` endpoint contract (or spec) to avoid route-only quotes during execution.
