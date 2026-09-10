# JUBILADOS CLUB — game theory & onchain design

*How the game works today, where the incentive design leaks, and a phased plan to
make holding $SAND and playing the game the same activity. Written against the
codebase as of commit `b1a9dbf` and docs.ponsfamily.com/v2.*

---

## 1. How it works today (the short version)

- **Simulation** (`sim.js`, `glsl.js`): a GPU heightfield with per-texel moisture
  and compaction. One law — angle of repose (~33° dry, steeper when damp and
  packed). Score is **Pensión**: `worth = above-high-water × (0.22 + 1.6 × packing)`,
  measured on the GPU (`sim.js:398-421`), scaled by 14 (`game.js:12`).
- **Modes** (`game.js`): Nine Siestas (timed build → flood → grade), Siesta
  (sandbox day), Infinite Pensión (creative), and **$SAND Beach** (curve mode).
- **Curve mode** (`pons.js` + `game.js:911-1168`): polls the pons v2 bonding
  curve every 6 s with raw JSON-RPC. The water level is the **drawdown from the
  rolling 20-minute peak**, smoothstepped so 30% down = full flood
  (`pons.js:137-151`). Trades are inferred from reserve deltas between polls;
  a sell lands as a splash wave. A connected wallet's balance adds sand to the
  pail: 0.1% of supply = 4 m³, capped at 40 m³ (`game.js:1088-1091`). Buys and
  sells happen on the curve itself, quoted exactly per the pons docs (fees off
  input on buys, off output on sells, per-recipient snipe tax, graduation cap).
  Graduation → sea goes slack permanently.
- **Persistence**: everything is localStorage. Score, castles, codex — nothing
  leaves the browser. The chain is read-only except for the user's own trades.

## 2. Game-theory audit of the current design

What already works:

- **Graduation as the collective win state** is genuinely good design: filling
  the curve is a positive-sum coordination goal with a real onchain finish line
  (locked v4 pool), and the game dramatizes it.
- **The bag→sand cap** (max at ~1% of supply) is the right defensive shape:
  holding matters, whales don't trivialize the game.
- **Drawdown-as-tide** gives the token a live, legible social display: the
  community literally watches the chart together through the beach.

Where it leaks:

1. **Selling is a pure externality.** A sell floods *everyone's* beach, but the
   seller bears no cost beyond their pro-rata share. Classic commons problem:
   the mechanism punishes the group for an individual's defection, which
   *pressures nobody*. The game knows about trades but not *whose* they are.
2. **Holding pays once, then never again.** The bag bonus is a static lookup.
   There is no time dimension — a wallet that has held through nine floods and
   a wallet that aped 4 seconds ago get identical sand.
3. **Nothing persists, so nothing compounds.** No leaderboard, no streaks, no
   castle that survives a session on $SAND Beach. Retention rests entirely on
   the sim being pleasant (it is, but that decays).
4. **The game dies at graduation.** "The sea goes slack for good" is poetic but
   it means the game ends exactly when the token's real life (the locked v4
   pool) begins. Long-term hold incentives need a post-graduation game.
5. **No revenue loop.** pons v2 gives the launch a creator tax and fee escrow —
   a permanent, per-trade revenue stream — and the game touches none of it.
   Sellers could be *funding* the holders' game. Right now they fund nothing.
6. **Solo on a crowded beach.** Every player builds alone against a shared
   chart. The community sees each other in the trade feed, not on the sand.

## 3. Hard constraints (what pons v2 actually allows)

Verified against docs.ponsfamily.com/v2:

- **No team allocation.** 100% of supply mints to the curve. Reward budgets can
  only come from (a) creator-tax revenue in the quote asset, (b) tokens the
  treasury buys on market, (c) the pons buyback vault's 5-year vest.
- **`creatorTaxBps` is capped and fixed at creation.** The launch-day choice IS
  the game's permanent budget. Cannot be raised later.
- **`creatorFeeRecipient` is transferable** (`transferCreatorFeeRecipient()`).
  Launch with a multisig, migrate to a treasury contract later. This is the
  single most important launch parameter for this design.
- **pons-native buybacks are opt-in, funded from the creator's fee share.**
  Bought tokens are NOT burned — locked in the vault, vesting linearly over
  five years, split creator/protocol. A credible slow supply sink.
