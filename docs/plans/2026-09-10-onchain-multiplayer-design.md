# TIDEWRIGHT onchain — Stock Token beaches, communal play, pots

*Validated in a brainstorming session on 2026-09-10. Supersedes the deleted
DESIGN.md (commit 562c1e8) and the first draft of this file. Facts about
Robinhood Chain below were verified against the live chain and official docs
on 2026-09-10; addresses should be re-checked before deployment.*

## Decisions

| Question | Decision |
|---|---|
| The tide | Robinhood **Stock Tokens** only (NVDA, MSTR, QQQ, ...). pons curves are no longer a tide source. |
| Multiplayer | Communal, chain-backed. Each player simulates their own sand; flags, ghosts, trades and pots come from the chain. No game server. |
| Our contracts at release | Beach Registry plus three pot contracts: Tide Pools, Last Grain, The Bell. |
| Bet asset | The beach's own Stock Token. |
| Closed market | Tide never sleeps: Chainlink feed in market hours, Uniswap v3 TWAP nights and weekends. |
| Randomness | None. All pots are oracle-free or settle on the two price sources. |
| Token family | Layered, launched later on pons: **Sand** is the material, **Castle** is the house. |
| pons relationship | We can launch on pons (allowlisted) but are not affiliated and cannot change how pons works. Nothing here needs pons to change. |
| Read infrastructure | Public RPC first, optional non-authoritative cache as fallback. |
| Competition | Cosmetic Remembrance leaderboards. Season rewards key only on chain-verifiable acts. |

The rule that never breaks: **money never follows a forgeable number.**
Remembrance is computed client-side and stays social. No pot reads it.

Robinhood's chain terms (§5.7(j)) require the term "Stock Tokens" in external
content. Use it everywhere, never "tokenized stocks".

## Why not shared sand

`spike/FINDINGS.md`: a shared heightfield needs one authoritative simulator
streaming deltas (~25 kbit/s per client). Lockstep is empirically impossible
because GPU floating point diverges across vendors within seconds. An
authoritative host is infrastructure the game cannot work without. Communal
beaches give "we are all here" without it; live rooms can be added later.

## 1. What the beach is

The beach is a Stock Token. Any of the 194 listed by Robinhood's registry
(`GET https://api.robinhood.com/rhj/assets`), 18-decimal ERC-20 beacon proxies
on chain 4663, issued by Robinhood Assets (Jersey) Ltd as tokenised debt
securities. Standard transfers, no allowlist, but **pausable and
admin-burnable** by the issuer. Not for US persons (Reg S) and restricted in
several other countries.

- **Your bag is your pail.** Holding the beach's Stock Token fills the pail,
  capped so whales do not trivialise it. Later, Sand adds to the pail on every
  beach.
- **Pots are in the beach's Stock Token.** Bet NVDA on the NVDA beach. Rake is
  taken in Stock Tokens and swapped to Sand by the treasury.
- **The frontend geofences** to Robinhood's restricted-country list. Bettors
  already hold Stock Tokens, but the game should not be the weak link.
- **Pots are short-lived** (minutes to hours) to bound exposure to an issuer
  pause.

Reference addresses (verify before use): NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`,
MSTR `0xec262a75e413fAfD0dF80480274532C79D42da09`,
QQQ `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68`,
USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 dec).

## 2. Tide model and price sources

Stocks move far less than memecoins, so the sea is measured in volatility
units, not percent.

**Sigma tide.** Each beach carries a rolling realised volatility from the last
20 trading sessions of Chainlink prints. Drawdown from the rolling peak is
divided by it: one sigma is wet feet, two is high water, three is the rug.
Same rulebook for NVDA and QQQ, each at its own tempo.

**Two sources, two jobs.**

| Source | Role | Facts |
|---|---|---|
| Chainlink "Robinhood X / USD" feeds | Canonical print. Drives the tide in market hours; settles pots whose window closes while `updatedAt` is fresh. | 8 dec, 0.5% deviation / 24 h heartbeat, 24/5, **frozen when markets are closed** (weekend gaps ~70 h). Prices the token (multiplier baked in). NVDA `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, MSTR `0x396118bdFB181e6240E74D243F266B061c0edc3D`, QQQ `0x80901d846d5D7B030F26B480776EE3b29374C2ae`. |
| Uniswap v3 TWAP vs USDG | 24/7 signal. Drives the tide nights and weekends; settles pots whose window closes while the feed is stale. 30 min TWAP from the deepest USDG pool per beach. | NVDA/USDG 0.05% `0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3` (~$2.7M USDG), MSTR/USDG 1% `0x17578c0e0d15da44f31677263114f71ae76653ea` (~$363k), QQQ/USDG 0.05% `0xd60a5d14db690b7afad71f76b108071d7175597d` (~$268k). Factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`. |

Pool depth is read onchain and **caps pot size**, so a thin pool at night
allows a small pot and a deep one a large pot. Corporate actions are baked
into both sources via the token multiplier, so splits do not fake a rug.

**Regimes rendered.** Market hours are day. Stale feed is night: pool-driven
tide under moon and stars, which the game already renders.

**Peak tracking.** Anyone may call `checkpoint(beach)` to pin a new rolling
peak; the caller earns a sliver of the next pot's rake. The client tracks the
peak locally for visuals so the beach never waits on a keeper.

**Trades on the sand** come from Uniswap `Swap` events on the beach's pools,
attributed per wallet. Your sell is your wave; a buy in high water pats your
castle.

## 3. Beach Registry and the communal client

Tiny by design: auditable in an afternoon, never upgraded.

```solidity
struct Slot { uint16 x; uint16 z; uint8 style; uint8 flags; uint40 at; bytes32 castle; }
mapping(address token => mapping(address wallet => Slot)) slots;

