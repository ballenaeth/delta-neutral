/* ============================================================================
   TIDEWRIGHT — sky.js
   A single-scattering Rayleigh + Mie atmosphere, raymarched into a lat-long
   LUT once a frame. Everything else in the game — the sea's reflection, the
   ambient on a sand wall, the fog on the headland — reads that one texture,
   so when the sun goes down the whole world goes down with it.
   ========================================================================== */
'use strict';

(function (T) {

const ATMO = `
const float Rg = 6371000.0;
const float Rt = 6471000.0;
const vec3  BR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float BM = 4.4e-6;
const float Hr = 8000.0;
const float Hm = 1400.0;

float rsiFar(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r*r;
  float d = b*b - c;
  if(d < 0.0) return -1.0;
  return -b + sqrt(d);
}
float rsiNear(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r*r;
  float d = b*b - c;
  if(d < 0.0) return -1.0;
  return -b - sqrt(d);
}

vec3 transmittanceTo(vec3 p, vec3 dir){
  float tMax = rsiFar(p, dir, Rt);
  if(tMax <= 0.0) return vec3(1.0);
  const int N = 8;
  float ds = tMax/float(N);
  float odR = 0.0, odM = 0.0;
  for(int i=0;i<N;i++){
    vec3 q = p + dir*(ds*(float(i)+0.5));
    float h = max(length(q) - Rg, 0.0);
    odR += exp(-h/Hr)*ds;
    odM += exp(-h/Hm)*ds;
  }
  return exp(-(BR*odR + BM*1.11*odM));
}

vec3 scatter(vec3 ro, vec3 rd, vec3 sun, float inten, out float groundMask){
  groundMask = 0.0;
  float tMax = rsiFar(ro, rd, Rt);
  float tg = rsiNear(ro, rd, Rg);
  if(tg > 0.0){ tMax = min(tMax, tg); groundMask = 1.0; }
  if(tMax <= 0.0) return vec3(0.0);

  const int N = 20, NL = 6;
  float mu = dot(rd, sun);
  float pR = 3.0/(16.0*PI)*(1.0 + mu*mu);
  const float g = 0.78;
  float g2 = g*g;
  float pM = 3.0/(8.0*PI)*((1.0-g2)*(1.0+mu*mu)) /
             ((2.0+g2)*pow(max(1.0+g2-2.0*g*mu, 1e-4), 1.5));

  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  float ds = tMax/float(N);
  for(int i=0;i<N;i++){
    vec3 p = ro + rd*(ds*(float(i)+0.5));
    float h = max(length(p) - Rg, 0.0);
    float hr = exp(-h/Hr)*ds;
    float hm = exp(-h/Hm)*ds;
    odR += hr; odM += hm;

    float tl = rsiFar(p, sun, Rt);
    float odRl = 0.0, odMl = 0.0;
    bool lit = rsiNear(p, sun, Rg) < 0.0;
    if(lit && tl > 0.0){
      float lds = tl/float(NL);
      for(int j=0;j<NL;j++){
        vec3 q = p + sun*(lds*(float(j)+0.5));
        float hl = max(length(q) - Rg, 0.0);
        odRl += exp(-hl/Hr)*lds;
        odMl += exp(-hl/Hm)*lds;
      }
      vec3 att = exp(-(BR*(odR+odRl) + BM*1.11*(odM+odMl)));
      sumR += att*hr;
      sumM += att*hm;
    }
  }
  return (sumR*BR*pR + sumM*BM*pM) * inten;
}
`;

/* ─────────────────── LUT pass ─────────────────── */
const LUT_FS = `
out vec4 fragColor;
in vec2 vUV;
uniform vec3  uSunDir;
uniform vec3  uMoonDir;
uniform float uSunI;
uniform float uMoonI;
` + ATMO + `
void main(){
  vec3 rd = skyUVToDir(vUV);
  vec3 ro = vec3(0.0, Rg + 240.0, 0.0);
  float gm;
  vec3 col = scatter(ro, rd, uSunDir, uSunI, gm);
  if(uMoonI > 0.0){
    float gm2;
    col += scatter(ro, rd, uMoonDir, uMoonI, gm2) * vec3(0.72, 0.82, 1.0);
  }
  /* Single scattering alone gives a sky about three times too dark against a
     sunlit ground — most of a real sky's brightness has bounced more than
     once. This is the standard cheat, and it is the difference between a
     believable noon and a total eclipse. */
  col *= 3.2;

  /* The same omission turns the long horizontal path yellow, because single
     scattering extinguishes the blue and never puts any back. Multiple
     scattering does put it back, so approximate that: desaturate and cool the
     horizon band — but only while the sun is high. A low sun's horizon is
     supposed to be that colour. */
  float horiz = 1.0 - smoothstep(0.0, 0.30, abs(rd.y));
  float high  = smoothstep(0.04, 0.45, uSunDir.y);
  float g = dot(col, vec3(0.3333));
  col = mix(col, mix(vec3(g), g*vec3(0.78, 0.93, 1.16), 0.7), horiz*high*0.62);
  // an airglow floor so the night is deep blue rather than a hole
  col += vec3(0.00042, 0.00072, 0.00160) * (1.0 + 2.4*pow(max(0.0, 1.0-abs(rd.y)), 6.0));
  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

/* ─────────────────── background pass ─────────────────── */
const BG_FS = `
out vec4 fragColor;
in vec2 vUV;
uniform sampler2D uSky;
uniform mat4  uInvVP;
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uMoonDir;
uniform vec3  uMoonColor;
uniform float uTime;
uniform float uNight;
uniform float uCloud;
uniform float uStyle;
uniform float uInkGain;

float cloudField(vec2 q, float t){
  float f = fbm(q*1.0 + vec2(t*0.010, t*0.004), 5);
  f = f*1.35 - 0.30;
  float ridge = 1.0 - abs(fbm(q*2.1 - vec2(t*0.017, 0.0), 4)*2.0 - 1.0);
  return clamp(f*0.78 + ridge*0.30 - 0.20, 0.0, 1.0);
}

void main(){
  vec4 h = uInvVP * vec4(vUV*2.0-1.0, 1.0, 1.0);
  vec3 rd = normalize(h.xyz/h.w - uCamPos);

  vec3 col = textureLod(uSky, dirToSkyUV(rd), 0.0).rgb;

  /* ── the other looks' skies ── */
  if(uStyle > 1.5){
    float up = clamp(rd.y, 0.0, 1.0);
    vec3 zen = textureLod(uSky, dirToSkyUV(vec3(0,1,0)), 2.0).rgb;
    float lz = luma(zen);
    float sd3 = dot(rd, uSunDir);
    float ang3 = acos(clamp(sd3, -1.0, 1.0));
    float cl = 0.0;
    if(rd.y > 0.02){
      float t3 = (1500.0 - uCamPos.y)/rd.y;
      cl = cloudField((uCamPos.xz + rd.xz*t3)*0.00048, uTime)*(uCloud + 0.3);
      cl = smoothstep(0.30, 0.40, cl)*smoothstep(0.02, 0.16, rd.y);
    }
    float b3 = pow(up, 0.55);

    float nite = nightOf(uSunColor);
    if(uStyle < 2.5){                                    /* Marram */
      vec3 p4 = mix(MAR_S4, NGT_S4, nite), p1 = mix(MAR_S1, NGT_S1, nite);
      col = screenPrint(clamp(0.98 - b3*0.42, 0.0, 1.0), gl_FragCoord.xy, 0.38, 3.3,
                        mix(MAR_S0,NGT_S0,nite), p1, mix(MAR_S2,NGT_S2,nite),
                        mix(MAR_S3,NGT_S3,nite), p4);
      col = mix(col, p4, cl*0.75);
      col = mix(col, mix(p1, vec3(0.92,0.94,0.98), nite), smoothstep(0.045, 0.030, ang3));
      col = mix(col, vec3(0.94,0.95,0.99), smoothstep(0.020, 0.013, acos(clamp(dot(rd,uMoonDir),-1.0,1.0)))*nite);
      col *= uInkGain;
    } else if(uStyle < 3.5){                             /* Ordnance */
      col = mix(mix(vec3(0.955,0.930,0.868), vec3(0.062,0.112,0.210), nite),
                mix(vec3(0.900,0.885,0.840), vec3(0.085,0.148,0.262), nite), b3);
      col = mix(col, mix(vec3(0.845,0.828,0.782), vec3(0.120,0.195,0.315), nite), cl*0.55);
      col = mix(col, mix(vec3(0.255,0.235,0.215), vec3(0.86,0.92,0.97), nite),
                smoothstep(0.040, 0.030, ang3)*0.75);
      col *= uInkGain;
    } else if(uStyle < 4.5){                             /* Felt */
      vec3 f1 = vec3(0.600,0.790,0.870), f2 = vec3(0.880,0.925,0.935);
      col = mix(f2, f1, softBands(b3, 3.0, 0.20))*(lz*3.6 + 0.42);
      col = mix(col, vec3(0.985,0.975,0.950)*(lz*3.8 + 0.5), cl*0.88);
      col *= 0.95 + 0.10*fbm(rd.xz*40.0, 3);
    } else if(uStyle < 5.5){                             /* Rockpool */
      col *= vec3(0.55,0.96,0.96);
      col = mix(col, vec3(0.10,0.36,0.38)*(luma(col)+0.06)*3.0, 0.40);
    } else if(uStyle < 6.5){                             /* Tin Toy */
      vec3 t1 = vec3(0.115,0.395,0.610), t2 = vec3(0.560,0.790,0.880);
      col = mix(t2, t1, softBands(b3, 4.0, 0.09))*(lz*2.4 + 0.14);
      col = mix(col, vec3(0.98,0.97,0.94)*(lz*2.6+0.2), cl*0.9);
      col += uSunColor*0.06*smoothstep(0.040, 0.028, ang3);
    } else if(uStyle < 7.5){                             /* Hanga */
      vec3 w1 = mix(vec3(0.905,0.855,0.740), vec3(0.180,0.230,0.360), nite);
      vec3 w2 = mix(vec3(0.545,0.640,0.680), vec3(0.070,0.100,0.190), nite);
      col = mix(w1, w2, smoothstep(0.0, 0.75, b3));      // bokashi
      col *= 0.90 + 0.18*fbmG(rd.xz*vec2(3.0, 26.0), 3);
      col = mix(col, mix(vec3(0.965,0.945,0.900), vec3(0.300,0.350,0.470), nite), cl*0.7);
      col = mix(col, mix(vec3(0.780,0.330,0.270), vec3(0.90,0.93,0.98), nite),
                smoothstep(0.048, 0.034, ang3)*0.85);
      col *= uInkGain;
    } else {                                             /* Midwinter */
      float l = luma(col);
      col = mix(vec3(l), col, 0.32)*vec3(0.88,0.93,1.06) + vec3(0.004,0.006,0.010);
    }
    fragColor = vec4(max(col, vec3(0.0)), 1.0);
    return;
  }

  /* ── Bucket & Spade sky: flat bands, a paper sun, cut-out clouds ── */
  if(uStyle > 0.5){
    float up = clamp(rd.y, 0.0, 1.0);
    vec3 zen = textureLod(uSky, dirToSkyUV(vec3(0,1,0)), 2.0).rgb;
    vec3 hor = textureLod(uSky, dirToSkyUV(normalize(vec3(rd.x,0.06,rd.z))), 2.0).rgb;
    float b = softBands(pow(up, 0.55), 4.0, 0.10);
    /* the LUT is a physical radiance field; a picture-book sky is a poster.
       Lift it and let the horizon go pale, or it reads as weather. */
    col = mix(hor*1.35, zen*1.75, b);
    /* the pale-blue horizon lift belongs to a high sun only — apply it at
       golden hour and you wash the gold straight out of the picture */
    float hi2 = smoothstep(0.06, 0.42, uSunDir.y);
    col = mix(col, vec3(0.42, 0.62, 0.74)*(luma(col) + 0.06)*2.4, (1.0 - b)*0.45*hi2);
    col += uSunColor*pow(max(dot(rd, uSunDir), 0.0), 3.0)*0.030*(1.0 - hi2);
    col = saturate3(col, 1.26)*1.35;

    /* a solid sun with one halo ring around it */
    float sd2 = dot(rd, uSunDir);
    float ang2 = acos(clamp(sd2, -1.0, 1.0));
    float disc2 = smoothstep(0.030, 0.024, ang2);
    float halo  = smoothstep(0.075, 0.048, ang2) - smoothstep(0.048, 0.040, ang2);
    col = mix(col, uSunColor*0.85 + vec3(0.35,0.30,0.16), disc2);
    col += (uSunColor*0.05 + vec3(0.02,0.015,0.006))*halo;
    col += uSunColor*pow(max(sd2,0.0), 8.0)*0.018;

    if(uNight > 0.001){
      vec3 ad2 = abs(rd);
      vec2 sp2 = (ad2.y > max(ad2.x, ad2.z)) ? rd.xz/max(ad2.y,1e-3)
               : (ad2.x > ad2.z ? rd.zy/max(ad2.x,1e-3) : rd.xy/max(ad2.z,1e-3));
      vec2 cl = floor(sp2*90.0);
      vec3 rn = hash32(cl + 5.1);
      vec2 o2 = fract(sp2*90.0) - (0.3 + rn.yz*0.4);
      float st = step(0.90, rn.x)*smoothstep(0.14, 0.05, length(o2));
      col += vec3(1.0,0.97,0.86)*st*0.9*uNight*smoothstep(-0.02,0.14,rd.y);
    }

    if(uCloud > 0.001 && rd.y > 0.02){
      float t2 = (1500.0 - uCamPos.y)/rd.y;
      vec2 q2 = (uCamPos.xz + rd.xz*t2)*0.00048;
      float cv = cloudField(q2, uTime)*(uCloud*(1.0 - 0.55*uNight) + 0.30);
      float cvL = cloudField(q2 + uSunDir.xz*0.075, uTime)*(uCloud + 0.30);
      float mass = smoothstep(0.30, 0.36, cv);
      float lit2 = smoothstep(0.34, 0.44, cvL);
      vec3 top = (uSunColor*0.055 + zen*1.7)*vec3(1.05,1.02,1.00);
      vec3 bot = (uSunColor*0.020 + zen*1.5)*vec3(0.86,0.87,1.02);
      vec3 cc2 = mix(bot, top, lit2);
      col = mix(col, cc2, mass*smoothstep(0.02, 0.16, rd.y)*0.95);
    }

    float md2 = dot(rd, uMoonDir);
    col = mix(col, vec3(0.95,0.94,0.86)*(0.35 + uNight*1.4),
              smoothstep(0.0175, 0.0135, acos(clamp(md2,-1.0,1.0))));
    fragColor = vec4(max(col, vec3(0.0)), 1.0);
    return;
  }

  /* ── stars ── */
  if(uNight > 0.001){
    vec3 ad = abs(rd);
    vec2 sp = (ad.y > max(ad.x, ad.z)) ? rd.xz/max(ad.y,1e-3) : (ad.x > ad.z ? rd.zy/max(ad.x,1e-3) : rd.xy/max(ad.z,1e-3));
    vec2 cell = floor(sp*260.0);
    vec3 rnd = hash32(cell + 3.7);
    float bright = pow(rnd.x, 34.0);
    vec2 off = fract(sp*260.0) - (0.25 + rnd.yz*0.5);
    float d = length(off);
    float tw = 0.62 + 0.38*sin(uTime*(1.4 + rnd.y*3.0) + rnd.z*40.0);
    float star = bright * smoothstep(0.16, 0.0, d) * tw;
    vec3 sc = mix(vec3(0.72,0.80,1.0), vec3(1.0,0.86,0.68), rnd.z);
    col += sc * star * 1.6 * uNight * smoothstep(-0.02, 0.16, rd.y);
    // a soft galactic band
    float band = exp(-pow((dot(rd, normalize(vec3(0.42,0.60,-0.68))))*3.1, 2.0));
    col += vec3(0.020,0.024,0.040)*band*uNight*fbm(sp*7.0, 4)*smoothstep(0.0,0.2,rd.y);
  }

  /* ── clouds ── */
  float cloudAmt = uCloud*(1.0 - 0.55*uNight);   // the late tides clear off
  if(cloudAmt > 0.001 && rd.y > 0.006){
    float H = 1500.0;
    float t = (H - uCamPos.y)/rd.y;
    vec2 q = (uCamPos.xz + rd.xz*t) * 0.00052;
    float cov = cloudField(q, uTime) * cloudAmt;
    // fake self-shading: sample toward the sun
    float covL = cloudField(q + uSunDir.xz*0.055, uTime) * cloudAmt;
    float dens = smoothstep(0.06, 0.62, cov);
    float shade = smoothstep(0.05, 0.75, covL);
    vec3 lit = mix(vec3(1.05,1.02,1.00), vec3(0.42,0.46,0.56), shade*0.85);
    vec3 zenith = textureLod(uSky, dirToSkyUV(vec3(0,1,0)), 3.0).rgb;
    /* the moon term matters: without it an overcast night is a black hole
       where the sky should be */
    vec3 cc = lit * (uSunColor*0.62 + zenith*1.5 + uMoonColor*3.2);
    float rim = pow(max(dot(rd, uSunDir), 0.0), 12.0)*(1.0-shade);
    cc += uSunColor*rim*0.9;
    /* the plane is sampled in metres; a few kilometres out there are more
       noise periods than pixels, so let it go */
    float reach = smoothstep(11000.0, 3000.0, t);
    float horizonFade = smoothstep(0.018, 0.19, rd.y)*reach;
    col = mix(col, cc, dens*horizonFade*0.92);

    // high cirrus
    float ct = (7000.0 - uCamPos.y)/rd.y;
    vec2 cq = (uCamPos.xz + rd.xz*ct)*0.00013;
    float ci = fbm(cq*vec2(1.0,3.4) + vec2(uTime*0.004,0.0), 4);
    ci = smoothstep(0.54, 0.86, ci)*0.55;
    /* tie the cirrus to the sky it is actually sitting in — a constant here
       turns into blazing white streaks the moment the exposure opens up */
    vec3 zen = textureLod(uSky, dirToSkyUV(vec3(0.0,1.0,0.0)), 2.0).rgb;
    col = mix(col, (uSunColor*0.55 + zen*2.2)*1.5, ci*horizonFade*cloudAmt);
  }

  /* ── the sun ── */
  float sd = dot(rd, uSunDir);
  float ang = acos(clamp(sd, -1.0, 1.0));
  const float SUN_R = 0.0092;
  float disc = smoothstep(SUN_R*1.06, SUN_R*0.90, ang);
  float limb = sqrt(max(1.0 - pow(ang/SUN_R, 2.0), 0.0));
  vec3 sunT = uSunColor;
  col += sunT * disc * (0.45 + 0.75*limb) * 130.0;
  col += sunT * pow(max(sd,0.0), 900.0) * 28.0;
  col += sunT * pow(max(sd,0.0), 42.0) * 0.9;
  col += sunT * pow(max(sd,0.0), 6.0) * 0.10;

  /* ── the moon ── */
  float md = dot(rd, uMoonDir);
  float mang = acos(clamp(md, -1.0, 1.0));
  const float MOON_R = 0.0125;
  float mdisc = smoothstep(MOON_R*1.05, MOON_R*0.93, mang);
  if(mdisc > 0.0){
    vec3 lo = normalize(rd - uMoonDir*md);
    vec2 mu = vec2(dot(lo, normalize(cross(uMoonDir, vec3(0,1,0)))),
                   dot(lo, normalize(cross(uMoonDir, cross(uMoonDir, vec3(0,1,0))))));
    float craters = fbm(mu*(1.0/MOON_R)*0.055 + 12.0, 4);
    vec3 mc = mix(vec3(0.86,0.87,0.90), vec3(0.60,0.62,0.68), smoothstep(0.42,0.66,craters));
    float lb = sqrt(max(1.0 - pow(mang/MOON_R, 2.0), 0.0));
    col += mc * mdisc * (0.35 + 0.9*lb) * 5.2 * uMoonColor * (0.4 + uNight);
  }
  col += uMoonColor * pow(max(md,0.0), 160.0) * 0.55 * uNight;

  fragColor = vec4(col, 1.0);
}`;

/* ═══════════════════════════════════════════════════════════════════ */
class Sky {
  constructor(gl, quality) {
    this.gl = gl;
    const W = 192, H = 96;
    this.lut = new T.FBO(gl, W, H, {
      internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT,
      filter: gl.LINEAR, min: gl.LINEAR_MIPMAP_LINEAR, levels: 7,
      wrapS: gl.REPEAT, wrapT: gl.CLAMP_TO_EDGE
    });
    // repeat horizontally so azimuth wraps without a seam
    gl.bindTexture(gl.TEXTURE_2D, this.lut.color[0]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.pLUT = new T.Program(gl, T.FS_VS, T.HEAD + T.COMMON + LUT_FS, 'skyLUT');
    this.pBG  = new T.Program(gl, T.FS_VS, T.HEAD + T.COMMON + BG_FS, 'skyBG');
    this.tex = this.lut.color[0];

    this.sunDir  = T.V3.create(0.3, 0.7, 0.6);
    this.moonDir = T.V3.create(-0.3, 0.5, -0.6);
    this.sunColor  = T.V3.create(1, 1, 1);
    this.moonColor = T.V3.create(0.35, 0.42, 0.6);
    this.sunI = 20.0; this.moonI = 0.0;
    this.night = 0; this.cloud = 0.8;
    this._dirty = true;
  }

  /* elevation/azimuth in degrees; az 90° points out to sea (+Z) */
  setSun(elevDeg, azimDeg) {
    const e = elevDeg * T.DEG, a = azimDeg * T.DEG;
    T.V3.set(this.sunDir, Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
    T.V3.norm(this.sunDir, this.sunDir);
    // moon rides opposite and a bit higher
    const me = (28 + Math.max(0, -elevDeg) * 0.9) * T.DEG, ma = (azimDeg + 168) * T.DEG;
    T.V3.set(this.moonDir, Math.cos(me) * Math.cos(ma), Math.sin(me), Math.cos(me) * Math.sin(ma));
    T.V3.norm(this.moonDir, this.moonDir);

    this.night = T.sat((2.0 - elevDeg) / 12.0);
    this.moonI = this.night * 0.055;
    this.sunI = 20.0;
    this._computeSunColor(elevDeg);
    this._dirty = true;
  }

  /* CPU mirror of transmittanceTo() so lighting code has the sun's colour */
  _computeSunColor(elevDeg) {
    const Rg = 6371000, Rt = 6471000, Hr = 8000, Hm = 1400;
    const BR = [5.802e-6, 13.558e-6, 33.1e-6], BM = 4.4e-6;
    const d = this.sunDir;
    const ro = [0, Rg + 240, 0];
    const b = ro[0]*d[0] + ro[1]*d[1] + ro[2]*d[2];
    const c = ro[0]*ro[0] + ro[1]*ro[1] + ro[2]*ro[2] - Rt*Rt;
    const disc = b*b - c;
    let odR = 0, odM = 0;
    if (disc > 0) {
      const tMax = -b + Math.sqrt(disc);
      const N = 20, ds = tMax / N;
      for (let i = 0; i < N; i++) {
        const s = ds * (i + 0.5);
        const px = ro[0]+d[0]*s, py = ro[1]+d[1]*s, pz = ro[2]+d[2]*s;
        const h = Math.max(Math.hypot(px, py, pz) - Rg, 0);
        odR += Math.exp(-h / Hr) * ds;
        odM += Math.exp(-h / Hm) * ds;
      }
    }
    const inten = 20.0;
    for (let i = 0; i < 3; i++)
      this.sunColor[i] = Math.exp(-(BR[i]*odR + BM*1.11*odM)) * inten;
    // once the sun is under the horizon, kill it off smoothly
    const k = T.sat((elevDeg + 3.5) / 4.5);
    for (let i = 0; i < 3; i++) this.sunColor[i] *= k;
    const mk = this.night;
    this.moonColor[0] = 0.030 * mk; this.moonColor[1] = 0.038 * mk; this.moonColor[2] = 0.058 * mk;
  }

  updateLUT() {
    if (!this._dirty) return;
    this._dirty = false;
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.lut.bind();
    this.pLUT.use()
      .set('uSunDir', this.sunDir).set('uMoonDir', this.moonDir)
      .set('uSunI', this.sunI).set('uMoonI', this.moonI);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  drawBackground(cam, time) {
    const gl = this.gl;
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.pBG.use()
      .tex('uSky', this.tex)
      .set('uInvVP', cam.invVP).set('uCamPos', cam.pos)
      .set('uSunDir', this.sunDir).set('uSunColor', this.sunColor)
      .set('uMoonDir', this.moonDir).set('uMoonColor', this.moonColor)
      .set('uTime', time).set('uNight', this.night).set('uCloud', this.cloud)
      .set('uStyle', this.style || 0).set('uInkGain', this.inkGain || 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }
}

T.Sky = Sky;
T.ATMO_GLSL = ATMO;

})(TW);
