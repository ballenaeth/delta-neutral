/* ============================================================================
   JUBILADOS CLUB — content.js
   The nine siestas, the tools, the codex. Everything a designer would touch.
   ========================================================================== */
'use strict';

(function (T) {

/* ─────────────────────────── icons ─────────────────────────── */
const I = {
  shovel: '<path d="M6 3v6M4 9h4l-1 8a2 2 0 0 0 4 0l-1-8h4M6 3h0"/><path d="M8 17l-3 4h6l-3-4z" transform="translate(4 0)"/>',
  pail:   '<path d="M5 8h14l-1.6 11a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8L5 8z"/><path d="M7 8a5 5 0 0 1 10 0"/><path d="M9.5 12.5v4M14.5 12.5v4"/>',
  pat:    '<path d="M4 15h16"/><path d="M7 15V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v6"/><path d="M9 4v2M12 3v3M15 4v2"/><path d="M4 19h16"/>',
  water:  '<path d="M12 3s6 6.4 6 10.4A6 6 0 0 1 6 13.4C6 9.4 12 3 12 3z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>',
  bucket: '<path d="M7 21V9l5-5 5 5v12"/><path d="M7 9h10"/><path d="M9 9V6.5M12 9V4.5M15 9V6.5"/><path d="M4 21h16"/>',
  wall:   '<path d="M3 20h18"/><path d="M4 20v-6h16v6"/><path d="M4 14v-3h3v3M10 14v-3h4v3M17 14v-3h3v3"/>',
  carve:  '<path d="M15 3l6 6-9.5 9.5-6-6L15 3z"/><path d="M11.5 6.5l6 6"/><path d="M5.5 12.5L3 21l8.5-2.5"/>',
  drip:   '<path d="M12 2c0 0 3 4.5 3 6.5a3 3 0 1 1-6 0C9 6.5 12 2 12 2z"/><path d="M8 21c0-4 1.6-6 4-6s4 2 4 6"/><path d="M6 21h12"/>',
  level:  '<path d="M3 12h18"/><path d="M3 12l3-3M21 12l-3-3M3 12l3 3M21 12l-3 3"/><path d="M12 4v3M12 17v3"/>',
  adorn:  '<path d="M12 3l2.2 5.6L20 9.2l-4.4 3.6 1.4 5.7L12 15.6 7 18.5l1.4-5.7L4 9.2l5.8-.6L12 3z"/>',
  flagI:  '<path d="M6 21V3"/><path d="M6 4h11l-2.5 3.5L17 11H6"/>',
  shellI: '<path d="M12 20C6 20 3 15 3 11a9 9 0 0 1 18 0c0 4-3 9-9 9z"/><path d="M12 20V4M8 19.2L6 5.4M16 19.2L18 5.4"/>',
  starI:  '<path d="M12 3l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 17.3 6.2 20.8l1.6-6.6L2.6 9.8l6.8-.5L12 3z"/>',
  woodI:  '<path d="M3 14c3-3 5 1 8-2s4 2 7-1"/><path d="M4 18c3-3 5 1 8-2s4 2 7-1"/>',
  lampI:  '<path d="M12 3a5 5 0 0 1 5 5c0 3-2 4-2 6H9c0-2-2-3-2-6a5 5 0 0 1 5-5z"/><path d="M10 17h4M10.5 20h3"/>',
  cairnI: '<path d="M8 20h8"/><ellipse cx="12" cy="18" rx="5" ry="2.2"/><ellipse cx="12" cy="13.6" rx="3.8" ry="1.9"/><ellipse cx="12" cy="9.8" rx="2.7" ry="1.6"/><ellipse cx="12" cy="6.6" rx="1.7" ry="1.2"/>',
  parasolI:'<path d="M12 12v9"/><path d="M10.5 21h3"/><path d="M2.5 12a9.5 9.5 0 0 1 19 0z"/><path d="M6.5 12c0-5.5 2.5-9.5 5.5-9.5s5.5 4 5.5 9.5"/>',
  pinwheelI:'<path d="M12 12V21"/><circle cx="12" cy="12" r="1.4"/><path d="M12 10.6c0-4 1-6.6 3.4-6.6S18 8 13.4 11.3"/><path d="M13.4 12.6c4 0 6.6 1 6.6 3.4S16 18.6 12.7 14"/><path d="M10.6 12.6c-4 0-6.6-1.4-6.6-3.6S8 5.4 11.3 10"/>',
  pailI:  '<path d="M4 8h13l-1.4 10.6a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7L4 8z"/><path d="M6 8a4.5 4.5 0 0 1 9 0"/><path d="M19 20V9M21.5 9h-5"/>',
  boatI:  '<path d="M3 17h18l-2.5 4h-13L3 17z"/><path d="M12 16V3"/><path d="M12.8 4.2c3 1.6 5 3.4 6.2 5.6h-6.2z"/><path d="M11.2 6.5C9 7.6 7.4 8.6 6.2 9.8h5z"/>',
  bottleI:'<path d="M10 2h4v4.5c0 1 .6 1.6 1.2 2.3.9 1 1.3 1.8 1.3 3V19a3 3 0 0 1-3 3h-3a3 3 0 0 1-3-3v-7.2c0-1.2.4-2 1.3-3C9.4 8.1 10 7.5 10 6.5z"/><path d="M9.5 13h5"/>',
  kelpI:  '<path d="M8 21c-1.5-4 .5-7 1-11S8 3 8 3"/><path d="M14 21c2-4 .5-7 0-11s1.5-6 1.5-6"/><path d="M11 21c-.5-3 1-5 1-8"/>',
  /* mould shapes */
  mTurret:'<path d="M6 21V9l6-5 6 5v12"/><path d="M6 9h12"/><path d="M8 9V6.2M12 9V4.5M16 9V6.2"/>',
  mKeep:  '<path d="M4 21V7h16v14z"/><path d="M4 7V4h3v2h3V4h4v2h3V4h3v3"/>',
  mGate:  '<path d="M3 21V7h5v14M16 21V7h5v14"/><path d="M8 21v-8h8v8"/><path d="M10.5 21v-4a1.5 1.5 0 0 1 3 0v4"/>',
  mStar:  '<path d="M12 2.5l2.8 6.3 6.8.6-5.2 4.5 1.6 6.6L12 17l-6 3.5 1.6-6.6L2.4 9.4l6.8-.6L12 2.5z"/>',
  mZig:   '<path d="M2 21h20"/><path d="M4 21v-4h16v4"/><path d="M6.5 17v-4h11v4"/><path d="M9 13V9h6v4"/><path d="M11 9V5.5h2V9"/>',
  mSpire: '<path d="M12 2l4.5 19h-9z"/><path d="M9 15h6M10 9h4"/>',
  mScallop:'<path d="M12 20.5C6 20.5 2.8 15.5 2.8 11a9.2 9.2 0 0 1 18.4 0c0 4.5-3.2 9.5-9.2 9.5z"/><path d="M12 20.5V3M8 20.2 6 4.6M16 20.2 18 4.6"/>',
  mFish:  '<path d="M20 12c-2.6 3.6-5.4 5.4-8.4 5.4S6 15.6 4 12c2-3.6 4.6-5.4 7.6-5.4S17.4 8.4 20 12z"/><path d="M20 12l3-3.4v6.8L20 12z"/><circle cx="8" cy="11" r=".9"/>',
  mCrab:  '<ellipse cx="12" cy="13.5" rx="5.5" ry="4"/><path d="M6 8.5 3.6 6.4a2 2 0 1 1 2-2L7.6 6.5"/><path d="M18 8.5l2.4-2.1a2 2 0 1 0-2-2L16.4 6.5"/><path d="M6.6 16 3 18M17.4 16 21 18M7.5 12.5 3.5 12M16.5 12.5 20.5 12"/>',
  mStarfish:'<path d="M12 3l2.4 6.1 6.5.4-5 4.2 1.7 6.3L12 16.6 6.4 20l1.7-6.3-5-4.2 6.5-.4L12 3z"/><circle cx="12" cy="12.5" r="1"/>'
};
T.ICONS = I;

/* ─────────────────────────── tools ─────────────────────────── */
/* `moves`: what the tool does to the amount of $SAND on the beach.
   -1 takes it away (into your bag) · +1 puts it back · 0 leaves it alone and
   changes what the sand is *like*. Shown in the interface, because the
   difference between Water and Drip is exactly this and nothing else. */
T.TOOLS = [
  { id:'shovel', key:'1', name:'Shovel',   icon:I.shovel, mode:1, unlock:1, moves:-1,
    rad:1.5, str:0.62, short:'Digs. Fills your bag.',
    desc:'Lifts sand off the beach and into your bag — wetness and all. Dig damp sand and the bag stays damp. Digging is how you get material, and how you get a moat. Yes, you still have to work a little. It is a club, not a charity.' },
  { id:'pail',   key:'2', name:'Pail',     icon:I.pail,   mode:2, unlock:1, moves:1,
    rad:1.3, str:0.55, short:'Pours a heap from your bag.',
    desc:'Throws real sand, which falls and piles where it lands. It arrives as wet as the bag says it is — check the reading before you ape it onto the ground.' },
  { id:'pat',    key:'3', name:'Pat',      icon:I.pat,    mode:3, unlock:1, moves:0,
    rad:1.1, str:0.55, short:'Diamond hands. Packs it. Adds nothing.',
    desc:'Compaction. Packed sand holds a far steeper face and survives the red candles. The most under-used tool on any beach and the whole difference between a jubilado and a tourist.' },
  { id:'water',  key:'4', name:'Water',    icon:I.water,  mode:4, unlock:1, moves:0,
    rad:1.6, str:0.60, short:'Wets sand already there. Adds none.',
    desc:'Raises the moisture of the sand under the brush so the grains bridge and it can stand steeper. It does not build anything — for that, use the Pail or Drip. Think of it as liquidity.' },
  { id:'bucket', key:'5', name:'Mould',    icon:I.bucket, mode:10, unlock:1, moves:1,
    rad:1.0, str:1.0, short:'Hold to fill. Click to turn out.',
    desc:'Hold on damp sand to scoop the mould full, then aim and click to turn it out. What comes out is exactly as wet as what went in. Turn out a dry one and it collapses like a Tuesday launch.' },
  { id:'wall',   key:'6', name:'Rampart',  icon:I.wall,   mode:6, unlock:2, moves:1,
    rad:0.9, str:0.9, short:'Drag to raise a wall.',
    desc:'Raises a wall to the height you started at. A long packed berm on the seaward side is a seawall. A seawall is a stop-loss you can stand on.' },
  { id:'carve',  key:'7', name:'Carve',    icon:I.carve,  mode:5, unlock:3, moves:-1,
    rad:0.55, str:0.62, short:'Cuts down to where you first pressed.',
    desc:'A blade, not a scoop. Press on the level you want and drag: everything you cross comes down to that height, and the cut edge is packed hard so it stands instead of slumping back. Gateways, stairs, a chiringuito terrace. Damp sand takes a crisp edge; dry sand crumbles.' },
  { id:'level',  key:'8', name:'Level',    icon:I.level,  mode:8, unlock:3, moves:0,
    rad:1.8, str:0.6, short:'Flattens to where you first pressed.',
    desc:'Drives the ground toward the height under your first click. Courtyards, terraces, a flat footing for a tower, somewhere to put the sunbed.' },
  { id:'drip',   key:'9', name:'Drip',     icon:I.drip,   mode:7, unlock:4, moves:1,
    rad:0.34, str:0.75, short:'Dribbles very wet sand into spires.',
    desc:'Takes sand from your bag, adds a splash on the way out, and lets it fall a blob at a time. Grows the knobbled gothic spires only a beach can make — Gaudí with a hangover. A dry bag makes a poor spire. Unlike Water, this one builds.' },
  { id:'adorn',  key:'0', name:'Adorn',    icon:I.adorn,  mode:0, unlock:5, moves:0,
    rad:0.5, str:1, short:'Sets a toy down.',
    desc:'Sombrillas, boats, bottles. They lean as the sand moves under them, and go over when the water reaches them. Cosmetic. Like most of crypto.' }
];

T.ADORN = [
  { id:'flag',     name:'Pennant',      icon:I.flagI,     scale:1.0 },
  { id:'parasol',  name:'Sombrilla',    icon:I.parasolI,  scale:1.0 },
  { id:'pinwheel', name:'Pinwheel',     icon:I.pinwheelI, scale:1.0 },
  { id:'lantern',  name:'Farolillo',    icon:I.lampI,     scale:1.0 },
  { id:'pail',     name:'Bucket & spade', icon:I.pailI,   scale:1.0 },
  { id:'boat',     name:'The yacht',    icon:I.boatI,     scale:1.0 },
  { id:'shell',    name:'Scallop',      icon:I.shellI,    scale:1.0 },
  { id:'star',     name:'Starfish',     icon:I.starI,     scale:1.0 },
  { id:'wood',     name:'Driftwood',    icon:I.woodI,     scale:1.0 },
  { id:'kelp',     name:'Kelp',         icon:I.kelpI,     scale:1.0 },
  { id:'bottle',   name:'Empty caña',   icon:I.bottleI,   scale:1.0 },
  { id:'cairn',    name:'Cairn',        icon:I.cairnI,    scale:1.0 }
];

/* ─────────────────────────── the moulds ───────────────────────────
   The plastic shapes in the bottom of the beach bag. `id` indexes
   mouldShape() in glsl.js — keep the two in step.                   */
T.MOULDS = [
  { id:0, name:'Round turret', icon:I.mTurret,  rad:0.95, h:1.55, detail:9,  wet:0.55 },
  { id:1, name:'Square keep',  icon:I.mKeep,    rad:1.05, h:1.35, detail:0,  wet:0.55 },
  { id:2, name:'Gatehouse',    icon:I.mGate,    rad:1.30, h:1.25, detail:0,  wet:0.58 },
  { id:3, name:'Star fort',    icon:I.mStar,    rad:1.35, h:0.95, detail:0,  wet:0.55 },
  { id:4, name:'Ziggurat',     icon:I.mZig,     rad:1.25, h:1.25, detail:0,  wet:0.50 },
  { id:5, name:'Spire',        icon:I.mSpire,   rad:0.70, h:2.10, detail:0,  wet:0.68 },
  { id:6, name:'Scallop',      icon:I.mScallop, rad:0.95, h:0.50, detail:0,  wet:0.42 },
  { id:7, name:'Fish',         icon:I.mFish,    rad:1.20, h:0.46, detail:0,  wet:0.42 },
  { id:8, name:'Crab',         icon:I.mCrab,    rad:1.20, h:0.42, detail:0,  wet:0.45 },
  { id:9, name:'Starfish',     icon:I.mStarfish,rad:1.20, h:0.34, detail:0,  wet:0.38 }
];

/* ─────────────────────────── the nine siestas ───────────────────────────
   The campaign. Nine tides across one long European afternoon, from the
   14:00 lunch to the last drink on the terrace. Your score is PENSIÓN:
   sand you left standing above the high-water line, weighted by how well
   you packed it. Loose sand is paper hands and counts for nothing.       */
function O(text, fn) { return { text, check: fn }; }

T.TIDES = [
  { n:1, name:'The Long Lunch',
    verse:'“The first tide only wants to know you turned up. Build something small and honest before the second course. It will take a corner anyway; that is how it says buenas.”',
    low:-0.34, high:0.30, build:170, flood:62, amp:0.55, sun:[62,205], cloud:0.55,
    objs:[
      O('Leave 320 of Pensión standing', s => s.worth >= 320),
      O('Keep three quarters of it through the flood', s => s.kept >= 0.75)
    ] },
  { n:2, name:'Siesta',
    verse:'“Everyone else is answering emails. You are asleep under a sombrilla with a mould full of damp sand. Turn out a dry tower and the beach will show you what it thinks of your work ethic.”',
    low:-0.32, high:0.44, build:170, flood:66, amp:0.68, sun:[52,176], cloud:0.6,
    objs:[
      O('Stand something 1.4 m above the high-water line', s => s.peakAbove >= 1.4),
      O('Leave 520 of Pensión standing', s => s.worth >= 520),
      O('Keep seven tenths through the flood', s => s.kept >= 0.70)
    ] },
  { n:3, name:'Dig the Moat',
    verse:'“Every ditch is also a bank. The spoil has to go somewhere, and where you put it is the whole of the craft. Dig toward the sea; build away from it. Same as a portfolio.”',
    low:-0.30, high:0.56, build:180, flood:72, amp:0.80, sun:[43,150], cloud:0.7,
    objs:[
      O('Cut a moat the water actually fills', s => s.moatFilled),
      O('Leave 760 of Pensión standing', s => s.worth >= 760),
      O('Keep seven tenths through the flood', s => s.kept >= 0.70)
    ] },
  { n:4, name:'Diamond Hands',
    verse:'“There is a sound packed sand makes under the flat of your hand — a dull, close sound, like a door shutting on a margin call. Pat until you hear it everywhere. This is the tide that separates jubilados from tourists.”',
    low:-0.28, high:0.66, build:180, flood:78, amp:0.94, sun:[33,127], cloud:0.75,
    objs:[
      O('Have 45 m³ of properly packed sand', s => s.packed >= 45),
      O('Leave 1000 of Pensión standing', s => s.worth >= 1000),
      O('Keep two thirds through the flood', s => s.kept >= 0.66)
    ] },
  { n:5, name:'Golden Visa',
    verse:'“At the fifth tide the sun comes down onto the water and the whole coast turns the colour of a struck euro. Do not stop to post about it. New York opens in twenty minutes and it is bringing water.”',
    low:-0.26, high:0.76, build:185, flood:84, amp:1.08, sun:[23,108], cloud:0.85,
    objs:[
      O('Stand something 1.9 m above the high-water line', s => s.peakAbove >= 1.9),
      O('Leave 1350 of Pensión standing', s => s.worth >= 1350),
      O('Keep two thirds through the flood', s => s.kept >= 0.66)
    ] },
  { n:6, name:'Farolillos',
    verse:'“The club lit lanterns along its sea wall every evening for four hundred summers. On the last evening they lit them too. That is the part the chart cannot take back.”',
    low:-0.24, high:0.86, build:190, flood:90, amp:1.22, sun:[13,94], cloud:0.8,
    objs:[
      O('Set six adornments and keep four upright', s => s.propsAlive >= 4),
      O('Leave 1700 of Pensión standing', s => s.worth >= 1700),
      O('Keep three fifths through the flood', s => s.kept >= 0.60)
    ] },
  { n:7, name:'The American Open',
    verse:'“15:30 in Madrid. The sets come in threes and the third one is a liar. Build for the third one. Build for the fourth, too; there is always someone in Connecticut with leverage.”',
    low:-0.22, high:0.95, build:195, flood:96, amp:1.48, sun:[5,84], cloud:1.0,
    objs:[
      O('Leave 1900 of Pensión standing', s => s.worth >= 1900),
      O('Have 85 m³ of packed sand', s => s.packed >= 85),
      O('Keep three fifths through the flood', s => s.kept >= 0.60)
    ] },
  { n:8, name:'Sobremesa',
    verse:'“You will notice, around the eighth tide, that you have stopped thinking of it as sand. Good. It stopped thinking of you as exit liquidity some time ago.”',
    low:-0.20, high:1.04, build:200, flood:104, amp:1.66, sun:[-4,76], cloud:0.9,
    objs:[
      O('Leave 2300 of Pensión standing', s => s.worth >= 2300),
      O('Stand something 2.4 m above the high-water line', s => s.peakAbove >= 2.4),
      O('Keep over half through the flood', s => s.kept >= 0.55)
    ] },
  { n:9, name:'Jubilación',
    verse:'“Nine is the tide that comes in the dark, and it comes all the way. Whatever is left standing when the water turns is not yours any more and never was. It belongs to the club. Hold the shape. Hold the bag.”',
    low:-0.18, high:1.14, build:215, flood:120, amp:1.85, sun:[-13,68], cloud:0.7,
    objs:[
      O('Leave 2700 of Pensión standing', s => s.worth >= 2700),
      O('Keep half of it through the dark water', s => s.kept >= 0.50),
      O('Still have a farolillo upright at the end', s => s.lanternAlive)
    ] }
];

/* ─────────────────────────── $SAND beach ───────────────────────────
   One tide with no clock. Where the water sits between `low` and `high`
   is decided by the $SAND chart on pons, not by a timer — see pons.js
   and Game.tick(). The numbers are the seventh tide's: weather, but
   survivable if you packed.                                              */
T.CURVE_TIDE = {
  n: 0, name: '$SAND Beach', verse: '', low: -0.30, high: 0.95, build: 1e9, flood: 1e9,
  amp: 1.40, sun: [30, 140], cloud: 0.6, objs: []
};

/* ─────────────────────────── codex ─────────────────────────── */
T.CODEX = [
  { id:'c1', tide:1, title:'On the club',
    src:'The Jubilado’s Primer, opening',
    body:[
      'Somewhere around 2024 a generation looked at the forty-year plan — the standing desk, the 401k, the 6 a.m. cold plunge — and said no. They took the severance, the airdrop, or the one good trade, and they went to the coast. They retired at thirty with nothing but a bag and a sombrilla. They called it euromaxxing. The rest of the internet called it a phase.',
      'The Jubilados Club is what they built with the afternoons. It is a beach. Every member gets the same sand, the same sea, and the same rule: whatever you leave standing when the tide comes in is your pensión. Whatever you didn’t pack, the water keeps.',
      'It did not end in a crash. It never ends. The tide is the chart, and the chart is other people, and other people are always selling.'
    ] },
  { id:'c2', tide:2, title:'Why the mould must be wet',
    src:'The Jubilado’s Primer, second lesson',
    body:[
      'Take dry sand between finger and thumb and it will not hold. Add a little water and it becomes, briefly, a solid — not because the water glues it, but because each drop pulls at the grains around it and every grain is being squeezed toward its neighbours by a thousand tiny meniscuses.',
      'Add more water and the drops touch each other and stop pulling. The squeeze goes. The sand runs. This is also what happens to a chart with too much liquidity and no conviction.',
      'So: damp, not soaked. There is no way to learn where that line is except by crossing it, which you will, repeatedly, and then one day not.'
    ] },
  { id:'c3', tide:3, title:'The purpose of a moat',
    src:'Field notes, terrace of the chiringuito',
    body:[
      'A moat does not stop water. Nothing stops water. A moat spends it.',
      'A wave arriving at a wall gives that wall all its energy at once. A wave arriving at a ditch first has to fill the ditch, and filling a ditch is work, and the work comes out of the wave. What reaches your wall afterward is slower, thinner and much stupider. Like a dump that has already eaten three bids.',
      'The corollary that catches everyone: a moat that drains inland is a delivery service. Cut your outlets seaward.'
    ] },
  { id:'c4', tide:4, title:'On the angle of repose',
    src:'The Jubilado’s Primer, third lesson',
    body:[
      'Pour dry sand onto a table. It makes a cone. Pour more and it makes a bigger cone with exactly the same sides. You cannot make it steeper. That angle — about thirty-three degrees in this sand — is not a suggestion. It is the sand telling you the only shape it can be.',
      'Everything you build here is an argument with that angle. Water is one argument. The flat of your hand is another. The sea is the rebuttal. Leverage is not an argument; it is a confession.'
    ] },
  { id:'c5', tide:5, title:'The colour of the fifth evening',
    src:'Marginalia, unsigned',
    body:[
      'They say that on the fifth tide the light comes in flat off the water and for about eleven minutes every wet surface on the beach behaves like a mirror, and for those eleven minutes you can see every green candle you ever sold too early reflected in the sand.',
      'I have watched for it nine times. I have never seen candles. I have seen a great deal of extremely good light, which is, I have come to think, the same claim made honestly.'
    ] },
  { id:'c6', tide:6, title:'The lamplighters',
    src:'Club ledger (fragment)',
    body:[
      'Item: to the lamplighters of the sea wall, for oil, for the quarter — paid.',
      'Item: for the replacement of eleven farolillos lost to weather — paid.',
      'Item: for the same, on the night of the big dump — the entry is finished, in a different hand, with the word *paid*.',
      'It is the only kindness in the whole ledger and someone went back for it.'
    ] },
  { id:'c7', tide:7, title:'Reading a set',
    src:'Field notes, 15:30 CET',
    body:[
      'Waves do not arrive evenly. They arrive in sets, and within a set they grow, and the last one of a set is the one that finds the base of your wall.',
      'You can hear it coming about four seconds before it arrives, because the water in front of it goes quiet — it is being pulled backward into the face of the thing. If the shore hisses and then stops hissing, stop patting and start watching. If the order book goes quiet at the open, same.'
    ] },
  { id:'c8', tide:8, title:'Undermining',
    src:'The Jubilado’s Primer, last lesson',
    body:[
      'Nothing here is knocked down. Everything here falls down.',
      'The sea does not hit your tower; it takes away a handful at the bottom of your tower, and then the tower is standing on a slope steeper than sand can be, and then it is not standing. Nobody rugs a project from the top.',
      'Which is to say: defend the feet. The top of a sandcastle has never once been the problem.'
    ] },
  { id:'c9', tide:9, title:'What the ninth tide is for',
    src:'The Jubilado’s Primer, closing',
    body:[
      'You will be told that a jubilado works to preserve something. That is a misunderstanding, and a comfortable one.',
      'Nothing you make here survives. Nine tides is not a long time and the ninth is not the last one; there is a tenth, and it is tomorrow, and it opens at 15:30.',
      'What a jubilado preserves is the *shape* — the fact that this arrangement of grains was possible, was chosen, was made by somebody on purpose on an ordinary afternoon while everyone else was in a stand-up. The sea can have the sand. It has never once managed to take the fact.',
      'Hold the shape. Then let go of it. Then order another caña and do it again.'
    ] },
  { id:'cx1', tide:0, hidden:true, title:'On spires',
    src:'Unlocked: you built a drip spire above two metres',
    body:[
      'The dripped spire is the only part of this craft that is not architecture. You cannot plan one. You hold very wet sand above a point and you let go of it a little at a time and what accumulates is a tower designed entirely by surface tension and gravity, with you as a delivery mechanism.',
      'It is also, structurally, absurd — a stack of blobs held together by water that is actively leaving. Which is why the good ones are always finished in a hurry and always slightly wrong, and why nobody has ever built the same one twice. Every memecoin is a drip spire.'
    ] },
  { id:'cx3', tide:0, hidden:true, title:'On $SAND',
    src:'Unlocked: you built on the $SAND chart',
    body:[
      'The club has a token now. It was launched on a curve: the first buyers pay almost nothing and each one after them pays a little more, and the whole of it is written down on a chain that does not forget and does not care.',
      'The water on this beach is not the moon’s. It is everyone who has ever sold. When $SAND stands at its recent high the sea is out and the beach is yours; when it falls the water comes up the shore by the same fraction, and it takes — as it always takes — the loose sand first, and the feet before the towers.',
      'When enough has been raised the launch graduates: the pool is locked and cannot be pulled. The old members call this slack water. It is the only kind that lasts, and it is the only kind you have to earn.'
    ] },
  { id:'cx2', tide:0, hidden:true, title:'On the bag',
    src:'Unlocked: you emptied your bag',
    body:[
      'There is no sand in this bay that you did not take from somewhere else in this bay.',
      'Beginners dig a borrow pit behind the castle, where it is convenient, and are then surprised when the sea comes up the pit like a stair and takes the castle from behind. This is also how most people lose a bag.',
      'Dig where you want a hole. There is always somewhere you want a hole.'
    ] }
];

/* ─────────────────────────── the looks ─────────────────────────── */
T.LOOKS = [
  { id:0, name:'Costa',         note:'the beach as it is' },
  { id:1, name:'Chiringuito',   note:'painted, inked, cosy' },
  { id:2, name:'Visit Spain',   note:'screen-printed poster' },
  { id:3, name:'Catastro',      note:'a survey chart of the sand' },
  { id:4, name:'Abuela’s Sofa', note:'a craft-fair diorama' },
  { id:5, name:'Cala',          note:'a foot under clear water' },
  { id:6, name:'Vespa',         note:'enamel on pressed tin' },
  { id:7, name:'Azulejo',       note:'woodblock, ragged key' },
  { id:8, name:'Benidorm, January', note:'the beach out of season' }
];

/* ─────────────────────────── the day ───────────────────────────
   A beach that faces west: the sun comes up behind the dunes and goes down
   over the water, which is the entire reason anyone retires here.        */
const DAWN = 0.235, DUSK = 0.795;
T.sunFromDay = function (t) {
  const p = (t - DAWN) / (DUSK - DAWN);
  return [66 * Math.sin(Math.PI * p), 272 - 182 * p];
};
T.dayClock = function (t) {
  const m = Math.floor(((t % 1) + 1) % 1 * 1440);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
T.dayPhase = function (t) {
  const e = T.sunFromDay(t)[0];
  const rising = t < 0.515;
  if (e < -8) return 'deep night';
  if (e < 0)  return rising ? 'first light' : 'dusk';
  if (e < 8)  return rising ? 'sunrise' : 'sunset';
  if (e < 20) return rising ? 'early light' : 'golden hour';
  if (e < 42) return rising ? 'morning' : 'sobremesa';
  if (e < 60) return rising ? 'late morning' : 'siesta';
  return 'lunch';
};
T.DAY_SPEEDS = [
  { name: 'held',  s: 0 },
  { name: 'slow',  s: 1 / 1500 },
  { name: 'gentle',s: 1 / 720 },
  { name: 'brisk', s: 1 / 300 }
];

/* ─────────────────────────── grading ─────────────────────────── */
T.grade = function (s) {
  let pts = 0;
  pts += Math.min(s.worth / Math.max(s.target, 1), 1.6) * 55;
  pts += Math.min(s.kept, 1) * 32;
  pts += s.objsDone / Math.max(s.objsTotal, 1) * 13;
  if (pts >= 96) return { g: 'S', line: 'The shape held. All of it. Retired.' };
  if (pts >= 84) return { g: 'A', line: 'The water went back out and found nothing to say. Jubilado.' };
  if (pts >= 68) return { g: 'B', line: 'It took a corner. It always takes a corner. Still up.' };
  if (pts >= 50) return { g: 'C', line: 'Standing, mostly. The feet went first. Paper feet.' };
  if (pts >= 30) return { g: 'D', line: 'The sea has opinions about your foundations. So does the chart.' };
  return { g: 'E', line: 'It is all still here. It is just flat now. ngmi.' };
};

})(TW);
