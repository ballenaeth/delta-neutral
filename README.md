# JUBILADOS CLUB — $SAND

**Retired at 30. Building sandcastles until the tide comes in.**

A 3D sandcastle simulator that runs entirely on the GPU, where the tide is the
$SAND chart. No engine, no libraries, no build step — one WebGL2 context,
~8 000 lines of JavaScript and GLSL, a beach that obeys the angle of repose,
and a bonding curve on Robinhood Chain that decides where the water sits.

> A generation looked at the forty-year plan and said no. They took the one
> good trade, blocked their manager at 14:00, and went to the coast with a bag
> and a sombrilla. Now they build castles all afternoon while the rest of the
> world is in a stand-up. The sea keeps what it takes: every red candle it
> climbs the beach and eats the loose sand first.
>
> *A jubilado is someone who packed it before the water changed its mind.*

---

## Play

```bash
node server.js          # → http://localhost:5173
```

Or clone and double-click `index.html` — every script is a classic
`<script src>`, so it runs from `file://` too (saves fall back to memory, and
the chain is read directly from the browser).

Needs WebGL2 with `EXT_color_buffer_float` — any Chrome, Edge or Firefox from
the last few years, Safari 16+. Drop **Render scale** in Settings if your GPU
is having a hard time. The only network traffic is JSON-RPC to Robinhood Chain,
and only on $SAND Beach.

---

## $SAND Beach

The main mode. **The chart is the tide.**

