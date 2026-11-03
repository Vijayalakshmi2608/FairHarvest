# QIE Integration Map

FairHarvest has one wallet-auth path for farmers and buyers. Public browsing, the Fair Price Index, and receipt rendering do not require a wallet; signing actions do.

| QIE component | Frontend file | Function / behavior |
|---|---|---|
| QIE Wallet | `frontend/lib/wallet.ts` | `useQieWallet()` discovers the EIP-1193 provider, requests accounts, checks chain 1990, and creates the viem wallet client. |
| QIE Wallet | `frontend/lib/contracts.ts` | `useContractActions()` uses the connected wallet for every listing, approval, escrow, confirmation, rating, and withdrawal signature. |
| QIE ID | `frontend/app/create-listing/page.tsx` | `verify()` gates listing creation and displays the verified state. |
| QIE ID | `frontend/lib/api.ts` | `verifyQieId()` calls the backend identity verification endpoint with the wallet address and signature. |
| QIE Stable Coin | `frontend/lib/contracts.ts` | `buy()` calls ERC-20 `approve` and then `OrderEscrow.createOrder`; totals are displayed as QSC. `withdraw()` calls `OrderEscrow.withdraw`. |
| OrderEscrow | `frontend/lib/contracts.ts` | `confirmDelivery()` calls `confirmDelivery(orderId, buyerRating)` and waits for the receipt. |
| ListingRegistry | `frontend/lib/contracts.ts` | `createListing()` calls `createListing` with crop, grade, quantity, harvest timestamp, region, base-unit price, and IPFS metadata. |
| QIEDex | `frontend/lib/integrations.ts` | `useQieDex().quoteQieAmount()` reads `quoteExactOutput` when a router is configured; `swapQieToStablecoin()` calls `swapExactQIEForTokens` with a capped native-QIE value and waits for the receipt. |
| IPFS | `frontend/lib/api.ts` | `uploadToIpfs()` posts the selected photo to `NEXT_PUBLIC_IPFS_UPLOAD_URL`; without it, the UI keeps a clearly marked pending URI rather than claiming upload success. |
| Auto-Restock Agent | `frontend/lib/integrations.ts` | `useAutoRestockAgent().saveRule()` signs the canonical rule with QIE Wallet, authenticates the merchant nonce, persists the rule at `POST /agent/rules`, updates stock at `PUT /agent/inventory`, and polls `GET /agent/actions`. |
| Auto-Restock Agent runner | `backend/src/agentRunner.ts` | `runActiveRestockRules()` reads active signed rules, scans the live `ListingRegistry`, ranks eligible farmers by indexed reputation, enforces quantity × price ≤ max spend, and submits only through the merchant or an explicitly scoped executor. It never uses the oracle key. |
| Auto-Restock API | `backend/src/server.ts` | Provides signed-rule persistence, inventory triggers, manual `POST /agent/run`, and the auditable action log. `AGENT_ENABLED=true` enables the mainnet scheduler; it is safe and non-submitting by default without a scoped executor. |
| Auto-Restock UI | `frontend/app/agent/page.tsx` | Mobile-first merchant controls for crop, stock threshold, quantity, max price, max spend, expiry, wallet signing, manual checks, and a live 10-second action log with explorer links. |

## Settlement guarantees

The sole settlement currency is QIE Stable Coin. QIEDex is optional and only swaps into stablecoin before escrow; it does not replace escrow settlement. The QIE checkout sequence is: native QIE quote → QIEDex swap → wait for swap receipt → exact stablecoin approval → `OrderEscrow.createOrder`. No frontend button implies a transaction succeeded until the viem receipt resolves.

## QIEDex configuration

The frontend adapter expects the deployed router to expose these native-QIE methods: `quoteExactOutput(uint256 amountOut, address tokenOut) returns (uint256 amountIn)` and payable `swapExactQIEForTokens(uint256 amountOutMin, address tokenOut, uint256 deadline)`. Set `NEXT_PUBLIC_QIEDEX_ROUTER_ADDRESS` and `NEXT_PUBLIC_STABLECOIN_ADDRESS` before enabling the live route. `NEXT_PUBLIC_QIEDEX_SLIPPAGE_BPS` defaults to 100 (1%). When the router is not configured, the UI shows a clearly labeled preview using `NEXT_PUBLIC_QIEDEX_QIE_PER_QUSDC` (default 1) and refuses to submit a fake swap.

## Agent safety

The Auto-Restock Agent is deliberately capped. A merchant sets a crop, stock threshold, quantity ceiling, maximum price per kg, maximum spend, and expiry. The frontend and `verifyRestockRule()` both reject a rule whose quantity ceiling times maximum price exceeds the spend cap. `runRestockOnce()` only submits when a signed rule, eligible listing, and explicit escrow submitter are present; otherwise it returns a non-submitting decision. Unlimited approvals and unlimited spending are not supported.

## Environment

Copy `frontend/.env.example` to `frontend/.env.local` and set the deployed contract addresses before live use. The public pages remain usable with demo data when the API and addresses are unavailable; this is intentional and clearly labeled in the action flows.
