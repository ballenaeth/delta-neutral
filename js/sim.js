/* ============================================================================
   TIDEWRIGHT — sim.js
   The sand. A continuous heightfield solved on the GPU: eight-neighbour
   avalanche relaxation against a *variable* angle of repose, capillary
   moisture, water-film shallow flow, and wave fluidisation.

   The whole design rests on one function, repose():
       dry sand      →  ~33°   (a slope, never a wall)
       damp + packed →  past vertical
       saturated     →  it runs like soup
   Every transfer between two cells is exactly antisymmetric, so sand is
   conserved to the last grain. That is what makes the pail meter honest, and
   what makes an undermined wall fall down without anyone scripting it.
   ========================================================================== */
'use strict';

(function (T) {

/* ─────────────────────────── shared simulation glsl ─────────────────────── */
const SIM_LIB = `
uniform vec4  uDomain;
uniform vec2  uTexel;
uniform float uRes;

vec2 uvToWorld(vec2 uv){ return uDomain.xy + uv*uDomain.zw; }
vec2 worldToUV(vec2 p){ return (p - uDomain.xy)/uDomain.zw; }

/* the angle of repose, as a slope (rise over run) */
float repose(float m, float c){
  float wet  = smoothstep(0.035, 0.55, m);
  float over = smoothstep(0.90, 1.0, m);
  float s = mix(0.655, 3.9, wet);
  s *= (1.0 + 2.35*c);
  /* Packed sand keeps its shape after it dries. The water is what let you
     build the face; the packing is what holds it up, and packing does not
     evaporate. Without this floor a tower you moulded at noon slumps into a
     heap by mid-afternoon, which is not what a beach does. */
  s = max(s, 0.655 + 14.0*c*c);
  /* soaking still ruins it — a floor for dry sand, not for soup */
  s *= (1.0 - 0.86*over);
  return max(s, 0.38);
}
`;

/* ─────────────────────────── initial state ─────────────────────────── */
const INIT_FS = `
in vec2 vUV; out vec4 fragColor;
uniform float uSeaBase;
` + SIM_LIB + `
void main(){
  vec2 wp = uvToWorld(vUV);
  float b = bedrock(wp);
  float depth = sandBed(wp);
  /* wetness follows the *surface*, not the hardpack — the top of a deep bed
     dries in the sun exactly like a shallow one */
  float wet = smoothstep(0.55, -0.35, b + depth - uSeaBase);
  float m = clamp(wet*0.92 + 0.06 + 0.05*vnoise(wp*0.6), 0.0, 1.0);
  fragColor = vec4(depth, m, 0.0, 0.0);
}`;

/* ─────────────────────────── the step ─────────────────────────── */
const STEP_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSand;
uniform sampler2D uDeposit;
uniform float uDepScale;
uniform float uDt, uTime, uSeaBase, uWaveAmp, uErodeK, uSunDry;
uniform vec4  uBrushA;   // x z radius strength
uniform vec4  uBrushB;   // x z mode param
uniform vec4  uStamp;    // x z radius height
uniform vec4  uStamp2;   // detail baseY pailGate active
uniform vec4  uStamp3;   // mouldId rotation moisture spare
` + SIM_LIB + `

float segDist(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float t = clamp(dot(pa,ba)/max(dot(ba,ba), 1e-6), 0.0, 1.0);
  return length(pa - ba*t);
}

/* how hard the sea is working this cell, right now */
float waveWork(vec2 wp, float gy){
  if(uErodeK <= 0.0) return 0.0;
  float sl = seaLevelAt(uSeaBase, uTime);
  float still = sl - gy;
  /* the wave is depth-limited, so anything above still water is untouched —
     and skipping it here is what keeps the whole solver cheap */
  if(still <= 0.0) return 0.0;
  float brk;
  float wy = sl + waveY(wp, uTime, still, uWaveAmp, brk);
  float depth = wy - gy;
  if(depth <= 0.0) return 0.0;
  float thin = exp(-max(depth,0.0)*1.25) * smoothstep(0.0, 0.045, depth);
  return clamp((0.30 + 1.85*brk) * thin * uErodeK, 0.0, 2.2);
}

const vec2 OFF[8] = vec2[8](
  vec2( 1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0,-1.0),
  vec2( 1.0, 1.0), vec2(-1.0, 1.0), vec2(1.0,-1.0), vec2(-1.0,-1.0));

void main(){
  vec2 uv = vUV;
  vec2 wp = uvToWorld(uv);
  vec4 S  = texture(uSand, uv);
  float h = S.r, m = S.g, c = S.b, f = S.a;
  float b0 = bedrock(wp);
  float H0 = b0 + h;
  float cs = uDomain.z/uRes;

  float wa   = waveWork(wp, H0);
  float rep0 = repose(m, c);
  float resist = 1.0/(1.0 + 3.4*c + 1.1*m);
  rep0 *= (1.0 - 0.93*clamp(wa*resist, 0.0, 1.0));
  float rate = 0.115 + 0.42*clamp(wa, 0.0, 1.0);

  float dSand = 0.0, mAcc = 0.0, cAcc = 0.0, wAcc = 0.0;
  float mDiff = 0.0, sumH = 0.0, nH = 0.0;
  float dFilm = 0.0, flowMag = 0.0;
  float surf = H0 + f;

  for(int i=0;i<8;i++){
    vec2 o = OFF[i];
    vec2 nuv = uv + o*uTexel;
    if(nuv.x < 0.0 || nuv.x > 1.0 || nuv.y < 0.0 || nuv.y > 1.0) continue;
    vec4 Sn = texture(uSand, nuv);
    vec2 nwp = uvToWorld(nuv);
    float bn = bedrock(nwp);
    float Hn = bn + Sn.r;
    sumH += Hn; nH += 1.0;
    mDiff += (Sn.g - m);

    float dist = length(o)*cs;
    float wan = waveWork(nwp, Hn);
    float repn = repose(Sn.g, Sn.b);
    repn *= (1.0 - 0.93*clamp(wan/(1.0 + 3.4*Sn.b + 1.1*Sn.g), 0.0, 1.0));
    float rep = 0.5*(rep0 + repn);
    /* Relaxation rate for this pair — and it has a hard ceiling. All eight
       neighbours pull on the same cell in the same substep, so a per-neighbour
       rate much past an eighth overshoots: the cell throws away more than its
       excess, the neighbour throws it straight back, and the pair rings at the
       grid frequency. Under a breaking wave this used to reach 0.535, four
       times over the limit, and the shoreline came out as a row of alternating
       one-cell spikes — a picket fence that was the solver oscillating, not the
       sea eroding. The sea still bites just as hard; it does it by dropping the
       angle of repose, which is the physical lever, not by moving sand faster
       than the scheme can stay stable. */
    float rt  = min(0.5*(rate + 0.115 + 0.42*clamp(wan,0.0,1.0)), 0.118);

    float dH  = H0 - Hn;
    float thr = rep*dist;
    float t = 0.0;
    if(dH > thr)        t = -(dH - thr);
    else if(dH < -thr)  t =  (-dH - thr);
    t *= rt;
    /* Symmetric clamp — identical expression evaluated from either side, so
       the pair transfer stays exactly antisymmetric.
       The 1/9 matters: with eight neighbours each allowed a bigger share, a
       cell under a breaking wave can be asked for more sand than it owns,
       go negative, get clamped at zero — and that clamp quietly mints sand.
       Left alone it grows dunes out of nothing during a storm. */
    if(t < 0.0) t = -min(-t, h*0.111);
    else        t =  min( t, Sn.r*0.111);
    dSand += t;
    if(t > 0.0){ mAcc += Sn.g*t; cAcc += Sn.b*t; wAcc += t; }

    /* water film — shallow flow over the surface */
    if(i < 4){
      float sn = Hn + Sn.a;
      float fl = (surf - sn)*0.26;
      fl = clamp(fl, -Sn.a*0.24, f*0.24);
      dFilm -= fl;
      flowMag += abs(fl);
    }
  }

  float hOld = h;
  h = max(h + dSand, 0.0);

  /* material that moved carries its own wetness and arrives unpacked */
  if(wAcc > 1e-6){
    float denom = max(hOld + wAcc, 1e-4);
    m = clamp((m*max(hOld,0.0) + mAcc)/denom, 0.0, 1.0);
    c = clamp((c*max(hOld,0.0) + cAcc*0.35)/denom, 0.0, 1.0);
  }
  /* Sand that moves arrives unpacked — but only in proportion to how much of
     the column actually moved. Wiping the whole cell's packing the instant a
     single grain shifts makes slumping self-feeding: it loosens, so it slumps
     more, so it loosens more, and a tower that should have settled a centimetre
     runs all the way down to a heap. */
  c *= 1.0 - clamp(abs(dSand)/max(h, 0.08), 0.0, 1.0)*0.55;
  /* capillary spread — small, or a wet tower drains into the dry beach
     around it in a couple of seconds */
  m = clamp(m + mDiff*0.0022, 0.0, 1.0);

  f = max(f + dFilm, 0.0);

  /* ── the sea's chemistry ── */
  float sl = seaLevelAt(uSeaBase, uTime);
  float table = smoothstep(0.40, -0.30, H0 - sl);
  m = max(m, table*0.98);

  if(wa > 0.0){
    m = max(m, clamp(wa*1.4, 0.0, 1.0));
    f = max(f, min(wa*0.16, 0.22));
    c = max(c - uDt*wa*0.85, 0.0);
  }

  float infil = min(f, uDt*0.62);
  f -= infil;
  m = clamp(m + infil*2.4/max(h, 0.06), 0.0, 1.0);

  /* Evaporation. Slow enough that a wall you wet at the start of a tide is
     still standing at the end of it, fast enough that you have to keep the
     bucket moving. Roughly a hundred seconds of full sun to go from soaked
     to useless. */
  float mWet = m;
  m -= uDt*uSunDry*(0.0019 + 0.0044*(1.0 - table));
  m = clamp(m, 0.0, 1.0);
  f = max(0.0, f - uDt*0.085);

  /* Sand that dries out of a wet state sets. The bridges between the grains
     go with the water, but the grains have already locked where you pressed
     them and the surface crusts over — so a castle stiffens as it dries
     instead of collapsing. Only sand that was genuinely wet earns it; dry
     beach sand blown into a heap sets to nothing. */
  c = clamp(c + max(mWet - m, 0.0)*1.6*smoothstep(0.12, 0.42, mWet), 0.0, 1.0);

  /* Packing barely fades on its own — it is undone by the sea, by digging and
     by slumping, all of which take it away far faster than time does. */
  c = max(0.0, c - uDt*(0.0004 + 0.042*smoothstep(0.91, 1.0, m)));

  /* ═══════════ sand that has just landed ═══════════
     Applied on the first substep only — uDepScale is 0 for the rest, or the
     same handful would be delivered two or three times a frame. */
  if(uDepScale > 0.0){
    vec2 dp = texture(uDeposit, uv).rg*uDepScale;
    if(dp.r > 0.00002){
      h += dp.r;
      float arrM = dp.g/max(dp.r, 1e-6);
      /* A column carries one moisture, so blending arrivals against its whole
         depth would dilute a bucket of wet sand into whatever dry metre it
         happened to land on. Only the top of a pile behaves wet — mix against
         a shallow active layer instead. */
      float skin = min(h - dp.r, 0.35);
      m = clamp((m*skin + arrM*dp.r)/max(skin + dp.r, 1e-4), 0.0, 1.0);
      c *= 1.0 - min(dp.r*8.0, 0.88);        // it arrives loose, every time
    }
  }

  /* ═══════════ the tool ═══════════ */
  int mode = int(uBrushB.z + 0.5);
  if(mode > 0){
    float r = uBrushA.z;
    float d = segDist(wp, uBrushA.xy, uBrushB.xy);
    float w = 1.0 - smoothstep(r*0.24, r, d);
    if(w > 0.0015){
      float s = uBrushA.w*uDt;
      float avgH = nH > 0.0 ? sumH/nH : H0;

      if(mode == 1){                       // SHOVEL
        float take = min(h, s*1.35*w);
        h -= take;
        c *= 1.0 - w*0.55;
        f = max(f, 0.0);
      } else if(mode == 2){                // POUR
        h += s*1.15*w*uBrushB.w;
        c *= 1.0 - w*0.72;
        m = mix(m, m*0.86, w*0.4);
      } else if(mode == 3){                // PAT
        c = clamp(mix(c, 1.0, clamp(w*s*3.1, 0.0, 1.0)), 0.0, 1.0);
        float settle = clamp(w*s*2.2, 0.0, 0.9);
        h = mix(h, max(avgH - b0, 0.0), settle*0.55);
        h -= s*w*0.035*h;
      } else if(mode == 4){                // WATER
        /* the bucket takes you to damp, not to soup — you have to work at
           ruining it, which is exactly how it goes on a real beach */
        m = clamp(mix(m, 0.86, clamp(w*s*2.4,0.0,1.0)), 0.0, 1.0);
        f += s*w*0.42;
      } else if(mode == 5){                // CARVE
        /* A blade, not a scoop. Everything you drag over comes down to the
           level you first pressed on — press beside a wall, drag through it,
           and you have a gateway rather than a dent. The cut edge is hard,
           because a soft one just slumps back in behind the spade; packing it
           lifts the angle of repose enough that the slot stands. */
        float wc = 1.0 - smoothstep(r*0.74, r, d);
        float floorY = clamp(uBrushB.w - b0, 0.0, 6.0);
        h -= clamp(h - floorY, 0.0, s*2.6)*wc;
        /* only sand still standing above the cut gets pressed — otherwise a
           stroke run along flat ground at its own level packs the whole beach,
           and Carve quietly becomes a Pat with a narrower brush */
        float proud = smoothstep(0.02, 0.16, h - floorY);
        c = clamp(max(c, wc*proud*0.92), 0.0, 1.0);
      } else if(mode == 6){                // RAMPART
        float want = clamp(uBrushB.w - b0, 0.0, 5.0);
        float rise = clamp(want - h, 0.0, s*2.6)*w*uStamp2.z;
        h += rise;
        c = clamp(mix(c, 0.62, w*0.30), 0.0, 1.0);
      } else if(mode == 7){                // DRIP
        float n = vnoise(wp*11.0 + vec2(uTime*1.7, uTime*-1.1));
        float n2 = vnoise(wp*31.0 - uTime*2.3);
        float blob = w*w*(0.35 + 1.25*n*n) * (0.6 + 0.8*n2);
        h += s*0.34*blob*uBrushB.w;
        m = clamp(mix(m, 0.93, w*0.55), 0.0, 1.0);
        c = clamp(mix(c, 0.50, w*0.30), 0.0, 1.0);
      } else if(mode == 8){                // LEVEL
        float want = clamp(uBrushB.w - b0, 0.0, 5.0);
        h += clamp(want - h, -s*2.0, s*2.0)*w;
      } else if(mode == 9){                // SMOOTH
        h = mix(h, max(avgH - b0, 0.0), clamp(w*s*3.4, 0.0, 0.92));
      } else if(mode == 11){               // SCOOP — filling the mould
        float take = min(h, s*1.6*w*w);
        h -= take;
        c *= 1.0 - w*0.40;
      }
    }
  }

  /* ═══════════ turning out the mould ═══════════ */
  if(uStamp.z > 0.0 && uStamp2.w > 0.5){
    vec2  rel = wp - uStamp.xy;
    float R   = uStamp.z;
    if(dot(rel, rel) < R*R*4.0){
      float ro = uStamp3.y;
      float ca = cos(-ro), sa = sin(-ro);
      vec2 q = vec2(rel.x*ca - rel.y*sa, rel.x*sa + rel.y*ca)/R;
      int mid = int(uStamp3.x + 0.5);
      vec2 ms = mouldShape(q, mid, uStamp2.x);
      /* The same silhouette, dilated: sampling nearer the centre pushes the
         coverage boundary outward. This is the sand that squeezes out under
         the rim — it follows the shape. A radial skirt instead would leave a
         raised disc round everything, which reads as a plinth, not as sand. */
      vec2 msO = mouldShape(q*0.84, mid, uStamp2.x);

      float baseY = uStamp2.y;
      float topY  = baseY + uStamp.w*ms.y;
      /* outside the shape, measure from the ground that is actually here —
         never from the height of the spot you clicked */
      float collar = (b0 + h) + msO.x*0.065;
      float want   = mix(collar, topY, ms.x) - b0;
      if(want > h){
        float k = clamp(ms.x*1.6, 0.0, 1.0);
        h = want;
        /* the sand that comes out is the sand that went in, pressed hard
           against the inside of the mould on its way */
        m = mix(m, uStamp3.z, k);
        c = max(c, 0.80*k);
      }
    }
  }

  h = clamp(h, 0.0, 6.0);
  fragColor = vec4(h, m, c, min(f, 0.6));
}`;

/* ─────────────────────────── ambient occlusion ─────────────────────────── */
const AO_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSand;
` + SIM_LIB + `
float gy(vec2 p){
  vec2 uv = worldToUV(p);
  float s = 0.0;
  if(uv.x>=0.0 && uv.x<=1.0 && uv.y>=0.0 && uv.y<=1.0) s = texture(uSand, uv).r;
  return bedrock(p) + s;
}
void main(){
  vec2 wp = uvToWorld(vUV);
  float h0 = gy(wp);
  float vis = 0.0;
  float jitter = hash12(floor(vUV*uRes))*TAU;
  for(int d=0; d<8; d++){
    float a = (float(d) + 0.5)/8.0*TAU + jitter;
    vec2 dir = vec2(cos(a), sin(a));
    float maxS = 0.0;
    float dist = 0.055;
    for(int s=0; s<9; s++){
      float hq = gy(wp + dir*dist);
      maxS = max(maxS, (hq - h0)/dist);
      dist *= 1.52;
    }
    vis += 1.0 - maxS/sqrt(1.0 + maxS*maxS);
  }
  vis /= 8.0;
  fragColor = vec4(clamp(vis, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

/* ─────────────────────────── the shore as it was ───────────────────────────
   bedrock + the loose layer, baked once. It never changes, and deriving it
   per texel per frame cost more than the entire rest of the frame.          */
const PRISTINE_FS = `
in vec2 vUV; out vec4 fragColor;
` + SIM_LIB + `
void main(){
  vec2 wp = uvToWorld(vUV);
  fragColor = vec4(bedrock(wp), sandBed(wp), 0.0, 1.0);
}`;

/* ─────────────────────────── metrics ─────────────────────────── */
const METRIC_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSand;
uniform sampler2D uPristine;
uniform float uHighY;
` + SIM_LIB + `
void main(){
  vec2 wp = uvToWorld(vUV);
  vec4 S = texture(uSand, vUV);
  vec2 pr = texture(uPristine, vUV).rg;
  float b = pr.r;
  float gyv = b + S.r;
  float pad = buildPad(wp);

  /* Measure against the shore as the tide left it, not against sea level —
     otherwise the dune behind you scores several thousand for existing. */
  float pristine = b + pr.g;
  float built = step(pristine + 0.12, gyv);
  float above = max(gyv - max(pristine, uHighY), 0.0);
  float worth = above*(0.22 + 1.60*S.b)*pad;

  fragColor = vec4(S.r,
                   worth,
                   S.b*max(gyv - pristine, 0.0)*pad,
                   (gyv - uHighY)*built*pad);
}`;

const REDUCE_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSrc;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy)*2;
  vec4 a = texelFetch(uSrc, c, 0);
  vec4 b = texelFetch(uSrc, c+ivec2(1,0), 0);
  vec4 d = texelFetch(uSrc, c+ivec2(0,1), 0);
  vec4 e = texelFetch(uSrc, c+ivec2(1,1), 0);
  fragColor = vec4(a.rgb+b.rgb+d.rgb+e.rgb, max(max(a.a,b.a), max(d.a,e.a)));
}`;

/* ─────────────────────────── ray pick ─────────────────────────── */
const PICK_FS = `
out vec4 fragColor;
uniform sampler2D uSand;
uniform vec3 uRayO, uRayD;
` + SIM_LIB + `
vec4 sandAt(vec2 p){
  vec2 uv = worldToUV(p);
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) return vec4(0.0);
  return texture(uSand, uv);
}
float gy(vec2 p){ return bedrock(p) + sandAt(p).r; }

