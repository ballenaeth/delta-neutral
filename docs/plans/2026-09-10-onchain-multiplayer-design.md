# TIDEWRIGHT onchain — pons beaches, communal play, pots

*Validated in a brainstorming session on 2026-09-10. Supersedes the deleted
DESIGN.md (commit 562c1e8) and two earlier drafts of this file. Facts about
pons and Robinhood Chain were checked against docs.ponsfamily.com (v1 and v2)
and the live chain on 2026-09-10; re-verify addresses before deployment.*

## Decisions

| Question | Decision |
|---|---|
| The tide | **pons tokens.** A v2 launch reads its bonding curve until graduation, then its permanently locked Uniswap v4 pool. A v1 launch reads its Uniswap v3 pool. |
| Multiplayer | Communal, chain-backed. Each player simulates their own sand; flags, ghosts, trades and pots come from the chain. No game server. |
| Our contracts at release | Beach Registry plus three pots: Tide Pools, Last Grain, Graduation Sweep. |
| Bet asset | ETH, the curve's quote asset, on every beach. Rake in ETH. (Assumption; see §4.) |
| Randomness | None. All pots settle on curve or pool reads, or on their own state. |
| Token family | Layered, launched later on pons v2: **Sand** is the material, **Castle** is the house. |
| pons relationship | We can launch on pons (allowlisted via `canLaunch`) but are **not affiliated** and cannot change how pons works. Nothing here needs pons to change. |
| Read infrastructure | Public RPC first, optional non-authoritative cache as fallback. |
| Competition | Cosmetic Remembrance leaderboards. Season rewards key only on chain-verifiable acts. |

The rule that never breaks: **money never follows a forgeable number.**
Remembrance is computed client-side and stays social. No pot reads it.

## Why not shared sand

`spike/FINDINGS.md`: a shared heightfield needs one authoritative simulator
streaming deltas (~25 kbit/s per client). Lockstep is empirically impossible
because GPU floating point diverges across vendors within seconds. An
authoritative host is infrastructure the game cannot work without. Communal
beaches give "we are all here" without it; live rooms can be added later.

## 1. What the beach is

Every pons launch is a beach. Contract addresses are canonical (names and
symbols are not unique).

