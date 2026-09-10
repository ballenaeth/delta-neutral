# Netcode spike — can an authoritative sand sim be streamed?

**Verdict: yes, comfortably. Bandwidth is not the risk. The risk is elsewhere.**

Measured against the real TIDEWRIGHT simulation with a real encoder and real
gzip, not estimated. Reproduce with `spike/netstream-probe.js` (dev tool, not
shipped, not referenced by `index.html`).

---

## Why this had to be answered first

A GPU sand sim **cannot be lockstepped**. GPU floating-point is not
bit-identical across vendors and drivers, so two machines running the same
shader diverge within seconds, and every frame of an 8-neighbour relaxation
compounds it. That rules out the peer-to-peer deterministic model most indie
RTS and TD games use.

So the architecture is forced: **one authority simulates, everyone else receives
heightfield state.** That is only viable if the state fits down a domestic
uplink during the worst case — a flood, when the sea is taking a castle apart.

## The wire format tested

Field downsampled to a coarse authoritative grid, tiled into 8×8 blocks. A block
that has not moved costs one bit. A block that has moved sends 64 deltas against
the state the client last acknowledged, quantised to 4 mm — far below what is
visible on sand. One byte per delta, with a two-byte escape. Then gzip.

Quantisation error accumulates in the probe exactly as it would on the wire:
the baseline advances only by what was actually sent.

## Results — 192×192 authority, 20 Hz

| Scenario | mean | p95 | peak |
|---|---|---|---|
| Idle, calm | 22.5 kbit/s | 32.3 | 34.4 |
| Building (pail, dragging) | 26.7 kbit/s | 35.0 | 35.4 |
| Digging | 30.5 kbit/s | 41.6 | 45.0 |
| Flood, tide IX, castle eroding | 23.5 kbit/s | 29.3 | 33.6 |
| Flood, erosion forced to max | 30.8 kbit/s | 40.3 | 43.2 |
| Large mould stamp (sharpest burst found) | 52.2 kbit/s | 84.0 | **84.0** |
| Soaking a keep until it slumps | 18.4 kbit/s | 27.5 | 29.3 |

**Worst burst measured across every scenario: 84 kbit/s — about 10 KB/s.**

Naive comparison: shipping the whole field as 16-bit every tick would be
73,728 bytes/tick, **11.8 Mbit/s**. The encoder is a 140–800× saving.

Joining a match costs one keyframe: **16.5 KB** at 128², **32.6 KB** at 192²,
**50.1 KB** at 256².

## Why it is so cheap: sand barely moves per tick

This is the finding that decides it. At maximum erosion:

```
mean cell change      0.013 mm / tick
cells moving > 4 mm   22 out of 36,864  (0.06 %)
```

Sand is dramatic **cumulatively** — a castle dissolves over a minute — but per
20 Hz tick almost nothing happens. Delta encoding is close to a perfect fit,
and the cost tracks *how much moved*, not how big the field is. Hence:

| Authority | cell size | join | mean | peak |
|---|---|---|---|---|
| 128² | 37.5 cm | 16.5 KB | 14.8 kbit/s | 20.3 |
| 192² | 25.0 cm | 32.6 KB | 21.2 kbit/s | 29.1 |
| 256² | 18.8 cm | 50.1 KB | 23.3 kbit/s | 29.1 |

Going from 128² to 256² — four times the cells — costs 57 % more bandwidth, not
400 %. **Pick the resolution on gameplay grounds, not network grounds.**

## The cost that is real: host readback

Per network tick, on the host:

| stage | ms |
|---|---|
| GPU readback | **10.48** |
| downsample (CPU) | 1.71 |
| encode | 0.23 |
| gzip | 0.39 |
| **total** | **12.81** (26 % of a 50 ms tick) |

Encoding is free. The readback dominates, and as written it is a **synchronous
stall** that blocks the pipeline — worse in practice than the number suggests.

Two fixes, both known-good:

1. **Downsample on the GPU** with a reduction pass, then read back 192² instead
   of 512². Seven times less data across the bus, and the CPU downsample cost
   disappears.
2. **Read back asynchronously** — PBO plus `fenceSync`, which this codebase
   already does for its metrics pass. One tick of latency, no stall.

Together these should put the host cost in low single-digit milliseconds.

## What this does NOT prove

- **Nothing about feel.** Bandwidth is settled; responsiveness at 150 ms is not.
  Building must be locally predicted — the player's own brush strokes applied
  immediately client-side and reconciled against authority — or it will feel
  like dragging a tool through treacle. That needs a build to evaluate.
- **The numbers are pessimistic.** The probe downsamples the 512² sim rather
  than running a genuinely coarse authority, so the field carries
  high-frequency detail a real coarse sim would never produce. Real deltas land
  under these.
- **Physics divergence is not addressed.** Clients render an interpolated
  heightfield; they do not simulate. Any client-side cosmetic detail must be
  strictly decorative, or it becomes a second source of truth.

## Recommendation

Bandwidth is not a reason to avoid multiplayer. Design for:

