/* ============================================================================
   TIDEWRIGHT — props.js
   Everything you can set down on the sand: pennants, scallops, starfish,
   driftwood, and the little lanterns that only earn their keep once the sun
   has gone. All geometry is generated in code — there isn't an asset file in
   this project — and every instance rides the heightfield, so a flag planted
   on a wall leans over when the wall slumps and topples when the wall goes.
   Plus gulls, because a beach without gulls is a diagram.
   ========================================================================== */
'use strict';

(function (T) {

/* ─────────────────────────── mesh builder ─────────────────────────── */
class Mesh {
  constructor() { this.v = []; this.parts = {}; }
  get count() { return this.v.length / 11; }
  push(p, n, c, kind, param) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], kind || 0, param || 0);
  }
  tri(a, b, c, col, kind, pa, pb, pc) {
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
    const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx/=l; ny/=l; nz/=l;
    const n = [nx, ny, nz];
    this.push(a, n, col, kind, pa); this.push(b, n, col, kind, pb); this.push(c, n, col, kind, pc);
  }
  quad(a, b, c, d, col, kind, pa, pb, pc, pd) {
    this.tri(a, b, c, col, kind, pa, pb, pc);
    this.tri(a, c, d, col, kind, pa, pc, pd);
  }
  cyl(x, y, z, r0, r1, h, seg, col, kind) {
    for (let i = 0; i < seg; i++) {
      const a0 = i/seg*Math.PI*2, a1 = (i+1)/seg*Math.PI*2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0 = [x+c0*r0, y, z+s0*r0], p1 = [x+c1*r0, y, z+s1*r0];
      const p2 = [x+c1*r1, y+h, z+s1*r1], p3 = [x+c0*r1, y+h, z+s0*r1];
      this.quad(p0, p1, p2, p3, col, kind, 0, 0, 1, 1);
      if (r1 > 0.0001 && i < seg) {
        this.tri([x, y+h, z], p3, p2, col, kind, 1, 1, 1);
      }
    }
  }
  dome(x, y, z, r, h, seg, rings, col, kind, squash) {
    squash = squash || 1;
    for (let j = 0; j < rings; j++) {
      const v0 = j/rings, v1 = (j+1)/rings;
      const r0 = r*Math.cos(v0*Math.PI/2), r1 = r*Math.cos(v1*Math.PI/2);
      const y0 = y + h*Math.sin(v0*Math.PI/2), y1 = y + h*Math.sin(v1*Math.PI/2);
      for (let i = 0; i < seg; i++) {
        const a0 = i/seg*Math.PI*2, a1 = (i+1)/seg*Math.PI*2;
        const A = [x+Math.cos(a0)*r0, y0, z+Math.sin(a0)*r0*squash];
        const B = [x+Math.cos(a1)*r0, y0, z+Math.sin(a1)*r0*squash];
        const C = [x+Math.cos(a1)*r1, y1, z+Math.sin(a1)*r1*squash];
        const D = [x+Math.cos(a0)*r1, y1, z+Math.sin(a0)*r1*squash];
        if (r1 < 0.0005) this.tri(A, B, [x, y1, z], col, kind, 0, 0, 0);
        else this.quad(A, B, C, D, col, kind, 0, 0, 0, 0);
      }
    }
  }
  box(x, y, z, sx, sy, sz, col, kind) {
    const X = sx/2, Z = sz/2;
    const p = (a,b,c) => [x+a, y+b, z+c];
    this.quad(p(-X,0,-Z), p(X,0,-Z), p(X,sy,-Z), p(-X,sy,-Z), col, kind);
    this.quad(p(X,0,Z), p(-X,0,Z), p(-X,sy,Z), p(X,sy,Z), col, kind);
    this.quad(p(X,0,-Z), p(X,0,Z), p(X,sy,Z), p(X,sy,-Z), col, kind);
    this.quad(p(-X,0,Z), p(-X,0,-Z), p(-X,sy,-Z), p(-X,sy,Z), col, kind);
    this.quad(p(-X,sy,-Z), p(X,sy,-Z), p(X,sy,Z), p(-X,sy,Z), col, kind);
    this.quad(p(-X,0,Z), p(X,0,Z), p(X,0,-Z), p(-X,0,-Z), col, kind);
  }
  /* a tapered four-sided tube between two points — legs and claws, which are
     the only things here that don't run along an axis */
  tube(a, b, r0, r1, col, kind, pa, pb) {
    const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    const ax = dx/L, ay = dy/L, az = dz/L;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ay) > 0.9) { ux = 1; uy = 0; uz = 0; }
    let t1x = uy*az - uz*ay, t1y = uz*ax - ux*az, t1z = ux*ay - uy*ax;
    const l1 = Math.hypot(t1x, t1y, t1z) || 1; t1x /= l1; t1y /= l1; t1z /= l1;
    const t2x = ay*t1z - az*t1y, t2y = az*t1x - ax*t1z, t2z = ax*t1y - ay*t1x;
    const P = (base, rad, cc, ss) => [
      base[0] + (t1x*cc + t2x*ss)*rad,
      base[1] + (t1y*cc + t2y*ss)*rad,
      base[2] + (t1z*cc + t2z*ss)*rad];
    for (let i = 0; i < 4; i++) {
      const a0 = i/4*Math.PI*2, a1 = (i+1)/4*Math.PI*2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad(P(a, r0, c0, s0), P(a, r0, c1, s1), P(b, r1, c1, s1), P(b, r1, c0, s0),
                col, kind, pa, pa, pb, pb);
    }
  }
  mark(name, fn) {
    const start = this.count;
    fn(this);
    const part = { first: start, count: this.count - start };
    /* Measure the thing while we still have its vertices to hand. "span" is
       the largest dimension it occupies — a pennant is tall, a starfish is
       wide — and it is what the size slider works in, so a number in metres
       means the same thing for every object in the bag. */
    let hi = 0, rad = 0;
    for (let i = start; i < this.count; i++) {
      const o = i * 11;
      const x = this.v[o], y = this.v[o + 1], z = this.v[o + 2];
      if (y > hi) hi = y;
      const r = Math.hypot(x, z);
      if (r > rad) rad = r;
    }
    part.height = hi;
    part.radius = rad;
    part.span = Math.max(hi, rad * 2);
    this.parts[name] = part;
  }
}