- **The curve emits real events**: `CurveBuy(buyer, recipient, quoteIn,
  tokensOut, fee, tax)` and `CurveSell(seller, recipient, tokensIn, quoteOut,
  fee, tax)`. The game currently infers trades from reserve deltas — it can
  instead know exactly who did what, per wallet, from `eth_getLogs`.
- **Post-graduation** the meme hook accrues swap fees per pool
  (`PoolFeesSwept`, `PoolRegistered`); the pool position sits permanently in
  the launch locker. The pool is readable — the tide does not have to end.

One self-imposed rule that must never be broken: **money never follows a
forgeable number.** Pensión is computed client-side and is trivially fakeable.
Onchain rewards may only key on chain-verifiable behavior (balances over time,
buys during drawdowns, staking). Pensión stays social/cosmetic. Any design that
pays ETH for a submitted score gets farmed to death within a day.

## 4. The loop we're building toward

> Sellers pay the creator tax → the tax funds the club treasury → the treasury
> pays diamond hands (stakers) and defends the flood line (seawall buybacks) →
> holding is visibly rewarded in-game (packed sand, flags, streaks) → the beach
> is worth defending → fewer panic sells → shallower floods. The people who
> bring the water in pay for the sea wall.

### Phase 0 — client-only, pre-launch (no contracts, ship now)

These fix playability and the externality problem using only what the chain
already emits. All of it works in practice mode today, on any pons launch.

1. **Read `CurveBuy`/`CurveSell` logs instead of reserve deltas** (`pons.js`).
   Per-wallet attribution unlocks everything below and makes the trade feed
   exact (the current delta method nets out opposing trades within one 6 s
   poll and can't size waves honestly).
2. **Your sell is YOUR wave.** When the connected wallet's own `CurveSell`
   lands, aim the splash at the player's castle (the game already has
   `mytrade` and targeted erosion machinery). Selling stops being free for
   the seller — the externality gets partially internalized, in fiction.
3. **Buying the dip reinforces your castle.** A `CurveBuy` from the player
   while flood > 0.5 triggers an auto-pat (compaction blessing) over their
   build. "Conviction, not leverage" becomes a mechanic, not a caption.
4. **Diamond-hands streaks from Transfer logs.** Days since the wallet last
   sold (verifiable) → sand arrives progressively pre-packed, cosmetic auras,
   codex unlocks. A 30-day holder's sand is simply better sand.
5. **The beach persists.** Autosave the $SAND Beach heightfield per token
   (the save format in `game.js:1384` already exists). On return, replay the
   chart's history since last visit and apply the erosion that "happened
   while you were away." Checking the chart and checking your castle become
   the same compulsion. This is the single biggest retention feature.
6. **Multi-timescale tide.** One 20-min window is spiky and illegible. Split:
   base sea level from a long window (24 h drawdown), wave amplitude from the
   short window, wind/weather from trade frequency. Tune `floodAt` per regime.
7. **Post-graduation beach.** On `graduated`, switch the price source to the
   v4 pool (swap events via the meme hook / pool reads) instead of ending the
   game. Graduated = calmer seas (locked liquidity narrative: lower `amp`,
   slower flood), not no seas. `BuybackLocked` / `PoolBuybackSkipped` events
   render as "the club buys" — a visible green wave paid for by the protocol.
8. **Daily siestas.** Rotating curve-mode objectives (survive a 10% drawdown
   with 500 Pensión standing; build through the American Open 15:30–17:00
   CET; keep a farolillo lit overnight). Local streak counter. Shareable
   grade-card PNG from photo mode with the chart stamped on it — the viral
   surface the game currently lacks.

### Phase 1 — launch-day parameters (zero code, irreversible, decide carefully)

- **`creatorTaxBps`: set it to the cap** (or near). This is the game's entire
  permanent budget and it can never be raised. A memecoin whose tax visibly
  funds its own game is a feature, not a friction — say so loudly.
- **`creatorFeeRecipient`: a multisig on day one**, migrated to the treasury
  contract in Phase 2. Never an EOA.
- **Turn pons buybacks ON.** Creator-share-funded, automatic, tokens locked
  five years. It is a credible, protocol-enforced commitment that dips get
  bought — exactly the "seawall" story — with zero custom code.
- **Pair token**: ETH unless there's a strong USDG argument; note the tide
  measures drawdown in the quote asset, so quote choice changes the game's
  volatility profile.
- Set `launchAt` for the menu countdown; keep the snipe-tax storm framing
  (first 5 seconds = 99% tax, the game should render those seconds as a squall).

### Phase 2 — the club's own contracts

