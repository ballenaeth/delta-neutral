# TIDEWRIGHT onchain, multiplayer across pons — design

*Validated in a brainstorming session on 2026-09-10. Supersedes the deleted
DESIGN.md (commit 562c1e8), whose audit and phased plan this builds on.
Written against docs.ponsfamily.com/v2 and the netcode spike in `spike/`.*

## Decisions

| Question | Decision |
|---|---|
| Multiplayer model | Communal, chain-backed. Each player simulates their own sand; presence, flags, snapshots and trades come from the chain. No game server. |
| Our contracts at release | One small Beach Registry on Robinhood Chain. |
| Token family | Layered: **Sand** is the material token, **Castle** is the staking/conviction token. |
| pons relationship | We are, or are partnered with, pons. Launch parameters are ours to set. |
| Pre-token pail | The beach's own token fills the pail, as today. |
| Read infrastructure | Public RPC first, optional non-authoritative cache as fallback. |
| Castle rewards | Sand bought on market by the treasury. Never WETH yield directly. |
| Competition | Cosmetic Remembrance leaderboards. Season rewards key only on chain-verifiable acts. |

The rule that never breaks: **money never follows a forgeable number.**
Remembrance is computed client-side and stays social.

## Why not shared sand

The spike (`spike/FINDINGS.md`) shows a shared heightfield is only possible
with one authoritative simulator streaming deltas at ~25 kbit/s per client.
Lockstep is empirically impossible because GPU floating point diverges across
vendors within seconds. An authoritative host means running infrastructure the
game cannot work without. Communal beaches give "we are all here" without that
cost, and nothing here prevents adding live rooms later.

## 1. Architecture

Three layers. The static site plus the chain is the whole required system.

1. **Beach client** — the existing WebGL game. Local simulation. The chain
   drives the tide (price) and the pail (balance), and delivers everyone
   else's presence: flags, castle snapshots, trades, holders.
2. **Beach Registry** — one contract, ours. Per (pons token, wallet): one flag
   position and style, one castle snapshot hash, timestamps. Anyone writes
   their own slot only.