/* ─────────────────────────── the catalogue ─────────────────────────── */
function buildProps() {
  const m = new Mesh();
  const wood  = [0.30, 0.235, 0.175];
  const wood2 = [0.42, 0.345, 0.265];
  const cloth = [0.78, 0.20, 0.20];
  const cloth2= [0.90, 0.72, 0.32];

  /* 0 — PENNANT */
  m.mark('flag', mm => {
    mm.cyl(0, 0, 0, 0.017, 0.013, 1.05, 7, wood, 0);
    mm.dome(0, 1.05, 0, 0.030, 0.045, 7, 3, [0.72,0.60,0.30], 0);
    // triangular pennant — kind 1 = cloth, param = distance along the fly
    const y0 = 0.68, y1 = 1.02;
    const N = 7;
    for (let i = 0; i < N; i++) {
      const t0 = i/N, t1 = (i+1)/N;
      const L = 0.52;
      const p0 = [0.012 + L*t0, y1 - t0*0.10, 0];
      const p1 = [0.012 + L*t1, y1 - t1*0.10, 0];
      const p2 = [0.012 + L*t1, y0 + t1*0.24, 0];
      const p3 = [0.012 + L*t0, y0 + t0*0.24, 0];
      mm.quad(p0, p1, p2, p3, i % 2 === 0 ? cloth : cloth2, 1, t0, t1, t1, t0);
      mm.quad(p3, p2, p1, p0, i % 2 === 0 ? cloth : cloth2, 1, t0, t1, t1, t0);
    }
  });

  /* 1 — SCALLOP SHELL */
  m.mark('shell', mm => {
    const col = [0.86, 0.76, 0.66], col2 = [0.72, 0.58, 0.50];
    const N = 15, R = 0.135;
    for (let i = 0; i < N; i++) {
      const a0 = -Math.PI*0.5 + Math.PI*(i/N), a1 = -Math.PI*0.5 + Math.PI*((i+1)/N);
      const rib0 = R*(1 + 0.055*Math.sin(i*3.1));
      const rib1 = R*(1 + 0.055*Math.sin((i+1)*3.1));
      const h0 = 0.035*Math.cos((i/N - 0.5)*Math.PI*1.1);
      const h1 = 0.035*Math.cos(((i+1)/N - 0.5)*Math.PI*1.1);
      const c = i % 2 === 0 ? col : col2;
      const A = [0, 0.006, 0];
      const B = [Math.cos(a0)*rib0, h0, Math.sin(a0)*rib0];
      const C = [Math.cos(a1)*rib1, h1, Math.sin(a1)*rib1];
      mm.tri(A, B, C, c, 0);
      mm.tri(A, C, B, [c[0]*0.7, c[1]*0.68, c[2]*0.66], 0);
    }
    // hinge
    mm.dome(0, 0, 0, 0.028, 0.022, 7, 2, col2, 0);
  });

  /* 2 — STARFISH */
  m.mark('star', mm => {
    const col = [0.80, 0.38, 0.24], col2 = [0.62, 0.26, 0.17];
    const arms = 5, R = 0.155, r = 0.055;
    for (let i = 0; i < arms*2; i++) {
      const a0 = i/(arms*2)*Math.PI*2, a1 = (i+1)/(arms*2)*Math.PI*2;
      const R0 = (i % 2 === 0) ? R : r, R1 = (i % 2 === 0) ? r : R;
      const h0 = (i % 2 === 0) ? 0.012 : 0.030, h1 = (i % 2 === 0) ? 0.030 : 0.012;
      const A = [0, 0.042, 0];
      const B = [Math.cos(a0)*R0, h0, Math.sin(a0)*R0];
      const C = [Math.cos(a1)*R1, h1, Math.sin(a1)*R1];
      mm.tri(A, B, C, i % 2 === 0 ? col : col2, 0);
      mm.tri([0,0.002,0], C, B, col2, 0);
    }
  });

  /* 3 — DRIFTWOOD */
  m.mark('wood', mm => {
    const rng = T.rng(9182);
    let x = -0.42, y = 0.045, z = 0, ang = 0.18;
    const seg = 7;
    for (let i = 0; i < seg; i++) {
      const t = i/seg;
      const r0 = 0.052*(1 - t*0.45) * (0.85 + rng()*0.3);
      const len = 0.135;
      const nx = x + Math.cos(ang)*len, nz = z + Math.sin(ang)*len;
      const ny = y + (rng()-0.5)*0.02;
      // a tapered segment as a short skewed cylinder
      const seg8 = 6;
      const ox = -Math.sin(ang), oz = Math.cos(ang);
      const P = (px,py,pz,ca,rr) => [px + ox*Math.cos(ca)*rr, py + Math.sin(ca)*rr, pz + oz*Math.cos(ca)*rr];
      for (let k = 0; k < seg8; k++) {
        const b0 = k/seg8*Math.PI*2, b1 = (k+1)/seg8*Math.PI*2;
        const A = P(x,y,z, b0, r0), B = P(x,y,z, b1, r0);
        const C = P(nx,ny,nz, b1, r0*0.92), D = P(nx,ny,nz, b0, r0*0.92);
        const sh = 0.72 + 0.28*Math.cos(b0);
        mm.quad(A, B, C, D, [0.40*sh+0.12, 0.355*sh+0.10, 0.315*sh+0.09], 0);
      }
      x = nx; z = nz; y = ny;
      ang += (rng()-0.5)*0.5;
    }
  });

  /* 4 — LANTERN */
  m.mark('lantern', mm => {
    const iron = [0.20, 0.17, 0.15];
    mm.cyl(0, 0, 0, 0.032, 0.024, 0.58, 7, [0.24,0.20,0.17], 0);
    mm.box(0, 0.58, 0, 0.145, 0.030, 0.145, iron, 0);              // base plate
    mm.box(0, 0.610, 0, 0.120, 0.150, 0.120, [1.0,0.72,0.34], 2);  // the flame, visible
    // four corner uprights, so the glass shows between them
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 0.062 : -0.062, sz = (i & 2) ? 0.062 : -0.062;
      mm.box(sx, 0.610, sz, 0.022, 0.150, 0.022, iron, 0);
    }
    mm.box(0, 0.760, 0, 0.150, 0.024, 0.150, iron, 0);
    const y = 0.784, C = [0, y + 0.080, 0], s = 0.078;
    const p = [[-s,y,-s],[s,y,-s],[s,y,s],[-s,y,s]];
    for (let i = 0; i < 4; i++) mm.tri(p[i], p[(i+1)%4], C, [0.28,0.24,0.21], 0);
    mm.cyl(0, y + 0.080, 0, 0.010, 0.006, 0.055, 5, iron, 0);
  });

  /* 5 — CAIRN (a stack of shore stones) */
  m.mark('cairn', mm => {
    const rng = T.rng(4471);
    let y = 0;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const r = 0.115*(1 - i/n*0.55)*(0.85 + rng()*0.3);
      const h = r*0.85;
      const g = 0.30 + rng()*0.20;
      mm.dome((rng()-0.5)*0.02, y, (rng()-0.5)*0.02, r, h, 8, 3, [g, g*0.98, g*0.95], 0, 0.85);
      y += h*0.86;
    }
  });

  /* 6 — PARASOL */
  m.mark('parasol', mm => {
    const pole = [0.62, 0.60, 0.56];
    mm.cyl(0, 0, 0, 0.020, 0.016, 1.02, 7, pole, 0);
    const cols = [[0.92,0.34,0.30],[0.97,0.94,0.88],[0.30,0.62,0.72],[0.97,0.94,0.88],
                  [0.95,0.72,0.26],[0.97,0.94,0.88],[0.45,0.66,0.38],[0.97,0.94,0.88]];
    const N = 8, R = 0.66, y0 = 1.00, sag = 0.16;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, am = (a0 + a1) / 2;
      const P = (an, rr, dy) => [Math.cos(an) * rr, y0 - dy, Math.sin(an) * rr];
      const A = [0, y0 + 0.10, 0];
      const B = P(a0, R, sag), C = P(am, R * 1.04, sag * 1.35), D = P(a1, R, sag);
      mm.tri(A, B, C, cols[i % 8], 0); mm.tri(A, C, D, cols[i % 8], 0);
      const sh = cols[i % 8].map(v => v * 0.55);
      mm.tri(A, C, B, sh, 0); mm.tri(A, D, C, sh, 0);
      // scalloped fringe
      mm.tri(B, C, [B[0]*1.06, B[1]-0.07, B[2]*1.06], cols[i % 8], 0);
    }
    mm.dome(0, y0 + 0.10, 0, 0.035, 0.055, 6, 2, pole, 0);
  });

  /* 7 — PINWHEEL (kind 4 spins) */
  m.mark('pinwheel', mm => {
    mm.cyl(0, 0, 0, 0.013, 0.010, 0.68, 6, [0.55, 0.52, 0.48], 0);
    const cols = [[0.95,0.32,0.30],[0.98,0.78,0.24],[0.30,0.66,0.78],
                  [0.52,0.76,0.36],[0.88,0.45,0.72],[0.98,0.94,0.90]];
    const y = 0.70;
    for (let i = 0; i < 6; i++) {
      const a0 = i / 6 * Math.PI * 2, a1 = a0 + Math.PI / 3.4;
      const R = 0.135;
      const A = [0, y, 0.012];
      const B = [Math.cos(a0) * R, y + Math.sin(a0) * R, 0.012];
      const C = [Math.cos(a1) * R * 0.72, y + Math.sin(a1) * R * 0.72, -0.014];
      mm.tri(A, B, C, cols[i], 4, 0, 1, 1);
      mm.tri(A, C, B, cols[i].map(v => v * 0.62), 4, 0, 1, 1);
    }
    mm.cyl(0, y - 0.012, 0, 0.016, 0.016, 0.026, 6, [0.90, 0.86, 0.80], 0);
  });

  /* 8 — TOY PAIL AND SPADE */
  m.mark('pail', mm => {
    const plastic = [0.92, 0.30, 0.26], rim = [0.98, 0.80, 0.24];
    mm.cyl(0.06, 0, 0, 0.115, 0.145, 0.20, 12, plastic, 0);
    mm.cyl(0.06, 0.20, 0, 0.145, 0.150, 0.022, 12, rim, 0);
    // handle
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI * (i / 8), a1 = Math.PI * ((i + 1) / 8);
      const P = an => [0.06 + Math.cos(an) * 0.145, 0.21 + Math.sin(an) * 0.115, 0];
      const A = P(a0), B = P(a1);
      mm.quad([A[0], A[1], -0.012], [B[0], B[1], -0.012],
              [B[0], B[1], 0.012], [A[0], A[1], 0.012], rim, 0);
    }
    // spade stuck in beside it
    mm.cyl(-0.20, 0, 0.05, 0.016, 0.014, 0.40, 6, [0.30, 0.60, 0.74], 0);
    mm.box(-0.20, 0.40, 0.05, 0.10, 0.030, 0.028, [0.30, 0.60, 0.74], 0);
  });

  /* 9 — TOY SAILBOAT */
  m.mark('boat', mm => {
    const hull = [0.90, 0.28, 0.24], deck = [0.94, 0.90, 0.84];
    const L = 0.30, W = 0.10, H = 0.075;
    for (let i = 0; i < 8; i++) {
      const t0 = i / 8 * 2 - 1, t1 = (i + 1) / 8 * 2 - 1;
      const w0 = W * Math.cos(t0 * 1.25), w1 = W * Math.cos(t1 * 1.25);
      const A = [t0 * L, 0, -w0], B = [t1 * L, 0, -w1];
      const C = [t1 * L, H, -w1 * 1.15], D = [t0 * L, H, -w0 * 1.15];
      mm.quad(A, B, C, D, hull, 0);
      mm.quad([t1*L,0,w1], [t0*L,0,w0], [t0*L,H,w0*1.15], [t1*L,H,w1*1.15], hull, 0);
      mm.quad([t0*L,H,-w0*1.15], [t1*L,H,-w1*1.15], [t1*L,H,w1*1.15], [t0*L,H,w0*1.15], deck, 0);
    }
    mm.cyl(0.0, H, 0, 0.010, 0.008, 0.42, 6, [0.62, 0.58, 0.52], 0);
    // sail — cloth, catches the wind
    const sy = H + 0.05;
    for (let i = 0; i < 5; i++) {
      const t0 = i / 5, t1 = (i + 1) / 5;
      const A = [0.012, sy + t0 * 0.34, 0], B = [0.012, sy + t1 * 0.34, 0];
      const C = [0.012 + (1 - t1) * 0.25, sy + t1 * 0.34, 0], D = [0.012 + (1 - t0) * 0.25, sy + t0 * 0.34, 0];
      const c = i % 2 === 0 ? [0.98, 0.96, 0.92] : [0.94, 0.55, 0.30];
      mm.quad(A, B, C, D, c, 1, t0, t1, t1, t0);
      mm.quad(D, C, B, A, c, 1, t0, t1, t1, t0);
    }
  });

  /* 10 — BOTTLE, with something in it */
  m.mark('bottle', mm => {
    const glass = [0.42, 0.62, 0.50];
    mm.cyl(0, 0.028, 0, 0.048, 0.050, 0.16, 9, glass, 0);
    mm.cyl(0, 0.188, 0, 0.050, 0.022, 0.055, 9, glass, 0);
    mm.cyl(0, 0.243, 0, 0.022, 0.022, 0.045, 9, glass, 0);
    mm.cyl(0, 0.288, 0, 0.024, 0.022, 0.026, 9, [0.72, 0.56, 0.34], 0);
    mm.dome(0, 0.0, 0, 0.048, 0.030, 9, 2, glass, 0);
    // the paper inside
    mm.box(0, 0.045, 0, 0.030, 0.11, 0.030, [0.92, 0.88, 0.76], 0);
  });

  /* 11 — KELP */
  m.mark('kelp', mm => {
    const rng = T.rng(5511);
    for (let f = 0; f < 5; f++) {
      const base = (rng() - 0.5) * 0.16, bz = (rng() - 0.5) * 0.16;
      const lean = (rng() - 0.5) * 0.5, hgt = 0.22 + rng() * 0.26;
      const g = 0.16 + rng() * 0.12;
      const col = [g * 0.9, g * 1.6, g * 1.0];
      for (let i = 0; i < 4; i++) {
        const t0 = i / 4, t1 = (i + 1) / 4;
        const w0 = 0.045 * (1 - t0 * 0.6), w1 = 0.045 * (1 - t1 * 0.6);
        const A = [base - w0, t0 * hgt, bz + lean * t0 * hgt];
        const B = [base + w0, t0 * hgt, bz + lean * t0 * hgt];
        const C = [base + w1, t1 * hgt, bz + lean * t1 * hgt];
        const D = [base - w1, t1 * hgt, bz + lean * t1 * hgt];
        mm.quad(A, B, C, D, col, 1, t0, t0, t1, t1);
        mm.quad(D, C, B, A, col.map(v => v * 0.7), 1, t0, t0, t1, t1);
      }
    }
  });

  return m;
}