void main(){
  float t = 0.02, hitT = -1.0;
  float prevT = t, prevD = uRayO.y + uRayD.y*t - gy(uRayO.xz + uRayD.xz*t);
  for(int i=0;i<190;i++){
    vec3 p = uRayO + uRayD*t;
    float d = p.y - gy(p.xz);
    if(d <= 0.0){ hitT = t; break; }
    prevT = t; prevD = d;
    t += max(0.045, d*0.62);
    if(t > 260.0) break;
  }
  vec4 outv;
  if(hitT < 0.0){
    outv = vec4(0.0, 0.0, 0.0, 0.0);
    if(int(gl_FragCoord.x) == 1) outv = vec4(0.0);
    fragColor = outv; return;
  }
  // bisect for a clean surface point
  float lo = prevT, hi = hitT;
  for(int i=0;i<14;i++){
    float mid = 0.5*(lo+hi);
    vec3 p = uRayO + uRayD*mid;
    if(p.y - gy(p.xz) > 0.0) lo = mid; else hi = mid;
  }
  vec3 hp = uRayO + uRayD*(0.5*(lo+hi));
  if(int(gl_FragCoord.x) == 0){
    fragColor = vec4(hp, 1.0);
  } else {
    vec4 s = sandAt(hp.xz);
    fragColor = vec4(s.g, s.b, s.r, bedrock(hp.xz));
  }
}`;

/* ═══════════════════════════════════════════════════════════════════════ */
const DOMAIN = [-24, -24, 48, 48];

class Sim {
  constructor(gl, res) {
    this.gl = gl;
    this.res = res;
    this.domain = new Float32Array(DOMAIN);
    this.texel = new Float32Array([1 / res, 1 / res]);
    this.cell = DOMAIN[2] / res;
    this.cellArea = this.cell * this.cell;

    const fopt = {
      internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT,
      filter: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE
    };
    this.a = new T.FBO(gl, res, res, fopt);
    this.b = new T.FBO(gl, res, res, fopt);

    const HEAD = T.HEAD + T.COMMON;
    this.pInit   = new T.Program(gl, T.FS_VS, HEAD + INIT_FS, 'simInit');
    this.pPrist  = new T.Program(gl, T.FS_VS, HEAD + PRISTINE_FS, 'simPristine');
    this.pStep   = new T.Program(gl, T.FS_VS, HEAD + STEP_FS, 'simStep');
    this.pAO     = new T.Program(gl, T.FS_VS, HEAD + AO_FS, 'simAO');
    this.pMetric = new T.Program(gl, T.FS_VS, HEAD + METRIC_FS, 'simMetric');
    this.pReduce = new T.Program(gl, T.FS_VS, T.HEAD + REDUCE_FS, 'simReduce');
    this.pPick   = new T.Program(gl, T.FS_VS, HEAD + PICK_FS, 'simPick');

    this.aoRes = Math.max(128, res >> 1);
    this.ao = new T.FBO(gl, this.aoRes, this.aoRes, {
      internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR
    });

    /* reduction pyramid */
    this.pyr = [];
    let r = res;
    this.metric = new T.FBO(gl, res, res, fopt);
    while (r > 1) { r >>= 1; this.pyr.push(new T.FBO(gl, r, r, fopt)); }

    this.pristine = new T.FBO(gl, res, res, fopt);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.pristine.bind();
    this._common(this.pPrist.use());
    this._quad();

    this.pick = new T.FBO(gl, 2, 1, fopt);
    this.pickReader = new T.AsyncReader(gl, 2, 1, gl.RGBA, gl.FLOAT, 2 * 4 * 4);
    this.metricReader = new T.AsyncReader(gl, 1, 1, gl.RGBA, gl.FLOAT, 4 * 4);

    /* undo ring */
    this.snapN = 10;
    this.snaps = [];
    for (let i = 0; i < this.snapN; i++) this.snaps.push(new T.FBO(gl, res, res, fopt));
    this.snapHead = 0; this.snapCount = 0;

    /* live readback values */
    this.hit = { valid: false, x: 0, y: 0, z: 0, m: 0, c: 0, depth: 0, bedrock: 0 };
    this.metrics = { total: 0, worth: 0, packed: 0, peak: 0 };
    this.baseTotal = 0;
    this.discardReads = 0;

    this.brushA = new Float32Array(4);
    this.brushB = new Float32Array(4);
    this.stamp  = new Float32Array(4);
    this.stamp2 = new Float32Array([8, 0, 1, 0]);
    this.stamp3 = new Float32Array([0, 0, 0.8, 0]);
    this.stampPending = false;
  }

  _quad() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }

  _common(p) {
    return p.set('uDomain', this.domain).set('uTexel', this.texel).set('uRes', this.res);
  }

  reset(seaBase) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.a.bind();
    this._common(this.pInit.use()).set('uSeaBase', seaBase);
    this._quad();
    this.snapCount = 0; this.snapHead = 0;
    this.baseTotal = -1;   // recomputed on the next metric read
    /* a readback may already be in flight describing the *old* shore —
       throw the next two away or the pail meter starts life lying */
    this.discardReads = 2;
  }

  /* upload a saved castle (Float32 RGBA at this.res) */
  upload(data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.a.color[0]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.res, this.res, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  get tex() { return this.a.color[0]; }
  get aoTex() { return this.ao.color[0]; }

  step(env, dt, depScale) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.b.bind();
    const p = this.pStep.use();
    this._common(p);
    p.tex('uSand', this.a.color[0])
      .tex('uDeposit', env.depositTex || this.a.color[0])
      .set('uDepScale', env.depositTex ? (depScale || 0) : 0)
      .set('uDt', dt).set('uTime', env.time)
      .set('uSeaBase', env.seaBase).set('uWaveAmp', env.waveAmp)
      .set('uErodeK', env.erodeK).set('uSunDry', env.sunDry)
      .set('uBrushA', this.brushA).set('uBrushB', this.brushB)
      .set('uStamp', this.stamp).set('uStamp2', this.stamp2).set('uStamp3', this.stamp3);
    this._quad();
    const t = this.a; this.a = this.b; this.b = t;
    if (this.stampPending) { this.stampPending = false; this.stamp2[3] = 0; }
  }

  updateAO() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.ao.bind();
    const p = this.pAO.use();
    p.set('uDomain', this.domain).set('uTexel', this.texel).set('uRes', this.res);
    p.tex('uSand', this.a.color[0]);
    this._quad();
  }

  /* full metric reduction; result lands a frame or two later */
  measure(highY) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.metric.bind();
    const p = this.pMetric.use();
    this._common(p).set('uHighY', highY);
    p.tex('uSand', this.a.color[0]).tex('uPristine', this.pristine.color[0]);
    this._quad();

    let src = this.metric;
    const rp = this.pReduce.use();
    for (let i = 0; i < this.pyr.length; i++) {
      const dst = this.pyr[i];
      dst.bind();
      rp.use().tex('uSrc', src.color[0]);
      this._quad();
      src = dst;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, src.fb);
    this.metricReader.request();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  pollMetrics() {
    if (!this.metricReader.poll()) return false;
    if (this.discardReads > 0) { this.discardReads--; return false; }
    const o = this.metricReader.out;
    const A = this.cellArea;
    this.metrics.total = o[0] * A;
    this.metrics.worth = o[1] * A;
    this.metrics.packed = o[2] * A;
    this.metrics.peak = o[3];
    if (this.baseTotal < 0) this.baseTotal = this.metrics.total;
    return true;
  }

  raycast(o, d) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.pick.bind();
    const p = this.pPick.use();
    this._common(p).set('uRayO', o).set('uRayD', d);
    p.tex('uSand', this.a.color[0]);
    this._quad();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pick.fb);
    this.pickReader.request();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  pollPick() {
    if (!this.pickReader.poll()) return false;
    const o = this.pickReader.out;
    const h = this.hit;
    h.valid = o[3] > 0.5;
    h.x = o[0]; h.y = o[1]; h.z = o[2];
    h.m = o[4]; h.c = o[5]; h.depth = o[6]; h.bedrock = o[7];
    return true;
  }

  /* ── undo ── */
  snapshot() {
    const gl = this.gl;
    const dst = this.snaps[this.snapHead];
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.a.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fb);
    gl.blitFramebuffer(0, 0, this.res, this.res, 0, 0, this.res, this.res,
                       gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    this.snapHead = (this.snapHead + 1) % this.snapN;
    this.snapCount = Math.min(this.snapCount + 1, this.snapN);
  }
  undo() {
    if (this.snapCount === 0) return false;
    const gl = this.gl;
    this.snapHead = (this.snapHead - 1 + this.snapN) % this.snapN;
    this.snapCount--;
    const src = this.snaps[this.snapHead];
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.a.fb);
    gl.blitFramebuffer(0, 0, this.res, this.res, 0, 0, this.res, this.res,
                       gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    return true;
  }

  /* read the whole field back (used by save; synchronous, off the hot path) */
  download() {
    const gl = this.gl;
    const out = new Float32Array(this.res * this.res * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.a.fb);
    gl.readPixels(0, 0, this.res, this.res, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  setBrush(ax, az, bx, bz, radius, strength, mode, param) {
    this.brushA[0] = ax; this.brushA[1] = az; this.brushA[2] = radius; this.brushA[3] = strength;
    this.brushB[0] = bx; this.brushB[1] = bz; this.brushB[2] = mode; this.brushB[3] = param;
  }
  clearBrush() { this.brushB[2] = 0; }
  setStamp(x, z, r, h, detail, baseY, mouldId, rot, moisture) {
    this.stamp[0] = x; this.stamp[1] = z; this.stamp[2] = r; this.stamp[3] = h;
    this.stamp2[0] = detail; this.stamp2[1] = baseY; this.stamp2[3] = 1;
    this.stamp3[0] = mouldId || 0;
    this.stamp3[1] = rot || 0;
    this.stamp3[2] = moisture === undefined ? 0.8 : moisture;
    this.stampPending = true;
  }
}

T.Sim = Sim;
T.DOMAIN = DOMAIN;

})(TW);