3. **Read cache** — optional, ours, non-authoritative. Mirrors registry and
   curve events so busy beaches load in one request. The client tries RPC
   first and verifies anything from the cache against chain reads when it
   matters (a flag's owner still holding).

### Phases

- **Phase 0 — release, no tokens of ours.** Every pons v2 launch is a beach.
  Registry deployed. Communal flags and snapshots. Per-wallet trade
  attribution from `CurveBuy`/`CurveSell` logs. Persistent beaches with
  offline erosion replay. Post-graduation pool tide.
- **Phase 1 — Sand launch.** pons v2 launch, creator tax at cap, fee recipient
  a multisig, pons buybacks on. Sand beach is the home beach. Seasons begin.
- **Phase 2 — Castle launch and vaults.** Castle Vault (staking), treasury that
  converts creator tax into Sand and drips it to stakers, Seawall bid. Staked
  Castle is visible on every beach as packed sand and unlocks. Castle launches
  only after the vault is audited, because the vault is the reason to buy it.

## 2. Beach Registry and the communal client

Tiny by design: auditable in an afternoon, never upgraded.

```solidity
struct Slot { uint16 x; uint16 z; uint8 style; uint8 flags; uint40 at; bytes32 castle; }
mapping(address token => mapping(address wallet => Slot)) slots;

function plant(address token, uint16 x, uint16 z, uint8 style) external;
function record(address token, bytes32 castleHash, bytes calldata snapshot) external;
function strike(address token) external;

event Planted(address indexed token, address indexed wallet, uint16 x, uint16 z, uint8 style);
event Recorded(address indexed token, address indexed wallet, bytes32 castleHash, bytes snapshot);
event Struck(address indexed token, address indexed wallet);
```

Onchain rules: one slot per wallet per beach; `plant` requires a nonzero
balance of `token` at call time. Everything else is enforced by the client
reading the chain, so the contract stays dumb.

- **Washing away.** The contract never removes flags. The client checks each
  owner's current balance; zero balance means the flag falls on the next
  tide. Selling out becomes visible to everyone with no extra transaction.
- **Snapshots.** Coarse heightfield, ~64×64 cells at 8 bits plus moisture and
  compaction bands; ~8 KB raw, 2–3 KB compressed. Stored in event data, never
  storage. Visitors render other players' castles as ghost outlines at their
  flag, in that player's chosen look. Ghosts are cosmetic and never feed the
  local sim. If size becomes a problem, move blobs to IPFS and keep the hash.
- **Attribution.** Replace reserve-delta inference with `CurveBuy`/`CurveSell`
  logs. A sell has a wallet, so its splash lands on the seller's own flag and
  castle. A buy during a flood pats the buyer's castle. The feed shows flag
  names, not addresses.
- **Read path.** Bounded `eth_getLogs` ranges with backoff. On failure or for
  old beaches, ask the cache for a digest, then verify flag owners with
  `balanceOf` before drawing. Cache down means slower load, not a broken beach.

## 3. Sand and Castle — the layered economy

Both are pons v2 launches: 100% of supply mints to the curve, no team
allocation. Every reward budget comes from creator tax in WETH, so the launch
parameters are the whole economy.

**Sand is the material.** On the Sand beach the bag fills the pail as on any
beach. Sand's extra role is the reward asset. The treasury never holds
unbought Sand: it buys on the curve before graduation and on the locked v4
pool after.

**Castle is conviction.** Castle's power is the Castle Vault:

- Stake Castle; unstaking starts a 48 h cooldown. Early exit forfeits accrued
  rewards to remaining stakers.
- Rewards are Sand. Each epoch (~weekly) the treasury claims creator tax from
  the pons fee escrow for both launches, spends a fixed share buying Sand, and
  streams it to stakers pro rata by stake-time.
- In game, on every pons beach: staked Castle means packed sand. Pail arrives
  pre-compacted, staked Castle counts double toward the bag cap, the flag
  carries a banner.

**Treasury — three fixed shares of creator tax:** staker rewards, the
Seawall, operations. The Seawall may only buy Sand when the onchain drawdown
from a rolling peak exceeds the flood threshold (the game's `floodAt`). Its
reserve renders as a berm at the flood line on the Sand beach: the bid is
visible before the flood arrives.

**Seasons.** An epoch range. Points from chain-verifiable acts only: net
position held through floods, hold streak from `Transfer` logs, staking
duration, presence at a graduation (a registry `record` in the block window).
Season rewards are Sand from the treasury. Remembrance leaderboards run
alongside and pay nothing.

**Launch parameters (irreversible):** creator tax at the cap for both
launches; fee recipient a multisig on day one, migrated to the treasury with
`transferCreatorFeeRecipient`; pons buybacks on.

## 4. Client refactor

Split by trust boundary, not by screen. Still classic script tags, zero
dependencies.

| Module | Role |
|---|---|
| `js/chain.js` (new, extracted from pons.js) | JSON-RPC with proxy fallback, ABI encode/decode, bounded `getLogs` with backoff, wallet connect and chain switch. The only file that talks to a node. |
| `js/pons.js` | Curve reads, quotes, trades. Gains log-based trade attribution and a post-graduation pool price source. |
| `js/registry.js` (new) | plant/record/strike; read a beach's flags and snapshots; cache fallback and balance verification. |
| `js/tide.js` (new) | Price history → water level. Base level from 24 h drawdown, wave amplitude from the 20 min window, weather from trade rate. Pure functions, no GL. |
| `js/beach.js` (new) | Per-token persistence and offline erosion replay on `sim.upload/download`; snapshot codec; ghost castle rendering. |
| `js/game.js` | Shrinks to modes, HUD, input. Curve mode becomes a thin binding. |
| `js/content.js` | Gains season definitions in Phase 1. |

### Failure handling

- Every chain read has a stale-tolerant default: a failed poll holds the last
  tide rather than dropping the sea.
- Log range errors narrow and retry (pons.js already does this).
- Cache unreachable → RPC only, slower join.
- Wallet rejection cancels cleanly with a toast.
- Oversized snapshots refused client-side before signing.
- Ghosts whose owner reads zero balance wash out on the next tide.

### Testing

- Node's built-in test runner, no dependencies: ABI codec, tide model,
  snapshot codec round trips, log parsing against recorded fixtures.
- Foundry for the registry, later the vault and treasury.
- Spike-style harness for offline erosion replay against recorded price
  histories.

## Risks

- **Reward farming / sybil.** Net-position accounting, staking gates, never
  pay on Remembrance. Assume bots on day one.
- **Regulatory.** Rewards are Sand bought on market, framed as gameplay
  material, never WETH yield. Get counsel before Phase 2. (Not legal advice.)
- **Oracle games.** A thin early curve lets one wallet paint the peak.
  Multi-timescale windows and volume-weighted peaks blunt it.
- **The tax is forever.** `creatorTaxBps` cannot be raised; use the cap.
- **Snapshot spam.** Event data is cheap but not free; rate-limit `record`
  per slot (e.g. once per N blocks) if it becomes a nuisance.

## Build order

| # | Item | Phase | Effort |
|---|---|---|---|
| 1 | Extract `chain.js`; log-based trade attribution | 0 | S |
| 2 | Your-sell-is-your-wave, buy-the-dip pat | 0 | S |
| 3 | `tide.js` multi-timescale model; post-graduation pool source | 0 | M |
| 4 | `beach.js` persistence + offline erosion replay | 0 | M |
| 5 | Beach Registry contract + Foundry tests + deploy | 0 | S |
| 6 | `registry.js`: flags, snapshots, ghosts, wash-away | 0 | M |
| 7 | Read cache (optional service) | 0 | M |
| 8 | Sand launch params; home-beach perks; seasons v1 | 1 | M |
| 9 | Castle Vault + treasury + escrow claim routing | 2 | L |
| 10 | Seawall + berm rendering | 2 | M |