function buildGull() {
  const m = new Mesh();
  const body = [0.92, 0.92, 0.93], tip = [0.16, 0.17, 0.19];
  m.dome(0, 0, 0, 0.075, 0.10, 7, 3, body, 0, 0.55);
  m.dome(0, 0, 0, 0.075, -0.06, 7, 3, body, 0, 0.55);
  m.tri([0.075,0.01,0], [0.16,0.0,0], [0.075,-0.01,0], [0.95,0.72,0.25], 0);
  // wings: kind 3, param = |span| for the flap
  for (let s = -1; s <= 1; s += 2) {
    const W = 0.42;
    const A = [-0.01, 0.015, 0], B = [-0.10, 0.0, s*W], C = [0.06, 0.005, s*W*0.62];
    m.tri(A, s > 0 ? B : C, s > 0 ? C : B, body, 3, 0, 1, 1);
    m.tri(A, s > 0 ? C : B, s > 0 ? B : C, body, 3, 0, 1, 1);
    const B2 = [-0.13, 0.0, s*W*1.05], C2 = [-0.05, 0.0, s*W*0.9];
    m.tri(B, s > 0 ? B2 : C2, s > 0 ? C2 : B2, tip, 3, 1, 1, 1);
  }
  return m;
}

/* A shore crab, about twenty centimetres across the carapace at scale 1.
   Legs are kind 5 and carry their position around the body in param, so the
   vertex shader can run a gait off a single phase number — which means the
   legs stop dead when the crab stops, for free. Claws are kind 6. */
