/* ============================================================================
   JUBILADOS CLUB — config.js
   The one file to touch on launch day.

   $SAND is not launched yet. Leave `address` empty and the club runs in
   pre-launch mode: $SAND Beach lets you practise on any pons v2 launch and
   says so. The moment you paste the contract address below (and bump the
   ?v= on the script tags in index.html), the beach locks to $SAND: no picker,
   the HUD, the buy button and the menu footer all point at it.

   You can also test a launch without editing anything: ?token=0x… in the URL
   wins over this file, which is handy in the minutes after the launch tx.
   ========================================================================== */
'use strict';

(function (T) {

T.SAND = {
  /* ── fill these in on launch day ── */
  address: '',                       // $SAND contract address on Robinhood Chain (pons v2 launch)
  launchAt: '',                      // optional ISO time, e.g. '2026-09-20T14:00:00+02:00' — shown as a countdown on the menu

  /* ── identity ── */
  symbol: 'SAND',
  name: 'Jubilados Club',
  chainId: 4663,

  /* ── links (leave empty to hide) ── */
  x: '',                             // https://x.com/…
  telegram: '',                      // https://t.me/…
  site: '',                          // https://…

  /* ── the tide ── */
  floodAt: 0.30,                     // this much drawdown from the recent peak is full flood
  windowMin: 20,                     // minutes the peak is measured over
  bagSandPerMille: 4,                // m³ of sand per 0.1 % of supply held
  bagSandMax: 40                     // a whale still has to dig a moat
};

/* what launch state the club is in right now */
T.SAND.live = () => /^0x[0-9a-fA-F]{40}$/.test(T.SAND.address);

})(TW);
