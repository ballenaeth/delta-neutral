/* ============================================================================
   TIDEWRIGHT — glsl.js
   The shared GLSL library. Every shader in the game #includes this by
   string-concatenation, so the beach profile, the wave field and the sky are
   *literally the same functions* on the simulation side and the render side.
   That is what keeps the water erosion lined up with the water you can see.
   ========================================================================== */
'use strict';

(function (T) {

/* ---------------------------------------------------------------- header */
T.HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;
T.HEAD_S = T.HEAD;

/* ---------------------------------------------------------------- common */
T.COMMON = `
#define PI  3.14159265359
#define TAU 6.28318530718

/* ─── hashes (Hoskins-style) ─── */
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash32(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

/* ─── noise ─── */
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  float a = hash12(i), b = hash12(i + vec2(1,0));
  float c = hash12(i + vec2(0,1)), d = hash12(i + vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float gnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  float a = dot(hash22(i)          *2.0-1.0, f);
  float b = dot(hash22(i+vec2(1,0))*2.0-1.0, f-vec2(1,0));
  float c = dot(hash22(i+vec2(0,1))*2.0-1.0, f-vec2(0,1));
  float d = dot(hash22(i+vec2(1,1))*2.0-1.0, f-vec2(1,1));
  return (mix(mix(a,b,u.x), mix(c,d,u.x), u.y))*0.72 + 0.5;
}
float fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for(int i=0;i<6;i++){
    if(i>=oct) break;
    s += a*vnoise(p); n += a; p *= 2.03; p += 17.1; a *= 0.5;
  }
  return s/max(n,1e-4);
}
float fbmG(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for(int i=0;i<6;i++){
    if(i>=oct) break;
    s += a*gnoise(p); n += a; p *= 2.07; p += 11.7; a *= 0.5;
  }
  return s/max(n,1e-4);
}

/* ─── smooth min / max ─── */
float smax(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(a-b)/k, 0.0, 1.0);
  return mix(b, a, h) + k*h*(1.0-h);
}

/* ═══════════════════════════════════════════════════════════════════════
   THE SHORE
   The bedrock: what is left when every loose grain has been taken away.
   Sea lies toward +Z; the dunes stand at -Z. Everything else is your doing.
   ═══════════════════════════════════════════════════════════════════════ */
/* additive, and zero outside its own footprint — a max() against this would
   pull the whole sea floor up to zero, which is a very quiet way to delete
   an ocean. */
float rockDome(vec2 p, vec2 c, float r, float h){
  vec2 q = (p - c)/vec2(r, r*0.78);
  float k = 1.0 - dot(q, q);
  if(k <= 0.0) return 0.0;
  return h * pow(k, 0.62) * (0.80 + 0.36*vnoise(p*1.7));
}

/* The working ground: where the shore is flat, where the loose sand is deep,
   and where anything you build is worth counting. One function, so the three
   can never disagree with each other. */
float buildPad(vec2 p){
  return smoothstep(23.0, 15.0, length((p - vec2(0.0, -7.0))*vec2(1.0, 0.92)));
}

float bedrock(vec2 p){
  float z = p.y;
  float y = 1.55 - 0.0705*(z + 24.0);

  // landward dune ridge — pushed out past the working ground so the camera
  // can pull back over the whole of it without burying itself
  y += 3.35 * smoothstep(-21.5, -31.0, z) * (0.85 + 0.4*vnoise(p*0.11));

  // the flat working pad — the shore is kindest where people build
  float pad = buildPad(p);

  /* and the hardpack dips away beneath it. The surface stays where it was;
     what changes is how far down you can go before you hit the bottom. */
  y -= 0.98*pad;

  // longshore undulation
  y += (0.42*vnoise(p*0.062) - 0.21) * (1.0 - 0.88*pad);
  y += (0.13*vnoise(p*0.21) - 0.065) * (1.0 - 0.72*pad);

  // ripple corduroy left by every tide that came before
  float rip = sin(z*2.15 + 5.2*vnoise(p*0.17) + 0.9*sin(p.x*0.31)) * 0.021;
  y += rip * smoothstep(-8.0, 4.0, z) * (1.0 - 0.55*pad);

  // headlands, for framing
  y += rockDome(p, vec2(-22.6,   7.5), 5.4, 3.10);
  y += rockDome(p, vec2( 23.8,  -1.5), 4.8, 2.70);
  y += rockDome(p, vec2(-19.6, -19.5), 6.2, 1.55);
  y += rockDome(p, vec2( 18.2, -21.0), 5.2, 1.95);
  y += rockDome(p, vec2( 26.0,  11.0), 3.2, 2.10);

  return y;
}

/* How bare the rock is here. Loose sand does not cling to the headlands, and
   asking bedrock() four times per pixel to find that out — which is what a
   finite-differenced slope costs — was more expensive than everything else in
   the frame put together. */
float domeMask(vec2 p, vec2 c, float r){
  vec2 q = (p - c)/vec2(r, r*0.78);
  return clamp(1.55 - dot(q, q)*1.55, 0.0, 1.0);
}
float rockiness(vec2 p){
  float m = domeMask(p, vec2(-22.6,   7.5), 5.4);
  m = max(m, domeMask(p, vec2( 23.8,  -1.5), 4.8));
  m = max(m, domeMask(p, vec2(-19.6, -19.5), 6.2));
  m = max(m, domeMask(p, vec2( 18.2, -21.0), 5.2));
  m = max(m, domeMask(p, vec2( 26.0,  11.0), 3.2));
  return m;
}

/* The loose sand the tide left last night. Shared by the simulation's initial
   state and by the coarse skirt that carries the beach past the sim domain,
   so the two meet without a step. */
float sandBed(vec2 p){
  float pad = buildPad(p);
  /* Deep. The hardpack dropped by 0.98 under the same pad, so the surface
     lands where it always did — but there is now the better part of two
     metres of sand over it, which is enough to cut a moat you can lose a
     spade in. */
  float d = 0.30 + 1.30*pad + 0.18*vnoise(p*0.33) + 0.08*vnoise(p*1.1);
  return max(d*(1.0 - rockiness(p)), 0.0);
}

/* ═══════════════════════════════════════════════════════════════════════
   THE MOULDS
   The plastic shapes in the bottom of every beach bag. Each one is a height
   profile over a unit disc: x = coverage (0 outside, 1 inside, soft at the
   rim), y = height as a fraction of the mould's depth. The simulation stamps
   with these and the sand shader draws their outline under your cursor from
   the same function, so the ghost you line up is exactly what turns out.
   ═══════════════════════════════════════════════════════════════════════ */
float boxD(vec2 p, vec2 c, vec2 hs){
  vec2 d = abs(p - c) - hs;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

vec2 mouldShape(vec2 q, int id, float p){
  float r = length(q);
  float a = atan(q.y, q.x);
  float cov = 0.0, hh = 1.0;

  if(id == 0){                                   /* round turret */
    cov = 1.0 - smoothstep(0.90, 1.00, r);
    hh  = 1.0 - 0.07*r;
    float n = max(p, 3.0);
    float k = fract(a/TAU*n + 0.5);
    float notch = smoothstep(0.26, 0.40, k)*(1.0 - smoothstep(0.60, 0.74, k));
    hh -= notch*0.15*smoothstep(0.52, 0.84, r);
  }
  else if(id == 1){                              /* square keep */
    vec2 d = abs(q);
    float m = max(d.x, d.y);
    cov = 1.0 - smoothstep(0.88, 0.98, m);
    hh  = 1.0;
    float cn = length(d - vec2(0.74));
    hh += (1.0 - smoothstep(0.14, 0.26, cn))*0.20;
    float t2 = (d.x > d.y) ? q.y : q.x;
    float k = fract(t2*2.4 + 0.5);
    float notch = smoothstep(0.28, 0.42, k)*(1.0 - smoothstep(0.58, 0.72, k));
    hh -= notch*0.13*smoothstep(0.60, 0.88, m)*(1.0 - smoothstep(0.14, 0.26, cn));
  }
  else if(id == 2){                              /* gatehouse */
    float dL = boxD(q, vec2(-0.62, 0.0), vec2(0.34, 0.36));
    float dR = boxD(q, vec2( 0.62, 0.0), vec2(0.34, 0.36));
    float dW = boxD(q, vec2( 0.00, 0.0), vec2(0.64, 0.24));
    float dd = min(min(dL, dR), dW);
    cov = 1.0 - smoothstep(-0.03, 0.04, dd);
    float tw = 1.0 - smoothstep(-0.02, 0.06, min(dL, dR));
    hh = mix(0.58, 1.0, tw);
    float arch = 1.0 - smoothstep(0.10, 0.24, abs(q.x));
    hh -= arch*(1.0 - tw)*0.26;
  }
  else if(id == 3){                              /* star fort */
    float R = 0.54 + 0.46*pow(abs(cos(2.5*a)), 0.55);
    cov = 1.0 - smoothstep(R - 0.07, R + 0.01, r);
    hh  = 1.0 - 0.13*r;
    float k = fract(a/TAU*10.0 + 0.5);
    hh -= smoothstep(0.3,0.44,k)*(1.0-smoothstep(0.56,0.7,k))*0.10*smoothstep(0.4,0.8,r);
  }
  else if(id == 4){                              /* stepped ziggurat */
    float m = max(abs(q.x), abs(q.y));
    cov = 1.0 - smoothstep(0.92, 1.00, m);
    float t = clamp(1.0 - m, 0.0, 1.0);
    hh = (floor(t*3.0) + 1.0)/3.0;
  }
  else if(id == 5){                              /* spire */
    cov = 1.0 - smoothstep(0.86, 0.98, r);
    hh  = pow(max(1.0 - r*0.98, 0.0), 0.62);
    hh *= 1.0 + 0.05*sin(a*7.0 + r*9.0);
  }
  else if(id == 6){                              /* scallop shell */
    float ribs = 0.5 + 0.5*cos(a*9.0);
    float R = 0.90 + 0.09*ribs;
    cov = 1.0 - smoothstep(R - 0.05, R + 0.01, r);
    /* A mould turns out flat-topped with near-vertical sides. Dome it and the
       outline stops reading — you get a lump, not a scallop. */
    hh  = 0.66 + 0.20*ribs + 0.16*sqrt(max(1.0 - r*r, 0.0));
  }
  else if(id == 7){                              /* fish */
    float e  = length(q*vec2(1.05, 1.85));
    float dB = e - 0.80;
    vec2  t  = q - vec2(-0.72, 0.0);
    float dT = max(abs(t.y)*1.05 + t.x*0.62, -t.x - 0.42);
    float dd = min(dB, dT);
    cov = 1.0 - smoothstep(-0.02, 0.05, dd);
    hh  = 0.74 + 0.26*sqrt(max(1.0 - min(e/0.80, 1.0)*min(e/0.80, 1.0), 0.0));
    hh *= 1.0 - smoothstep(0.62, 1.10, -q.x)*0.42;     // the tail sits lower
    float eye = 1.0 - smoothstep(0.06, 0.13, length(q - vec2(0.34, 0.16)));
    hh -= eye*0.22;
  }
  else if(id == 8){                              /* crab */
    float e   = length(q*vec2(1.20, 1.45));
    float dB  = e - 0.66;
    float dC1 = length(q - vec2(-0.70, 0.52)) - 0.25;
    float dC2 = length(q - vec2( 0.70, 0.52)) - 0.25;
    float dl  = 1e3;
    for(int i=0;i<3;i++){
      float y = 0.10 - float(i)*0.30;
      dl = min(dl, boxD(q, vec2(-0.70, y), vec2(0.30, 0.085)));
      dl = min(dl, boxD(q, vec2( 0.70, y), vec2(0.30, 0.085)));
    }
    float dd = min(min(dB, min(dC1, dC2)), dl);
    cov = 1.0 - smoothstep(-0.02, 0.05, dd);
    float body = 1.0 - smoothstep(-0.05, 0.12, dB);
    hh = mix(0.52, 0.74 + 0.26*sqrt(max(1.0 - min(e/0.66,1.0)*min(e/0.66,1.0), 0.0)), body);
    float ey = 1.0 - smoothstep(0.05, 0.12, min(length(q - vec2(-0.22, 0.30)),
                                                length(q - vec2( 0.22, 0.30))));
    hh += ey*0.16;
  }
  else {                                         /* starfish */
    float R = 0.40 + 0.60*pow(abs(cos(2.5*a)), 0.85);
    cov = 1.0 - smoothstep(R - 0.06, R + 0.01, r);
    hh  = 0.80 + 0.20*(1.0 - smoothstep(0.0, 0.55, r));
  }
  return vec2(clamp(cov, 0.0, 1.0), max(hh, 0.0));
}

/* ═══════════════════════════════════════════════════════════════════════
   THE WATER
   ═══════════════════════════════════════════════════════════════════════ */
const vec4 WAVE0 = vec4( 0.05, -1.00, 19.0, 0.200);
const vec4 WAVE1 = vec4(-0.26, -0.97, 12.2, 0.124);
const vec4 WAVE2 = vec4( 0.33, -0.95,  6.9, 0.066);
const vec4 WAVE3 = vec4(-0.14, -0.99,  3.9, 0.031);
const vec4 WAVE4 = vec4( 0.47, -0.89,  2.35,0.017);

vec4 waveParam(int i){
  if(i==0) return WAVE0;
  if(i==1) return WAVE1;
  if(i==2) return WAVE2;
  if(i==3) return WAVE3;
  return WAVE4;
}

/* the slow breathing of the sets — this is what runs the swash up the beach */
float seaLevelAt(float base, float t){
  return base
       + 0.118*sin(t*0.5100)
       + 0.067*sin(t*0.2410 + 1.73)
       + 0.028*sin(t*1.0700 + 0.41);
}

/* Gerstner sum with shoaling, refraction and depth-limited breaking.
   d   = still-water depth (m, clamped >= 0)
   amp = global swell scale
   returns xyz = displacement, w = breaking intensity 0..1                   */
vec4 gerstner(vec2 p, float t, float d, float amp, int nw){
  vec3 disp = vec3(0.0);
  float brk = 0.0, wsum = 0.0;

  /* First, how steep does this sum WANT to be? A Gerstner surface stays
     single-valued only while its total steepness stays under one; past that the
     crests roll over and the sheet passes through itself. The clamp below is
     per wave, so five waves were each allowed 0.92 and the sum was allowed 4.6
     — and on the late tides, where the swell is biggest and refraction has
     turned every component to face the beach so they add rather than cancel,
     it really did go over. That is the folded, overlapping, flickering
     triangles on a rising tide. Budget the whole sum instead of each part. */
  float stSum = 0.0;
  for(int i=0;i<5;i++){
    if(i>=nw) break;
    vec4 Wq = waveParam(i);
    float kq = TAU / Wq.z;
    float thq = tanh(clamp(kq*max(d, 0.015), 0.02, 10.0));
    float Aq = min(Wq.w*amp / sqrt(max(thq, 0.055)), 0.46*max(d, 0.02));
    stSum += min(0.92, Aq*kq*2.6);
  }
  float budget = min(1.0, 0.80/max(stSum, 1e-4));

  for(int i=0;i<5;i++){
    if(i>=nw) break;
    vec4 W = waveParam(i);
    float L = W.z;
    float k = TAU / L;
    vec2 dir = normalize(W.xy);
    float sh = 1.0 - smoothstep(0.0, 6.0, d);
    dir = normalize(mix(dir, vec2(0.0,-1.0), sh*0.88));

    float kd = clamp(k*max(d, 0.015), 0.02, 10.0);
    float th = tanh(kd);
    float c  = sqrt(9.81/k * th);
    float A  = W.w*amp / sqrt(max(th, 0.055));
    float Ab = 0.46*max(d, 0.02);
    float over = max(A - Ab, 0.0);
    brk  += (over / max(A,1e-4)) * W.w;
    wsum += W.w;
    A = min(A, Ab);

    float ph = dot(dir*k, p) - c*k*t;
    /* Horizontal orbital motion, and the whole reason the waterline used to
       come out as a comb of spikes. The depth under a vertex is measured
       *before* this term moves it, so a vertex shoved half a metre up a
       sloping beach carries the wrong depth with it — it ends up buried in one
       place and standing proud of the sand in the next, and the shore turns
       into a picket fence. Orbital motion belongs to deep water anyway: it
       collapses as the bottom comes up, so hold it off until there is real
       water under the wave, and never let it exceed the depth it is moving in. */
    float Q  = min(0.92, A*k*2.6)*budget;
    float horiz = min(min(Q/k, A*2.2), d*0.45)*smoothstep(0.06, 1.10, d);
    disp.xz -= dir*horiz*sin(ph);
    disp.y  += A*cos(ph);
  }
  return vec4(disp, clamp(brk/max(wsum,1e-4)*1.35, 0.0, 1.0));
}

/* cheap vertical-only query, for the simulation */
float waveY(vec2 p, float t, float d, float amp, out float brk){
  vec4 g = gerstner(p, t, d, amp, 3);
  brk = g.w;
  return g.y;
}

/* ═══════════════════════════════════════════════════════════════════════
   SKY SAMPLING  (lat-long LUT with a horizon-biased vertical axis)
   ═══════════════════════════════════════════════════════════════════════ */
vec2 dirToSkyUV(vec3 d){
  float az = atan(d.z, d.x)/TAU + 0.5;
  float e  = asin(clamp(d.y, -1.0, 1.0))/PI;          // -0.5 .. 0.5
  float v  = 0.5 + sign(e)*sqrt(abs(e)*2.0)*0.5;
  return vec2(az, clamp(v, 0.001, 0.999));
}
vec3 skyUVToDir(vec2 uv){
  float az = (uv.x - 0.5)*TAU;
  float s  = (uv.y - 0.5)*2.0;
  float el = sign(s)*s*s*0.5*PI;
  float cy = cos(el);
  return vec3(cy*cos(az), sin(el), cy*sin(az));
}

/* ═══════════════════════════════════════════════════════════════════════
   COLOUR
   ═══════════════════════════════════════════════════════════════════════ */
const mat3 ACES_IN = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602);
vec3 rrtOdt(vec3 v){
  vec3 a = v*(v + 0.0245786) - 0.000090537;
  vec3 b = v*(0.983729*v + 0.4329510) + 0.238081;
  return a/b;
}
vec3 tonemapACES(vec3 c){
  c = ACES_IN * c;
  c = rrtOdt(c);
  c = ACES_OUT * c;
  return clamp(c, 0.0, 1.0);
}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* ═══════════════════════════════════════════════════════════════════════
   BUCKET & SPADE
   The second look. Light gets sorted into a few flat steps, colour gets
   pushed, and everything reads as a painted toy left out on the sand.
   uStyle is 0 for Salt & Light and 1 for this.
   ═══════════════════════════════════════════════════════════════════════ */
float bands(float x, float n){
  return floor(clamp(x, 0.0, 0.999)*n + 0.5)/n;
}
/* soft-edged steps — hard floor() crawls when the sun moves */
float softBands(float x, float n, float w){
  float s = clamp(x, 0.0, 1.0)*n;
  float f = floor(s), r = s - f;
  return (f + smoothstep(0.5 - w, 0.5 + w, r))/n;
}
vec3 saturate3(vec3 c, float k){
  return mix(vec3(dot(c, vec3(0.2126,0.7152,0.0722))), c, k);
}

/* ═══════════════════════════════════════════════════════════════════════
   MARRAM
   The third look: a screen-printed travel poster. Light is not shaded, it is
   *separated* — five inks, and the tones between them are a rotated dot
   screen, exactly the way a print shop would do it. uStyle == 2.
   ═══════════════════════════════════════════════════════════════════════ */
float halftone(vec2 fc, float v, float ang, float scale){
  float c = cos(ang), s = sin(ang);
  vec2 p = vec2(fc.x*c - fc.y*s, fc.x*s + fc.y*c)/scale;
  vec2 g = fract(p) - 0.5;
  float r = sqrt(clamp(v, 0.0, 1.0))*0.74;
  return smoothstep(r + 0.075, r - 0.075, length(g));
}
/* five inks, dot-screened between each pair */
vec3 screenPrint(float L, vec2 fc, float ang, float scale,
                 vec3 i0, vec3 i1, vec3 i2, vec3 i3, vec3 i4){
  float t = clamp(L, 0.0, 0.9999)*4.0;
  float f = floor(t);
  float d = halftone(fc, t - f, ang, scale);
  vec3 a, b;
  if(f < 0.5)      { a = i0; b = i1; }
  else if(f < 1.5) { a = i1; b = i2; }
  else if(f < 2.5) { a = i2; b = i3; }
  else             { a = i3; b = i4; }
  return mix(a, b, d);
}
/* the sand run and the water run */
#define MAR_S0 vec3(0.128, 0.100, 0.104)
#define MAR_S1 vec3(0.392, 0.212, 0.190)
#define MAR_S2 vec3(0.745, 0.452, 0.288)
#define MAR_S3 vec3(0.918, 0.752, 0.510)
#define MAR_S4 vec3(0.972, 0.926, 0.836)
#define MAR_W0 vec3(0.055, 0.128, 0.170)
#define MAR_W1 vec3(0.070, 0.286, 0.330)
#define MAR_W2 vec3(0.145, 0.500, 0.505)
#define MAR_W3 vec3(0.430, 0.740, 0.690)
#define MAR_W4 vec3(0.955, 0.925, 0.855)
/* the same runs after dark — a printed look has to change plates for a night
   edition, or midnight comes out identical to noon */
#define NGT_S0 vec3(0.038, 0.046, 0.078)
#define NGT_S1 vec3(0.098, 0.124, 0.196)
#define NGT_S2 vec3(0.205, 0.256, 0.360)
#define NGT_S3 vec3(0.390, 0.455, 0.560)
#define NGT_S4 vec3(0.690, 0.735, 0.800)
#define NGT_W0 vec3(0.022, 0.036, 0.070)
#define NGT_W1 vec3(0.048, 0.084, 0.150)
#define NGT_W2 vec3(0.098, 0.160, 0.250)
#define NGT_W3 vec3(0.215, 0.300, 0.400)
#define NGT_W4 vec3(0.640, 0.690, 0.760)
/* how far past sundown we are, straight off the sun's transmitted colour */
float nightOf(vec3 sunCol){ return clamp(1.0 - luma(sunCol)*2.2, 0.0, 1.0); }


/* ═══════════════════════════════════════════════════════════════════════
   BRDF pieces
   ═══════════════════════════════════════════════════════════════════════ */
float D_GGX(float NoH, float a){
  float a2 = a*a;
  float d = NoH*NoH*(a2 - 1.0) + 1.0;
  return a2/(PI*d*d + 1e-7);
}
float V_Smith(float NoV, float NoL, float a){
  float a2 = a*a;
  float gv = NoL*sqrt(NoV*NoV*(1.0-a2)+a2);
  float gl = NoV*sqrt(NoL*NoL*(1.0-a2)+a2);
  return 0.5/max(gv+gl, 1e-5);
}
vec3 F_Schlick(vec3 f0, float u){
  float f = pow(1.0 - u, 5.0);
  return f0 + (1.0 - f0)*f;
}
/* Oren–Nayar, the reason a lit sand slope looks flat and chalky rather than
   like a shiny sphere. Sand is about as rough as a diffuse surface gets. */
float orenNayar(vec3 N, vec3 V, vec3 L, float rough){
  float NoL = max(dot(N,L), 0.0);
  float NoV = max(dot(N,V), 0.0);
  float s = rough*rough;
  float A = 1.0 - 0.5*s/(s + 0.33);
  float B = 0.45*s/(s + 0.09);
  float cosPhi = dot(normalize(V - N*NoV + 1e-6), normalize(L - N*NoL + 1e-6));
  float av = acos(clamp(NoV, 0.03, 1.0));
  float al = acos(clamp(NoL, 0.03, 1.0));
  float a = max(av, al), b = min(av, al);
  return NoL*(A + B*max(cosPhi,0.0)*sin(a)*min(tan(b), 3.0));
}
`;

/* ---------------------------------------------------------------- sand field */
/* Sampling helpers for the simulation texture. Kept separate because only
   shaders that actually own a sand texture need them.                        */
T.SANDFIELD = `
uniform sampler2D uSand;      // r sand depth · g moisture · b compaction · a water film
uniform vec4  uDomain;        // minX minZ sizeX sizeZ
uniform vec2  uTexel;         // 1/res
uniform float uRes;

vec2 uvToWorld(vec2 uv){ return uDomain.xy + uv*uDomain.zw; }
vec2 worldToUV(vec2 p){ return (p - uDomain.xy)/uDomain.zw; }

vec4 sandBilinear(vec2 uv){
  vec2 t = uv*uRes - 0.5;
  vec2 i = floor(t), f = fract(t);
  vec2 b = (i + 0.5)*uTexel;
  vec4 s00 = texture(uSand, b);
  vec4 s10 = texture(uSand, b + vec2(uTexel.x, 0.0));
  vec4 s01 = texture(uSand, b + vec2(0.0, uTexel.y));
  vec4 s11 = texture(uSand, b + uTexel);
  return mix(mix(s00,s10,f.x), mix(s01,s11,f.x), f.y);
}

/* total ground height at a world position */
float groundY(vec2 p){
  return bedrock(p) + sandBilinear(worldToUV(p)).r;
}
`;

/* ---------------------------------------------------------------- shadows */
T.SHADOW = `
uniform highp sampler2DShadow uShadow;
uniform mat4  uLightVP;
uniform float uShadowTexel;
uniform float uShadowOn;

float shadowAt(vec3 wp, float NoL){
  if(uShadowOn < 0.5) return 1.0;
  vec4 lp = uLightVP * vec4(wp, 1.0);
  vec3 pc = lp.xyz/lp.w*0.5 + 0.5;
  if(pc.x<0.002||pc.x>0.998||pc.y<0.002||pc.y>0.998||pc.z>0.999) return 1.0;
  float bias = clamp(0.0016*tan(acos(clamp(NoL,0.02,1.0))), 0.0004, 0.006);
  pc.z -= bias;
  float s = 0.0;
  // 3x3 rotated Poisson — cheap, soft enough for sand
  const vec2 P[9] = vec2[9](
    vec2( 0.000, 0.000), vec2( 0.940, 0.170), vec2( 0.290, 0.940),
    vec2(-0.680, 0.640), vec2(-0.960,-0.230), vec2(-0.310,-0.910),
    vec2( 0.660,-0.720), vec2( 0.470, 0.520), vec2(-0.520,-0.400));
  float ang = hash12(floor(wp.xz*140.0))*TAU;
  float ca = cos(ang), sa = sin(ang);
  mat2 rot = mat2(ca, sa, -sa, ca);
  for(int i=0;i<9;i++){
    vec2 o = rot*P[i]*uShadowTexel*1.35;
    s += texture(uShadow, vec3(pc.xy + o, pc.z));
  }
  return s/9.0;
}
`;

/* ---------------------------------------------------------------- lighting env */
T.LIGHTENV = `
uniform sampler2D uSky;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uMoonDir;
uniform vec3  uMoonColor;
uniform vec3  uCamPos;
uniform float uTime;
uniform float uFogK;

vec3 skySample(vec3 d, float lod){ return textureLod(uSky, dirToSkyUV(normalize(d)), lod).rgb; }

vec3 ambientFrom(vec3 N){
  vec3 up  = skySample(vec3(0.0,1.0,0.0), 5.0);
  vec3 a   = skySample(normalize(N + vec3(0.0,0.25,0.0)), 4.0);
  return mix(a, up, 0.35);
}

/* aerial perspective — thin, but it is what puts the headlands "away" */
vec3 applyFog(vec3 col, float dist, vec3 rd){
  float f = 1.0 - exp(-dist*uFogK);
  vec3 sky = skySample(rd, 2.0);
  float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 8.0);
  sky += uSunColor*sunAmt*0.35;
  return mix(col, sky, clamp(f, 0.0, 1.0));
}
`;

})(TW);