function buildCrab() {
  const m = new Mesh();
  const shell  = [0.44, 0.20, 0.145];
  const shell2 = [0.54, 0.285, 0.19];
  const limb   = [0.48, 0.235, 0.16];
  const eye    = [0.04, 0.035, 0.04];

  /* carapace — wider than long, and flatter than either */
  m.dome(0, 0.034, 0, 0.100, 0.052, 13, 4, shell, 0, 0.70);
  m.dome(0, 0.034, 0, 0.100, -0.030, 13, 3, shell2, 0, 0.70);

  /* eight legs, four a side, alternating phase so it actually walks */
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 4; i++) {
      const zz = -0.048 + i*0.034;
      const ph = ((i*0.5) + (s > 0 ? 0.5 : 0.0)) % 1.0;
      const reach = 0.150 + (i === 0 || i === 3 ? -0.020 : 0.012);
      const hip  = [s*0.052, 0.040, zz];
      const knee = [s*(reach*0.62), 0.062, zz + s*0.004];
      const foot = [s*reach, 0.0, zz + 0.014];
      m.tube(hip,  knee, 0.0105, 0.0085, limb, 5, ph, ph);
      m.tube(knee, foot, 0.0085, 0.0035, limb, 5, ph, ph);
    }
  }

  /* two claws, held out in front — a fat hand with two short blunt fingers,
     because a pair of thin spikes reads as an insect, not a crab */
  for (let s = -1; s <= 1; s += 2) {
    const sh   = [s*0.052, 0.038, 0.050];
    const el   = [s*0.098, 0.030, 0.090];
    const hand = [s*0.124, 0.033, 0.116];
    m.tube(sh, el,  0.0135, 0.0120, limb,   6, 0.0, 0.25);
    m.tube(el, hand, 0.0180, 0.0170, shell2, 6, 0.30, 0.5);
    const tipU = [s*0.142, 0.041, 0.148];
    const tipL = [s*0.140, 0.021, 0.146];
    m.tube(hand, tipU, 0.0092, 0.0044, shell2, 6, 0.6,  1.0);
    m.tube(hand, tipL, 0.0092, 0.0044, shell2, 6, 0.6, -1.0);
  }

  /* eyestalks */
  for (let s = -1; s <= 1; s += 2) {
    const b = [s*0.026, 0.070, 0.044], tp = [s*0.030, 0.098, 0.050];
    m.tube(b, tp, 0.0060, 0.0055, limb, 0, 0, 0);
    m.dome(s*0.030, 0.096, 0.050, 0.0105, 0.011, 6, 2, eye, 0);
  }
  return m;
}

