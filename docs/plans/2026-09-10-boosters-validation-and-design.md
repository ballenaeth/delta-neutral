# Boosters — validation against pons v2 and a design brainstorm

*Draft from a brainstorming session on 2026-09-10. Everything about pons and
Robinhood Chain below was read from docs.ponsfamily.com/v2, docs.robinhood.com
and the live chain that day. Re-verify addresses before deployment. Nothing
here is validated with Dani yet; see "Open decisions".*

## 0. Verdict in one paragraph

The idea holds, but the money is not where the pitch puts it. The bonding
curve phase of a token that graduates lasts seconds to a minute and collects
roughly 0.09 ETH of creator tax at a 2% tax, so a fuel tank filled only from
the curve is a toy. The same token's locked v4 pool did 74.6 ETH of volume in
the following day, which at 2% is about 1.5 ETH of creator tax per day. The
tank is a post-graduation product that happens to switch on during the curve.
The second correction: the binding limit on leverage is pool depth, not fuel.
Bots produce volume (fuel) without depth (holders), so the sampled pool had
~1 ETH of real ETH-side depth while earning fees fast. Capacity must be
`min(fuel, depth)`, and with physical leverage that is manipulation-resistant
by construction. Everything else in the pitch (tank as lender, liquidation
priced off reserves and sold back, no oracle, no external lender, creators
keep taxes on, graveyard jackpot) checks out against the docs, with the
mechanical caveats in §3.

## 1. What pons v2 actually is (facts that constrain the design)

**Chain.** Robinhood Chain, id 4663, ~0.10 s blocks (measured). Public RPC
`https://rpc.mainnet.chain.robinhood.com` rate-limits bursts (HTTP 429) and
caps `eth_getLogs` at 10,000 matches per query.

**Launch volume.** 11,561 launches in 14.0 h → **~825 launches/hour**, mostly
bots (repeated symbols, 26 buys from one wallet graduating a curve alone).
`launchEnabled()` returns `true` today although the docs say public launching
is closed; still gate any create flow on `canLaunch(address)`.

**Quote assets.** Not "every launch quotes a stock". Census of 11,561 launches
by `pairToken`: ETH 6,815 (59%), NVDA 1,598 (14%), USDG 1,022 (9%), SPCX 398,
AAPL 196, SPY 163, GOOGL 159, GME 147, DJT 118, then a long tail of ~45 other
stock tokens. Stock-quoted launches are real and plentiful; ETH is the majority.

**Curve economics.** Constant product with a phantom quote reserve.
`pairTokenEconomics(pair)` gives `phantomQuote`, `graduationThreshold`,
`decimals`; the threshold is always 2.5× the phantom:

| quote | phantom | threshold | ≈ USD at graduation |
|---|---|---|---|
| ETH | 1.68 | 4.2 | $10.3k (ETH $2,457) |
| NVDA | 16.64 | 41.6 | $9.1k (NVDA $218) |
| USDG | 3,236 | 8,090 | $8.1k |
| SPY | 4.36 | 10.9 | · |
| AAPL, GOOGL | 9.68 | 24.2 | · |
| GME | 147.6 | 369 | · |

Supply 1e9, of which 714.3M sellable and 285.7M reserved for the pool
(`supply × phantom / (phantom + threshold)`). Graduation is automatic inside
the buy that empties `sellableTokens()`; sells are refused from the moment
`readyToGraduate()` is true. Pool: Uniswap v4, fee 0, tickSpacing 200, meme
hook, one full-range position locked forever in the Launch Locker.

**Fees.** `feeBps = 100` on every launch seen. `creatorTaxBps` is chosen at
launch, immutable, capped by `maxCreatorTaxBps() = 1000`. Distribution of the
313 sampled launches: 0% (40%), 1% (21%), 2% (17%), 3% (4%), 5% (4%),
10% (2%), rest scattered. Fee policy read for a live token:
`protocolFeeShareBps 3000, buybackBurnBps 5000, hookFeeBps 100,
maxInternalPriceImpactBps 300`. So the creator receives **70% of the 1% fee
(and of the snipe tax, which "joins the launch's trading fee") plus 100% of
the creator tax**, on the curve and, after graduation, on every pool swap.
Post-graduation the hook charges on the *unspecified* currency, so roughly
half the creator's income arrives as the meme token itself.