**v2 beaches** (factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`), discovered
from `TokenLaunched` logs as `js/pons.js` already does:

- **Pre-graduation:** price from the curve. `getReserves()` (includes phantom
  quote; never `realQuoteReserve()` for pricing), progress from
  `realQuoteReserve() / graduationThreshold()`. Trades from `CurveBuy(buyer,
  recipient, quoteIn, tokensOut, fee, tax)` and `CurveSell(seller, recipient,
  tokensIn, quoteOut, fee, tax)`. Snipe tax is folded into `fee` on buys.
- **Graduation:** `sellableTokens()` hits zero → `CurveCompleted(token,
  totalQuoteCollected, reservedTokens)` on the curve, `LaunchSwept(token)` then
  `PoolGraduated(token)` on the factory, `PoolRegistered(poolId)` on the meme
  hook. Liquidity is one full-range position held forever by the Launch Locker
  `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952`.
- **Post-graduation:** price from the v4 pool. `poolId = keccak256(abi.encode(
  currency0, currency1, 0, tickSpacing, memeHook))`, currencies sorted, native
  ETH is `address(0)` and therefore `currency0`; `tickSpacing` and `hooks`
  from the launch record. Read `getSlot0(poolId)` and `getLiquidity(poolId)`
  on StateView, swaps from the PoolManager `Swap` event filtered by `poolId`.
  Hook events `PoolFeesSwept`, `PoolConversionSkipped`, `PoolBuybackSkipped`
  render as the club sweeping and buying.
- Resolve a token's hook and escrow **from the factory that launched it**;
  older launches settle through older stacks.

**v1 beaches** (factory `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`, 2191 in
the feed today): fixed 1 B supply, Uniswap v3 pool against WETH at 1 % fee,
`getLaunchedToken(token)` gives pool side and fee, `graduationStatus(token)`
gives paired principal against a 4.2 ETH default threshold. No migration at
graduation. Price from `slot0()`, swaps from the pool's `Swap` event. Verified
today: pool `0x47f544…` answers `slot0`, `fee = 10000`, token0 = WETH.

**Your bag is your pail.** Holding the beach's token fills the pail, capped
near 1 % of supply as today. Later, Sand adds to the pail on every beach.

Reference addresses (verify before use): WETH
`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`; meme hook
`0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`; fee escrow
`0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`; buyback vault
`0x42df2a798f82289E177311362e8f5ccC45c1219c`; Uniswap v3 factory
`0x1f7d7550b1b028f7571e69a784071f0205fd2efa`; Uniswap v4 PoolManager
`0x8366a39cc670b4001a1121b8f6a443a643e40951` and StateView
`0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` (from Uniswap's deployment list,
not pons docs).

## 2. Tide model

**Drawdown from a rolling peak** stays the tide, but measured in volatility
units once a beach has history. A fresh curve has none, so the first 24 h use
the fixed rule (30 % drawdown = full flood, tunable per beach). After that the
beach carries a rolling realised volatility and the sea is in sigma: one is
wet feet, two is high water, three is the rug. A graduated pool is calmer than
a young curve, and the same rulebook covers both.

**Multi-timescale.** Base sea level from a 24 h drawdown, wave amplitude from
the 20 min window, weather from trade rate. Replaces the single spiky 20 min
window.

**Graduation is not the end.** Today graduation ends the game ("slack water
for good"). Instead the tide switches source to the v4 pool: slack water
during the switch, then calmer seas with the locked-liquidity narrative.
Hook buyback events render as a green wave the club paid for.

**Peak tracking.** Anyone may call `checkpoint(beach)` on the pot contract to
pin the rolling peak; the caller earns a sliver of the next rake. The client
tracks the peak locally for visuals so the beach never waits on a keeper.

**Attribution.** Curve and pool events carry wallets, so a sell has an owner.
Your sell is your wave, aimed at your own flag and castle. A buy in high water
pats your castle. The old reserve-delta inference goes.

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
  Rate-limit `record` per slot if spammed; IPFS if size bites.
- **Read path.** Bounded `eth_getLogs` with backoff; cache digest as fallback,
  flag owners re-verified with `balanceOf` before drawing. Cache down means a
  slower load, never a broken beach.

## 4. The pots

Three contracts. All settle in ETH. None reads Remembrance. None uses
randomness.

**Why ETH.** The curve's quote asset is native ETH, so pots match the chart's
own denomination, need no approvals, and rake converts to Sand with one swap.
The alternative, pots in the beach's own token, adds buy pressure per
community but means holding 2 000 different ERC-20s in pots and approvals on
every stake. Revisit if the community pull matters more than simplicity.

**Tide Pools.** Parimutuel on how deep the sea gets over a window (15 min by
default). Buckets in sigma: slack, wet feet, high water, rug. At close the
contract reads the beach's price source itself (curve reserves, or v4 / v3
`slot0`), computes the window's maximum drawdown from the pinned peak, and the
winning bucket splits the pot minus rake. Deep buckets pay big. Pot capped by
liquidity: `getLiquidity(poolId)` for pools, `realQuoteReserve()` for curves.

**Last Grain.** One pot per beach, always running. Buying a grain resets a
countdown and raises the next grain's price by a fixed percentage. At zero the
last buyer takes the pot minus rake; a new round opens seeded from rake. The
countdown shortens as the round ages. Rendered as the tide clock, the pot a
sand tower at the flood line.

**Graduation Sweep.** Parimutuel on which time bucket a v2 curve graduates
in. Opens once progress passes a threshold (say 60 %), settles when anyone
calls `settle` and the contract reads `graduated()` true; the settling call
records the bucket, and the rake sliver rewards whoever calls first. Bettors
on the live bucket have every reason to be quick. Being present at a
graduation becomes a thing people do.

**Shared rules.**

- Rake fixed at deploy; split treasury / checkpoint or settle caller.
- Nothing settles on an unreadable source; the window voids and stakes are
  refundable.
- Every pot emits events the beach renders live: stakes as figures at their
  flag, wins as fireworks over the winner's castle.

## 5. Sand and Castle — the layered economy

Both are pons v2 launches, later. 100 % of supply mints to the curve, so the
reward budget is rake plus creator tax.

**Sand is the material.** Its beach is a pons beach like any other. Holding
Sand adds to the pail on every beach, on top of the beach's own token: the
one bag that works everywhere. The treasury buys Sand with ETH rake and
creator tax, on the curve before graduation and in the locked v4 pool after.

**Castle is the house.** Launched only after the vault is audited.

- Stake Castle; unstaking has a 48 h cooldown; early exit forfeits accrued
  rewards to remaining stakers.
- Each epoch (~weekly) the treasury's Sand splits: half streamed to stakers
  pro rata by stake-time, half burned.
- In game on every beach: staked Castle means packed sand, a doubled bag cap,
  a banner on the flag.

**Treasury.** ETH in, Sand out. Fixed shares: stakers, burn, the Seawall,
operations. **The Seawall** holds ETH that may only buy Sand when Sand's own
onchain drawdown exceeds the flood line; its reserve renders as a berm at the
flood line on the Sand beach, a bid everyone can verify before the flood.

**Seasons.** Epoch ranges. Points from chain-verifiable acts only: pot
participation, net position through floods, hold streaks from `Transfer`
logs, staking duration, presence at a graduation (a registry `record` in the
block window). Rewards in Sand. Remembrance leaderboards run alongside and pay
nothing.

**Launch parameters (irreversible, creator-side).** Creator tax at
`maxCreatorTaxBps()` read from the factory; fee recipient the multisig,
migrated to the treasury with `transferCreatorFeeRecipient(token, new)`;
`buybackEnabled` on (creator's share, vault-locked, 5-year linear release,
`releasable(token)` / `release(token)`). Creator revenue claimed from the fee
escrow with `claim()` / `claimToken(token)`. Read `canLaunch(address)` first.

## 6. Client refactor

Split by trust boundary. Still classic script tags, zero dependencies.

| Module | Role |
|---|---|
| `js/chain.js` (new, extracted from pons.js) | JSON-RPC with proxy fallback, ABI encode/decode, bounded `getLogs`, wallet connect and chain switch. The only file that talks to a node. |
| `js/pons.js` | Curve reads, quotes, trades, `CurveBuy`/`CurveSell` attribution, graduation detection, launch discovery for v1 and v2. |
| `js/pools.js` (new) | Uniswap v4 (StateView, PoolManager `Swap`) and v3 (`slot0`, `Swap`) price and trade reads, liquidity, poolId derivation. |
| `js/tide.js` (new) | Price history → tide. Fixed rule then sigma, rolling peak, multi-timescale, source switch at graduation. Pure functions, no GL. |
| `js/pots.js` (new) | Tide Pools, Last Grain, Graduation Sweep: reads, stakes, claims, event feed. |
| `js/registry.js` (new) | plant/record/strike, flags, snapshots, ghosts, cache fallback. |
| `js/beach.js` (new) | Per-beach persistence and offline erosion replay on `sim.upload/download`; snapshot codec. |
| `js/game.js` | Shrinks to modes, HUD, input. Beach mode is a thin binding. |
| `js/content.js` | Season definitions in Phase 1. |

### Failure handling

- Every chain read has a stale-tolerant default: a failed poll holds the last
  tide rather than dropping the sea.
- Graduation mid-session: slack water while the pool source comes up; if
  `PoolRegistered` is not yet seen, keep the last curve price.
- Log range errors narrow and retry. Cache unreachable → RPC only.
- Wallet rejection cancels cleanly with a toast. Oversized snapshots refused
  before signing. Ghosts with zero-balance owners wash out on the next tide.

### Testing

- Node's built-in test runner, no dependencies: ABI codec, poolId derivation,
  tide model against recorded curve and pool histories, snapshot codec round
  trips, log parsing against fixtures.
- Foundry for registry and pots against forked Robinhood Chain state
  (real curves, real graduated pools); later the vault and treasury.
- Spike-style harness for offline erosion replay.

## 7. Phases

- **Phase 0 — release.** Every pons launch is a beach, v2 and v1. Registry,
  flags, ghosts, per-wallet attribution. Tide across graduation. Tide Pools,
  Last Grain, Graduation Sweep in ETH, rake to a multisig. No tokens of ours.
- **Phase 1 — Sand.** pons v2 launch. Sand pail bonus live. Seasons in Sand.
- **Phase 2 — Castle.** Vault, treasury, Seawall, rake routing to stakers.

## 8. Risks, plainly

- **Regulatory.** Parimutuel pots in ETH on memecoin prices is gambling.
  Heavier than the earlier tax-drip design. Counsel before Phase 0, not
  Phase 2. (Not legal advice.)
- **Oracle games.** A thin young curve lets one wallet paint the peak, and a
  v4 pool has no built-in TWAP. Pot caps scale with liquidity, checkpoints
  average several reads, and curve manipulation costs fees plus creator tax
  both ways. Nothing fully removes it pre-graduation; say so in the UI.
- **Stack drift.** pons says older launches settle through older hooks and
  escrows. Always resolve from the launching factory.
- **The tax is forever.** `creatorTaxBps` cannot be raised; read the cap and
  use it.
- **Sybil / wash** on seasons. Net position accounting, never gross.
- **Not affiliated.** pons can change its stack or close the allowlist; the
  game reads public contracts and needs nothing from pons, but Sand and
  Castle depend on `canLaunch` staying granted.

## 9. Build order

| # | Item | Phase | Effort |
|---|---|---|---|
| 1 | Extract `chain.js`; `CurveBuy`/`CurveSell` attribution | 0 | S |
| 2 | Your-sell-is-your-wave, buy-in-flood pat | 0 | S |
| 3 | `pools.js`: v4 poolId + StateView reads, v3 reads; tide across graduation | 0 | M |
| 4 | `tide.js`: multi-timescale, sigma after history | 0 | M |
| 5 | Beach Registry + Foundry tests + deploy; `registry.js` | 0 | M |
| 6 | `beach.js` persistence + offline erosion replay | 0 | M |
| 7 | Pot contracts + forked tests + audit | 0 | L |
| 8 | `pots.js` + HUD: tide clock, pot tower, stake figures | 0 | M |
| 9 | Counsel sign-off | 0 | — |
| 10 | Read cache (optional service) | 0 | M |
| 11 | Sand launch; pail bonus; seasons v1 | 1 | M |
| 12 | Castle Vault + treasury + Seawall + rake routing | 2 | L |