- **192² authority** — 25 cm cells, ~25 kbit/s per client, 33 KB to join.
- **20 Hz** state, client-side interpolation between ticks.
- **Client-side prediction on your own tools**, authority reconciliation on everyone else's.
- **GPU downsample + async readback** on the host from day one.
- Visual detail decoupled from authority: clients may add high-frequency
  cosmetic relief locally, but it must never feed back into gameplay.

The next unknown worth spending a week on is **latency feel**, not throughput.

---

# Part 2 — latency

**Verdict: playable at 150 ms, but only because of how this material behaves.
Lockstep is now empirically ruled out, not just theoretically.**

## How much of each tool lands inside the latency window

If a tool takes two seconds to show its effect, a 150 ms delay is invisible. If
it is instantaneous, the delay is the whole experience. Measured as height
change under the brush, as a fraction of the first 1.2 s:

| Tool | 50 ms | 100 ms | **150 ms** | 500 ms |
|---|---|---|---|---|
| **Pail** (pour) | 0 % | 0 % | **0 %** | 19 % |
| **Shovel** (dig) | 4 % | 9 % | **13 %** | 43 % |
| **Rampart** | 26 % | 53 % | **66 %** | 90 % |
| **Mould stamp** | 100 % | 100 % | **100 %** | 100 % |

**Pouring is free.** Nothing at all has happened at 150 ms, because the sand is
still in the air — the game already throws grains as particles with a flight
time, and that flight time is longer than the network delay. Latency hides
inside an animation that exists for other reasons.

**Rampart is the exposed one** at 66 %, and **the stamp is fully exposed** at
100 %. But the stamp is also the easiest thing in the game to predict: it is a
pure function of position, mould, rotation, radius and height, all known at
click time. Measured, the stamp is **100 % present on the first frame with
0 mm of subsequent drift** — a client reproduces it exactly and instantly.

## What an unpredicted client actually gets wrong

Showing a client the authoritative field from RTT ago, while a player drags a
tool:

| RTT | Rampart worst cell | Rampart mean field | Shovel worst cell |
|---|---|---|---|
| 50 ms | 129 mm | 0.08 mm | 68 mm |
| 150 ms | 215 mm | 0.25 mm | 181 mm |
| 250 ms | 215 mm | 0.42 mm | 208 mm |

Two things matter here. The error **saturates** — 215 mm at both 150 and
250 ms, because a tool reaches its target height and stops. And the mean field
error is a quarter of a millimetre: **the entire error is under your own
cursor.** Everywhere else the two worlds are identical to within the wire's own
4 mm quantisation.

That is precisely the shape client-side prediction handles: predict your own
tool, take everyone else's on authority.

## Divergence — why lockstep is impossible and prediction is not

Same state, run twice, one perturbed. Perturbation of 0.5 mm in a single cell:

| elapsed | max divergence | cells touched |
|---|---|---|
| 5 s | 0.72 mm | 337 |
| 10 s | 10.4 mm | 380 |
| 15 s | 30.9 mm | 389 |
| 20 s | 13.5 mm | 366 |

A half-millimetre seed becomes three centimetres in fifteen seconds, then
oscillates. This is granular criticality: a slope resting exactly at its angle
of repose is metastable, so a hair's difference decides whether a given
avalanche fires now or in a second's time. **Two machines cannot stay in step,
confirmed empirically.**

But on the horizon that prediction actually operates over, differences are
inert. Seeding a perturbation of 5 mm — orders of magnitude larger than any
cross-vendor floating-point discrepancy:

| elapsed | 50 ms | 150 ms | 300 ms | 500 ms | 1 s |
|---|---|---|---|---|---|
| max divergence | 5 mm | 5 mm | 5 mm | 5 mm | 5 mm |

It neither grows nor spreads for a full second. At a 20 Hz correction rate the
client is re-anchored every 50 ms, long before criticality has anything to act
on — and sub-4 mm drift is below the wire format's quantisation floor, so it is
literally unrepresentable as an error.

## Recommendation

- **Predict your own tools locally; never predict anyone else's.** The whole
  visible error is under the acting cursor.
- **The stamp must be predicted** — it is 100 % instantaneous and 100 %
  reproducible. Draw it the moment the player clicks.
- **The pour needs nothing.** Its own particle flight already exceeds the
  network delay.
- **Rampart, Pat, Carve and Level need local application plus reconciliation.**
  They are fast enough to notice and approximate enough to correct.
- **Correct at 20 Hz.** Divergence over one tick is below the protocol's own
  noise floor.
- **Never attempt lockstep**, at any tick rate, on any hardware.

## Corrections made during this spike

Recorded because both would have produced confident, wrong conclusions:

1. The first bandwidth run reported idle traffic equal to a flood, with
   identical 11 KB peaks. That was the harness measuring the tail of the
   initial sync — deltas are clamped to 0.5 m/tick and the client starts from an
   empty field, so the first few ticks were full-field catch-up. Fixed by
   sending a proper keyframe and settling before measuring.
2. The divergence test was first called "saturating" on a five-second window.
   Extending to twenty seconds showed it amplifies to centimetres. The
   short-horizon conclusion survived; the characterisation did not.