The game reads the $SAND bonding curve on [pons](https://docs.ponsfamily.com)
(Robinhood Chain, id 4663) every six seconds, with raw JSON-RPC and no
libraries — the trust path is the chain, not the pons website.

- **The water sits at the price’s recent high** (the last 20 minutes by
  default). Every percent the price falls from that peak walks the sea up the
  beach; 30 % down is high water, and the sea takes the loose sand first and
  the feet before the towers. Buys draw the water back.
- **A sell lands as a wave.** The curve’s reserves moving between two polls is
  a trade; a sell throws a splash on top of whatever the drawdown already says.
- **Your bag is your sand.** Connect a wallet (it is switched to Robinhood
  Chain for you) and every 0.1 % of $SAND supply you hold is 4 m³ more sand in
  the pail, up to 40 m³. A whale still has to dig a moat.
- **Buy $SAND from the beach.** Trades happen on the curve itself, quoted the
  way the pons docs quote them — fees off the input on a buy, off the output on
  a sell, snipe tax read per recipient, partial fill at the graduation
  boundary — and your wallet signs everything. Nothing here custodies anything.
- **Graduation is slack water.** When the curve fills, the pool is locked and
  the sea stops climbing for good. The club is retired.
- <kbd>R</kbd> rehearses a rug: thirty seconds of high water, nothing on the
  chain touched.

Your score is **Pensión**: sand standing above the high-water line, weighted by
how well you packed it. Loose sand is paper hands and counts for nothing.

### Before launch

$SAND has not launched yet, and the club knows it. With no address in
`js/config.js`, $SAND Beach runs in **practice mode**: the picker lists the
latest launches off the pons v2 factory (busiest first) and you build on any of
them, with a banner saying so. Everything else — bag, buys, waves, graduation —
works exactly as it will on launch day, just on someone else’s chart.

### Launch day

1. Launch $SAND on pons v2. Public launching is closed; the launching wallet
   needs `canLaunch(address)` to be true on the factory
   (`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`). Pair it against ETH or an
   approved quote token — the game handles both and shows every figure in the
   launch’s own quote asset.
2. Paste the contract address into `js/config.js` → `T.SAND.address`.
   Optionally set `launchAt` beforehand for a countdown on the menu, and the
   `x` / `telegram` / `site` links.
3. Bump the `?v=` on every script tag in `index.html` (GitHub Pages caches
   for ten minutes) and deploy.

From that moment the picker disappears, the beach locks to $SAND, the menu
footer shows the CA linked to pons, and “Buy $SAND” means exactly that. In the
minutes before you have edited the file, `?token=0x…` in the URL does the same
thing — handy right after the launch tx confirms.

Tuning: `T.SAND.floodAt` (drawdown that is full flood), `windowMin` (minutes
the peak is measured over), `bagSandPerMille` and `bagSandMax`. All four can be
overridden per session with `?flood=`, `?window=` URL params.

---

## The other ways in

**The Nine Siestas** is the campaign: nine tides across one long European
afternoon, from *The Long Lunch* to *Jubilación*, each giving you a stretch of
low water to build in and then taking it back, higher and rougher each time.
The seventh is *The American Open* — 15:30 in Madrid, when the sets come in
threes and the third one is a liar. Between them the sun crosses the sky
exactly once.

**Siesta Mode** is the cosy one. No tide, no clock, no alarm, every mould, and
a full sunrise-to-stars day over the beach that you can scrub or let run.

**Infinite Pensión** takes the arithmetic away: a bottomless bag and a sea that
never comes in. Sand still slumps, still needs wetting, still sets as it dries.

## The one law

**Dry sand cannot stand.** Each grain has an angle it refuses to exceed —
about 33° dry. Water bridges the grains and lets you go past vertical; too much
and it runs like soup. Then **pat it**: compaction is the other half of
strength. Damp, not soaked. Conviction, not leverage.

A readout follows your cursor with the moisture, the packing, how much sand is
left, and a plain-English verdict. A single line above the workbench always
says the next useful thing.

## Tools, moulds, toys

| | |
|---|---|
| **takes sand** | Shovel, Carve — into your bag |
| **adds sand** | Pail, Mould, Rampart, Drip — out of your bag |
| **no sand** | Pat (diamond hands), Water, Level, Adorn — changes what the sand is *like* |

Ten moulds — round turret, square keep, gatehouse, star fort, ziggurat, spire,
scallop, fish, crab, starfish. Hold on damp sand to fill, aim, click. What comes
out is exactly as wet as what went in.

Twelve adornments — pennant, sombrilla, pinwheel, farolillo, bucket & spade,
the yacht, scallop, starfish, driftwood, kelp, an empty caña, cairn. They lean
as the sand shifts and go over when the water reaches them.

Sand is conserved to the grain. Digging fills your bag; pouring empties it.
Dig your moat *where you want a moat* and the spoil becomes your keep.

## Nine looks

Settings → **Look**. Same simulation, same sun, same castle — nine ways of
separating the light, switched live:

| | |
|---|---|
| **Costa** | The beach as it is. Oren–Nayar sand with mica glints, Gerstner sea, raymarched atmosphere, HDR bloom. |
| **Chiringuito** | A picture book. Three flat steps of light with a coloured shadow, a brown ink line, a shallow miniature focus. |
| **Visit Spain** | A screen-printed travel poster. Five inks, a rotated dot screen, one ink out of register. |
| **Catastro** | A survey chart of your own castle. Contours off the heightfield, hachures on the steep faces. |
| **Abuela’s Sofa** | A craft-fair diorama. Wrap lighting, no specular, fibre in the fill, a fuzzy halo on every edge. |
| **Cala** | The whole beach under a foot of clear water. Caustics, a green cast, a slow refractive wobble. |
| **Vespa** | Enamel over pressed tin. Four hard steps, a banded highlight, wear where the curvature is high. |
| **Azulejo** | Woodblock. Flat colour blocks with grain, a hand-gradated sky, a misregistered plate. |
| **Benidorm, January** | The same beach out of season. The realistic render, drained and cooled. |

## Controls

| | |
|---|---|
| Left mouse | use tool |
| Right drag · Shift + drag | orbit |
| Middle drag · Alt + drag | pan |
| Wheel | zoom |
| W A S D · Q E | pan · rotate |
| 1 – 9 , 0 | select tool |
| `[` `]` | brush / mould size |
| `,` `.` | turn the mould |
| Shift *held during a stroke* | fine work |
| Z | undo stroke |
| R | call the tide early · rehearse a rug |
| P | photo mode |
| H | hide interface |
| Esc | pause (siesta) |

## Files

| | |
|---|---|
| `js/config.js` | **the one file to touch on launch day** — $SAND address, links, tide tuning |
| `js/pons.js` | the chain: factory and curve reads, wallet, quoting, buy/sell, recent launches |
| `js/content.js` | the nine siestas, the tools, the primer, the looks — everything a designer touches |
| `js/game.js` | camera, input, the tide machine, scoring, the interface, the frame |
| `js/sim.js` `terrain.js` `water.js` `sky.js` `props.js` `particles.js` `post.js` `glsl.js` | the GPU simulation and renderer |
| `server.js` | static files, plus `POST /rpc` forwarded to Robinhood Chain for browsers that will not talk to it directly |

## Credits

The simulation and renderer are [tidewright](https://github.com/winchxyz/tidewright)
by winchxyz, MIT — a sandcastle sim generated in one Claude Code session. The
club, $SAND, the pons integration and the afternoon are ours. MIT, see
`LICENSE`.

*Not financial advice. It is sand.*
