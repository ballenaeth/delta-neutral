/* ============================================================================
   JUBILADOS CLUB — game.js
   Camera, input, the tide state machine, scoring, the interface, and the frame.
   ========================================================================== */
'use strict';

(function (T) {

const $ = s => document.querySelector(s);
const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
const DEG = T.DEG;
const SCORE_SCALE = 14;
const PAIL_START = 6.0;
const PAIL_SHOW = 22.0;
const SIM_HZ = 120;

/* ═══════════════════════════ camera ═══════════════════════════ */
class Camera {
  constructor() {
    this.target = T.V3.create(0, 0.75, -6);
    this.tgt    = T.V3.create(0, 0.75, -6);
    this.dist = 20; this.distT = 20;
    this.yaw = -Math.PI / 2; this.yawT = -Math.PI / 2;
    this.pitch = 0.44; this.pitchT = 0.44;
    this.fov = 52 * DEG;
    this.pos = T.V3.create();
    this.view = T.M4.create(); this.proj = T.M4.create();
    this.vp = T.M4.create(); this.invVP = T.M4.create();
    this.up = T.V3.create(0, 1, 0);
    this.near = 0.08; this.far = 3000;
    this.free = false;
  }
  update(dt, aspect) {
    const k = 16;
    this.dist = T.damp(this.dist, this.distT, k, dt);
    this.yaw = T.damp(this.yaw, this.yawT, k, dt);
    this.pitch = T.damp(this.pitch, this.pitchT, k, dt);
    for (let i = 0; i < 3; i++) this.target[i] = T.damp(this.target[i], this.tgt[i], k, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.pos[0] = this.target[0] + cp * Math.cos(this.yaw) * this.dist;
    this.pos[1] = this.target[1] + sp * this.dist;
    this.pos[2] = this.target[2] + cp * Math.sin(this.yaw) * this.dist;
    /* keep the eye above the shore. A coarse analytic copy of the beach
       profile is enough — it only has to stop the camera burrowing. */
    const g = Camera.groundGuess(this.pos[0], this.pos[2]);
    if (this.pos[1] < g + 0.75) this.pos[1] = g + 0.75;
    T.M4.lookAt(this.view, this.pos, this.target, this.up);
    T.M4.perspective(this.proj, this.fov, aspect, this.near, this.far);
    T.M4.mul(this.vp, this.proj, this.view);
    T.M4.invert(this.invVP, this.vp);
  }
  /* mirrors bedrock() + sandBed() in glsl.js, minus the noise and the rocks */
  static groundGuess(x, z) {
    let y = 1.55 - 0.0705 * (z + 24);
    y += 3.35 * T.smoothstep(-21.5, -31.0, z);
    const pad = T.smoothstep(23, 15, Math.hypot(x, (z + 7) * 0.92));
    y += -0.98 * pad + 0.30 + 1.30 * pad;
    const rock = (cx, cz, r, h) => {
      const q = Math.hypot((x - cx) / r, (z - cz) / (r * 0.78));
      const k = 1 - q * q;
      return k > 0 ? h * Math.pow(k, 0.62) : 0;
    };
    y += rock(-22.6, 7.5, 5.4, 3.10) + rock(23.8, -1.5, 4.8, 2.70)
       + rock(-19.6, -19.5, 6.2, 1.55) + rock(18.2, -21.0, 5.2, 1.95)
       + rock(26.0, 11.0, 3.2, 2.10);
    return y;
  }

  ray(ndcX, ndcY, o, d) {
    const a = [0, 0, 0], b = [0, 0, 0];
    T.M4.transformPoint(a, this.invVP, [ndcX, ndcY, -1]);
    T.M4.transformPoint(b, this.invVP, [ndcX, ndcY, 1]);
    T.V3.copy(o, this.pos);
    d[0] = b[0] - a[0]; d[1] = b[1] - a[1]; d[2] = b[2] - a[2];
    T.V3.norm(d, d);
  }
}

/* ═══════════════════════════ the game ═══════════════════════════ */
class Game {
  constructor() {
    this.canvas = $('#gl');
    const opts = { antialias: false, alpha: false, depth: true, stencil: false,
                   powerPreference: 'high-performance', preserveDrawingBuffer: false };
    const gl = this.gl = this.canvas.getContext('webgl2', opts);
    if (!gl) { this.fatal('This browser did not give us a WebGL2 context.'); return; }
    if (!gl.getExtension('EXT_color_buffer_float')) {
      this.fatal('EXT_color_buffer_float is missing — the simulation needs float render targets.');
      return;
    }
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('EXT_float_blend');

    this.dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = this.dbg ? gl.getParameter(this.dbg.UNMASKED_RENDERER_WEBGL) : 'GPU';

    this.settings = Object.assign({
      quality: 'high', scale: 100, fov: 52, bloom: 60, grain: 35,
      glint: true, shadow: true, shafts: true, invY: false, vol: 70, mus: 55,
      look: 0
    }, T.store.get('tw.settings', {}));
    this.save = Object.assign({ tide: 1, best: 0, codex: [], totals: 0 }, T.store.get('tw.save', {}));

    this.cam = new Camera();
    this.time = 0;
    this.state = 'menu';
    this.mode = 'novena';
    this.tideIdx = 0;
    this.phase = 'ebb';
    this.phaseT = 0;
    this.paused = false;
    this.hudHidden = false;
    this.photo = false;
    this.acc = 0;
    this.frame = 0;
    this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;

    this.seaBase = -0.34;
    this.seaTarget = -0.34;
    this.waveAmp = 0.55;
    this.erodeK = 0.3;
    this.wind = 0.4;
    this.windVec = new Float32Array([0.4, 0, -0.9]);
    this.exposure = -1;
    this.sunScreen = new Float32Array([0.5, 0.5]);

    this.tool = T.TOOLS[0];
    this.radius = 1.5;
    this.strength = 0.6;
    this.towerH = 1.5;
    this.merlons = 9;
    this.adornIdx = 0;
    /* the mould: scoop it full, then turn it out */
    this.mould = { idx: 0, fill: 0, wet: 0, rot: 0 };
    /* the day, for Slack Water */
    this.dayT = 0.335;
    this.daySpeed = 2;
    this.dayOn = false;
    this.toolDown = false;
    this.anchorY = 0;
    this.prevHit = [0, 0];
    this.strokeVol = 0;

    this.pail = PAIL_START;
    this.pailWet = 0.42;        // the pail remembers how wet its sand was
    this.inFlight = 0;          // sand thrown but not yet landed
    this.screenUnder = null;    // the screen an overlay is covering
    this.worthBase = 0;
    this.worthPeak = 0;
    this.flags = {};

    this.audio = new T.Audio();
    this.initGL();
    this.initUI();
    this.initInput();
    this.applySettings();

    this.lastT = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  fatal(msg) {
    $('#loading').classList.add('hidden');
    $('#fatal').classList.remove('hidden');
    $('#fatalMsg').textContent = msg;
    console.error(msg);
  }

  /* ─────────────────────── gl systems ─────────────────────── */
  qualityCfg() {
    switch (this.settings.quality) {
      case 'low':   return { sim: 256, water: 224, shadow: 1024, grid: 256, ss: 0.85 };
      case 'med':   return { sim: 384, water: 288, shadow: 1536, grid: 384, ss: 1.0 };
      case 'ultra': return { sim: 640, water: 448, shadow: 2560, grid: 640, ss: 1.35 };
      default:      return { sim: 512, water: 352, shadow: 2048, grid: 512, ss: 1.0 };
    }
  }

  initGL() {
    const gl = this.gl;
    const q = this.qualityCfg();
    this.cfg = q;
    this.progress(10, 'shaping the bedrock');
    this.sky = new T.Sky(gl);
    this.sky.setSun(16, 104);
    this.sky.cloud = T.TIDES[0].cloud;
    this.progress(25, 'sorting the grains');
    this.sim = new T.Sim(gl, q.sim);
    this.progress(45, 'displacing the sand');
    this.terrain = new T.Terrain(gl, this.sim, q.grid, Math.min(256, q.grid));
    this.progress(60, 'filling the bay');
    this.water = new T.Water(gl, this.sim, q.water);
    this.progress(72, 'whittling driftwood');
    this.props = new T.Props(gl, this.sim);
    this.progress(82, 'throwing sand in the air');
    this.particles = new T.Particles(gl, this.sim);
    this.progress(90, 'grading the light');
    this.post = new T.Post(gl);

    this.shadowRes = q.shadow;
    this.shadow = new T.FBO(gl, q.shadow, q.shadow, { color: 0, depth: true, depthTex: true, compare: true });
    this.lightVP = T.M4.create();
    this.lightView = T.M4.create();
    this.lightProj = T.M4.create();

    this.emptyVAO = gl.createVertexArray();
    gl.bindVertexArray(this.emptyVAO);

    this.env = {
      cam: this.cam, sky: this.sky, time: 0, seaBase: -0.34, waveAmp: 0.55,
      erodeK: 0.3, sunDry: 1, fogK: 0.0011, glint: true, wind: 0.4,
      windVec: this.windVec, lightVP: this.lightVP, shadowTex: this.shadow.depth,
      shadowRes: q.shadow, shadowOn: true
    };
    this.progress(100, 'the water is out');
    this.resize();
    this.sim.reset(this.seaBase);
    for (let i = 0; i < 24; i++) this.sim.step(this.env, 1 / 60);
    this.sim.updateAO();
  }

  progress(p, msg) {
    const f = $('#loadFill'), m = $('#loadMsg');
    if (f) f.style.width = p + '%';
    if (m) m.textContent = msg;
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = (this.settings.scale / 100) * this.cfg.ss;
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const w = Math.max(320, Math.round(cw * dpr * s));
    const h = Math.max(240, Math.round(ch * dpr * s));
    this.outW = Math.round(cw * dpr); this.outH = Math.round(ch * dpr);
    this.canvas.width = this.outW; this.canvas.height = this.outH;
    if (this.rw === w && this.rh === h) return;
    this.rw = w; this.rh = h;
    if (this.hdr) { this.hdr.dispose(); this.copy.dispose(); }
    const o = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR };
    this.hdr = new T.FBO(gl, w, h, Object.assign({ depth: true, depthTex: true }, o));
    this.copy = new T.FBO(gl, w, h, o);
    this.post.resize(w, h);
  }

  /* ─────────────────────── interface ─────────────────────── */
  initUI() {
    const self = this;
    /* every full-bleed card, looked up once — overlayOpen() asks every frame */
    this.screens = $$('.screen');

    /* palette */
    const pal = $('#palette');
    pal.innerHTML = '';
    T.TOOLS.forEach(t => {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.id = t.id;
      const moves = t.moves > 0 ? '<i class="mv adds"></i>' : (t.moves < 0 ? '<i class="mv takes"></i>' : '');
      b.innerHTML = '<svg viewBox="0 0 24 24">' + t.icon + '</svg>' + moves +
        '<span class="k">' + t.key + '</span>' +
        '<span class="tip"><b>' + t.name + '</b>' + (t.short ? '<em>' + t.short + '</em>' : '') + '</span>';
      b.onclick = () => self.pickTool(t.id);
      pal.appendChild(b);
    });

    /* adornments */
    const ag = $('#adornGrid');
    ag.innerHTML = '';
    T.ADORN.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'adorn' + (i === 0 ? ' on' : '');
      b.title = a.name;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + a.icon + '</svg>';
      b.onclick = () => { self.adornIdx = i; self.refreshAdorn(); self.audio.ui(true); };
      ag.appendChild(b);
    });

    /* the mould rack */
    const mg = $('#mouldGrid');
    mg.innerHTML = '';
    T.MOULDS.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'adorn' + (i === 0 ? ' on' : '');
      b.title = m.name;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
      b.onclick = () => self.pickMould(i);
      mg.appendChild(b);
    });

    /* the day */
    const ds = $('#daySpeeds');
    ds.innerHTML = '';
    T.DAY_SPEEDS.forEach((s, i) => {
      const b = document.createElement('button');
      b.textContent = s.name;
      b.className = i === self.daySpeed ? 'on' : '';
      b.onclick = () => {
        self.daySpeed = i; self.audio.ui(true);
        $$('#daySpeeds button').forEach((x, k) => x.classList.toggle('on', k === i));
      };
      ds.appendChild(b);
    });
    $('#dayScrub').oninput = e => {
      self.dayT = +e.target.value / 1000;
      self.daySpeed = 0;
      $$('#daySpeeds button').forEach((x, k) => x.classList.toggle('on', k === 0));
    };

    /* menu */
    $$('#menu [data-act]').forEach(b => {
      b.onclick = () => {
        self.audio.start(); self.audio.ui(true);
        const a = b.dataset.act;
        if (a === 'novena') self.startRun(1);
        else if (a === 'continue') self.startRun(self.save.tide);
        else if (a === 'free') self.startSandbox();
        else if (a === 'creative') self.startCreative();
        else if (a === 'curve') self.openCurvePick();
        else if (a === 'codex') self.openCodex();
        else if (a === 'settings') self.openOver('#settings');
        else if (a === 'howto') self.openOver('#howto');
      };
    });
    $$('[data-close]').forEach(b => b.onclick = () => {
      self.audio.ui(false);
      self.closeOver('#' + b.closest('.screen').id);
    });

    $('#bGo').onclick = () => { self.audio.ui(true); self.beginBuild(); };
    $('#sNext').onclick = () => { self.audio.ui(true); self.nextTide(); };
    $('#sRetry').onclick = () => { self.audio.ui(true); self.startRun(this.tideIdx + 1); };
    $('#sMenu').onclick = () => { self.audio.ui(false); self.toMenu(); };
    $('#pResume').onclick = () => self.setPaused(false);
    $('#pQuit').onclick = () => { self.setPaused(false); self.toMenu(); };
    $('#pSettings').onclick = () => self.openOver('#settings');
    $('#pCodex').onclick = () => self.openCodex();
    $('#pSave').onclick = () => self.saveCastle();
    $('#pLoad').onclick = () => self.loadCastle();
    $('#setWipe').onclick = () => {
      if (confirm('Rug yourself? All progress and saved castles go. The bag stays on-chain, obviously.')) {
        T.store.del('tw.save'); T.store.del('tw.castle'); T.store.del('tw.taught');
        self.save = { tide: 1, best: 0, codex: [], totals: 0 };
        self.toast('The club has forgotten you. Welcome back, tourist.', 'bad');
      }
    };
    $('#pExit').onclick = () => self.setPhoto(false);
    $('#pShot').onclick = () => { self.wantShot = true; };
    $('#optFold').onclick = () => self.foldOpts();

    /* sliders */
    const bind = (id, cb, fmt) => {
      const el = $(id);
      if (!el) return;
      const run = () => { cb(parseFloat(el.value)); if (fmt) fmt(el.value); };
      el.oninput = run; run();
    };
    bind('#sRad', v => { this.radius = v / 100; }, v => $('#vRad').textContent = (v / 100).toFixed(2) + ' m');
    bind('#sStr', v => { this.strength = v / 100; }, v => $('#vStr').textContent = Math.round(v) + '%');
    bind('#sTh', v => { this.towerH = v / 100; }, v => $('#vTh').textContent = (v / 100).toFixed(2) + ' m');
    bind('#sCr', v => { this.merlons = v; }, v => $('#vCr').textContent = (+v === 0 ? 'none' : v));
    this.pickMould(0);

    const S = this.settings;
    $('#qQuality').value = S.quality;
    $('#qScale').value = S.scale; $('#qFov').value = S.fov;
    $('#qBloom').value = S.bloom; $('#qGrain').value = S.grain;
    $('#qGlint').checked = S.glint; $('#qShadow').checked = S.shadow;
    $('#qShafts').checked = S.shafts; $('#qInvY').checked = S.invY;
    $('#qVol').value = S.vol; $('#qMus').value = S.mus;
    const sset = () => {
      S.quality = $('#qQuality').value;
      S.scale = +$('#qScale').value; S.fov = +$('#qFov').value;
      S.bloom = +$('#qBloom').value; S.grain = +$('#qGrain').value;
      S.glint = $('#qGlint').checked; S.shadow = $('#qShadow').checked;
      S.shafts = $('#qShafts').checked; S.invY = $('#qInvY').checked;
      S.vol = +$('#qVol').value; S.mus = +$('#qMus').value;
      T.store.set('tw.settings', S);
      this.applySettings();
    };
    ['#qQuality','#qScale','#qFov','#qBloom','#qGrain','#qGlint','#qShadow','#qShafts','#qInvY','#qVol','#qMus']
      .forEach(id => { const e = $(id); if (e) e.oninput = e.onchange = sset; });

    const lp = $('#lookPick'); lp.innerHTML = '';
    T.LOOKS.forEach(L => {
      const b = document.createElement('button');
      b.dataset.look = L.id;
      b.innerHTML = '<b>' + L.name + '</b><em>' + L.note + '</em>';
      b.onclick = () => {
        S.look = L.id;
        T.store.set('tw.settings', S);
        this.applySettings();
        this.audio.ui(true);
        this.toast(L.name + ' — ' + L.note + '.', 'lore');
      };
      lp.appendChild(b);
    });

    /* photo sliders */
    ['#pSun','#pAz','#pExp','#pFoc','#pApt'].forEach(id => {
      const e = $(id); if (e) e.oninput = () => this.updatePhoto();
    });

    if (this.save.tide > 1) {
      $('#btnContinue').hidden = false;
      $('#continueSub').textContent = 'Tide ' + T.roman(this.save.tide) + ' — ' +
        (T.TIDES[this.save.tide - 1] ? T.TIDES[this.save.tide - 1].name : '');
    }
    $('#menuGpu').textContent = String(this.gpuName).slice(0, 46);
    this.foldOpts(!!T.store.get('tw.fold', false));
    this.pickTool('shovel');
  }

  applySettings() {
    const S = this.settings;
    $('#vScale').textContent = S.scale + '%';
    $('#vFov').textContent = S.fov + '°';
    $('#vBloom').textContent = S.bloom + '%';
    $('#vGrain').textContent = S.grain + '%';
    $('#vVol').textContent = S.vol + '%';
    $('#vMus').textContent = S.mus + '%';
    this.cam.fov = S.fov * DEG;
    this.env.glint = S.glint;
    this.env.style = T.clamp(S.look | 0, 0, T.LOOKS.length - 1);
    this.sky.style = this.env.style;
    this.sky._dirty = true;
    $$('.look-pick button').forEach(b => b.classList.toggle('on', +b.dataset.look === this.env.style));
    this.audio.setVolumes(S.vol / 100, S.mus / 100);
    const q = this.qualityCfg();
    if (this.cfg && q.sim !== this.cfg.sim && !this.pendingQuality) {
      this.toast('Reload the page to apply the new simulation resolution.', '');
      this.pendingQuality = true;
    }
    this.resize();
  }

  show(sel) { $(sel).classList.remove('hidden'); }
  hide(sel) { $(sel).classList.add('hidden'); }

  /* Settings, Codex and How-to can be opened from the menu or from the pause
     screen, and every .screen is the same full-bleed transparent layer at the
     same z — so revealing one on top of another simply draws both, and you get
     two menus printed over each other. Cover what was showing, and put it back
     on the way out. */
  openOver(sel) {
    /* never record the screen we are about to open as the one underneath it,
       or closing it would hide and immediately re-show the same card */
    const prev = $$('.screen').find(s => '#' + s.id !== sel && !s.classList.contains('hidden'));
    this.screenUnder = prev ? '#' + prev.id : null;
    if (prev) this.hide('#' + prev.id);
    this.show(sel);
  }
  closeOver(sel) {
    this.hide(sel);
    if (this.screenUnder) { this.show(this.screenUnder); this.screenUnder = null; }
  }

  /* three sentences, once, the first time anyone picks up a spade */
  firstRun() {
    if (T.store.get('tw.taught', false)) return;
    T.store.set('tw.taught', true);
    const lines = [
      ['Dig first. Every grain you build with comes out of a hole you made. No airdrops here.', 'lore'],
      ['Wet sand stands, dry sand slumps. The readout at your cursor tells you which you have.', ''],
      ['Hold the Mould on damp sand to fill it, then click where you want it. Pat it after. Diamond hands.', 'good']
    ];
    lines.forEach((l, i) => setTimeout(() => this.toast(l[0], l[1]), 1200 + i * 4200));
  }

  toast(msg, cls) {
    const t = document.createElement('div');
    t.className = 'toast ' + (cls || '');
    t.textContent = msg;
    $('#toast').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 420); }, 3200);
  }

  pickTool(id) {
    const t = T.TOOLS.find(x => x.id === id);
    if (!t) return;
    if (this.mode === 'novena' && t.unlock > this.tideIdx + 1) {
      this.toast(t.name + ' unlocks at tide ' + T.roman(t.unlock) + '. Patience, jubilado.', 'bad');
      return;
    }
    this.tool = t;
    if (t.id === 'bucket') { const m = this.mouldDef(); t.rad = m.rad; this.towerH = m.h; }
    this.radius = t.rad; this.strength = t.str;
    $('#sRad').value = Math.round(t.rad * 100);
    $('#sStr').value = Math.round(t.str * 100);
    $('#vRad').textContent = t.rad.toFixed(2) + ' m';
    $('#vStr').textContent = Math.round(t.str * 100) + '%';
    $('#optName').textContent = t.name;
    $('#optShort').textContent = t.short || '';
    $('#optDesc').textContent = t.desc;
    const tag = $('#optTag');
    tag.textContent = t.moves > 0 ? 'adds sand' : (t.moves < 0 ? 'takes sand' : 'no sand');
    tag.className = 'opt-tag ' + (t.moves > 0 ? 'adds' : (t.moves < 0 ? 'takes' : 'none'));
    const isMould = t.id === 'bucket', isAdorn = t.id === 'adorn';
    $('#stampOpts').style.display = isMould ? '' : 'none';
    $('#adornOpts').style.display = isAdorn ? '' : 'none';
    /* the depth and merlon sliders belong to the mould and nothing else */
    $$('#optsPanel .opt.tho').forEach(e => e.style.display = isMould ? '' : 'none');
    $('#sStr').parentElement.style.display = (isMould || isAdorn) ? 'none' : '';
    /* one explanation at a time: with a rack on screen the long note is noise */
    $('#optDesc').style.display = (isMould || isAdorn) ? 'none' : '';
    $$('#palette .tool').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (isAdorn) this.sizeForAdorn();
    this.audio.ui(true);
  }

  foldOpts(force) {
    const p = $('#optsPanel');
    const on = force === undefined ? !p.classList.contains('fold') : force;
    p.classList.toggle('fold', on);
    T.store.set('tw.fold', on);
    this.audio.ui(!on);
  }

  refreshAdorn() {
    $$('#adornGrid .adorn').forEach((b, i) => b.classList.toggle('on', i === this.adornIdx));
    if (this.tool && this.tool.id === 'adorn') this.sizeForAdorn();
  }

  /* For everything else the size slider is a brush radius; for the bag of
     things it is the object's own longest dimension, measured off the mesh —
     so 1.10 m of pennant really is a pennant 1.10 m tall. Picking a new one
     resets the slider to that object's true size. */
  sizeForAdorn() {
    const a = T.ADORN[this.adornIdx];
    this.radius = this.props.span(a.id);
    $('#sRad').value = Math.round(this.radius * 100);
    $('#vRad').textContent = this.radius.toFixed(2) + ' m';
  }

  /* what the pail actually has left to give — sand in the air has left it
     but has not reached the ground, so it belongs to neither yet */
  pailShown() {
    if (this.mode === 'creative') return Infinity;
    return Math.max(0, this.pail - this.inFlight);
  }

  mouldDef() { return T.MOULDS[T.clamp(this.mould.idx, 0, T.MOULDS.length - 1)]; }

  pickMould(i) {
    this.mould.idx = T.clamp(i, 0, T.MOULDS.length - 1);
    const m = this.mouldDef();
    $$('#mouldGrid .adorn').forEach((b, k) => b.classList.toggle('on', k === this.mould.idx));
    if (this.tool && this.tool.id === 'bucket') {
      this.radius = m.rad; this.towerH = m.h;
      $('#sRad').value = Math.round(m.rad * 100);
      $('#sTh').value = Math.round(m.h * 100);
      $('#vRad').textContent = m.rad.toFixed(2) + ' m';
      $('#vTh').textContent = m.h.toFixed(2) + ' m';
      $('#optDesc').textContent = this.tool.desc;
    }
    if (this.audio.ok) this.audio.ui(true);
  }

  /* how long a scoop takes — a big mould is a big scoop */
  mouldFillTime() {
    return 0.85 + this.radius * this.radius * this.towerH * 0.85;
  }

  refreshLocks() {
    const tn = this.mode !== 'novena' ? 99 : this.tideIdx + 1;
    $$('#palette .tool').forEach(b => {
      const t = T.TOOLS.find(x => x.id === b.dataset.id);
      b.classList.toggle('locked', t.unlock > tn);
    });
  }

  /* ─────────────────────── input ─────────────────────── */
  initInput() {
    const c = this.canvas, self = this;
    this.mouse = { x: 0, y: 0, ndc: [0, 0], down: 0 };
    this.keys = {};
    this.drag = null;

    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      self.audio.start();
      c.setPointerCapture(e.pointerId);
      self.updateMouse(e);
      if (e.button === 0 && !e.shiftKey && self.canBuild()) self.beginStroke();
      else self.drag = { mode: (e.button === 1 || e.altKey) ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
      document.body.classList.toggle('orbiting', !!self.drag);
    });
    window.addEventListener('pointermove', e => {
      self.updateMouse(e);
      if (!self.drag) return;
      const dx = e.clientX - self.drag.x, dy = e.clientY - self.drag.y;
      self.drag.x = e.clientX; self.drag.y = e.clientY;
      const cam = self.cam;
      if (self.drag.mode === 'orbit') {
        cam.yawT += dx * 0.0055;
        cam.pitchT += (self.settings.invY ? -1 : 1) * dy * 0.0042;
        cam.pitchT = T.clamp(cam.pitchT, 0.06, 1.45);
      } else {
        const s = cam.dist * 0.0016;
        const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
        cam.tgt[0] += (dx * sy - dy * cy * 0.6) * s;
        cam.tgt[2] += (-dx * cy - dy * sy * 0.6) * s;
      }
    });
    window.addEventListener('pointerup', () => {
      self.endStroke();
      self.drag = null;
      document.body.classList.remove('orbiting');
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.shiftKey) {
        self.radius = T.clamp(self.radius * (e.deltaY > 0 ? 0.92 : 1.087), 0.15, 4.5);
        $('#sRad').value = Math.round(self.radius * 100);
        $('#vRad').textContent = self.radius.toFixed(2) + ' m';
      } else {
        self.cam.distT = T.clamp(self.cam.distT * (e.deltaY > 0 ? 1.11 : 0.9), 2.5, 70);
      }
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      /* a card is up: it owns the keyboard. Escape still gets through, because
         Escape is how you close it. */
      if (self.overlayOpen() && e.key !== 'Escape') return;
      self.keys[e.code] = true;
      const k = e.key.toLowerCase();
      const tool = T.TOOLS.find(t => t.key === e.key);
      if (tool) { self.pickTool(tool.id); return; }
      if (k === 'z') { if (self.sim.undo()) { self.toast('Undone.', ''); self.audio.ui(false); } }
      else if (k === '[') { self.radius = T.clamp(self.radius * 0.85, 0.15, 4.5); $('#sRad').value = Math.round(self.radius*100); $('#vRad').textContent = self.radius.toFixed(2)+' m'; }
      else if (k === ']') { self.radius = T.clamp(self.radius * 1.18, 0.15, 4.5); $('#sRad').value = Math.round(self.radius*100); $('#vRad').textContent = self.radius.toFixed(2)+' m'; }
      else if (k === ',' || k === '.') {
        const step = (e.shiftKey ? 5 : 15) * DEG * (k === ',' ? -1 : 1);
        if (self.tool.id === 'bucket') self.mould.rot += step;
        else self.adornRot = (self.adornRot || 0) + step;
      }
      else if (k === 'r' && self.state === 'play' && self.phase === 'ebb' && self.mode === 'novena') self.startFlood();
      else if (k === 'r' && self.state === 'play' && self.mode === 'curve' && !(self.rugT > 0)) {
        self.rugT = 30; self.toast('Rug rehearsal. Thirty seconds of high water — nothing on the chain moved. Yet.', 'bad');
      }
      else if (e.key === 'Tab') { e.preventDefault(); self.foldOpts(); }
      else if (k === 'p') self.setPhoto(!self.photo);
      else if (k === 'h') { self.hudHidden = !self.hudHidden; $('#hud').classList.toggle('dim', self.hudHidden); }
      else if (e.key === 'Escape') {
        if (!$('#settings').classList.contains('hidden')) { self.closeOver('#settings'); return; }
        if (!$('#codex').classList.contains('hidden')) { self.closeOver('#codex'); return; }
        if (!$('#howto').classList.contains('hidden')) { self.closeOver('#howto'); return; }
        if (!$('#trade').classList.contains('hidden')) { self.hide('#trade'); self.tradeOpen = false; return; }
        if (!$('#curvePick').classList.contains('hidden')) { self.closeOver('#curvePick'); return; }
        if (self.state === 'play') self.setPaused(!self.paused);
      }
    });
    window.addEventListener('keyup', e => { self.keys[e.code] = false; });
    window.addEventListener('resize', () => self.resize());
    window.addEventListener('blur', () => { self.keys = {}; self.endStroke(); self.drag = null; });
  }

  updateMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
    this.mouse.ndc[0] = (this.mouse.x / r.width) * 2 - 1;
    this.mouse.ndc[1] = 1 - (this.mouse.y / r.height) * 2;
  }

  /* Is one of the full-bleed cards up? While one is it owns the keyboard and
     nobody is working the beach. Without this the probe chip and the hint line
     keep drawing underneath the trade dialog and print straight through its
     glass, and a bare keypress behind it still switches tools or calls the
     tide — you could start a rug rehearsal in the middle of a sell. */
  overlayOpen() {
    const s = this.screens;
    for (let i = 0; i < s.length; i++) if (!s[i].classList.contains('hidden')) return true;
    return false;
  }

  canBuild() {
    return (this.state === 'play') && !this.paused && !this.photo && !this.overlayOpen();
  }

  beginStroke() {
    const h = this.sim.hit;
    if (!h.valid) return;
    this.sim.snapshot();
    this.toolDown = true;
    this.anchorY = h.y;
    this.prevHit[0] = h.x; this.prevHit[1] = h.z;
    const t = this.tool;
    if (t.id === 'bucket') {
      const M = this.mould, def = this.mouldDef();
      if (M.fill < 1) return;                       // keep holding — applyTool scoops
      if (this.pailShown() < 0.12) {
        this.toast('Bag empty. Dig somewhere. Or buy more $SAND.', 'bad');
        this.toolDown = false; return;
      }
      this.sim.setStamp(h.x, h.z, this.radius, this.towerH, this.merlons, h.y,
                        def.id, M.rot, M.wet);
      this.audio.stamp();
      this.particles.burst(0, h.x, h.y + 0.1, h.z, 30, 1.4, 0.9, 0.045, 1);
      this.particles.burst(3, h.x, h.y + 0.15, h.z, 9, 0.6, 1.5, 0.15, 0.5);
      this.flags.towers = (this.flags.towers || 0) + 1;
      if (M.wet < def.wet - 0.14)
        this.toast('Too dry to hold its shape. Wet the sand before you fill.', 'bad');
      else if (M.wet > 0.93)
        this.toast('That was soup. Too much liquidity, not enough conviction.', 'bad');
      M.fill = 0; M.wet = 0;
      this.toolDown = false;
      return;
    }
    if (t.id === 'adorn') {
      const a = T.ADORN[this.adornIdx];
      const rot = (this.adornRot || 0) + (Math.random() - 0.5) * 0.5;
      /* the slider is the size you asked for, in metres; the jitter is only
         enough to stop a row of them looking stamped */
      const s = this.radius / this.props.span(a.id) * (0.96 + Math.random() * 0.08);
      this.props.add(a.id, h.x, h.y, h.z, rot, a.scale * s);
      this.audio.place();
      this.flags.props = (this.flags.props || 0) + 1;
      this.toolDown = false;
      return;
    }
    if (t.id === 'shovel' && h.depth < 0.05) this.flags.hardpack = true;
  }

  endStroke() {
    if (!this.toolDown) return;
    this.toolDown = false;
    this.sim.clearBrush();
  }

  applyTool(dt) {
    const s = this.sim, h = s.hit, t = this.tool;

    /* ── scooping the mould full ── */
    if (t.mode === 10) {
      const M = this.mould;
      if (!this.toolDown || !h.valid || M.fill >= 1) { s.clearBrush(); return; }
      /* In Endless Sand the mould fills from the pail, not from the beach.
         Everywhere else it is a scoop: it takes what it needs out of the ground
         under it and leaves a hollow, which is the whole bargain. Here there is
         nothing to bargain with, so it just fills — and quickly. Wetting the
         ground first still helps, because the mould will take the damper of the
         two, which keeps the Water tool worth carrying. */
      const endless = this.mode === 'creative';
      if (endless) {
        s.clearBrush();
        const inc = dt / this.mouldFillTime() * 1.85;
        const src = Math.max(this.pailWet, h.valid ? h.m : 0);
        M.wet += (src - M.wet) * Math.min(1, inc * 4.0 + (M.fill < 0.02 ? 1 : 0));
        M.fill = Math.min(1, M.fill + inc);
        if (this.frame % 2 === 0) {
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = this.radius * (0.5 + Math.random() * 0.45);
            this.particles.spawn(0,
              h.x + Math.cos(a) * r, h.y + 0.30 + Math.random() * 0.22, h.z + Math.sin(a) * r,
              -Math.cos(a) * 0.22, -0.45 - Math.random() * 0.35, -Math.sin(a) * 0.22,
              0.5 + Math.random() * 0.25, 0.028 + Math.random() * 0.014, src, 0);
          }
          if (this.frame % 16 === 0) this.audio.dig();
        }
        if (M.fill >= 1) { this.audio.pat(); this.toolDown = false; }
        return;
      }
      s.setBrush(h.x, h.z, h.x, h.z, this.radius * 0.88, 0.85, 11, 0);
      const avail = T.sat(h.depth / 0.22);
      const inc = dt / this.mouldFillTime() * (0.22 + 0.78 * avail);
      M.wet += (h.m - M.wet) * Math.min(1, inc * 4.0 + (M.fill < 0.02 ? 1 : 0));
      M.fill = Math.min(1, M.fill + inc);
      /* sand lifting off the ground and over the rim of the mould */
      if (this.frame % 2 === 0 && h.depth > 0.02) {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = this.radius * (0.5 + Math.random() * 0.45);
          this.particles.spawn(0,
            h.x + Math.cos(a) * r, h.y + 0.05, h.z + Math.sin(a) * r,
            -Math.cos(a) * (0.5 + Math.random() * 0.6),
            1.3 + Math.random() * 1.1,
            -Math.sin(a) * (0.5 + Math.random() * 0.6),
            0.55 + Math.random() * 0.3, 0.028 + Math.random() * 0.014, h.m, 0);
        }
        if (this.frame % 16 === 0) this.audio.dig();
      }
      if (M.fill >= 1) { this.audio.pat(); this.toolDown = false; s.clearBrush(); }
      return;
    }

    /* ── pouring and dripping are real transport now: the tool throws sand
       into the air and the heightfield only changes when it lands ── */
    if (t.mode === 2 || t.mode === 7) {
      s.clearBrush();
      if (!this.toolDown || !h.valid) return;
      if (this.pailShown() <= 0.02) return;
      const drip = t.mode === 7;
      const fine0 = (this.keys.ShiftLeft || this.keys.ShiftRight) ? 0.35 : 1;
      const vol = (drip ? 0.20 : 1.75) * this.strength * fine0 * dt;
      const n = T.clamp(Math.round(vol / 0.014), 1, 5);
      const rr = this.radius * (drip ? 0.35 : 0.78);
      /* the grains carry the pail's own wetness, not the wetness of wherever
         you happen to be aiming. Dripping adds a splash on the way out. */
      const moist = drip ? Math.min(0.96, this.pailWet + 0.20) : this.pailWet;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * rr;
        this.particles.spawn(0,
          h.x + Math.cos(a) * r, h.y + (drip ? 0.30 : 0.44), h.z + Math.sin(a) * r,
          (Math.random() - 0.5) * (drip ? 0.10 : 0.30),
          -0.55 - Math.random() * 0.45,
          (Math.random() - 0.5) * (drip ? 0.10 : 0.30),
          1.4, drip ? 0.028 : 0.040, moist, vol / n);
      }
      this.inFlight += vol;
      if (this.frame % (drip ? 20 : 12) === 0) this.audio.pour();
      if (drip && (h.y - h.bedrock) > 1.6) this.flags.spire = true;
      return;
    }

    if (!this.toolDown || !h.valid || t.mode === 0) { s.clearBrush(); return; }
    let param = 0;
    if (t.mode === 2 || t.mode === 7) param = this.pailShown() > 0.02 ? 1 : 0;
    if (t.mode === 5 || t.mode === 6 || t.mode === 8) param = this.anchorY;
    s.stamp2[2] = (t.mode === 6) ? (this.pailShown() > 0.02 ? 1 : 0) : 1;
    const fine = this.keys.ShiftLeft || this.keys.ShiftRight ? 0.35 : 1;
    s.setBrush(this.prevHit[0], this.prevHit[1], h.x, h.z,
      this.radius, this.strength * fine, t.mode, param);
    this.prevHit[0] = h.x; this.prevHit[1] = h.z;

    /* ── sand leaving the ground for the pail ──
       The volume is banked, and the pail's wetness becomes the volume-weighted
       average of everything you have lifted into it. Wet sand collected stays
       wet; it only dries afterwards, in the sun, in the pail. */
    if (t.mode === 1 || t.mode === 5) {
      const rate = (t.mode === 1 ? 1.35 : 1.8) * this.strength * fine;
      const area = Math.PI * this.radius * this.radius * (t.mode === 1 ? 0.55 : 0.22);
      const lifted = Math.min(rate * dt * area, h.depth * area);
      if (lifted > 0) {
        this.pailWet = (this.pailWet * Math.max(this.pail, 0.05) + h.m * lifted) /
                       (Math.max(this.pail, 0.05) + lifted);
      }
      /* and you see it go — thrown off the spade, back over the drag */
      if (this.frame % 2 === 0 && h.depth > 0.02) {
        const dx = h.x - this.prevHit[0], dz = h.z - this.prevHit[1];
        const dl = Math.hypot(dx, dz) || 1;
        const tx = -dx / dl, tz = -dz / dl;
        const n = 1 + Math.round(this.radius * 2.5 * this.strength);
        for (let i = 0; i < n; i++) {
          const sp = 0.9 + Math.random() * 1.5;
          this.particles.spawn(0,
            h.x + (Math.random() - 0.5) * this.radius,
            h.y + 0.06 + Math.random() * 0.05,
            h.z + (Math.random() - 0.5) * this.radius,
            tx * sp * 0.7 + (Math.random() - 0.5) * 0.9,
            1.1 + Math.random() * 1.5,
            tz * sp * 0.7 + (Math.random() - 0.5) * 0.9,
            0.55 + Math.random() * 0.35, 0.030 + Math.random() * 0.016, h.m, 0);
        }
      }
    }

    /* feedback */
    if (this.frame % 3 === 0) {
      const n = Math.max(1, Math.round(this.radius * 3));
      if (t.mode === 1) {
        if (this.frame % 12 === 0) this.audio.dig();
      } else if (t.mode === 3) {
        if (this.frame % 15 === 0) { this.audio.pat(); this.particles.burst(3, h.x, h.y + 0.05, h.z, 3, 0.5, 1.0, 0.09, 0.4); }
      } else if (t.mode === 4) {
        this.particles.burst(2, h.x, h.y + 0.25, h.z, 3, 0.9, 0.5, 0.026, 0.3);
        if (this.frame % 24 === 0) this.audio.water();
      } else if (t.mode === 5) {
        if (this.frame % 15 === 0) this.audio.carve();
      }
    }
    if (t.mode === 1 && h.depth < 0.05) this.flags.hardpack = true;
  }

  /* ─────────────────────── tide machine ─────────────────────── */
  tide() {
    if (this.mode === 'curve') return T.CURVE_TIDE;
    return T.TIDES[T.clamp(this.tideIdx, 0, T.TIDES.length - 1)];
  }

  startRun(n) {
    this.mode = 'novena';
    this.tideIdx = T.clamp(n - 1, 0, T.TIDES.length - 1);
    this.hide('#menu'); this.hide('#summary');
    this.beginTide();
  }
  startSandbox() {
    this.mode = 'sandbox';
    this.tideIdx = 4;
    this.hide('#menu');
    this.state = 'play'; this.phase = 'ebb'; this.phaseT = 1e9;
    this.dayT = 0.335;
    this.resetField();
    const s = T.sunFromDay(this.dayT);
    this.sky.setSun(s[0], s[1]);
    this.show('#hud');
    this.layoutFor('sandbox');
    this.refreshLocks();
    this.toast('Siesta mode. A whole day, no alarm, and nothing is coming for it.', 'lore');
    this.firstRun();
  }

  /* Endless Sand — the pail never runs out and the sea never climbs. Everything
     else is the same beach: sand still slumps, still dries, still sets. You are
     only spared the arithmetic of where the material came from. */
  startCreative() {
    this.mode = 'creative';
    this.tideIdx = 4;
    this.hide('#menu');
    this.state = 'play'; this.phase = 'ebb'; this.phaseT = 1e9;
    this.dayT = 0.335;
    this.resetField();
    this.pailWet = 0.66;              // a bottomless pail of properly damp sand
    const s = T.sunFromDay(this.dayT);
    this.sky.setSun(s[0], s[1]);
    this.show('#hud');
    this.layoutFor('sandbox');
    this.refreshLocks();
    this.toast('Infinite pensión. Nothing to dig for, nothing coming for it. Just build.', 'lore');
    this.firstRun();
  }

  /* ─────────────────────── The Curve (pons) ───────────────────────
     The same beach with the tide handed to a pons v2 launch on Robinhood
     Chain. The water sits at the price's recent peak and climbs by the
     drawdown; your bag is sand in the pail; buys and sells happen on the
     curve, signed by your own wallet. pons.js does the reading.        */
  openCurvePick() {
    const P = T.Pons;
    const q = new URLSearchParams(location.search).get('token');
    /* launched: the club builds on $SAND and nothing else */
    if (!(q && P.isAddr(q)) && T.SAND.live()) {
      this.openOver('#curvePick');
      $('#pickStatus').textContent = 'locking to $SAND…';
      $('#pickAddr').value = T.SAND.address;
      this.startCurve(T.SAND.address);
      return;
    }
    this.openOver('#curvePick');
    $('#pickFlood').textContent = Math.round(P.floodAt * 100) + '%';
    $('#prelaunch').hidden = T.SAND.live();
    $('#pickTitle').textContent = T.SAND.live() ? 'Which chart are we building on?' : 'Which chart are we practising on?';
    const last = T.store.get('tw.pons.token', '');
    if (q && P.isAddr(q)) $('#pickAddr').value = q;
    else if (last) $('#pickAddr').value = last;
    if (!this.pickWired) {
      this.pickWired = true;
      $('#pickGo').onclick = () => this.startCurve($('#pickAddr').value.trim());
      $('#pickAddr').onkeydown = e => { if (e.key === 'Enter') this.startCurve($('#pickAddr').value.trim()); };
    }
    const st = $('#pickStatus');
    st.textContent = 'reading the factory…';
    const ul = $('#pickRecent');
    P.recent(24).then(list => {
      /* the busiest of the latest two dozen first — a fresh launch with
         nothing raised is a flat beach with no chart to play against */
      list.sort((a, b) => (a.graduated - b.graduated) || (b.progress - a.progress) || (b.block - a.block));
      list = list.slice(0, 12);
      st.textContent = list.length ? 'pons v2 · factory ' + P.fmt.short(P.FACTORY_V2) + ' · latest launches, busiest first' : 'no recent launches found';
      ul.innerHTML = '';
      if (!list.length) { ul.innerHTML = '<li class="dim">nothing off the factory lately — paste a CA</li>'; return; }
      list.forEach(l => {
        const li = document.createElement('li');
        li.innerHTML = '<b>' + esc(l.symbol) + '</b><span>' + esc(l.name || '') + '</span>' +
          '<i class="lp"><u style="width:' + Math.round((l.progress || 0) * 100) + '%"></u></i>' +
          '<em>' + (l.graduated ? 'graduated' : Math.round((l.progress || 0) * 100) + '%') + '</em>';
        li.onclick = () => { $('#pickAddr').value = l.token; this.startCurve(l.token); };
        ul.appendChild(li);
      });
    }).catch(e => {
      st.textContent = 'could not read the chain: ' + (e.message || e);
      ul.innerHTML = '<li class="dim">paste a CA instead</li>';
    });
    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  }

  async startCurve(addr) {
    const P = T.Pons;
    const st = $('#pickStatus');
    if (!P.isAddr(addr)) { st.textContent = 'that is not a contract address'; return; }
    st.textContent = 'asking the factory for its curve…';
    $('#pickGo').disabled = true;
    try {
      await P.setToken(addr);
    } catch (e) {
      st.textContent = e.message || String(e);
      $('#pickGo').disabled = false;
      return;
    }
    $('#pickGo').disabled = false;
    T.store.set('tw.pons.token', addr);
    this.hide('#curvePick'); this.hide('#menu'); this.screenUnder = null;
    this.mode = 'curve';
    this.tideIdx = 6;
    this.state = 'play'; this.phase = 'ebb'; this.phaseT = 1e9;
    this.dayT = 0.42; this.daySpeed = 1;
    this.resetField();
    this.pailBonus = 0; this.splash = 0; this.rugT = 0; this.curveFlood = 0;
    const s = T.sunFromDay(this.dayT);
    this.sky.setSun(s[0], s[1]);
    this.show('#hud');
    this.layoutFor('curve');
    this.refreshLocks();
    this.renderObjectives();
    this.wireCurve();
    this.updateCurvePanel();
    this.unlockCodex('cx3');
    this.toast((T.SAND.live() && P.state.token.toLowerCase() === T.SAND.address.toLowerCase()
      ? '$SAND Beach. ' : 'Practice beach: $' + P.state.symbol + '. ') +
      'The water sits at the last ' + P.windowMin + ' minutes’ high. Build.', 'lore');
    this.firstRun();
  }

  wireCurve() {
    if (this.curveWired) return;
    this.curveWired = true;
    const P = T.Pons, self = this;
    $('#pConnect').onclick = () => {
      self.audio.ui(true);
      P.connect().then(() => self.toast('gm ' + P.fmt.short(P.state.account) + ' — wallet on Robinhood Chain.', 'good'))
        .catch(e => self.toast(e.message || String(e), 'bad'));
    };
    $('#pBuy').onclick = () => self.openTrade('buy');
    $('#pSell').onclick = () => self.openTrade('sell');
    $('#tradeCancel').onclick = () => { self.audio.ui(false); self.hide('#trade'); self.tradeOpen = false; };
    $('#tradeGo').onclick = () => self.sendTrade();
    $('#tradeAmt').oninput = () => self.quoteTrade();
    P.on('trade', t => {
      if (self.mode !== 'curve') return;
      if (t.side === 'sell') {
        /* a sell an eighth of the graduation threshold deep is a full wave */
        self.splash = Math.min(1.5, self.splash + T.clamp(t.quote / Math.max(P.state.thresholdF || 1, 1e-9) * 8, 0.25, 1.0));
        self.audio.bell(147, 0.08, 2.4);
        self.toast('Paper hands: ' + P.fmt.q(t.quote) + ' out. A wave comes in.', 'bad');
      } else {
        self.audio.bell(294, 0.06, 2.0);
        self.toast('Someone aped ' + P.fmt.q(t.quote) + '. The water draws back.', 'good');
      }
      self.feedLine(t);
    });
    P.on('graduated', () => {
      if (self.mode !== 'curve') return;
      self.audio.bell(220, 0.12, 5.5); setTimeout(() => self.audio.bell(330, 0.10, 6), 700);
      self.toast('Graduated. The pool is locked, the sea goes slack, the club is retired.', 'lore');
    });
    P.on('error', m => { if (self.mode === 'curve' && !self.errToasted) { self.errToasted = true; self.toast('Chain read failed: ' + m, 'bad'); } });
    P.on('update', () => { self.errToasted = false; if (self.mode === 'curve') self.updateCurvePanel(); });
    P.on('mytrade', t => {
      self.toast((t.side === 'buy' ? 'Aped. More sand in the bag.' : 'Sold. The bag is lighter. Jubilado no more?'), t.side === 'buy' ? 'good' : '');
    });
  }

  feedLine(t) {
    const P = T.Pons, f = $('#pFeed');
    const d = document.createElement('div');
    d.className = 'fl ' + t.side;
    d.textContent = (t.side === 'buy' ? '▲ ' : '▼ ') + P.fmt.q(t.quote) + ' · ' + P.fmt.big(BigInt(Math.round(t.tokens)) * 10n ** BigInt(P.state.decimals)) + ' ' + P.state.symbol;
    f.prepend(d);
    while (f.children.length > 4) f.lastChild.remove();
  }

  updateCurvePanel() {
    const P = T.Pons, S = P.state;
    $('#pSym').textContent = S.symbol.length > 7 ? S.symbol.slice(0, 7) : S.symbol;
    const isSand = T.SAND.live() && S.token.toLowerCase() === T.SAND.address.toLowerCase();
    $('#pName').textContent = isSand ? T.SAND.name : 'practice · ' + (S.name || P.fmt.short(S.token));
    $('#pName').title = S.token;
    const ph = $('#pPhase');
    const k = this.curveFlood || 0;
    let txt, cls = '';
    if (S.graduated) { txt = 'SLACK — graduated, pool locked'; }
    else if (!S.ok) { txt = 'reading the chain…'; }
    else if (k < 0.08) { txt = 'EBB — the water is out'; }
    else if (k < 0.6) { txt = 'FLOOD — the chart is bleeding'; cls = 'flood'; }
    else { txt = 'HIGH WATER — hold the shape'; cls = 'flood'; }
    ph.className = 'phase ' + cls;
    ph.querySelector('span').textContent = txt;
    $('#pPrice').textContent = P.fmt.price(S.price);
    const dd = S.drawdown;
    $('#pDelta').textContent = S.peak > 0 ? (dd < 0.002 ? 'at the peak' : '−' + P.fmt.pct(dd) + ' from peak') : '—';
    $('#pDelta').className = dd > 0.05 ? 'bad' : '';
    $('#pCurveFill').style.width = Math.round(S.progress * 100) + '%';
    $('#pCurveText').textContent = S.graduated ? 'graduated' : P.fmt.pct(S.progress);
    $('#pCurveHint').textContent = S.graduated ? 'Uniswap v4 · locked' :
      (S.threshold > 0n ? P.fmt.qb(S.realQuote) + ' of ' + P.fmt.qb(S.threshold) : 'to graduation');
    const bag = $('#pBag');
    if (S.account) {
      const m3 = this.bagSand();
      bag.innerHTML = '<b>' + P.fmt.big(S.balance) + ' ' + S.symbol + '</b>' +
        '<span>' + P.fmt.pct(S.bagFrac) + ' of supply · +' + m3.toFixed(1) + ' m³ sand</span>' +
        '<span class="dim">' + P.fmt.short(S.account) + '</span>';
    }
    $('#pLink').href = P.tokenUrl();
    /* a practice beach buys someone else's coin — the button must say which */
    $('#pBuy').textContent = 'Buy $' + (S.symbol.length > 10 ? S.symbol.slice(0, 10) : S.symbol);
    $('#pBuy').disabled = !!S.graduated; $('#pSell').disabled = !!S.graduated;
    if (this.tradeOpen) this.quoteTrade();
  }

  /* what your bag is worth in sand: 0.1 % of supply → 4 m³, capped so a
     whale still has to dig a moat */
  bagSand() {
    const f = T.Pons.state.bagFrac || 0;
    return Math.min(T.SAND.bagSandMax, f * 1000 * T.SAND.bagSandPerMille);
  }

  openTrade(side) {
    const P = T.Pons, S = P.state;
    if (!P.hasWallet()) { this.toast('No wallet in this browser — open pons instead: ' + P.tokenUrl(), 'bad'); return; }
    if (S.graduated) { this.toast('Graduated — trade it in the locked pool on pons.', ''); return; }
    this.audio.ui(true);
    this.tradeSide = side; this.tradeOpen = true;
    $('#tradeNum').textContent = side === 'buy' ? 'BUY $' + S.symbol : 'SELL $' + S.symbol;
    $('#tradeTitle').textContent = side === 'buy' ? 'Buy $' + S.symbol + ' on the curve' : 'Sell $' + S.symbol + ' on the curve';
    $('#tradeUnit').textContent = side === 'buy' ? S.quoteSymbol : S.symbol;
    $('#tradeAmt').value = '';
    const qk = $('#tradeQuick'); qk.innerHTML = '';
    /* sensible bites of the quote asset: a slice of the graduation threshold */
    const th = S.thresholdF || (S.isNative ? 4 : 8000);
    const bite = f => { const v = th * f; return v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(1) : v.toPrecision(2); };
    const quick = side === 'buy' ? [bite(0.001), bite(0.0025), bite(0.01), bite(0.025)] : ['25%', '50%', '100%'];
    quick.forEach(v => {
      const b = document.createElement('button'); b.textContent = v;
      b.onclick = () => {
        if (v.endsWith('%')) {
          const frac = BigInt(parseInt(v, 10));
          const amt = S.balance * frac / 100n;
          $('#tradeAmt').value = (Number(amt) / 10 ** S.decimals).toFixed(0);
        } else $('#tradeAmt').value = v;
        this.quoteTrade();
      };
      qk.appendChild(b);
    });
    $('#tradeQuote').textContent = S.account ? 'type an amount' : 'connect a wallet first — the quote needs your address for the snipe tax';
    $('#tradeGo').disabled = false;
    this.openOver('#trade');
    (S.account ? Promise.resolve() : P.connect().catch(e => this.toast(e.message || String(e), 'bad'))).then(() => this.quoteTrade());
  }

  async quoteTrade() {
    const P = T.Pons, S = P.state, out = $('#tradeQuote');
    const v = $('#tradeAmt').value.trim();
    if (!v || isNaN(+v) || +v <= 0) { out.textContent = '—'; return; }
    try {
      if (this.tradeSide === 'buy') {
        const wei = P.toWei(v, S.quoteDecimals);
        const q = await P.quoteBuy(wei);
        const per = Number(wei) / 10 ** S.quoteDecimals / (Number(q.tokensOut) / 10 ** S.decimals);
        out.innerHTML = '≈ <b>' + P.fmt.big(q.tokensOut) + ' ' + S.symbol + '</b>' +
          ' · ' + P.fmt.pct(Number(q.tokensOut) / Number(S.supply)) + ' of supply' +
          ' · +' + Math.min(T.SAND.bagSandMax, Number(q.tokensOut) / Number(S.supply) * 1000 * T.SAND.bagSandPerMille).toFixed(1) + ' m³' +
          '<br><span class="dim">fee ' + (Number(S.feeBps) / 100) + '% · creator ' + (Number(S.creatorTaxBps) / 100) + '%' +
          (q.snipeBps > 0n ? ' · <b class="bad">snipe tax ' + (Number(q.snipeBps) / 100).toFixed(1) + '% — wait a few seconds</b>' : '') +
          (q.capped ? ' · <b>fills the curve — the rest is refunded</b>' : '') +
          ' · ' + P.fmt.price(per) + ' avg · 3% slippage</span>';
      } else {
        const wei = P.toWei(v, S.decimals);
        if (wei > S.balance) { out.innerHTML = '<span class="bad">that is more than your bag holds</span>'; return; }
        const q = P.quoteSell(wei);
        out.innerHTML = '≈ <b>' + P.fmt.qb(q.quoteOut) + '</b>' +
          '<br><span class="dim">fee ' + (Number(S.feeBps) / 100) + '% · creator ' + (Number(S.creatorTaxBps) / 100) + '% · 3% slippage</span>';
      }
    } catch (e) { out.innerHTML = '<span class="bad">' + (e.message || e) + '</span>'; }
  }

  async sendTrade() {
    const P = T.Pons, S = P.state;
    const v = $('#tradeAmt').value.trim();
    if (!v || isNaN(+v) || +v <= 0) return;
    const go = $('#tradeGo');
    go.disabled = true; go.textContent = 'Sign in the wallet…';
    try {
      if (this.tradeSide === 'buy') await P.buy(P.toWei(v, S.quoteDecimals), 300);
      else await P.sell(P.toWei(v, S.decimals), 300);
      this.audio.bell(392, 0.08, 3);
      this.hide('#trade'); this.tradeOpen = false;
    } catch (e) {
      const m = (e && (e.message || e.data && e.data.message)) || String(e);
      $('#tradeQuote').innerHTML = '<span class="bad">' + m.slice(0, 220) + '</span>';
    }
    go.disabled = false; go.textContent = 'Sign it · LFG';
  }

  beginTide() {
    const t = this.tide();
    this.state = 'brief';
    this.resetField();
    $('#bNum').textContent = 'TIDE ' + T.roman(t.n);
    $('#bName').textContent = t.name;
    $('#bVerse').textContent = t.verse;
    const lowZ = (1.55 - t.low) / 0.0705 - 24;
    const highZ = (1.55 - t.high) / 0.0705 - 24;
    $('#bReach').textContent = Math.round(lowZ - highZ) + ' m further up';
    $('#bTime').textContent = Math.round(t.build / 60) + ' min ' + (t.build % 60) + ' s';
    const el = t.sun[0];
    $('#bLight').textContent = el > 45 ? 'high morning' : el > 25 ? 'afternoon' :
      el > 8 ? 'low gold' : el > 0 ? 'sunset' : el > -8 ? 'dusk' : 'dark water';
    const ul = $('#bObj'); ul.innerHTML = '';
    t.objs.forEach(o => { const li = document.createElement('li'); li.textContent = o.text; ul.appendChild(li); });
    this.show('#brief');
    this.audio.setTide(t.n);
    this.audio.bell(t.n > 6 ? 196 : 294, 0.10, 3.2);
  }

  beginBuild() {
    this.hide('#brief');
    this.state = 'play'; this.phase = 'ebb';
    this.phaseT = this.tide().build;
    this.show('#hud');
    this.layoutFor('novena');
    this.refreshLocks();
    this.renderObjectives();
    this.toast('The water is out. Build. The Americans are still in a meeting.', 'lore');
    this.firstRun();
  }

  resetField() {
    const t = this.tide();
    this.seaBase = t.low; this.seaTarget = t.low;
    this.waveAmp = t.amp * 0.55;
    this.erodeK = 0.35;
    this.sky.cloud = t.cloud;
    this.sunA = t.sun;
    this.sunB = (T.TIDES[this.tideIdx + 1] || t).sun;
    this.sky.setSun(t.sun[0], t.sun[1]);
    this.sim.reset(this.seaBase);
    this.env.seaBase = this.seaBase; this.env.waveAmp = this.waveAmp; this.env.erodeK = 0;
    for (let i = 0; i < 30; i++) this.sim.step(this.env, 1 / 60);
    this.sim.updateAO();
    this.props.clear();
    this.pail = PAIL_START;
    this.pailWet = 0.42;        // a fresh pail off the damp beach
    this.inFlight = 0;
    this.sim.baseTotal = -1;
    this.worthBase = -1;
    this.worthPeak = 0;
    this.flags = {};
    this.cam.tgt[0] = 0; this.cam.tgt[1] = 0.8; this.cam.tgt[2] = -7;
    this.cam.distT = 23; this.cam.pitchT = 0.42; this.cam.yawT = -Math.PI / 2;
  }

  startFlood() {
    if (this.phase !== 'ebb') return;
    this.phase = 'flood';
    this.phaseT = this.tide().flood;
    this.floodLen = this.tide().flood;
    this.worthAtFlood = Math.max(0, (this.sim.metrics.worth - Math.max(this.worthBase, 0)) * SCORE_SCALE);
    this.audio.bell(147, 0.13, 5.0);
    this.toast('The tide has turned. Red candle incoming.', 'bad');
    $('#tidePhase').classList.add('flood');
    $('.clockbar').classList.add('flood');
  }

  endTide() {
    this.state = 'summary';
    this.phase = 'ebb';
    $('#tidePhase').classList.remove('flood');
    $('.clockbar').classList.remove('flood');
    const t = this.tide();
    const worth = Math.max(0, (this.sim.metrics.worth - Math.max(this.worthBase, 0)) * SCORE_SCALE);
    const kept = this.worthAtFlood > 30 ? T.clamp(worth / this.worthAtFlood, 0, 1) : (worth > 30 ? 1 : 0);
    const stats = {
      worth: Math.round(worth),
      kept,
      peakAbove: this.sim.metrics.peak,
      packed: this.sim.metrics.packed,
      moatFilled: !!this.flags.hardpack,
      propsAlive: this.props.list.filter(p => p.health > 0.5).length,
      lanternAlive: this.props.list.some(p => p.type === 'lantern' && p.health > 0.5),
      target: this.targetFor(t)
    };
    const results = t.objs.map(o => ({ text: o.text, ok: !!o.check(stats) }));
    stats.objsDone = results.filter(r => r.ok).length;
    stats.objsTotal = results.length;
    const g = T.grade(stats);

    $('#sGrade').textContent = g.g;
    $('#sTitle').textContent = this.tideIdx === 8 ? 'The ninth water has gone back out. You are retired.' : 'The water has gone back out.';
    $('#sLine').textContent = g.line;
    $('#sStats').innerHTML =
      cell('Pensión', stats.worth) +
      cell('Kept', Math.round(kept * 100) + '%') +
      cell('Packed', stats.packed.toFixed(1) + ' m³') +
      cell('Highest', (stats.peakAbove).toFixed(2) + ' m');
    $('#sObj').innerHTML = '<div class="bh">Asked of you</div><ul>' +
      results.map(r => '<li class="' + (r.ok ? 'done' : 'fail') + '">' + r.text + '</li>').join('') + '</ul>';
    $('#sNext').style.display = (this.tideIdx >= T.TIDES.length - 1) ? 'none' : '';

    this.save.totals = (this.save.totals || 0) + stats.worth;
    this.save.best = Math.max(this.save.best || 0, stats.worth);
    if (stats.objsDone >= Math.max(1, results.length - 1))
      this.save.tide = Math.max(this.save.tide, Math.min(T.TIDES.length, t.n + 1));
    this.unlockCodex('c' + t.n);
    if (this.flags.spire) this.unlockCodex('cx1');
    if (this.flags.pailEmpty) this.unlockCodex('cx2');
    T.store.set('tw.save', this.save);

    this.audio.bell(this.tideIdx === 8 ? 110 : 220, 0.12, 5.5);
    if (this.tideIdx === 8) setTimeout(() => this.audio.bell(165, 0.10, 7), 900);
    this.show('#summary');
    this.hide('#hud');

    function cell(l, v) { return '<div><div class="s-l">' + l + '</div><div class="s-v">' + v + '</div></div>'; }
  }

  targetFor(t) {
    const o = t.objs.find(x => /Pensión/.test(x.text));
    if (!o) return 1000;
    const m = /(\d+)/.exec(o.text);
    return m ? +m[1] : 1000;
  }

  nextTide() {
    this.hide('#summary');
    if (this.tideIdx >= T.TIDES.length - 1) { this.toMenu(); return; }
    this.tideIdx++;
    this.beginTide();
  }

  /* the footer of the menu says where $SAND is: a CA, or not yet */
  refreshLaunchLine() {
    const el = $('#menuCA'), sub = $('#curveSub');
    if (!el) return;
    if (T.SAND.live()) {
      const a = T.SAND.address;
      el.innerHTML = 'CA <a href="' + T.Pons.LAUNCHPAD + '/' + a + '" target="_blank" rel="noopener" title="' + a + '">' +
        a.slice(0, 6) + '…' + a.slice(-4) + '</a> · pons';
      if (sub) sub.textContent = 'The chart is the tide. Every sell brings the water in; your $SAND bag is your sand.';
    } else {
      let line = '$SAND · not launched yet';
      if (T.SAND.launchAt) {
        const ms = Date.parse(T.SAND.launchAt) - Date.now();
        if (ms > 0) {
          const h = Math.floor(ms / 3.6e6), m = Math.floor(ms % 3.6e6 / 6e4);
          line = '$SAND launches in ' + (h >= 48 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h + 'h ' + m + 'm');
        } else line = '$SAND · launching';
      }
      el.textContent = line;
      if (sub) sub.textContent = 'Not launched yet — practise on any pons chart. On launch day the beach locks to $SAND.';
    }
    const links = [['x', 'X'], ['telegram', 'TG'], ['site', 'site']].filter(l => T.SAND[l[0]]);
    if (links.length) el.innerHTML += links.map(l => ' <span class="dot">·</span> <a href="' + T.SAND[l[0]] + '" target="_blank" rel="noopener">' + l[1] + '</a>').join('');
  }

  toMenu() {
    if (this.mode === 'curve') { T.Pons.stop(); this.tradeOpen = false; this.hide('#trade'); }
    this.refreshLaunchLine();
    this.state = 'menu';
    this.screenUnder = null;
    this.hide('#hud'); this.hide('#summary'); this.hide('#brief'); this.hide('#pause');
    this.hide('#dayPanel');
    this.show('#menu');
    if (this.save.tide > 1) {
      $('#btnContinue').hidden = false;
      $('#continueSub').textContent = 'Tide ' + T.roman(this.save.tide) + ' — ' +
        (T.TIDES[this.save.tide - 1] ? T.TIDES[this.save.tide - 1].name : '');
    }
  }

  setPaused(p) {
    this.paused = p;
    $('#pause').classList.toggle('hidden', !p);
    if (p) $('#pauseSub').textContent = this.mode === 'curve' ? 'The chart does not take a siesta. The sand does.' : this.phase === 'flood' ? 'The water is waiting too.' : 'The beach waits.';
  }

  /* ─────────────────────── codex ─────────────────────── */
  unlockCodex(id) {
    if (!this.save.codex) this.save.codex = [];
    if (this.save.codex.indexOf(id) < 0) {
      this.save.codex.push(id);
      const e = T.CODEX.find(c => c.id === id);
      if (e) this.toast('Primer: “' + e.title + '”', 'lore');
      T.store.set('tw.save', this.save);
    }
  }
  openCodex() {
    const list = $('#codexList'); list.innerHTML = '';
    const unlocked = this.save.codex || [];
    T.CODEX.forEach(c => {
      const li = document.createElement('li');
      const has = unlocked.indexOf(c.id) >= 0;
      li.textContent = has ? c.title : '— sealed —';
      li.className = has ? '' : 'locked';
      if (has) li.onclick = () => {
        $$('#codexList li').forEach(x => x.classList.remove('on'));
        li.classList.add('on');
        $('#codexRead').innerHTML = '<h3>' + c.title + '</h3><div class="cr-src">' + c.src + '</div>' +
          c.body.map(p => '<p>' + p + '</p>').join('');
      };
      list.appendChild(li);
    });
    $('#codexRead').innerHTML = '<div class="cr-empty">' +
      (unlocked.length ? 'Select an entry.' : 'Nothing yet. The beach tells you things as you work.') + '</div>';
    this.openOver('#codex');
  }

  /* ─────────────────────── save / load a castle ─────────────────────── */
  saveCastle() {
    try {
      const res = this.sim.res, D = 256;
      const src = this.sim.download();
      const out = new Uint8Array(D * D * 5);
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
        const sx = Math.min(res - 1, Math.round(x * res / D));
        const sy = Math.min(res - 1, Math.round(y * res / D));
        const i = (sy * res + sx) * 4, o = (y * D + x) * 5;
        const hh = T.clamp(Math.round(src[i] * 10000), 0, 65535);
        out[o] = hh & 255; out[o + 1] = hh >> 8;
        out[o + 2] = T.clamp(Math.round(src[i + 1] * 255), 0, 255);
        out[o + 3] = T.clamp(Math.round(src[i + 2] * 255), 0, 255);
        out[o + 4] = T.clamp(Math.round(src[i + 3] * 400), 0, 255);
      }
      let bin = '';
      for (let i = 0; i < out.length; i += 4096)
        bin += String.fromCharCode.apply(null, out.subarray(i, i + 4096));
      T.store.set('tw.castle', {
        d: btoa(bin), res: D, tide: this.tideIdx + 1,
        props: this.props.list.map(p => [p.type, p.x, p.y, p.z, p.rot, p.scale])
      });
      this.toast('Castle saved. Not your keys, still your castle.', 'good');
    } catch (e) { this.toast('Could not save (storage blocked).', 'bad'); }
  }

  loadCastle() {
    const c = T.store.get('tw.castle', null);
    if (!c) { this.toast('No castle saved.', 'bad'); return; }
    try {
      const bin = atob(c.d), D = c.res;
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const res = this.sim.res;
      const dst = new Float32Array(res * res * 4);
      for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
        const sx = Math.min(D - 1, Math.floor(x * D / res));
        const sy = Math.min(D - 1, Math.floor(y * D / res));
        const o = (sy * D + sx) * 5, i = (y * res + x) * 4;
        dst[i] = (u[o] | (u[o + 1] << 8)) / 10000;
        dst[i + 1] = u[o + 2] / 255;
        dst[i + 2] = u[o + 3] / 255;
        dst[i + 3] = u[o + 4] / 400;
      }
      this.sim.upload(dst);
      this.sim.baseTotal = -1;
      this.props.clear();
      (c.props || []).forEach(p => this.props.add(p[0], p[1], p[2], p[3], p[4], p[5]));
      this.toast('Castle restored.', 'good');
      this.setPaused(false);
    } catch (e) { this.toast('That castle would not come back.', 'bad'); }
  }

  /* ─────────────────────── photo mode ─────────────────────── */
  setPhoto(on) {
    this.photo = on;
    document.body.classList.toggle('photo', on);
    $('#photo').classList.toggle('hidden', !on);
    if (on) {
      $('#pSun').value = Math.round(this.sky._elev * 10);
      $('#pAz').value = Math.round(this.sky._azim);
      this.updatePhoto();
      this.toast('Photo mode. Drag to frame, P to leave.', '');
    }
  }
  updatePhoto() {
    const el = +$('#pSun').value / 10, az = +$('#pAz').value;
    $('#vSun').textContent = el.toFixed(0) + '°';
    $('#vAz').textContent = az.toFixed(0) + '°';
    $('#vExp').textContent = (+$('#pExp').value / 100).toFixed(2) + '×';
    $('#vFoc').textContent = (+$('#pFoc').value / 100 * 40 + 2).toFixed(1) + ' m';
    $('#vApt').textContent = (+$('#pApt').value / 100).toFixed(2);
    this.sky.setSun(el, az);
  }

  /* ─────────────────────── objectives / hud ─────────────────────── */
  /* one left column: the tide and its gauge, or the day. Never both. */
  layoutFor(mode) {
    const sandbox = mode !== 'novena' && mode !== 'curve';
    const curve = mode === 'curve';
    $('#tidePanel').classList.toggle('hidden', mode !== 'novena');
    $('#gauge').classList.toggle('hidden', sandbox);
    $('#dayPanel').classList.toggle('hidden', !sandbox);
    $('#ponsPanel').classList.toggle('hidden', !curve);
  }

  renderObjectives() {
    const ul = $('#objList'); ul.innerHTML = '';
    if (this.mode !== 'novena') { $('#objPanel').style.display = 'none'; return; }
    $('#objPanel').style.display = '';
    this.tide().objs.forEach(o => {
      const li = document.createElement('li');
      li.textContent = o.text;
      ul.appendChild(li);
    });
  }

  updateHUD() {
    const t = this.tide();
    if (this.mode === 'novena') {
      $('#tideNum').textContent = T.roman(t.n);
      $('#tideName').textContent = t.name;
      $('#tidePhase').querySelector('span').textContent =
        this.phase === 'ebb' ? 'EBB — the water is out' : 'FLOOD — the water is coming';
      const total = this.phase === 'ebb' ? t.build : this.floodLen || t.flood;
      $('#clockFill').style.width = (T.clamp(this.phaseT / total, 0, 1) * 100) + '%';
      $('#clockText').textContent = T.fmtTime(this.phaseT);
      $('#clockHint').innerHTML = this.phase === 'ebb' ? '<kbd>R</kbd> call it early' : '';
    }

    /* the score counts up rather than snapping — it reads as a tally */
    const worth = Math.max(0, (this.sim.metrics.worth - Math.max(this.worthBase, 0)) * SCORE_SCALE);
    this.shownScore = this.shownScore === undefined ? worth
      : this.shownScore + (worth - this.shownScore) * 0.22;
    if (Math.abs(worth - this.shownScore) < 0.6) this.shownScore = worth;
    $('#scoreVal').textContent = Math.round(this.shownScore).toLocaleString('en-GB');
    const pv = this.pailShown();
    const endless = !isFinite(pv);
    const pf = endless ? 1 : T.clamp(pv / PAIL_SHOW, 0, 1);
    $('#pailFill').style.width = (pf * 100) + '%';
    $('#pailFill').parentElement.classList.toggle('low', !endless && pv < 0.6);
    const pw = Math.round(this.pailWet * 100);
    const cls = this.pailWet > 0.88 ? 'soak' : (this.pailWet > 0.5 ? 'damp' : 'dry');
    $('#pailText').innerHTML = (endless ? '∞' : pv.toFixed(2) + ' m³') +
      '<i class="' + cls + '">' + pw + '% wet</i>';

    this.updateHint();

    /* gauge */
    const lo = -0.6, hi = 3.6;
    const map = y => T.clamp((y - lo) / (hi - lo), 0, 1) * 100;
    const sea = map(this.seaBase), high = map(t.high);
    const peak = map(t.high + Math.max(this.sim.metrics.peak, 0));
    $('#gSea').style.height = sea + '%';
    $('#gNow').style.bottom = sea + '%';
    $('#gHigh').style.bottom = high + '%';
    $('#gPeak').style.bottom = peak + '%';
    /* labels must never sit on top of each other */
    $('#gHigh').style.opacity = Math.abs(high - sea) < 9 ? 0.25 : 1;
    $('#gPeak').style.opacity = Math.abs(peak - high) < 9 ? 0.25 : 1;

    /* the mould */
    if (this.tool.mode === 10) {
      const M = this.mould, def = this.mouldDef();
      const bar = $('#mouldFill'), lbl = $('#mouldText'), hint = $('#mouldHint');
      const box = bar.parentElement;
      bar.style.width = (M.fill * 100) + '%';
      const soaked = M.wet > 0.93, tooDry = M.wet < def.wet - 0.14;
      box.className = 'mould-bar' + (M.fill >= 1 ? ' full' : '') +
        (M.fill > 0.02 ? (tooDry ? ' dry' : (soaked ? '' : ' wet')) : '');
      lbl.textContent = M.fill >= 1 ? 'FULL · ' + Math.round(M.wet * 100) + '% wet'
        : M.fill > 0.02 ? Math.round(M.fill * 100) + '%' : 'empty';
      if (M.fill >= 1) {
        hint.textContent = tooDry ? 'too dry — it will slump when it comes out'
          : soaked ? 'soaked — it will run' : 'click where you want it · , . to turn';
        hint.className = 'mould-hint ' + (tooDry || soaked ? 'bad' : 'go');
      } else {
        hint.textContent = (this.mode === 'creative' ? 'hold anywhere to fill the '
                                                     : 'hold on damp sand to fill the ')
                         + def.name.toLowerCase();
        hint.className = 'mould-hint';
      }
    }

    /* the day */
    if (this.mode === 'sandbox') {
      $('#dayTime').textContent = T.dayClock(this.dayT);
      $('#dayPhase').textContent = T.dayPhase(this.dayT);
      const sc = $('#dayScrub');
      if (document.activeElement !== sc) sc.value = Math.round(this.dayT * 1000);
      const C = 2 * Math.PI * 17;
      $('#dayArc').style.strokeDashoffset = (C * (1 - this.dayT)).toFixed(1);
      const a = this.dayT * Math.PI * 2;
      $('#dayPip').setAttribute('cx', (22 + Math.cos(a) * 17).toFixed(2));
      $('#dayPip').setAttribute('cy', (22 + Math.sin(a) * 17).toFixed(2));
      const up = T.sunFromDay(this.dayT)[0] > 0;
      $('#dayPip').style.fill = up ? 'var(--gold-hot)' : 'var(--wet)';
    }

    /* live objective ticks */
    const stats = this.liveStats();
    $$('#objList li').forEach((li, i) => {
      const o = this.tide().objs[i];
      if (o) li.classList.toggle('done', !!o.check(stats));
    });
  }

  /* the readout that follows the cursor: what this sand will actually do */
  updateProbe() {
    const chip = $('#probeChip'), h = this.sim.hit;
    const show = h.valid && this.canBuild() && !this.hudHidden && !this.drag;
    chip.classList.toggle('hidden', !show);
    if (!show) return;
    /* flip above the cursor in the lower half, and to its left near the right
       edge, so the chip never lands on the workbench or the score card */
    const W = window.innerWidth || 1280, Hh = window.innerHeight || 720;
    const flipY = this.mouse.y > Hh * 0.56;
    const flipX = this.mouse.x > W - 230;
    const x = T.clamp(this.mouse.x + (flipX ? -202 : 26), 8, Math.max(8, W - 196));
    const y = T.clamp(this.mouse.y + (flipY ? -150 : -28), 8, Math.max(8, Hh - 142));
    chip.style.transform = 'translate(' + x + 'px,' + y + 'px)';

    const m = h.m, c = h.c, d = h.depth;
    $('#pcWet').style.width = (m * 100) + '%';
    $('#pcWetT').textContent = Math.round(m * 100) + '%';
    $('#pcPack').style.width = (c * 100) + '%';
    $('#pcPackT').textContent = Math.round(c * 100) + '%';
    $('#pcDepth').style.width = T.clamp(d / 2.2, 0, 1) * 100 + '%';
    $('#pcDepthT').textContent = d.toFixed(2) + 'm';

    const v = $('#pcVerdict');
    let txt, cls;
    if (d < 0.04) { txt = 'hardpack — nothing left to dig'; cls = 'none'; }
    else if (m > 0.90) { txt = 'soaked — it will run'; cls = 'bad'; }
    else if (m > 0.55) { txt = c > 0.45 ? 'damp and packed — strong' : 'damp — good, now pat it'; cls = ''; }
    else if (m > 0.30) { txt = 'drying — wet it again'; cls = 'dry'; }
    else { txt = 'dry — will not stand'; cls = 'dry'; }
    v.textContent = txt;
    v.className = 'pc-verdict ' + cls;
  }

  /* one line, at the bottom, that always says the next useful thing */
  updateHint() {
    const el = $('#hintText'), t = this.tool, h = this.sim.hit;
    let s = '', cls = '';
    if (!this.canBuild()) { el.textContent = ''; return; }
    if (t.mode === 10) {
      const M = this.mould, def = this.mouldDef();
      if (M.fill < 1) {
        s = M.fill > 0.02 ? 'keep holding — ' + Math.round(M.fill * 100) + '% full'
          : (this.mode === 'creative' ? 'hold anywhere to fill the '
                                      : 'hold on damp sand to fill the ') + def.name.toLowerCase();
      } else if (M.wet < def.wet - 0.14) { s = 'the sand you scooped was too dry — it will slump'; cls = 'bad'; }
      else { s = 'aim and click to turn it out · , . to turn it'; cls = 'go'; }
    } else if (t.mode === 0) {
      s = 'click to set down a ' + T.ADORN[this.adornIdx].name.toLowerCase();
    } else if ((t.moves > 0) && this.pailShown() <= 0.02) {
      s = 'your bag is empty — dig somewhere you want a hole'; cls = 'bad';
    } else if (t.mode === 4 && h.valid && h.m > 0.9) {
      s = 'that is already soaked — any more and it runs'; cls = 'bad';
    } else if (t.mode === 1 && h.valid && h.depth < 0.05) {
      s = 'hardpack — dig somewhere with sand left'; cls = 'bad';
    } else if (t.mode === 3 && h.valid && h.m < 0.3) {
      s = 'patting dry sand does very little — wet it first';
    } else if (t.mode === 5) {
      s = this.toolDown ? 'cutting down to where you pressed'
                        : 'press on the level you want, then drag through the wall';
    } else if (t.mode === 6 || t.mode === 8) {
      s = 'press first where you want the height, then drag';
    }
    el.textContent = s;
    el.className = cls;
  }

  liveStats() {
    const t = this.tide();
    const worth = Math.max(0, (this.sim.metrics.worth - Math.max(this.worthBase, 0)) * SCORE_SCALE);
    return {
      /* before the flood there is nothing kept yet — showing that objective
         as already met is a small lie the interface used to tell */
      worth, kept: this.phase === 'ebb' ? 0 :
        (this.worthAtFlood > 30 ? T.clamp(worth / this.worthAtFlood, 0, 1) : 1),
      peakAbove: this.sim.metrics.peak,
      packed: this.sim.metrics.packed,
      moatFilled: !!this.flags.hardpack,
      propsAlive: this.props.list.filter(p => p.health > 0.5).length,
      lanternAlive: this.props.list.some(p => p.type === 'lantern' && p.health > 0.5),
      target: this.targetFor(t), objsDone: 0, objsTotal: 1
    };
  }

  /* ─────────────────────── simulation tick ─────────────────────── */
  tick(dt) {
    const t = this.tide();
    /* phase timing */
    if (this.state === 'play' && !this.paused && this.mode === 'novena') {
      this.phaseT -= dt;
      if (this.phase === 'ebb') {
        if (this.phaseT <= 0) this.startFlood();
      } else {
        const p = 1 - T.clamp(this.phaseT / this.floodLen, 0, 1);
        let k;
        if (p < 0.42) k = p / 0.42;
        else if (p < 0.60) k = 1;
        else k = 1 - (p - 0.60) / 0.40;
        k = T.sat(k);
        const ek = k * k * (3 - 2 * k);
        this.seaTarget = T.lerp(t.low, t.high, ek);
        this.waveAmp = t.amp * (0.55 + 0.62 * ek);
        this.erodeK = 0.35 + 1.05 * ek;
        if (this.phaseT <= 0) this.endTide();
      }
    } else if (this.mode === 'sandbox') {
      /* two soft tides across the day — the water walks up to the edge of
         your work and walks back again, and never takes anything */
      const swell = Math.sin(this.dayT * Math.PI * 4.0);
      this.seaTarget = t.low + 0.13 + 0.13 * swell;
      this.waveAmp = t.amp * (0.42 + 0.16 * (0.5 + 0.5 * swell));
      this.erodeK = 0.22 + 0.14 * (0.5 + 0.5 * swell);
    } else if (this.mode === 'creative') {
      /* the water sits where it is and stays there. It still breaks on the
         shore, because a still sea looks dead — it just never climbs. */
      this.seaTarget = t.low;
      this.waveAmp = t.amp * 0.34;
      this.erodeK = 0.05;
    } else if (this.mode === 'curve') {
      /* the chart is the tide. pons.js keeps `flood` — the drawdown from the
         recent peak, eased — and we walk the water toward it. A sell lands
         as a splash on top; R rehearses a rug for half a minute; graduation
         locks the pool and the sea goes slack for good. */
      const S = T.Pons.state;
      let k = S.graduated ? 0 : S.flood;
      if (this.rugT > 0) {
        this.rugT -= dt;
        const p = 1 - this.rugT / 30;
        k = Math.max(k, Math.sin(Math.PI * p));
      }
      this.curveFlood = T.damp(this.curveFlood || 0, k, 0.35, dt);
      this.splash = T.damp(this.splash || 0, 0, 0.5, dt);
      const ek = this.curveFlood;
      this.seaTarget = T.lerp(t.low, t.high, ek);
      this.waveAmp = t.amp * (S.graduated ? 0.30 : 0.50 + 0.62 * ek + 0.55 * this.splash);
      this.erodeK = S.graduated ? 0.08 : 0.30 + 1.05 * ek + 0.6 * this.splash;
      this.phase = ek > 0.08 ? 'flood' : 'ebb';
    }
    this.seaBase = T.damp(this.seaBase, this.seaTarget, 3.0, dt);

    /* sun travels across the tide */
    if (this.state === 'play' && !this.photo && this.mode === 'novena') {
      const total = t.build + t.flood;
      const done = this.phase === 'ebb' ? (t.build - this.phaseT) : (t.build + (t.flood - this.phaseT));
      const u = T.clamp(done / total, 0, 1) * 0.55;
      this.sky.setSun(T.lerp(this.sunA[0], this.sunB[0], u), T.lerp(this.sunA[1], this.sunB[1], u));
    } else if (!this.photo && this.state === 'play' &&
               (this.mode === 'sandbox' || this.mode === 'creative' || this.mode === 'curve')) {
      /* the whole day, running */
      this.dayT = (this.dayT + dt * T.DAY_SPEEDS[this.daySpeed].s) % 1;
      const s = T.sunFromDay(this.dayT);
      this.sky.setSun(s[0], s[1]);
      this.sky.cloud = 0.30 + 0.48 * (0.5 + 0.5 * Math.sin(this.dayT * 11.7 + 1.3));
    } else if (!this.photo && this.state !== 'play') {
      /* the menu sits in permanent low gold, the sun grazing the water */
      this.sky.setSun(15.5 + 1.2 * Math.sin(this.time * 0.05), 104 + 6 * Math.sin(this.time * 0.031));
    }
    this.sky._elev = Math.asin(this.sky.sunDir[1]) / DEG;
    this.sky._azim = (Math.atan2(this.sky.sunDir[2], this.sky.sunDir[0]) / DEG + 360) % 360;

    /* wind */
    const gust = 0.55 + 0.45 * Math.sin(this.time * 0.19) + 0.25 * Math.sin(this.time * 0.61);
    this.wind = T.clamp((0.25 + t.amp * 0.5) * gust, 0.1, 2.2);
    this.windVec[0] = Math.sin(this.time * 0.07) * 0.6 * this.wind;
    this.windVec[1] = 0.05 * this.wind;
    this.windVec[2] = -0.95 * this.wind;

    /* env */
    const e = this.env;
    e.time = this.time; e.seaBase = this.seaBase; e.waveAmp = this.waveAmp;
    e.erodeK = this.erodeK; e.wind = this.wind;
    e.sunDry = T.clamp(0.30 + this.sky.sunColor[0] * 0.055, 0.25, 1.4);
    e.fogK = 0.00085 + this.sky.night * 0.0006;
    e.shadowOn = this.settings.shadow && this.sky.sunDir[1] > 0.06;

    /* simulation */
    if (!this.paused) {
      /* grains move first, then hand their volume over, then the field is
         solved — so sand poured this frame is in the ground this frame */
      this.particles.step(e, dt);
      this.particles.depositPass(this.sim);
      e.depositTex = this.particles.depositTex;

      this.acc += Math.min(dt, 0.1);
      let steps = 0;
      const sdt = 1 / SIM_HZ;
      while (this.acc >= sdt && steps < 5) {
        this.applyTool(sdt);
        this.sim.step(e, sdt, steps === 0 ? 1 : 0);
        this.acc -= sdt; steps++;
      }
      if (steps === 0) this.sim.clearBrush();
      /* nothing ran, but the sand still landed — deliver it next frame */
      if (steps === 0) this.pendingDeposit = true;
      this.inFlight = T.damp(this.inFlight, 0, 4.5, dt);
      /* sand left standing in a pail in the sun dries at about the rate the
         ground does — collect it wet, use it soon. In Endless Sand the pail is
         a fiction anyway, so it stays as damp as you last made it. */
      if (this.mode !== 'creative')
        this.pailWet = T.clamp(this.pailWet - dt * e.sunDry * 0.0088, 0, 1);
    }
    this.sim.updateAO();

    /* pick + metrics */
    const o = T.V3.create(), d = T.V3.create();
    this.cam.ray(this.mouse.ndc[0], this.mouse.ndc[1], o, d);
    this.sim.raycast(o, d);
    this.sim.pollPick();
    if (this.frame % 3 === 0) this.sim.measure(t.high);
    if (this.sim.pollMetrics()) {
      if (this.worthBase < 0) this.worthBase = this.sim.metrics.worth;
      const prevPail = this.pail;
      const bonus = this.mode === 'curve' ? this.bagSand() : 0;
      this.pail = Math.max(0, PAIL_START + bonus + (this.sim.baseTotal - this.sim.metrics.total));
      if (prevPail > 0.02 && this.pailShown() <= 0.02) {
        this.flags.pailEmpty = true;
        this.toast('Bag empty. Dig somewhere you want a hole.', 'bad');
      }
      const wp = this.sim.metrics.worth;
      if (this.worthPeak - wp > 0.9 && this.phase === 'flood') {
        this.audio.collapse(T.clamp((this.worthPeak - wp) * 0.25, 0, 1));
      }
      this.worthPeak = T.lerp(this.worthPeak, wp, 0.5);
    }

    /* cursor ring — and, when the mould is full, the shape it will leave */
    const h = this.sim.hit;
    const c2 = this.terrain.cursor2, c3 = this.terrain.cursor3;
    const isMould = this.tool.mode === 10;
    const mouldReady = isMould && this.mould.fill >= 1;
    const isAdorn = this.tool.id === 'adorn';
    this.terrain.cursor[0] = h.x; this.terrain.cursor[1] = h.z;
    /* for the bag the ring is the object's own footprint at the size you set,
       not a brush — otherwise a starfish sits inside a metre-wide circle */
    this.terrain.cursor[2] = isAdorn
      ? this.props.footprint(T.ADORN[this.adornIdx].id) *
        (this.radius / this.props.span(T.ADORN[this.adornIdx].id))
      : (mouldReady ? this.radius : (isMould ? this.radius * 0.88 : this.radius));
    c2[0] = (h.valid && this.canBuild() && !this.hudHidden) ? 1 : 0;
    c2[1] = 0.55; c2[2] = 0.5 + 0.5 * Math.sin(this.time * 3.4);
    c2[3] = (this.tool.mode === 2 || this.tool.mode === 7 || this.tool.mode === 6)
      ? (this.pailShown() > 0.02 ? 1 : 0)
      : (isMould && !mouldReady ? 2 : 1);
    c3[0] = mouldReady ? 1 : 0;
    c3[1] = this.mouldDef().id;
    c3[2] = this.mould.rot;
    c3[3] = this.merlons;

    /* props, gulls and crabs */
    this.terrain.setLamps(this.props.list, this.sky.night, this.cam.pos);
    this.props.updateGulls(this.time, dt);
    if (!this.paused)
      this.props.updateCrabs(this.time, dt, this.seaBase,
        this.toolDown ? this.sim.hit : null);
    if (!this.paused && this.phase === 'flood')
      this.props.updateHealth(this.seaBase, dt, p => {
        this.particles.burst(2, p.x, p.y + 0.2, p.z, 10, 1.2, 0.7, 0.03, 0.7);
      });

    /* sea spray along the break line */
    if (!this.paused && this.frame % 2 === 0) {
      const sl = this.seaBase;
      const shoreZ = (1.55 - sl) / 0.0705 - 24;
      const n = Math.round(2 + this.waveAmp * 5);
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * 46;
        const z = shoreZ + (Math.random() - 0.4) * 5.5;
        this.particles.spawn(1, x, sl + 0.15 + Math.random() * 0.3, z,
          (Math.random() - 0.5) * 1.6, 0.9 + Math.random() * 2.4 * this.waveAmp,
          -1.2 - Math.random() * 2.0 * this.waveAmp,
          0.8 + Math.random() * 1.1, 0.028 + Math.random() * 0.03);
      }
    }

    /* audio bed */
    const camToShore = Math.abs(this.cam.pos[2] - ((1.55 - this.seaBase) / 0.0705 - 24));
    const surfI = T.clamp(1.25 - camToShore / 30, 0.25, 1) * T.clamp(0.45 + this.waveAmp * 0.6, 0, 1.4);
    const swash = Math.sin(this.time * 0.51) * 0.6 + Math.sin(this.time * 0.241 + 1.73) * 0.4;
    this.audio.update(dt, surfI, T.clamp(this.wind / 1.6, 0, 1), swash, this.sky.night);

    /* exposure — driven by the sun's transmitted colour, so the whole day
       arc is one continuous curve rather than a flickering auto-meter */
    const sl2 = this.sky.sunColor;
    const sunLum = sl2[0] * 0.2126 + sl2[1] * 0.7152 + sl2[2] * 0.0722;
    /* key = roughly the radiance a horizontal patch of dry sand will send back */
    const lum = 0.175 * sunLum + 0.010 * this.sky.night + 0.006;
    const tgt = T.clamp(0.72 / lum, 0.05, 26);
    this.exposure = this.exposure > 0 ? T.damp(this.exposure, tgt, 1.6, dt) : tgt;
    /* lamps and the cursor burn at a fixed *screen* brightness, not a fixed
       radiance — otherwise they scale with the night's open exposure */
    e.emiss = (2.4 / this.exposure) * (0.30 + 0.70 * this.sky.night);
    e.uiGain = T.clamp(0.30 / this.exposure, 0.02, 2.2);
    /* the printed looks author final screen colours, so undo the exposure */
    e.inkGain = 1 / Math.max(this.exposure, 1e-4);
    this.sky.inkGain = e.inkGain;
  }

  /* ─────────────────────── render ─────────────────────── */
  render() {
    const gl = this.gl, cam = this.cam;
    const e = this.env;

    this.sky.updateLUT();

    /* shadow map */
    if (e.shadowOn) {
      const sd = this.sky.sunDir;
      const c = [0, 0.9, -6];
      const eye = [c[0] + sd[0] * 60, c[1] + sd[1] * 60, c[2] + sd[2] * 60];
      const up = Math.abs(sd[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0];
      T.M4.lookAt(this.lightView, eye, c, up);
      T.M4.ortho(this.lightProj, -23, 23, -23, 23, 1, 130);
      T.M4.mul(this.lightVP, this.lightProj, this.lightView);
      this.shadow.bind();
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);          // the sand is a sheet, not a solid
      this.terrain.drawDepth(this.lightVP);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      this.props.drawDepth(e);
      gl.disable(gl.CULL_FACE);
    }

    /* main pass */
    this.hdr.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    this.sky.drawBackground(cam, this.time);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    this.terrain.draw(e);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    this.props.draw(e);
    gl.disable(gl.CULL_FACE);

    /* copy for refraction */
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.hdr.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copy.fb);
    gl.blitFramebuffer(0, 0, this.rw, this.rh, 0, 0, this.rw, this.rh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    this.hdr.bind();
    this.water.draw(e, this.copy.color[0], this.rw, this.rh);
    this.particles.render(e, this.rh);

    /* sun screen position */
    const sp = [0, 0, 0];
    const sfar = [cam.pos[0] + this.sky.sunDir[0] * 900,
                  cam.pos[1] + this.sky.sunDir[1] * 900,
                  cam.pos[2] + this.sky.sunDir[2] * 900];
    T.M4.transformPoint(sp, cam.vp, sfar);
    const onScreen = this.sky.sunDir[1] > -0.02 &&
      T.V3.dot(this.sky.sunDir, [cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]]) > -0.2;
    this.sunScreen[0] = sp[0] * 0.5 + 0.5;
    this.sunScreen[1] = sp[1] * 0.5 + 0.5;

    const S = this.settings;
    const st = this.env.style;
    const flat = st > 0;                       // anything but Salt & Light
    const printed = st > 1;                    // authors its own final colours
    const expo = this.exposure * (this.photo ? (+$('#pExp').value / 100) : 1);
    this.post.render(this.hdr.color[0], this.hdr.depth, {
      exposure: expo * (st === 1 ? 1.12 : 1),
      bloom: S.bloom / 100 * (1 + this.sky.night * 0.5) * (printed ? 0.12 : (flat ? 0.55 : 1)),
      grain: S.grain / 100 * (printed ? 0.15 : (flat ? 0.45 : 1)),
      vignette: printed ? 0.10 : (flat ? 0.16 : 0.30),
      ca: flat ? 0 : 0.22,
      style: st,
      outline: (st === 1 || st === 2 || st === 3 || st === 6 || st === 7) ? 1.0 : 0.0,
      time: this.time,
      night: this.sky.night,
      shafts: S.shafts ? 0.55 * T.clamp(this.sky.sunDir[1] * 4 + 0.4, 0, 1) : 0,
      sunScreen: this.sunScreen,
      sunOnScreen: onScreen,
      sunColor: this.sky.sunColor,
      near: cam.near, far: cam.far,
      /* Bucket & Spade gets a shallow miniature focus — the toy-diorama trick */
      focus: this.photo ? (+$('#pFoc').value / 100 * 40 + 2) : (flat ? cam.dist * 0.92 : 12),
      aperture: this.photo ? (+$('#pApt').value / 100) : (st === 1 ? 0.30 : (st === 5 ? 0.22 : 0)),
      outW: this.outW, outH: this.outH
    });

    if (this.wantShot) {
      this.wantShot = false;
      try {
        const a = document.createElement('a');
        a.download = 'jubilados-club-' + Date.now() + '.png';
        a.href = this.canvas.toDataURL('image/png');
        a.click();
        this.toast('Captured.', 'good');
      } catch (err) { this.toast('Capture failed.', 'bad'); }
    }
  }

  /* ─────────────────────── loop ─────────────────────── */
  loop(now) {
    requestAnimationFrame(this.loop);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }

    if (!this.paused) this.time += dt;
    this.frame++;

    /* keyboard camera */
    const k = this.keys, cam = this.cam;
    if (!this.paused) {
      const sp = cam.dist * 0.55 * dt * (k.ShiftLeft ? 2.4 : 1);
      const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
      if (k.KeyW) { cam.tgt[0] -= cy * sp; cam.tgt[2] -= sy * sp; }
      if (k.KeyS) { cam.tgt[0] += cy * sp; cam.tgt[2] += sy * sp; }
      if (k.KeyA) { cam.tgt[0] -= sy * sp; cam.tgt[2] += cy * sp; }
      if (k.KeyD) { cam.tgt[0] += sy * sp; cam.tgt[2] -= cy * sp; }
      if (k.KeyQ) cam.yawT -= dt * 1.1;
      if (k.KeyE) cam.yawT += dt * 1.1;
      cam.tgt[0] = T.clamp(cam.tgt[0], -30, 30);
      cam.tgt[2] = T.clamp(cam.tgt[2], -30, 26);
    }

    if (this.state === 'menu' && !this.photo) {
      cam.yawT += dt * 0.035;
      cam.tgt[0] = 0; cam.tgt[2] = -6; cam.distT = 24; cam.pitchT = 0.30;
    }

    cam.update(dt, this.rw / this.rh);
    this.tick(dt);
    this.render();
    if (this.state === 'play' && !this.hudHidden) {
      this.updateProbe();                             // follows the mouse, so every frame
      if ((this.frame & 1) === 0) this.updateHUD();
    } else {
      $('#probeChip').classList.add('hidden');
    }
  }
}

/* ═══════════════════════════ boot ═══════════════════════════ */
window.addEventListener('load', () => {
  try {
    const g = new TW.Game();
    window.__tw = g;
    if (!g.gl) return;
    g.refreshLaunchLine();
    setInterval(() => { if (g.state === 'menu') g.refreshLaunchLine(); }, 30000);
    setTimeout(() => {
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('menu').classList.remove('hidden');
    }, 480);
  } catch (err) {
    console.error(err);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('fatal').classList.remove('hidden');
    document.getElementById('fatalMsg').textContent = err.message || String(err);
  }
});

T.Game = Game;

})(TW);
