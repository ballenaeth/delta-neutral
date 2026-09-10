/* ============================================================================
   TIDEWRIGHT — audio.js
   Everything you hear is synthesised at runtime: surf from three bands of
   filtered noise driven by the actual swash phase, wind, gulls, the tools,
   and a slow modal pad through a procedurally-generated reverb. No samples.
   ========================================================================== */
'use strict';

(function (T) {

class Audio {
  constructor() {
    this.ok = false;
    this.master = 0.7;
    this.musicVol = 0.55;
    this.started = false;
    this.chordT = 0;
    this.chordI = 0;
    this.tide = 1;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const ctx = this.ctx;
    this.started = true; this.ok = true;

    this.out = ctx.createGain();
    this.out.gain.value = this.master;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.22;
    this.out.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.busAmb = ctx.createGain(); this.busAmb.gain.value = 0.85; this.busAmb.connect(this.out);
    this.busSfx = ctx.createGain(); this.busSfx.gain.value = 0.9;  this.busSfx.connect(this.out);
    this.busMus = ctx.createGain(); this.busMus.gain.value = this.musicVol; this.busMus.connect(this.out);

    /* ── reverb ── */
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._makeIR(2.9, 2.4);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.42;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.out);

    /* ── noise ── */
    this.noiseBuf = this._makeNoise(5);

    /* surf: a low body, the break, and a bright hiss over the top */
    this.surfLow = this._noiseChain(this.noiseBuf, 'lowpass', 260, 0.7, 0.0, this.busAmb);
    this.surfMid = this._noiseChain(this.noiseBuf, 'bandpass', 720, 0.55, 0.0, this.busAmb);
    this.surfHi  = this._noiseChain(this.noiseBuf, 'highpass', 2100, 0.4, 0.0, this.busAmb);
    this.wind    = this._noiseChain(this.noiseBuf, 'bandpass', 480, 0.9, 0.0, this.busAmb);

    /* wind gets a slow sweep */
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const lg = ctx.createGain(); lg.gain.value = 260;
    lfo.connect(lg); lg.connect(this.wind.filter.frequency); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.021;
    const lg2 = ctx.createGain(); lg2.gain.value = 0.5;
    lfo2.connect(lg2); lg2.connect(this.wind.gain.gain); lfo2.start();

    this._startPad();
    this.nextGull = ctx.currentTime + 3;
  }

  _makeNoise(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = w * 0.72 + last * 3.2;
    }
    // fade the seam so the loop is inaudible
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) { const k = i / f; d[i] *= k; d[n - 1 - i] *= k; }
    return b;
  }

  _makeIR(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 480 ? i / 480 : 1);
      }
    }
    return b;
  }

  _noiseChain(buf, type, freq, q, gain, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(filter); filter.connect(g); g.connect(dest);
    src.start(ctx.currentTime + Math.random() * 0.5);
    return { src, filter, gain: g };
  }

  /* ── the pad ── */
  _startPad() {
    const ctx = this.ctx;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.0;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 700; this.padFilter.Q.value = 0.6;
    this.padGain.connect(this.padFilter);
    this.padFilter.connect(this.busMus);
    const send = ctx.createGain(); send.gain.value = 0.5;
    this.padFilter.connect(send); send.connect(this.verb);

    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.033;
    const lg = ctx.createGain(); lg.gain.value = 330;
    lfo.connect(lg); lg.connect(this.padFilter.frequency); lfo.start();

    this.voices = [];
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator();
      o.type = i < 3 ? 'triangle' : 'sine';
      const g = ctx.createGain(); g.gain.value = i < 3 ? 0.16 : 0.09;
      o.connect(g); g.connect(this.padGain);
      o.start();
      this.voices.push({ o, g });
    }
    this.padGain.gain.setTargetAtTime(0.28, ctx.currentTime, 6);
  }

  /* A aeolian drifting toward phrygian as the tides get late */
  _chord(i, tide) {
    const roots = [55.00, 61.74, 65.41, 49.00, 55.00, 73.42];
    const shapes = [
      [1, 1.5, 2, 3, 4.5, 6],
      [1, 1.2, 1.8, 2.4, 3.6, 4.8],
      [1, 1.5, 2, 2.5, 3, 4],
      [1, 1.335, 2, 2.67, 4, 5.34]
    ];
    const r = roots[i % roots.length] * (tide > 6 ? 0.5 : 1);
    return shapes[i % shapes.length].map(m => r * m);
  }

  setTide(n) { this.tide = n; }

  bell(freq, vol, dur) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const parts = [1, 2.0, 3.01, 4.16, 5.43, 6.79];
    const amps  = [1, 0.5, 0.34, 0.20, 0.12, 0.07];
    const g = ctx.createGain(); g.gain.value = vol;
    g.connect(this.busMus);
    const s = ctx.createGain(); s.gain.value = 0.85; g.connect(s); s.connect(this.verb);
    for (let i = 0; i < parts.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * parts[i] * (1 + (Math.random() - 0.5) * 0.004);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(amps[i], t + 0.006);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur * (1 - i * 0.11));
      o.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  /* ── one-shots ── */
  _burst(freq, q, dur, vol, type, sweepTo) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.busSfx);
    src.start(t, Math.random() * 3); src.stop(t + dur + 0.05);
  }

  dig()   { this._burst(900 + Math.random()*400, 1.4, 0.20, 0.16, 'bandpass', 320); }
  pour()  { this._burst(1900, 0.8, 0.16, 0.10, 'bandpass'); }
  pat()   {
    this._burst(240, 2.4, 0.13, 0.22, 'lowpass');
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(this.busSfx); o.start(t); o.stop(t + 0.2);
  }
  water() { this._burst(700, 0.9, 0.45, 0.14, 'bandpass', 2600); }
  carve() { this._burst(2600, 3.0, 0.10, 0.11, 'bandpass'); }
  stamp() {
    this._burst(180, 1.8, 0.30, 0.30, 'lowpass');
    this.bell(392, 0.06, 0.9);
  }
  collapse(amt) {
    this._burst(160, 0.8, 0.55 + amt * 0.5, Math.min(0.34, 0.10 + amt * 0.3), 'lowpass', 60);
  }
  place() { this._burst(1400, 2.0, 0.12, 0.13); this.bell(659, 0.045, 0.5); }
  ui(up) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = up ? 880 : 620;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g); g.connect(this.busSfx); o.start(t); o.stop(t + 0.16);
  }
  gull() {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.16 + Math.random() * 0.1);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const base = 900 + Math.random() * 450;
      o.frequency.setValueAtTime(base * 0.75, s);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, s + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.6, s + 0.19);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 2.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.035, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
      o.connect(f); f.connect(g); g.connect(this.busAmb);
      const sd = ctx.createGain(); sd.gain.value = 0.6; g.connect(sd); sd.connect(this.verb);
      o.start(s); o.stop(s + 0.26);
    }
  }

  setVolumes(master, music) {
    this.master = master; this.musicVol = music;
    if (!this.ok) return;
    this.out.gain.setTargetAtTime(master, this.ctx.currentTime, 0.1);
    this.busMus.gain.setTargetAtTime(music, this.ctx.currentTime, 0.1);
  }

  /* called every frame: surfI 0..1 how close/violent the water is,
     windI 0..1, and swash the instantaneous surge phase                    */
  update(dt, surfI, windI, swash, night) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const sw = 0.5 + 0.5 * swash;
    this.surfLow.gain.gain.setTargetAtTime(0.30 * surfI * (0.55 + 0.75 * sw), t, 0.25);
    this.surfMid.gain.gain.setTargetAtTime(0.16 * surfI * sw * sw, t, 0.18);
    this.surfHi.gain.gain.setTargetAtTime(0.085 * surfI * Math.pow(sw, 3), t, 0.12);
    this.wind.gain.gain.setTargetAtTime(0.055 + 0.10 * windI, t, 0.6);
    this.padFilter.frequency.setTargetAtTime(520 + 620 * (1 - night * 0.6), t, 3.0);

    /* chord changes */
    this.chordT -= dt;
    if (this.chordT <= 0) {
      this.chordT = 15 + Math.random() * 7;
      const f = this._chord(this.chordI++, this.tide);
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        v.o.frequency.setTargetAtTime(f[i] * (i > 3 ? 2 : 1), t, 3.5);
        v.o.detune.setTargetAtTime((Math.random() - 0.5) * 14, t, 2);
      }
    }
    if (t > this.nextGull) {
      this.nextGull = t + 7 + Math.random() * 16 + night * 20;
      if (Math.random() < (night > 0.4 ? 0.12 : 0.75)) this.gull();
    }
  }
}

T.Audio = Audio;

})(TW);
