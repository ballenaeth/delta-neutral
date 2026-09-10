/* ============================================================================
   TIDEWRIGHT — water.js
   The sea. Gerstner sum with real shoaling (amplitude gains as the bottom
   comes up, the crest gets depth-limited, and the excess becomes foam), a
   camera-centred exponentially-warped grid so the same 147k vertices give
   19 cm of detail at your feet and still reach the horizon, and a surface
   shader doing refraction, Beer–Lambert extinction, sky reflection, sun
   glitter and three kinds of foam.
   ========================================================================== */
'use strict';

(function (T) {

const WATER_COMMON = `
uniform sampler2D uSand;
uniform vec4  uDomain;
uniform vec2  uTexel;
uniform float uRes;
uniform float uSeaBase, uWaveAmp;

vec2 worldToUV(vec2 p){ return (p - uDomain.xy)/uDomain.zw; }
vec4 sandSmooth(vec2 uv){
  vec2 t = uv*uRes - 0.5;
  vec2 i = floor(t), f = fract(t);
  f = f*f*(3.0-2.0*f);
  vec2 b = (i+0.5)*uTexel;
  vec4 s00 = texture(uSand, b);
  vec4 s10 = texture(uSand, b + vec2(uTexel.x,0.0));
  vec4 s01 = texture(uSand, b + vec2(0.0,uTexel.y));
  vec4 s11 = texture(uSand, b + uTexel);
  return mix(mix(s00,s10,f.x), mix(s01,s11,f.x), f.y);
}
float groundY(vec2 p){
  vec2 uv = worldToUV(p);
  float s = (uv.x>=0.0 && uv.x<=1.0 && uv.y>=0.0 && uv.y<=1.0) ? sandSmooth(uv).r : sandBed(p);
  return bedrock(p) + s;
}
`;

const WATER_VS = `
uniform mat4  uVP;
uniform vec3  uCamPos;
uniform float uTime;
uniform float uGridN;
uniform vec2  uCenter;
out vec3  vWP;
out vec3  vN;
out float vBrk;
out float vDepth;
out vec2  vBase;
` + T.COMMON + WATER_COMMON + `

const float R0 = 1450.0;
const float KK = 7.2;
float mapAxis(float s){
  return sign(s)*R0*(exp(KK*abs(s)) - 1.0)/(exp(KK) - 1.0);
}
/* How wide this vertex's own cell is, on one axis, in metres — the derivative
   of the warp times one grid step. The grid is warped per axis, so near the
   shore a cell can be four centimetres across and a metre deep, and a single
   scalar offset cannot describe it. */
float cellAt(float s, float n){
  return (2.0/n)*R0*KK*exp(KK*abs(s))/(exp(KK) - 1.0);
}

vec3 waterPoint(vec2 base, out float brk, out float dep){
  float g  = groundY(base);
  float sl = seaLevelAt(uSeaBase, uTime);
  float d  = max(sl - g, 0.0);
  /* The grid is exponentially warped, so far triangles are enormous and the
     swell aliases into stripes. Fade the amplitude out instead — a distant
     sea reads as a glittering plane anyway. */
  float fade = clamp(1.22 - length(base - uCamPos.xz)/300.0, 0.02, 1.0);
  vec4 w = gerstner(base, uTime, d, uWaveAmp*fade, 5);
  brk = w.w; dep = d;
  return vec3(base.x + w.x, sl + w.y, base.y + w.z);
}

void main(){
  int N = int(uGridN);
  int id = gl_VertexID;
  int quad = id/6;
  int k = id - quad*6;
  int W = N - 1;
  int cx = quad - (quad/W)*W;
  int cy = quad/W;
  ivec2 o;
  if(k==0)      o = ivec2(0,0);
  else if(k==1) o = ivec2(1,0);
  else if(k==2) o = ivec2(0,1);
  else if(k==3) o = ivec2(1,0);
  else if(k==4) o = ivec2(1,1);
  else          o = ivec2(0,1);
  ivec2 c = ivec2(cx,cy) + o;
  vec2 s = vec2(c)/float(W)*2.0 - 1.0;
  vec2 base = uCenter + vec2(mapAxis(s.x), mapAxis(s.y));

  float brk, dep;
  vec3 p0 = waterPoint(base, brk, dep);
  float b1, b2, d1, d2;
  /* Sample the neighbours at exactly one cell, so the normal describes the
     triangle it is about to be interpolated across. The old fixed offset
     (0.36 m + 0.6 cm per metre of distance) was right only within a few metres
     of the camera; by 200 m it read a 1.5 m patch of sea and smeared the answer
     over an eight-metre triangle, so neighbouring vertices got uncorrelated
     normals and the far water broke into a mosaic of flat facets. */
  float nGrid = float(W);
  vec2 cell = vec2(cellAt(s.x, nGrid), cellAt(s.y, nGrid));
  vec3 px = waterPoint(base + vec2(cell.x, 0.0), b1, d1);
  vec3 pz = waterPoint(base + vec2(0.0, cell.y), b2, d2);

  vWP    = p0;
  vN     = normalize(cross(pz - p0, px - p0));
  vBrk   = brk;
  vDepth = dep;
  vBase  = base;
  gl_Position = uVP*vec4(p0, 1.0);
}`;

const WATER_FS = `
in vec3  vWP;
in vec3  vN;
in float vBrk;
in float vDepth;
in vec2  vBase;
out vec4 fragColor;

uniform sampler2D uScene;
uniform vec2  uScreen;
uniform float uNight;
uniform float uStyle;
uniform float uInkGain;
` + T.SHADOW + T.LIGHTENV + WATER_COMMON + `

/* A printmaker cuts water as long lines that ride the swell, so the line work
   is a contour of the wave surface itself — bend the crest, and every line
   bends with it. Sampling the height (rather than screen space) is also what
   keeps the far water quiet instead of packing lines into moiré. */
float crestLine(float y, vec2 base, float far){
  float ph = y*3.1 + fbmG(base*0.30, 2)*0.75;
  float t  = fract(ph);
  float w  = fwidth(ph)*1.35 + 0.022;
  float ln = 1.0 - smoothstep(0.0, w, min(t, 1.0 - t));
  /* ragged, the way a gouge skips — but along the line, never across it */
  ln *= 0.55 + 0.45*fbmG(vec2(base.x*1.7, base.y*0.20), 2);
  return ln*(1.0 - smoothstep(0.35, 0.95, far));
}

vec3 detailN(vec2 p, float t, float scale, float amp){
  float e = 0.09/scale;
  vec2 d1 = vec2(t*0.20, -t*0.34);
  vec2 d2 = vec2(-t*0.15, -t*0.27);
  float h  = gnoise(p*scale + d1) + 0.55*gnoise(p*scale*2.17 + d2);
  float hx = gnoise((p+vec2(e,0.0))*scale + d1) + 0.55*gnoise((p+vec2(e,0.0))*scale*2.17 + d2);
  float hz = gnoise((p+vec2(0.0,e))*scale + d1) + 0.55*gnoise((p+vec2(0.0,e))*scale*2.17 + d2);
  return normalize(vec3(-(hx-h)*amp/e, 1.0, -(hz-h)*amp/e));
}

float foamNoise(vec2 p, float t){
  float a = fbm(p*1.5 + vec2(0.0, t*0.55), 4);
  float b = fbm(p*4.4 - vec2(t*0.22, t*0.9), 3);
  return a*0.62 + b*0.38;
}

void main(){
  vec3 Vv = uCamPos - vWP;
  float dist = length(Vv);
  vec3 V = Vv/max(dist, 1e-4);

  float g = groundY(vWP.xz);
  float depth = vWP.y - g;
  if(depth < -0.045) discard;
  float edge = smoothstep(-0.030, 0.075, depth);

  /* ── normal ──
     "far" drives every high-frequency term to zero and widens the specular
     lobe instead, which is the only honest way to stop a sea from crawling */
  float far   = smoothstep(45.0, 340.0, dist);
  float dfade = clamp(1.0 - dist/180.0, 0.0, 1.0);
  vec3 nd1 = detailN(vWP.xz, uTime,      1.15, 0.115*dfade);
  vec3 nd2 = detailN(vWP.xz, uTime*1.4,  6.50, 0.045*dfade*dfade);
  vec3 nd3 = detailN(vWP.xz, uTime*2.1, 26.00, 0.016*dfade*dfade*dfade);
  vec3 Nb = normalize(vN);
  vec3 T2 = normalize(cross(vec3(0.0,0.0,1.0), Nb));
  vec3 B2 = cross(Nb, T2);
  vec3 nd = normalize(nd1 + nd2*0.8 + nd3*0.6);
  vec3 N = normalize(T2*nd.x + Nb*nd.y + B2*nd.z);
  N = normalize(mix(N, vec3(0.0,1.0,0.0), far*0.92));

  float NoV = max(dot(N, V), 1e-4);

  /* ── refraction ── */
  vec2 suv = gl_FragCoord.xy/uScreen;
  float bend = clamp(depth*0.55, 0.0, 1.0)*0.055/max(dist*0.05, 1.0);
  vec2 ruv = clamp(suv + N.xz*bend, vec2(0.001), vec2(0.999));
  vec3 below = texture(uScene, ruv).rgb;

  /* Beer–Lambert through the water column (down and back up) */
  vec3 ext = vec3(0.52, 0.155, 0.105);
  float path = max(depth, 0.0)*(1.0 + 1.0/max(NoV, 0.25))*0.5;
  vec3 trans = exp(-ext*path*2.6);
  vec3 refr = below*trans;

  /* in-scattering: the green a shallow sea has when the sun is behind it */
  vec3 waterTint = mix(vec3(0.075,0.30,0.295), vec3(0.045,0.185,0.235), smoothstep(0.4,4.0,depth));
  float NoL0 = max(dot(vec3(0.0,1.0,0.0), uSunDir), 0.0);
  vec3 inSc = waterTint*(uSunColor*(0.055 + 0.16*NoL0) + ambientFrom(vec3(0,1,0))*0.55);
  refr += inSc*(1.0 - trans);

  /* ── reflection ── */
  vec3 R = reflect(-V, N);
  R.y = abs(R.y)*0.55 + R.y*0.45;                 // keep it off the sea floor
  vec3 env = skySample(R, 0.0);
  float sh = shadowAt(vWP, 1.0);

  /* sun glitter — roughen with distance to absorb the detail we just removed */
  float rough = 0.055 + 0.10*smoothstep(0.0, 1.2, vBrk) + far*0.135;
  vec3 H = normalize(V + uSunDir);
  float NoH = max(dot(N,H), 0.0);
  float NoL = max(dot(N, uSunDir), 0.0);
  float a2 = max(rough*rough, 5e-4);
  float spec = D_GGX(NoH, a2)*V_Smith(NoV, NoL, a2)*NoL;
  vec3 sun = uSunColor*spec*sh*2.2;
  vec3 moon = uMoonColor*D_GGX(max(dot(N, normalize(V+uMoonDir)),0.0), a2)*0.9;

  float F = 0.02 + 0.98*pow(1.0 - NoV, 5.0);
  F = mix(F, 1.0, smoothstep(600.0, 1400.0, dist)*0.5);

  vec3 col = mix(refr, env, clamp(F, 0.0, 1.0)) + sun + moon;

  /* ── foam ── */
  float fn = foamNoise(vBase*0.55, uTime);
  float crest = smoothstep(0.22, 0.85, vBrk);
  float shore = smoothstep(0.30, 0.02, depth);
  float trail = smoothstep(0.55, 0.95, fn)*smoothstep(0.05, 0.5, vBrk);
  float lace  = smoothstep(0.62, 0.98, foamNoise(vBase*2.4 + 7.0, uTime*1.6))*shore;
  float foam = clamp(crest*mix(0.5,1.0,smoothstep(0.35,0.75,fn)) + trail*0.75 + lace*0.85, 0.0, 1.0);
  foam *= smoothstep(0.0, 0.02, depth);
  /* foam is built from noise sampled in world metres; past a few hundred of
     them there are more periods than pixels and it turns into stripes */
  foam *= 1.0 - far*0.97;

  vec3 foamCol = (uSunColor*sh*0.30 + ambientFrom(vec3(0,1,0))*1.15)*vec3(1.0,0.99,0.97);
  col = mix(col, foamCol, foam*0.92);

  /* a bright lip right on the breaking crest */
  col += uSunColor*sh*crest*crest*0.18;

  /* ── Bucket & Spade: a sea painted in three greens and a white edge ── */
  if(uStyle > 0.5){
    vec3 sky3 = ambientFrom(vec3(0.0,1.0,0.0));
    vec3 key  = (uSunColor*0.115 + sky3*1.5 + uMoonColor*3.0)*1.35;
    key = mix(vec3(luma(key)), key, 0.45);   // keep the sea's own colour
    vec3 shal = vec3(0.52, 0.94, 0.88);
    vec3 mid  = vec3(0.22, 0.72, 0.80);
    vec3 deep = vec3(0.13, 0.48, 0.66);
    float band = softBands(clamp(depth/2.6, 0.0, 1.0), 3.0, 0.13);
    vec3 body = mix(shal, mix(mid, deep, smoothstep(0.34, 1.0, band)), smoothstep(0.0, 0.40, band));
    /* a stepped ripple across the flats so it is not a dead sheet */
    float rip = softBands(0.5 + 0.5*sin(vBase.y*1.35 - uTime*1.05 + sin(vBase.x*0.42)*1.6), 2.0, 0.22);
    body *= 0.90 + 0.16*rip;
    /* flat white where it breaks and where it runs up the sand */
    float paint = softBands(clamp(crest*1.5 + lace*1.2 + shore*0.75 + trail*0.8, 0.0, 1.0), 2.0, 0.16);
    col = mix(body*key, vec3(1.0, 0.99, 0.96)*key*1.25, paint*(1.0 - far*0.55));
    /* one cartoon glint on the sun's path */
    float g = softBands(pow(max(dot(N, normalize(V + uSunDir)), 0.0), 90.0), 2.0, 0.2);
    col += uSunColor*g*0.10*sh*(1.0 - far);
    col = mix(col, skySample(reflect(-V, vec3(0.0,1.0,0.0)), 1.0)*1.55,
              smoothstep(0.50, 0.96, 1.0 - NoV)*0.62);
  }

  /* ── the sea in each of the other looks ── */
  if(uStyle > 1.5){
    /* never reach the darkest ink — a poster's far water is a mid teal, not a
       black band ruled across the horizon */
    float band = clamp(0.88 - depth*0.15 - far*0.06, 0.34, 1.0);
    float wash = clamp(crest*1.3 + lace*1.1 + shore*0.7 + trail*0.7, 0.0, 1.0);
    vec3 sky3 = ambientFrom(vec3(0.0,1.0,0.0));

    float nite = nightOf(uSunColor);
    if(uStyle < 2.5){                                   /* Marram */
      col = screenPrint(clamp(band + wash*0.5, 0.0, 1.0), gl_FragCoord.xy, 1.05, 3.3,
                        mix(MAR_W0,NGT_W0,nite), mix(MAR_W1,NGT_W1,nite),
                        mix(MAR_W2,NGT_W2,nite), mix(MAR_W3,NGT_W3,nite),
                        mix(MAR_W4,NGT_W4,nite))*uInkGain;
    } else if(uStyle < 3.5){                            /* Ordnance */
      vec3 paper = mix(vec3(0.945,0.918,0.850), vec3(0.075,0.130,0.235), nite);
      vec3 ink   = mix(vec3(0.255,0.235,0.215), vec3(0.800,0.870,0.930), nite);
      vec3 blue  = mix(vec3(0.780,0.860,0.895), vec3(0.110,0.200,0.330), nite);
      col = mix(blue, paper, smoothstep(0.0, 2.6, depth)*0.30);
      /* engraved wave marks, fixed size on screen */
      float eng = step(0.62, fract(gl_FragCoord.y*0.10 + sin(gl_FragCoord.x*0.045 + vBase.y*0.4)*0.5));
      col = mix(col, ink, eng*0.16*(1.0 - far*0.5));
      col = mix(col, paper, wash*0.85);
      col *= uInkGain;
    } else if(uStyle < 4.5){                            /* Felt */
      vec3 c1 = vec3(0.180,0.470,0.500), c2 = vec3(0.330,0.640,0.640);
      col = mix(c1, c2, softBands(band, 3.0, 0.2))*(sky3*1.5 + uSunColor*0.09);
      col *= 0.92 + 0.16*fbm(vBase*22.0, 3);
      col = mix(col, vec3(0.93,0.95,0.93)*(sky3*1.6), wash*0.9);
    } else if(uStyle < 5.5){                            /* Rockpool */
      col *= vec3(0.62,0.98,0.95);
      col = mix(col, vec3(0.10,0.34,0.36)*(luma(col)+0.05)*3.0, 0.30);
    } else if(uStyle < 6.5){                            /* Tin Toy */
      vec3 c1 = vec3(0.075,0.300,0.470), c2 = vec3(0.250,0.640,0.760);
      col = mix(c1, c2, softBands(band, 4.0, 0.07))*(sky3*1.35 + uSunColor*0.10);
      col += uSunColor*0.05*step(0.62, wash);
      col *= 0.95 + 0.10*halftone(gl_FragCoord.xy, 0.9, 2.1, 2.1);
    } else if(uStyle < 7.5){                            /* Hanga */
      vec3 c1 = mix(vec3(0.130,0.330,0.430), vec3(0.055,0.095,0.190), nite);
      vec3 c2 = mix(vec3(0.360,0.600,0.630), vec3(0.150,0.210,0.330), nite);
      col = mix(c1, c2, softBands(band, 3.0, 0.22));
      col *= 0.88 + 0.22*fbmG(vec2(vBase.x*0.5, vBase.y*10.0), 3);
      col = mix(col, mix(vec3(0.955,0.935,0.880), vec3(0.560,0.620,0.700), nite),
                softBands(wash, 2.0, 0.14)*0.92);
      col = mix(col, c1*0.40, crestLine(vWP.y, vBase, far)*(1.0 - foam)*0.62);
      col *= uInkGain;
    } else {                                            /* Midwinter */
      float l = luma(col);
      col = mix(vec3(l), col, 0.34)*vec3(0.86,0.93,1.06) + vec3(0.008,0.011,0.016);
    }
  }

  col = applyFog(col, dist, -V);
  fragColor = vec4(col, edge);
}`;

/* ═══════════════════════════════════════════════════════════════════════ */
class Water {
  constructor(gl, sim, gridN) {
    this.gl = gl; this.sim = sim;
    this.gridN = gridN;
    this.count = (gridN - 1) * (gridN - 1) * 6;
    this.prog = new T.Program(gl,
      T.HEAD + WATER_VS,
      T.HEAD_S + T.COMMON + WATER_FS, 'water');
    this.center = new Float32Array([0, -4]);
    this.screen = new Float32Array([1, 1]);
  }

  draw(env, sceneTex, w, h) {
    const gl = this.gl, s = this.sim;
    this.screen[0] = w; this.screen[1] = h;
    this.center[0] = env.cam.pos[0] * 0.55;
    this.center[1] = env.cam.pos[2] * 0.55 - 2.0;
    gl.enable(gl.BLEND);
    /* Colour blends normally, but alpha is driven *down* wherever water covers
       the frame — so the scene's alpha channel comes out of this pass as "how
       much of this pixel is not sea". The printed looks need that downstream:
       a key line cut from depth curvature fires on every wave crest, and the
       open sea ends up covered in scratches. */
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    const p = this.prog.use();
    p.tex('uSand', s.tex).tex('uSky', env.sky.tex).tex('uShadow', env.shadowTex)
     .tex('uScene', sceneTex);
    p.set('uDomain', s.domain).set('uTexel', s.texel).set('uRes', s.res)
     .set('uVP', env.cam.vp).set('uCamPos', env.cam.pos).set('uGridN', this.gridN)
     .set('uCenter', this.center).set('uTime', env.time)
     .set('uSeaBase', env.seaBase).set('uWaveAmp', env.waveAmp)
     .set('uSunDir', env.sky.sunDir).set('uSunColor', env.sky.sunColor)
     .set('uMoonDir', env.sky.moonDir).set('uMoonColor', env.sky.moonColor)
     .set('uFogK', env.fogK).set('uScreen', this.screen).set('uNight', env.sky.night)
     .set('uLightVP', env.lightVP).set('uShadowTexel', 1 / env.shadowRes)
     .set('uShadowOn', env.shadowOn ? 1 : 0).set('uStyle', env.style || 0)
     .set('uInkGain', env.inkGain || 1);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.disable(gl.BLEND);
  }
}

T.Water = Water;

})(TW);