**How fees reach a recipient.** Never pushed. They accrue on the curve, then
on the hook, until a sweep (`sweepFees` / `sweepPoolFees`, operator-run when
an internal conversion is needed) credits the Fee Escrow. The recipient pulls
with `claim()` (native) or `claimToken(asset)`. Escrow is pull-based precisely
so that a contract recipient can never block anyone; **a contract can be the
creatorFeeRecipient**. The current recipient can re-point future fees at any
time with `transferCreatorFeeRecipient(token, newRecipient)` (verified to
exist on the factory; reverts with a custom error for a non-recipient).

**Graduation and life afterwards.** Sample of 313 launches: 8 graduated
(2.6%), 286 dead (<1% of threshold), 19 partial. Two graduated ETH curves:
23 buys / 8 wallets / 4.39 ETH in, and 26 buys / 1 wallet / 4.24 ETH in, both
finished within a minute. Two graduated USDG curves showed gross curve volume
of $62.6k and $28.1k against an $8.1k threshold (3.5–7.7× churn). Post
graduation the meme hook logged ~1,300 events per 40 s across 130 pools
(~117k/h) and the PoolManager ~2,000 swaps per 40 s across 356 pools. The
sampled graduated ETH token (2% tax): 919 swaps and 74.6 ETH of ETH-side
volume in ~25 h, yet StateView shows ~0.98 ETH of ETH-side depth (liquidity
2.93e22 at tick 206209): sold down to a ~1.1 ETH market cap while bots churn.

**Oracles.** pons has none and needs none; the curve is the price. Robinhood
Chain has Chainlink feeds for every Stock Token and for ETH/USD
(AggregatorV3, 8 decimals, heartbeat 86,400 s, 0.5% deviation; stock feeds
update 24/5). Verified live: NVDA/USD `0x379EC4f7…9F15` answered $218.34 and
was 6.4 h stale after the close; ETH/USD `0x78F3556b…3A9` $2,457.32. Stock
Tokens are plain 18-decimal ERC-20s with no transfer allowlist (corporate
actions via an ERC-8056 `uiMultiplier`, already folded into the Chainlink
price). Not offered to US persons: a legal constraint, not a technical one.

**Uniswap v4 on 4663 (developers.uniswap.org):** PoolManager
`0x8366a39cc670b4001a1121b8f6a443a643e40951`, StateView
`0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` (verified reading the sample
pool), V4Quoter `0x8dc178efb8111bb0973dd9d722ebeff267c98f94`, Universal Router
`0x8876789976decbfcbbbe364623c63652db8c0904`, Permit2 canonical.
`poolId = keccak256(abi.encode(currency0, currency1, 0, 200, memeHook))`,
currencies sorted, native ETH = address(0).

## 2. Is it economically reasonable? Numbers.

Using the sampled 2%-tax ETH token and today's prices:

| source of fuel | per token | notes |
|---|---|---|
| Curve, tax 2%, no churn | 0.088 ETH (~$215) | measured: 0.0877 ETH tax on 4.39 ETH of buys |
| Curve, tax 2%, 5× churn | ~0.4 ETH | churn seen on USDG curves |
| Curve, tax 10%, 5× churn | ~2 ETH | max tax; rare (2% of creators) |
| Creator's 70% of fee + snipe on the curve | ~0.07 ETH | snipe ≈ 1.2% of volume on the sampled curve |
| **Pool, tax 2%, one day** | **~1.5 ETH/day** | 74.6 ETH volume × 2%; half arrives as meme token |
| Pool, creator's 70% of 1% hook fee | ~0.5 ETH/day | |

So a middling graduated token at 2% feeds its tank ~2 ETH/day, ~1 ETH of it
in quote. A week of that is a real lender. The curve phase alone never is.