/* ─────────────────────────── shaders ─────────────────────────── */
const PROP_VS = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=3) in vec2 aInfo;
layout(location=4) in vec4 aI0;   // x y z rotY
layout(location=5) in vec4 aI1;   // scale health groundStick seed
uniform sampler2D uSand;
uniform vec4  uDomain;
uniform mat4  uVP;
uniform float uTime;
uniform float uWind;
uniform float uStick;
out vec3 vWP; out vec3 vN; out vec3 vCol; out float vKind; out float vHealth;
` + T.COMMON + `
vec2 worldToUV(vec2 p){ return (p - uDomain.xy)/uDomain.zw; }
float gy(vec2 p){
  vec2 uv = worldToUV(p);
  float s = 0.0;
  if(uv.x>=0.0&&uv.x<=1.0&&uv.y>=0.0&&uv.y<=1.0) s = textureLod(uSand, uv, 0.0).r;
  return bedrock(p) + s;
}
void main(){
  vec2 base = aI0.xz;
  float scale = aI1.x;
  float health = aI1.y;
  float ground = aI1.z;
  float seed = aI1.w;

  float y0 = mix(aI0.y, gy(base), ground);
  float e = 0.16;
  vec3 sn = normalize(vec3(gy(base-vec2(e,0.0)) - gy(base+vec2(e,0.0)), 2.0*e,
                           gy(base-vec2(0.0,e)) - gy(base+vec2(0.0,e))));

  vec3 p = aPos*scale;
  vec3 n = aNrm;

  /* wind on cloth */
  if(aInfo.x > 0.5 && aInfo.x < 1.5){
    float t = aInfo.y;
    float w = sin(uTime*5.1 + t*7.0 + seed*9.0)*0.11 + sin(uTime*8.3 + t*13.0)*0.045;
    p.z += w*t*scale*(0.35 + uWind);
    p.y += sin(uTime*4.0 + t*9.0)*0.03*t*scale;
    p.x *= 1.0 - 0.12*t*abs(w)*3.0;
  }
  /* wing flap */
  if(aInfo.x > 2.5 && aInfo.x < 3.5){
    float f = sin(uTime*7.4 + seed*11.0);
    p.y += aInfo.y*abs(p.z)*f*0.85;
    p.z *= 1.0 - 0.10*abs(f);
  }
  /* crab legs — the gait phase arrives in the seed slot, and it only advances
     while the crab is actually walking, so a crab that has stopped stands
     still without anyone having to tell the shader about it */
  if(aInfo.x > 4.5 && aInfo.x < 5.5){
    float ph = seed + aInfo.y*6.2831;
    float lift = max(0.0, sin(ph));
    float swing = cos(ph);
    float far = abs(p.x)/max(scale, 1e-4);       // 0 at the hip, 1 at the foot
    p.y += lift*0.055*far*scale;
    p.z += swing*0.030*far*scale;
    p.x -= swing*0.012*far*scale*sign(p.x);
  }
  /* claws — a slow idle open and close, and they wave when it hurries */
  if(aInfo.x > 5.5 && aInfo.x < 6.5){
    float w = sin(uTime*1.7 + seed*0.35)*0.5 + 0.5;
    p.y += aInfo.y*(0.006 + 0.014*w)*scale;
    p.z += abs(aInfo.y)*0.004*w*scale;
  }
  /* pinwheel — spins about its own axle, faster in a gust */
  if(aInfo.x > 3.5 && aInfo.x < 4.5){
    float spin = uTime*(1.6 + uWind*5.5) + seed*3.0;
    float pivot = 0.70*scale;
    float cs = cos(spin), sn = sin(spin);
    vec2 v = vec2(p.x, p.y - pivot);
    p.xy = vec2(v.x*cs - v.y*sn, v.x*sn + v.y*cs) + vec2(0.0, pivot);
    n.xy = vec2(n.x*cs - n.y*sn, n.x*sn + n.y*cs);
  }

  /* fallen props lie down */
  float fall = (1.0 - clamp(health, 0.0, 1.0))*1.45;
  float cf = cos(fall), sf = sin(fall);
  p = vec3(p.x*cf + p.y*sf, -p.x*sf + p.y*cf, p.z);
  n = vec3(n.x*cf + n.y*sf, -n.x*sf + n.y*cf, n.z);

  /* yaw */
  float ca = cos(aI0.w), sa = sin(aI0.w);
  p = vec3(p.x*ca + p.z*sa, p.y, -p.x*sa + p.z*ca);
  n = vec3(n.x*ca + n.z*sa, n.y, -n.x*sa + n.z*ca);

  /* lean with the sand */
  vec3 up = normalize(mix(vec3(0.0,1.0,0.0), sn, uStick*aI1.z));
  vec3 tx = normalize(cross(vec3(0.0,0.0,1.0), up));
  vec3 tz = cross(up, tx);
  vec3 wp = vec3(base.x, y0, base.y) + tx*p.x + up*p.y + tz*p.z;
  vec3 wn = normalize(tx*n.x + up*n.y + tz*n.z);

  vWP = wp; vN = wn; vCol = aCol; vKind = aInfo.x; vHealth = health;
  gl_Position = uVP*vec4(wp, 1.0);
}`;

const PROP_FS = `
in vec3 vWP; in vec3 vN; in vec3 vCol; in float vKind; in float vHealth;
out vec4 fragColor;
uniform float uNight;
uniform float uEmiss;
uniform float uStyle;
` + T.SHADOW + T.LIGHTENV + `
void main(){
  vec3 N = normalize(vN);
  vec3 Vv = uCamPos - vWP;
  float dist = length(Vv);
  vec3 V = Vv/max(dist,1e-4);
  if(dot(N,V) < 0.0) N = -N;

  float NoL = max(dot(N, uSunDir), 0.0);
  float sh = shadowAt(vWP + N*0.01, NoL);
  vec3 albedo = vCol;

  vec3 col;
  if(uStyle > 1.5){
    /* every stylised look treats a toy the same way: flat spot colour,
       three steps, and whatever the look does to it afterwards */
    vec3 sky3 = ambientFrom(vec3(0.0,1.0,0.0));
    vec3 sun3 = uSunColor + uMoonColor*3.0;
    vec3 a = saturate3(albedo, uStyle > 6.5 && uStyle < 7.5 ? 0.82 : 1.20);
    float key = softBands(NoL*mix(0.48, 1.0, sh), 3.0, 0.14);
    vec3 kc = mix(vec3(luma(sun3*0.13 + sky3*0.9)), sun3*0.13 + sky3*0.9, 0.55);
    col = a*kc*mix(0.44, 1.05, key);
    if(uStyle < 3.5)      col = mix(col, col*vec3(1.06,0.94,0.84), 0.35);   // Marram / Ordnance warm
    else if(uStyle < 5.5) col *= vec3(0.78, 1.00, 0.98);                    // Felt / Rockpool cool
    else if(uStyle > 7.5) col = mix(vec3(luma(col)), col, 0.40)*vec3(0.88,0.93,1.05);
  } else if(uStyle > 0.5){
    /* painted tin: two steps of light, a coloured shadow, a rim */
    vec3 sky3 = ambientFrom(vec3(0.0,1.0,0.0));
    vec3 sun3 = uSunColor + uMoonColor*3.0;
    vec3 a = saturate3(albedo, 1.22);
    float key = softBands(NoL*mix(0.55, 1.0, sh), 3.0, 0.13);
    vec3 kc = sun3*0.135 + sky3*0.85;
    kc = mix(vec3(luma(kc)), kc, 0.60);
    vec3 lit = a*kc;
    col = mix(lit*vec3(0.47,0.52,0.65) + a*sky3*0.42, lit, key);
    col += (sun3*0.05 + sky3*0.6)*pow(1.0 - max(dot(N,V),0.0), 3.0)*0.5*a;
  } else {
    col = albedo*(uSunColor*sh*NoL/PI*1.9 + ambientFrom(N)*1.0);
    col += albedo*uMoonColor*max(dot(N, uMoonDir), 0.0)*0.95;
  }

  /* thin cloth lets light through */
  if(vKind > 0.5 && vKind < 1.5){
    float back = max(dot(-N, uSunDir), 0.0);
    col += albedo*uSunColor*sh*back*0.55;
  }
  /* Emissive. Scaled against the current exposure so a lamp is a lamp at
     noon and at midnight — otherwise the night exposure turns it into a
     white hole. */
  if(vKind > 1.5 && vKind < 2.5){
    col += vec3(1.42, 0.80, 0.32)*uEmiss;
  }
  if(uStyle < 0.5){
    float rough = 0.62;
    vec3 H = normalize(V + uSunDir);
    float a2 = rough*rough;
    col += uSunColor*sh*F_Schlick(vec3(0.035), max(dot(V,H),0.0))
         * D_GGX(max(dot(N,H),0.0), a2)*V_Smith(max(dot(N,V),1e-4), NoL, a2)*NoL;
  }

  col = applyFog(col, dist, -V);
  fragColor = vec4(col, 1.0);
}`;

const PROP_DEPTH_FS = `
out vec4 fragColor;
in vec3 vWP; in vec3 vN; in vec3 vCol; in float vKind; in float vHealth;
void main(){ fragColor = vec4(1.0); }`;

/* ═══════════════════════════════════════════════════════════════════════ */
const TYPES = ['flag', 'shell', 'star', 'wood', 'lantern', 'cairn',
               'parasol', 'pinwheel', 'pail', 'boat', 'bottle', 'kelp'];
const MAX_INST = 160;
const MAX_CRAB = 11;

class Props {
  constructor(gl, sim) {
    this.gl = gl; this.sim = sim;
    const mesh = buildProps();
    this.parts = mesh.parts;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.v), gl.STATIC_DRAW);

    const gmesh = buildGull();
    this.gullPart = { first: 0, count: gmesh.count };
    this.gvbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gvbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gmesh.v), gl.STATIC_DRAW);

    const cmesh = buildCrab();
    this.crabPart = { first: 0, count: cmesh.count };
    this.cvbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cvbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cmesh.v), gl.STATIC_DRAW);

    this.prog  = new T.Program(gl, T.HEAD + PROP_VS, T.HEAD_S + T.COMMON + PROP_FS, 'prop');
    this.depth = new T.Program(gl, T.HEAD + PROP_VS, T.HEAD + PROP_DEPTH_FS, 'propDepth');

    this.inst = {};
    this.vao = {};
    for (const t of TYPES) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, MAX_INST * 8 * 4, gl.DYNAMIC_DRAW);
      this.inst[t] = { buf: b, data: new Float32Array(MAX_INST * 8), n: 0, dirty: false };
      this.vao[t] = this._makeVAO(this.vbo, b);
    }
    /* gulls */
    this.gullBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gullBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 16 * 8 * 4, gl.DYNAMIC_DRAW);
    this.gullData = new Float32Array(16 * 8);
    this.gullVAO = this._makeVAO(this.gvbo, this.gullBuf);
    this.gulls = [];
    const rng = T.rng(77);
    for (let i = 0; i < 7; i++) {
      this.gulls.push({
        a: rng()*Math.PI*2, r: 16 + rng()*30, y: 7 + rng()*10,
        sp: (0.10 + rng()*0.14)*(rng() > 0.5 ? 1 : -1), seed: rng()*10,
        cz: -6 + (rng()-0.5)*22, cx: (rng()-0.5)*22, bob: rng()*6.28
      });
    }
    /* crabs */
    this.crabBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.crabBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_CRAB * 8 * 4, gl.DYNAMIC_DRAW);
    this.crabData = new Float32Array(MAX_CRAB * 8);
    this.crabVAO = this._makeVAO(this.cvbo, this.crabBuf);
    this.crabs = [];
    const cr = T.rng(4211);
    for (let i = 0; i < MAX_CRAB; i++) {
      this.crabs.push({
        x: (cr() - 0.5) * 34, z: -16 + cr() * 20,
        dir: cr() * Math.PI * 2, sp: 0, gait: cr() * 6.28,
        face: cr() > 0.5 ? 1 : -1,
        scale: 0.52 + cr() * 0.36,
        t: cr() * 3, moving: false, bolt: 0
      });
    }

    this.list = [];
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _makeVAO(mesh, instBuf) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    const S = 11 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, S, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, S, 36);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const IS = 8 * 4;
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, IS, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, IS, 16);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  bindAttribLocations() { /* locations fixed by declaration order in the shader */ }

  /* how big each object is at scale 1, straight off its own geometry */
  span(type) { const p = this.parts[type]; return p ? p.span : 1; }
  footprint(type) { const p = this.parts[type]; return p ? Math.max(p.radius, 0.05) : 0.2; }

  add(type, x, y, z, rotY, scale) {
    if (this.list.length >= MAX_INST * 2) return null;
    const p = { type, x, y, z, rot: rotY, scale, health: 1, seed: Math.random() * 6.28, placedY: y };
    this.list.push(p);
    this._rebuild();
    return p;
  }
  removeLast() { if (this.list.length) { this.list.pop(); this._rebuild(); } }
  clear() { this.list.length = 0; this._rebuild(); }

  _rebuild() {
    for (const t of TYPES) this.inst[t].n = 0;
    for (const p of this.list) {
      const s = this.inst[p.type];
      if (!s || s.n >= MAX_INST) continue;
      const o = s.n * 8;
      s.data[o] = p.x; s.data[o+1] = p.y; s.data[o+2] = p.z; s.data[o+3] = p.rot;
      s.data[o+4] = p.scale; s.data[o+5] = p.health; s.data[o+6] = 1; s.data[o+7] = p.seed;
      s.n++; s.dirty = true;
    }
    for (const t of TYPES) {
      const s = this.inst[t];
      if (!s.dirty) continue;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data, 0, Math.max(s.n, 1) * 8);
      s.dirty = false;
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
  }

  /* waves knock things over */
  updateHealth(seaLevel, dt, onFall) {
    let changed = false;
    for (const p of this.list) {
      if (p.health <= 0.02) continue;
      const sub = seaLevel + 0.1 - p.y;
      if (sub > 0) {
        p.health -= dt * (0.35 + sub * 0.9);
        if (p.health < 0) p.health = 0;
        changed = true;
        if (p.health === 0 && onFall) onFall(p);
      }
    }
    if (changed) this._rebuild();
  }

  updateGulls(t, dt) {
    const d = this.gullData;
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i];
      g.a += g.sp * dt;
      const x = g.cx + Math.cos(g.a) * g.r;
      const z = g.cz + Math.sin(g.a) * g.r * 0.7;
      const y = g.y + Math.sin(t * 0.6 + g.bob) * 0.9;
      const o = i * 8;
      d[o] = x; d[o+1] = y; d[o+2] = z;
      d[o+3] = -g.a + (g.sp > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      d[o+4] = 1; d[o+5] = 1; d[o+6] = 0; d[o+7] = g.seed;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gullBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, this.gulls.length * 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /* Crabs. They scuttle in bursts and sit still between them, they walk
     sideways because crabs do, and they keep to the wet band above the
     waterline — so when the tide climbs they get pushed up the beach ahead of
     it without anyone scripting a retreat. Come at one with a tool and it
     bolts. The heightfield places them, so they walk over anything you build. */
  updateCrabs(t, dt, seaLevel, cursor) {
    const d = this.crabData;
    /* the beach profile the tide gauge uses, solved for z at the water's edge */
    const zWater = (1.55 - seaLevel) / 0.0705 - 24;
    const zSafe = zWater - 1.1;

    for (let i = 0; i < this.crabs.length; i++) {
      const c = this.crabs[i];

      if (cursor && cursor.valid) {
        const dx = c.x - cursor.x, dz = c.z - cursor.z;
        const r2 = dx*dx + dz*dz;
        if (r2 < 5.3) {
          c.dir = Math.atan2(dz, dx);          // straight away from the hand
          c.bolt = 1.1;
          c.moving = true;
          c.t = Math.max(c.t, 0.5);
        }
      }

      c.bolt = Math.max(0, c.bolt - dt);
      c.t -= dt;
      if (c.t <= 0) {
        if (c.moving) { c.moving = false; c.t = 0.7 + Math.random()*3.0; }
        else {
          c.moving = true;
          c.t = 0.4 + Math.random()*1.6;
          c.dir = Math.random()*Math.PI*2;
          c.sp = 0.30 + Math.random()*0.70;
          if (Math.random() < 0.25) c.face = -c.face;
        }
      }

      if (c.moving || c.bolt > 0) {
        const sp = (c.moving ? c.sp : 0.55) * (1 + c.bolt*2.4);
        let nx = c.x + Math.cos(c.dir)*sp*dt;
        let nz = c.z + Math.sin(c.dir)*sp*dt;
        /* the sea, and the ends of the world */
        if (nz > zSafe)  { c.dir = -Math.PI*0.5 + (Math.random()-0.5)*0.7; nz = zSafe; }
        if (nz < -21)    { c.dir =  Math.PI*0.5 + (Math.random()-0.5)*0.7; nz = -21; }
        if (nx >  21)    { c.dir = Math.PI - c.dir; nx = 21; }
        if (nx < -21)    { c.dir = Math.PI - c.dir; nx = -21; }
        c.x = nx; c.z = nz;
        c.gait += sp*dt*26.0;
      }
      /* a crab caught below the waterline by a rising tide legs it inland */
      if (c.z > zSafe) { c.z = zSafe; c.bolt = Math.max(c.bolt, 0.6); }

      const o = i*8;
      d[o] = c.x; d[o+1] = 0; d[o+2] = c.z;
      d[o+3] = c.dir + c.face*Math.PI*0.5;   // sideways, like a crab
      d[o+4] = c.scale; d[o+5] = 1; d[o+6] = 1; d[o+7] = c.gait;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.crabBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, this.crabs.length*8);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _drawAll(prog, env, isDepth) {
    const gl = this.gl, s = this.sim;
    prog.use();
    prog.tex('uSand', s.tex);
    if (!isDepth) {
      prog.tex('uSky', env.sky.tex).tex('uShadow', env.shadowTex);
      prog.set('uCamPos', env.cam.pos)
        .set('uSunDir', env.sky.sunDir).set('uSunColor', env.sky.sunColor)
        .set('uMoonDir', env.sky.moonDir).set('uMoonColor', env.sky.moonColor)
        .set('uFogK', env.fogK).set('uNight', env.sky.night)
        .set('uEmiss', env.emiss || 0.0).set('uStyle', env.style || 0)
        .set('uLightVP', env.lightVP).set('uShadowTexel', 1 / env.shadowRes)
        .set('uShadowOn', env.shadowOn ? 1 : 0);
    }
    prog.set('uDomain', s.domain).set('uTime', env.time).set('uWind', env.wind)
        .set('uVP', isDepth ? env.lightVP : env.cam.vp).set('uStick', 0.75);

    for (const t of TYPES) {
      const inst = this.inst[t];
      if (inst.n === 0) continue;
      const part = this.parts[t];
      gl.bindVertexArray(this.vao[t]);
      gl.drawArraysInstanced(gl.TRIANGLES, part.first, part.count, inst.n);
    }
    /* crabs lie flat on whatever they are standing on */
    prog.set('uStick', 0.95);
    gl.bindVertexArray(this.crabVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.crabPart.count, this.crabs.length);

    prog.set('uStick', 0.0);
    gl.bindVertexArray(this.gullVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.gullPart.count, this.gulls.length);
    gl.bindVertexArray(null);
  }

  draw(env) { this._drawAll(this.prog, env, false); }
  drawDepth(env) { this._drawAll(this.depth, env, true); }
}

T.Props = Props;
T.PROP_TYPES = TYPES;

})(TW);