1. **The Castle Vault (staking).** Stake $SAND → unstaking takes a 48 h
   cooldown ("the walk back from the beach") and early exit forfeits accrued
   rewards to remaining stakers. Rewards: the treasury claims creator-tax
   revenue from the pons fee escrow and drips it to stakers per epoch.
   In-game: **staked sand is packed sand** — counts double toward the bag cap
   and arrives pre-compacted; unstaked balance is loose sand. Game theory:
   staked supply cannot market-sell inside a panic window (mechanical
   circuit-breaker), sellers' tax funds stakers' yield (defection pays the
   cooperators), and the in-game bonus gives small holders a non-financial
   reason to lock.
2. **The Seawall.** A treasury strategy contract holding a fixed share of
   creator-tax revenue that may *only* buy when drawdown from a rolling
   onchain peak exceeds the flood threshold (mirror the game's `floodAt`).
   Everyone can verify the bid exists before the flood comes — a credible
   commitment, not a promise. Render it literally: a berm at the flood line
   whose height is the seawall's reserve balance.
3. **The Flag Registry.** One tiny contract: any holder plants one flag at
   (x, z) with a style id — a single storage slot, one cheap tx. Every
   player's beach renders every holder's flag. Wallet goes to zero → the flag
   washes away on the next tide. The beach becomes communal without touching
   the hard problem of a shared heightfield. This is the cheapest possible
   multiplayer and the strongest possible "we're all here" signal.
4. **Eligibility gating for anything paid:** epoch rewards key on *net*
   position change over the epoch + staking status, never on gross buys
   (kills wash-trade farming) and never on Pensión (kills score forging).

### Phase 3 — the wider pons ecosystem

- **Away Beaches.** Practice mode already lists every pons v2 launch — lean
  in. Per-token beaches with local flags and leaderboards market the game to
  every other pons community and route volume through pons. The game becomes
  ecosystem infrastructure: *the* front-end where any pons chart is playable.
- **Graduation festivals.** Watch curves above ~90% progress; when
  `CurveCompleted` fires, stage the slack-water event live for everyone
  building there. Being present at graduations becomes a thing people do.
- **The Castle Chronicle.** End-of-epoch NFT: heightfield hash + thumbnail +
  claimed Pensión. Explicitly cosmetic (the score is a claim, not a fact) —
  a collectible gallery of afternoons, never a reward key.
- **Ecosystem stats in the club**: fee escrow totals, buyback vault balance
  and vest progress, pons-wide graduations — the beach as a pons dashboard.

## 5. Risks, stated plainly

- **Reward farming / sybil**: mitigated by net-position accounting, staking
  gates, and the never-pay-on-Pensión rule. Assume every reward path will be
  attacked by bots on day one, because on pons it will be.
- **Regulatory**: routing creator-tax revenue to stakers as yield has
  securities texture in several jurisdictions. Frame as gameplay rewards,
  cap it, and get real counsel before Phase 2 ships. (Not legal advice.)
- **Oracle games**: a thin early curve lets one wallet paint the 20-minute
  peak and rug-rehearse for real. Multi-timescale windows and volume-weighted
  peaks blunt it; nothing fully removes it pre-graduation.
- **The tax is forever**: `creatorTaxBps` cannot be raised. Under-set it and
  the treasury starves permanently; the cap exists, use it.
- **Five-year vault vest**: pons buyback tokens vest to creator+protocol —
  they re-enter supply slowly. Fine, but say it before someone else does.

## 6. Priority order

| # | Item | Type | Effort | Impact |
|---|------|------|--------|--------|
| 1 | CurveBuy/CurveSell log reading + per-wallet attribution | client | S | unlocks 2–4 |
| 2 | Your-sell-is-your-wave, buy-the-dip blessing | client | S | fixes the externality |
| 3 | Persistent $SAND beach + offline erosion replay | client | M | retention |
| 4 | Post-graduation pool tide | client | M | game survives its own win |
| 5 | Launch params: max tax, multisig recipient, buybacks ON | ops | — | the entire budget |
| 6 | Daily siestas + shareable grade cards | client | M | acquisition loop |
| 7 | Castle Vault staking + escrow claim routing | contract | L | core hold incentive |
| 8 | Flag Registry | contract | S | communal beach |
| 9 | Seawall | contract | M | credible flood bid |
| 10 | Away-beach leaderboards, graduation festivals | client+svc | L | pons ecosystem play |
