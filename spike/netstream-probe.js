/* ============================================================================
   TIDEWRIGHT — spike/netstream-probe.js          DEV TOOL — NOT SHIPPED
   Not referenced by index.html. Load it into a running game with:
       fetch('spike/netstream-probe.js').then(r=>r.text()).then(eval)

   THE QUESTION
   ------------
   A GPU sand sim cannot be lockstepped: GPU floating point is not bit-identical
   across vendors, so two machines running the same shader diverge within
   seconds. That forces an authoritative model — one machine simulates, the
   others receive heightfield state. Which only works if the state fits down a
   domestic uplink, in the worst case, which is a flood: every cell moving at
   once, sixty times a second.

   This measures that, on the real simulation, with a real encoder and real
   gzip. It reports bytes actually on the wire.

   WHAT IT DOES NOT PROVE
   ----------------------
   Bandwidth only. It says nothing about whether the game FEELS right at
   150 ms — that needs a build with prediction in it. It is also deliberately
   pessimistic: it downsamples the 512² sim rather than running a genuinely
   coarse one, so the field carries high-frequency detail a real coarse
   authority would never have. Real numbers land under these.
   ========================================================================== */
'use strict';

(function () {

/* ── the wire format ──────────────────────────────────────────────────────
   Tile the field into 8×8 blocks. A block that has not moved costs one bit.
   A block that has moved sends 64 quantised deltas against the last state the
   client acknowledged. Heights are metres; the quantiser works in millimetres,
   which is far below anything a player can see on sand.                    */

const BLOCK = 8;

function boxDownsample(src, srcRes, dstRes) {
  const out = new Float32Array(dstRes * dstRes);
  const k = srcRes / dstRes;
  for (let y = 0; y < dstRes; y++) {
    for (let x = 0; x < dstRes; x++) {
      let s = 0, n = 0;
      const y0 = (y * k) | 0, y1 = ((y + 1) * k) | 0;
      const x0 = (x * k) | 0, x1 = ((x + 1) * k) | 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) { s += src[(yy * srcRes + xx) * 4]; n++; }
      out[y * dstRes + x] = n ? s / n : 0;
    }
  }
  return out;
}

/* Encode `cur` against `base`. Returns the raw packet and updates `base` to
   exactly what the client will now hold — so quantisation error accumulates in
   the probe the same way it would in the real thing, rather than being quietly
   forgiven each tick. */
function encode(cur, base, res, mmPerStep, maxStepM) {
  const blocks = res / BLOCK;
  const maskBytes = Math.ceil((blocks * blocks) / 8);
  const mask = new Uint8Array(maskBytes);
  const payload = [];
  let dirty = 0;

  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      let moved = false;
      for (let y = 0; y < BLOCK && !moved; y++)
        for (let x = 0; x < BLOCK; x++) {
          const i = (by * BLOCK + y) * res + bx * BLOCK + x;
          if (Math.abs(cur[i] - base[i]) * 1000 >= mmPerStep) { moved = true; break; }
        }
      if (!moved) continue;
      const bi = by * blocks + bx;
      mask[bi >> 3] |= 1 << (bi & 7);
      dirty++;
      for (let y = 0; y < BLOCK; y++)
        for (let x = 0; x < BLOCK; x++) {
          const i = (by * BLOCK + y) * res + bx * BLOCK + x;
          let d = cur[i] - base[i];
          d = Math.max(-maxStepM, Math.min(maxStepM, d));
          const q = Math.round(d * 1000 / mmPerStep);          // signed steps
          payload.push(q);
          base[i] += q * mmPerStep / 1000;                     // what the client gets
        }
    }
  }

  /* One byte per delta where it fits, an escape plus two bytes where it does
     not. Deltas are overwhelmingly tiny, so this is nearly always one byte. */
  const body = [];
  for (const q of payload) {
    if (q >= -127 && q <= 127) body.push(q & 0xff);
    else { body.push(0x80); body.push(q & 0xff); body.push((q >> 8) & 0xff); }
  }
  const out = new Uint8Array(maskBytes + body.length);
  out.set(mask, 0);
  out.set(Uint8Array.from(body), maskBytes);
  return { bytes: out, dirtyBlocks: dirty, totalBlocks: blocks * blocks };
}

async function gzipSize(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return buf.byteLength;
}

/* ── the probe ─────────────────────────────────────────────────────────── */

const G = window.__tw;

const Probe = {
  res: 192,
  hz: 20,
  mmPerStep: 4,        // 4 mm quantisation
  maxStepM: 0.5,       // biggest height change one tick may carry
  base: null,
  samples: [],

  reset(res) {
    this.res = res;
    this.base = new Float32Array(res * res);
    this.samples = [];
  },

  /* A joining client gets the whole field once, quantised, as a keyframe.
     Returns its wire size — that is the cost of joining a match, not the cost
     of playing one, and the two must never be averaged together. */
  async keyframe() {
    const S = G.sim;
    const cur = boxDownsample(S.download(), S.res, this.res);
    const q = new Int16Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      q[i] = Math.round(cur[i] * 1000 / this.mmPerStep);
      this.base[i] = q[i] * this.mmPerStep / 1000;
    }
    const raw = new Uint8Array(q.buffer);
    const gz = await gzipSize(raw);
    return { rawBytes: raw.length, gzBytes: gz === null ? raw.length : gz };
  },

  /* Drive ticks until the client has actually caught up, so steady-state
     measurements are not polluted by the tail of the initial sync. */
  async settle(stepFn, maxTicks) {
    for (let i = 0; i < (maxTicks || 40); i++) {
      if (stepFn) stepFn();
      await this.tick();
      const s = this.samples[this.samples.length - 1];
      if (s.dirty / s.blocks < 0.01) break;
    }
    this.samples.length = 0;
  },

  /* one network tick: read the field, downsample, encode, measure */
  async tick() {
    const S = G.sim;
    const raw = S.download();
    const cur = boxDownsample(raw, S.res, this.res);
    const { bytes, dirtyBlocks, totalBlocks } = encode(
      cur, this.base, this.res, this.mmPerStep, this.maxStepM);
    const gz = await gzipSize(bytes);
    this.samples.push({ raw: bytes.length, gz: gz === null ? bytes.length : gz,
                        dirty: dirtyBlocks, blocks: totalBlocks });
  },

  stats() {
    if (!this.samples.length) return null;
    const gz = this.samples.map(s => s.gz).sort((a, b) => a - b);
    const sum = gz.reduce((a, b) => a + b, 0);
    const pick = p => gz[Math.min(gz.length - 1, Math.floor(gz.length * p))];
    const meanDirty = this.samples.reduce((a, s) => a + s.dirty / s.blocks, 0) / this.samples.length;
    const kbps = v => +(v * this.hz * 8 / 1000).toFixed(1);
    return {
      ticks: gz.length,
      meanBytes: Math.round(sum / gz.length),
      p50: pick(0.50), p95: pick(0.95), peak: gz[gz.length - 1],
      dirtyPct: +(meanDirty * 100).toFixed(1),
      kbitPerSec_mean: kbps(sum / gz.length),
      kbitPerSec_p95: kbps(pick(0.95)),
      kbitPerSec_peak: kbps(gz[gz.length - 1]),
      uncompressedMeanBytes: Math.round(
        this.samples.reduce((a, s) => a + s.raw, 0) / this.samples.length),
      naiveFullFieldBytes: this.res * this.res * 2,   // 16-bit, whole field, every tick
    };
  }
};

window.__netspike = { Probe, boxDownsample, encode, gzipSize, BLOCK };
console.log('netstream probe loaded');

})();