**Depth is the real cap.** Physical leverage means the vault actually buys.
On the constant-product curve a buy of Δq against quote reserve q moves price
by `((q+Δq)/q)² − 1`: a 0.3 ETH buy on a fresh 1.68 ETH curve is +39%. On the
sampled pool (0.98 ETH depth) a 0.1 ETH buy is +22%. So per-position notional
must be bounded by impact (e.g. ≤ 5% ⇒ notional ≈ 2.5% of quote-side depth),
and total open interest per token by a multiple of depth. Fuel that exceeds
what depth can absorb simply sits in the tank earning nothing, which is fine.

**Where leverage actually exists.** Tokens with real depth (≥ 20 ETH quote
side ⇒ ~0.5 ETH per position at 5% impact, several ETH of open interest).
That is a small set of planets at any moment, and exactly the set the pitch
says it should be. The curve phase gets a symbolic 2× only, because impact
dominates.

**Meme-token-side fuel is not lending capital.** Half of post-graduation
creator income is the token itself. Lending it against long positions in the
same token is reflexive. Route it to the graveyard jackpot or sell it slowly
through the pool (bounded by the same impact rule). Only quote-side fuel lends.

**Token quoted in a stock.** The tank for an NVDA-quoted token holds NVDA
tokens and lends NVDA. Positions, debts, PnL are all in NVDA. That is the
"third layer of volatility" from the pitch, and it is honest: the rocket's
altitude is price in NVDA, the horizon is NVDA/USD from Chainlink.

## 3. Mechanical caveats the design must absorb

1. **Mark must be realizable value, not spot.** Health = quoteSell(collateral
   tokens) / debt. Spot off `getReserves()` after your own buy shows a fake
   gain equal to your own impact. This also makes the system
   manipulation-resistant: the attacker who pumps to inflate a mark pays the
   impact and the exit slippage.
2. **The graduation boundary.** Sells are refused once `readyToGraduate()`;
   the vault must liquidate/close via the PoolManager afterwards
   (`unlock` callback, swap currency1→currency0). Normally the pool exists in
   the same transaction as the last buy; the "Swept" phase can persist and the
   7-day rescue path exists. Positions carry a `venue` state: curve → pool.
3. **Fees compound at open.** Buy pays 1% + tax, sell pays 1% + tax, plus
   impact both ways. At 5× with a 2% tax the position opens ~15–20% of margin
   under water on a realizable mark. Show it. 2×/3× only on the curve.
4. **Snipe tax is only reachable as the creator's 70% share.** No way to take
   the protocol's 30%, and none is needed.
5. **Fuel needs the creator to point at the tank.** Either at launch
   (`creatorFeeRecipient = tank`, via our create flow while `canLaunch`) or
   later (`transferCreatorFeeRecipient`, instant, by the current recipient).
   Existing tokens opt in; nothing can be forced. The tank must also call the
   escrow `claim()` / `claimToken()`: permissionless `refuel(token)`.
6. **The fee escrow holds separate balances per asset.** A stock-quoted
   token's tank claims the stock token with `claimToken(pair)` and the meme
   token with `claimToken(token)`.
7. **Chainlink stock feeds are stale nights and weekends.** Fine for the
   horizon (cosmetic), never used in a settlement path.
8. **RPC.** 825 launches/hour cannot all be rockets. The scene selects.

## 4. Three ways to build the lever

**A. Physical leverage vault (recommended first).** The tank lends quote; the
vault buys real tokens on the curve or pool and custodies them; mark is the
realizable sell output; liquidation is an actual sell back into the same
venue. Capacity = min(fuel, depth). Manipulation-resistant, no oracle, no
TWAP, works on the curve and the pool with the same accounting. Downside:
capacity on thin tokens is small and impact is visible. This is what the
pitch describes.

**B. Synthetic booster (CFD).** No buying: a bet paid from the tank with
payoff `lev × return`, marked to a price. Far more capacity, no impact, but
on a 1 ETH-deep pool a 0.3 ETH nudge moves the mark 30% and drains the tank;
it needs a TWAP, and v4 pools have no built-in oracle and the pons hook is
not ours, so we would run a permissionless observation recorder. Wrong first
product for thin markets.