function plant(address token, uint16 x, uint16 z, uint8 style) external;   // requires balanceOf > 0
function record(address token, bytes32 castleHash, bytes calldata snapshot) external;
function strike(address token) external;

event Planted(address indexed token, address indexed wallet, uint16 x, uint16 z, uint8 style);
event Recorded(address indexed token, address indexed wallet, bytes32 castleHash, bytes snapshot);
event Struck(address indexed token, address indexed wallet);
```

- One slot per wallet per beach. Everything else is enforced by the client.
- **Washing away.** The client checks each owner's balance; zero means the flag
  falls on the next tide. No extra transaction.
- **Snapshots.** ~64×64 heightfield at 8 bits plus moisture and compaction
  bands, 2–3 KB compressed, in event data only. Rendered as ghost outlines at
  the owner's flag in their chosen look. Cosmetic; never feeds the local sim.
  Rate-limit `record` per slot if spammed; move blobs to IPFS if size bites.
- **Read path.** Bounded `eth_getLogs` with backoff; cache digest as fallback,
  flag owners re-verified with `balanceOf` before drawing. Cache down means a
  slower load, never a broken beach.

## 4. The pots

Three contracts. All settle in the beach's Stock Token. None reads
Remembrance. None uses randomness.

**Tide Pools.** Parimutuel on how deep the sea gets over a window (15 min by
day, 60 min at night). Buckets in sigma: slack, wet feet, high water, rug.
At close the contract reads the price source, computes the window's maximum
drawdown from the pinned peak, and the winning bucket splits the pot minus
rake. Deep buckets pay big. Pot capped by pool depth.

**Last Grain.** One pot per beach, always running. Buying a grain resets a
countdown and raises the next grain's price by a fixed percentage. At zero the
last buyer takes the pot minus rake; a new round opens seeded from rake. The
countdown shortens as the round ages. Rendered as the tide clock, the pot a
sand tower at the flood line. Carries the pause risk, so its pot is capped.

**The Bell.** Parimutuel on the closing print in sigma buckets relative to the
open. Opens at market open, locks 30 min before close, settles on the last
fresh Chainlink print of the session. One scheduled event per beach per day.

**Shared rules.**

- Rake fixed at deploy; split treasury / checkpoint caller.
- Nothing settles on a stale source. If both are unusable at close, the window
  voids and stakes are refundable.
- Void and refund path on issuer pause.
- Every pot emits events the beach renders live: stakes as figures at their
  flag, wins as fireworks over the winner's castle.

## 5. Sand and Castle — the layered economy

Both are pons v2 launches, later. 100% of supply mints to the curve; the
reward budget is rake plus creator tax.

**Sand is the material.** Holding Sand adds to the pail on every beach, on top
of the beach's own token: the one bag that works everywhere. The treasury
swaps Stock Token rake into Sand on Uniswap (a graduated pons launch sits in a
locked v4 pool).

**Castle is the house.** Launched only after the vault is audited.

- Stake Castle; unstaking has a 48 h cooldown; early exit forfeits accrued
  rewards to remaining stakers.
- Each epoch (~weekly) the treasury's Sand splits: half streamed to stakers
  pro rata by stake-time, half burned.
- In game on every beach: staked Castle means packed sand, a doubled bag cap,
  a banner on the flag.

**Treasury.** Rake in, Sand out. Fixed shares: stakers, burn, operations. The
earlier Seawall idea is dropped: we do not own the tide's asset.

**Seasons.** Epoch ranges. Points from chain-verifiable acts only: pot
participation, hold streaks from `Transfer` logs, staking duration, presence at
The Bell (a registry `record` in the block window). Rewards in Sand.
Remembrance leaderboards run alongside and pay nothing.

**Launch parameters (irreversible, creator-side on pons).** Creator tax at the
cap pons allows; fee recipient the multisig, migrated to the treasury with
`transferCreatorFeeRecipient`; pons buybacks on.

## 6. Client refactor

Split by trust boundary. Still classic script tags, zero dependencies.

| Module | Role |
|---|---|
| `js/chain.js` (new, extracted from pons.js) | JSON-RPC with proxy fallback, ABI encode/decode, bounded `getLogs`, wallet connect and chain switch. The only file that talks to a node. |
| `js/stocks.js` (new) | Stock Token list, Chainlink feed reads, Uniswap v3 pool discovery, TWAP, `Swap` log attribution, pool depth. |
| `js/tide.js` (new) | Price history → sigma tide. Realised vol, rolling peak, regime (day/night). Pure functions, no GL. |
| `js/pots.js` (new) | Tide Pools, Last Grain, The Bell: reads, stakes, claims, event feed. |
| `js/registry.js` (new) | plant/record/strike, flags, snapshots, ghosts, cache fallback. |
| `js/beach.js` (new) | Per-beach persistence and offline erosion replay on `sim.upload/download`; snapshot codec. |
| `js/pons.js` | Shrinks to Sand/Castle launch reads and trading; curve tide removed. |
| `js/game.js` | Shrinks to modes, HUD, input. Beach mode is a thin binding. |
| `js/content.js` | Season definitions in Phase 1. |

### Failure handling

- Every chain read has a stale-tolerant default: a failed poll holds the last
  tide rather than dropping the sea.
- Feed stale → pool TWAP; pool unreadable → feed; both → hold, and pots void.
- Log range errors narrow and retry. Cache unreachable → RPC only.
- Wallet rejection cancels cleanly with a toast. Oversized snapshots refused
  before signing. Ghosts with zero-balance owners wash out on the next tide.

### Testing

- Node's built-in test runner, no dependencies: ABI codec, sigma tide against
  recorded feed histories, TWAP math, snapshot codec round trips, log parsing
  against fixtures.
- Foundry for registry and pots with forked Robinhood Chain state; later the
  vault and treasury.
- Spike-style harness for offline erosion replay.

## 7. Phases

- **Phase 0 — release.** Stock Token beaches for every listed token. Registry,
  flags, ghosts, per-wallet swap attribution. Sigma tide with both sources.
  Tide Pools, Last Grain, The Bell in Stock Tokens, rake to a multisig.
  Geofenced frontend. No pons involvement.
- **Phase 1 — Sand.** pons launch. Sand pail bonus live. Seasons in Sand.
- **Phase 2 — Castle.** Vault, treasury swap and burn, rake routing to stakers.

## 8. Risks, plainly

- **Regulatory.** Parimutuel pots in securities-linked tokens is gambling on
  securities. Heavier than anything in the previous design. Geofence and get
  counsel **before Phase 0**, not Phase 2. (Not legal advice.)
- **Issuer pause / admin burn** can freeze a pot. Short windows, capped Last
  Grain, refund path.
- **Oracle manipulation** of thin pools at night. Pot caps scale with depth,
  30 min TWAP, void on divergence between sources.
- **Feed staleness** over long weekends (~70 h observed). Handled by regimes,
  but the `updatedAt` gate must be strict.
- **Sybil / wash** on seasons. Net position accounting, never gross.
- **Term of art.** Say "Stock Tokens", per Robinhood's terms.

## 9. Build order

| # | Item | Phase | Effort |
|---|---|---|---|
| 1 | Extract `chain.js`; `stocks.js` feed + pool reads | 0 | S |
| 2 | `tide.js` sigma tide, regimes; replace curve tide in game | 0 | M |
| 3 | `Swap` attribution: your-sell-is-your-wave, buy-in-flood pat | 0 | S |
| 4 | Beach Registry + Foundry tests + deploy; `registry.js` | 0 | M |
| 5 | `beach.js` persistence + offline erosion replay | 0 | M |
| 6 | Pot contracts (Tide Pools, Last Grain, The Bell) + forked tests + audit | 0 | L |
| 7 | `pots.js` + HUD: tide clock, pot tower, stake figures | 0 | M |
| 8 | Geofence + counsel sign-off | 0 | — |
| 9 | Read cache (optional service) | 0 | M |
| 10 | Sand launch; pail bonus; seasons v1 | 1 | M |
| 11 | Castle Vault + treasury swap/burn + rake routing | 2 | L |