**C. Hybrid.** A on the curve and on shallow planets; B only on planets whose
depth exceeds a floor, marked to our recorder's TWAP, with open interest
capped by tank balance. This is the "perps against the locked v4 pool's
TWAP" from the pitch, and it belongs in a second phase once A has tanks with
balances and the recorder has history.

## 5. Architecture (for A, with C in mind)

### Contracts (Foundry; Robinhood Chain)

```
TankFactory      creates one FuelTank clone per pons token (EIP-1167).
FuelTank         the creatorFeeRecipient. refuel(): claims escrow balances.
                 Quote-side fuel is lendable. Meme-token fuel → Graveyard.
                 Earns: borrow fee (bps/day, accrued on close) + liquidation
                 spread. Never leaves the token: fuel is per-token by design.
Booster          positions. open(token, margin, lev, minOut): pulls margin,
                 borrows (lev−1)·margin from the token's tank, buys on the
                 venue, records {tokens, debt, venue, openedAt}.
                 close(): sell, repay debt+fee, return remainder.
                 liquidate(): permissionless when realizable < debt·(1+mm);
                 sells, repays, pays keeper from the spread, rest to tank.
                 Venue adapter: curve (buy/sell) | v4 pool (unlock → swap).
                 Caps: per-position impact ≤ maxImpactBps; per-token open
                 interest ≤ k·quoteDepth; both read from the venue live.
Graveyard        dead-token registry (rule: curve <1% after N days, or pool
                 quote-side depth below a floor for M days, permissionless
                 mark). burnForTickets(token, amount): burns bag, tickets ∝
                 amount × a per-token weight. Jackpot = meme-token fuel sold
                 down + quote fuel of dead tanks. Draw: see open decisions.
```

Invariants: a tank lends only the quote asset of its own token; Booster
never holds fuel; every mark is a realizable venue quote computed on chain;
liquidation and close are the same code path with a different recipient.

### Client (the 3D layer)

Three.js scene, RPC-direct as the old `js/pons.js` was (factory logs,
curve reads, StateView, Chainlink), no backend in the trust path.

- **Launch zone.** Rockets = launches with a tank *or* `realQuoteReserve`
  above a floor (the 825/h spam stays off-screen). Altitude = price in the
  quote asset, log scale; the horizon is the quote's USD line (Chainlink;
  frozen and dimmed when stale: "market closed").
- **Thruster.** The leverage dial. The realizable-mark PnL, the impact of
  your own entry and the liquidation altitude are drawn on the rocket before
  you sign.
- **Fuel tank.** The tank's quote balance, filling from `CurveBuy/CurveSell`
  tax fields and hook accruals as trades land; lendable vs. depth-capped
  portions shown as two fills.
- **Explosion.** `Liquidated` event; debris falls into the graveyard.
- **Planets.** Graduated tokens orbit; radius from pool depth, glow from
  24 h volume; boostable the same way.
- **Graveyard.** Dead tokens as wreckage; burn bags for tickets; the jackpot
  as a slow-turning core.

### Data flow

TokenLaunched → curve reads (6 s poll, batched) → position health locally
computed with the same formulas the contract uses → Chainlink for horizon →
StateView for planets → our contracts' events for tanks, positions, deaths.

## 6. Open decisions (for Dani)

1. **Physical (A) first, hybrid (C) later — agree?** The alternative is to
   go straight to synthetic and accept the oracle problem.
2. **Leverage menu.** Curve: 2× only? Planets: 2×/3×/5× gated by depth?
3. **Graveyard draw randomness.** Options: (a) hash of the next pons
   `CurveCompleted` tx on the chain (cheap, sequencer-trusting), (b) commit-
   reveal by ticket holders, (c) no draw at all: pro-rata payout of the dead
   tank to burners, which keeps the "no randomness" rule of the earlier
   TIDEWRIGHT design.
4. **Launch flow.** Do we launch tokens through our own flow so the tank is
   the recipient from block one, or only offer the `transferCreatorFeeRecipient`
   opt-in? The former needs `canLaunch(ourRouter)`.
5. **Who runs keepers.** Liquidations are permissionless with a bounty; do we
   also run one?
