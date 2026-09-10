/* ============================================================================
   TIDEWRIGHT — terrain.js
   The sand surface. A vertex-ID generated grid (no buffers at all) displaced
   by the simulation texture, shaded with:
     · Oren–Nayar diffuse, because sand is the roughest thing on a beach
     · wetness that darkens albedo, drops roughness and flattens micro-normals
     · a mica glint field — the reason real sand *sparkles* and CG sand doesn't
     · heightfield horizon AO, procedural ripples, shell grit, heavy-mineral
       streaks in the swash zone
     · caustics wherever the water is standing over it
   ========================================================================== */
'use strict';

(function (T) {

const TERRAIN_VS = `
uniform sampler2D uSand;
uniform vec4  uDomain;
uniform mat4  uVP;
uniform float uGridN;
uniform float uOuter;      // 1 = the coarse skirt that carries the coast past the sim
out vec3 vWP;
out vec2 vUV;
out vec4 vS;
` + T.COMMON + `
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
  vec2 uv = vec2(c)/float(W);

  vec2 wp;
  vec4 S = vec4(0.0);
  float drop = 0.0;
  if(uOuter > 0.5){
    vec2 s = uv*2.0 - 1.0;
    wp = vec2(0.0, -4.0) + sign(s)*pow(abs(s), vec2(2.6))*340.0;
    vec2 duv = (wp - uDomain.xy)/uDomain.zw;
    bool ins = duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0;
    /* Inside the sim domain the skirt is redundant — but its triangles are
       three times coarser, so once the sea scours the shoreline they saw
       straight up through the real surface as a picket fence. Sample the same
       field, then sink it out of the way. */
    S.r = ins ? textureLod(uSand, clamp(duv, 0.0, 1.0), 0.0).r : sandBed(wp);
    vec2 dd = min(duv, 1.0 - duv);
    drop = 0.85*smoothstep(0.0, 0.045, max(0.0, min(dd.x, dd.y)));
    vUV = clamp(duv, 0.0, 1.0);
  } else {
    wp = uDomain.xy + uv*uDomain.zw;
    S = textureLod(uSand, uv, 0.0);
    vUV = uv;
  }
  float y = bedrock(wp) + S.r - drop;
  vWP = vec3(wp.x, y, wp.y);
  vS  = S;
  gl_Position = uVP*vec4(vWP, 1.0);
}`;

const DEPTH_FS = `
out vec4 fragColor;
in vec3 vWP; in vec2 vUV; in vec4 vS;
void main(){ fragColor = vec4(1.0); }`;

const TERRAIN_FS = `
in vec3 vWP; in vec2 vUV; in vec4 vS;
out vec4 fragColor;

uniform sampler2D uSand;
uniform sampler2D uAO;
uniform vec4  uDomain;
uniform vec2  uTexel;
uniform float uRes;
uniform float uCell;
uniform float uSeaBase;
uniform float uWaveAmp;
uniform float uGlint;
uniform vec4  uCursor;   // x z radius mode
uniform vec4  uCursor2;  // valid, innerRatio, pulse, allowed
uniform vec4  uCursor3;  // showMould, mouldId, rotation, detail
uniform float uUIGain;   // cursor brightness, scaled against the exposure
uniform float uStyle;    // 0 = Salt & Light · 1 = Bucket & Spade · 2 = Marram
uniform float uInkGain;  // 1/exposure, so printed inks land at authored values
uniform vec4  uLamps[4]; // xyz = position, w = intensity (0 = off)
` + T.SHADOW + T.LIGHTENV + `

vec2 worldToUV(vec2 p){ return (p - uDomain.xy)/uDomain.zw; }

vec4 sandSmooth(vec2 uv){
  vec2 t = uv*uRes - 0.5;
  vec2 i = floor(t), f = fract(t);
  f = f*f*(3.0 - 2.0*f);
  vec2 b = (i + 0.5)*uTexel;
  vec4 s00 = texture(uSand, b);
  vec4 s10 = texture(uSand, b + vec2(uTexel.x, 0.0));
  vec4 s01 = texture(uSand, b + vec2(0.0, uTexel.y));
  vec4 s11 = texture(uSand, b + uTexel);
  return mix(mix(s00,s10,f.x), mix(s01,s11,f.x), f.y);
}
float groundY(vec2 p){
  vec2 uv = worldToUV(p);
  float s = (uv.x>=0.0 && uv.x<=1.0 && uv.y>=0.0 && uv.y<=1.0) ? sandSmooth(uv).r : sandBed(p);
  return bedrock(p) + s;
}

/* micro relief: grain, wind ripple, and the corduroy the tide leaves */
vec3 detailNormal(vec2 p, float wet, float packed, float fade, out float grit){
  float e = 0.028;
  float s = 0.0;

  float a0 = fbmG(p*7.4, 3);
  float a1 = fbmG(p*23.0, 2);
  float a2 = gnoise(p*74.0);

  float amp = mix(1.0, 0.30, wet)*mix(1.0, 0.45, packed);
  float f0 = (a0-0.5)*0.055*amp;
  float f1 = (a1-0.5)*0.024*amp;
  float f2 = (a2-0.5)*0.010*amp*fade;

  // sample gradients numerically on the sum
  vec2 d = vec2(e, 0.0);
  float hx = ((fbmG((p+d.xy)*7.4,3)-0.5)*0.055 + (fbmG((p+d.xy)*23.0,2)-0.5)*0.024
            + (gnoise((p+d.xy)*74.0)-0.5)*0.010*fade)*amp;
  float hz = ((fbmG((p+d.yx)*7.4,3)-0.5)*0.055 + (fbmG((p+d.yx)*23.0,2)-0.5)*0.024
            + (gnoise((p+d.yx)*74.0)-0.5)*0.010*fade)*amp;
  float h0 = f0+f1+f2;
  grit = a2;
  return normalize(vec3(-(hx-h0)/e, 1.0, -(hz-h0)/e));
}

/* the mica. Two octaves of per-cell random micro-facets — a sparkle that moves
   with the head vector, exactly like the real thing does when you walk past. */
float micaGlint(vec3 N, vec3 V, vec3 L, vec2 p, float fade){
  if(fade <= 0.002) return 0.0;
  vec3 H = normalize(V + L);
  float g = 0.0;
  float sc = 210.0;
  for(int o=0;o<2;o++){
    vec2 cell = floor(p*sc + float(o)*53.0);
    /* only a small fraction of grains are mica — that sparseness is the
       whole effect. Light every cell and you get glitter glue, not a beach. */
    float present = step(0.84, hash12(cell*1.37 + 5.0));
    if(present > 0.0){
      vec3 r = hash32(cell)*2.0 - 1.0;
      vec3 gn = normalize(N + r*0.52);
      float d = max(dot(gn, H), 0.0);
      g += pow(d, 1500.0)*(0.5 + 0.5*hash12(cell + 7.0));
    }
    sc *= 3.4;
  }
  return g*fade;
}

/* Contour lines straight off the heightfield — the one look this game is
   uniquely able to draw, because it *is* a heightfield. Fragment-only: it
   needs fwidth to hold the line to one pixel. */
float contour(float h, float step_, float weight){
  float c = fract(h/step_);
  float w = fwidth(h/step_)*1.1 + weight;
  return 1.0 - smoothstep(0.0, w, min(c, 1.0 - c));
}

float caustic(vec2 p, float t){
  float a = 0.0;
  vec2 q = p*2.3;
  for(int i=0;i<3;i++){
    vec2 o = vec2(sin(t*0.7 + float(i)*2.1), cos(t*0.53 + float(i)*1.7))*0.35;
    a += abs(gnoise(q + o + float(i)*13.0)*2.0 - 1.0);
    q *= 1.9;
  }
  a = 1.0 - a/3.0;
  return pow(clamp(a, 0.0, 1.0), 5.0);
}

void main(){
  vec2 wp = vWP.xz;
  vec2 duv = (wp - uDomain.xy)/uDomain.zw;
  bool inside = duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0;
  vec4 S = inside ? sandSmooth(duv)
                  : vec4(0.0, smoothstep(0.45, -0.30, vWP.y - uSeaBase), 0.0, 0.0);
  float sand = S.r, moist = S.g, packed = S.b, film = S.a;

  /* ── macro normal from the heightfield ── */
  float e = uCell;
  float hl = groundY(wp - vec2(e,0.0)), hr = groundY(wp + vec2(e,0.0));
  float hd = groundY(wp - vec2(0.0,e)), hu = groundY(wp + vec2(0.0,e));
  vec3 Nmac = normalize(vec3(hl - hr, 2.0*e, hd - hu));

  /* Everything below is textured from a top-down projection, which turns into
     vertical smears the moment you build an actual wall. Shear the sampling
     coordinate with height on steep faces — cheap, and there is no direction
     left along which the noise stays constant. */
  float vert = smoothstep(0.72, 0.18, Nmac.y);
  vec2 hz = normalize(vec2(-Nmac.z, Nmac.x) + vec2(1e-4, 0.0));
  vec2 wallP = vec2(dot(wp, hz), vWP.y*1.15 + 13.7);
  vec2 sp = mix(wp, wallP, vert);

  vec3 Vv = uCamPos - vWP;
  float dist = length(Vv);
  vec3 V = Vv/max(dist,1e-4);

  float fw = fwidth(wp.x) + fwidth(wp.y) + 0.0001;
  float dfade = exp(-fw*34.0);

  float wet = clamp(moist*1.05, 0.0, 1.0);
  float sheen = clamp(film*4.5, 0.0, 1.0);

  float grit;
  /* the toy beach keeps a whisper of grain and no more */
  vec3 Ndet = detailNormal(sp, max(max(wet, sheen), uStyle*0.82), packed, dfade*(1.0 - uStyle*0.55), grit);
  /* rotate the detail normal into the macro frame */
  vec3 Tt = normalize(cross(vec3(0.0,0.0,1.0), Nmac));
  vec3 Bt = cross(Nmac, Tt);
  vec3 N = normalize(Tt*Ndet.x + Nmac*Ndet.y + Bt*Ndet.z);
  N = normalize(mix(N, Nmac, sheen*0.75));

  /* ── albedo ── */
  float grain = fbm(sp*3.1, 3);
  float grain2 = vnoise(sp*17.0);
  vec3 dry = mix(vec3(0.600,0.517,0.386), vec3(0.702,0.622,0.470), grain);
  dry = mix(dry, vec3(0.745,0.700,0.586), smoothstep(0.62,0.95,grain2)*0.45);   // shell grit
  // heavy minerals gather where the water works — dark ribbons in the swash
  float heavy = smoothstep(0.68, 0.93, fbm(sp*vec2(0.9,4.2) + 31.0, 3));
  float swash = smoothstep(0.9, 0.05, abs(vWP.y - uSeaBase - 0.05));
  dry = mix(dry, vec3(0.235,0.205,0.198), heavy*swash*0.62);
  // packed sand reads slightly denser and cooler
  dry = mix(dry, dry*vec3(0.90,0.90,0.94), packed*0.30);

  vec3 albedo = mix(dry, dry*vec3(0.50,0.470,0.452), wet*0.92);
  albedo = mix(albedo, albedo*0.76, sheen*0.6);

  /* ── Bucket & Spade: a painted beach out of a picture book ── */
  if(uStyle > 0.5){
    vec3 pale = vec3(0.980, 0.880, 0.660);
    vec3 warm = vec3(0.930, 0.780, 0.520);
    vec3 damp = vec3(0.720, 0.560, 0.400);
    float tone = softBands(grain*0.8 + 0.1, 3.0, 0.16);
    vec3 a = mix(warm, pale, tone);
    a = mix(a, damp, softBands(wet, 2.0, 0.22));
    a = mix(a, vec3(0.560, 0.430, 0.330), sheen*0.55);
    a = mix(a, a*vec3(0.94,0.95,1.02), packed*0.35);
    albedo = a;
  }

  /* ── occlusion ── */
  float ao = inside ? texture(uAO, duv).r : 1.0;
  ao = mix(1.0, ao, 0.92);
  float micAO = mix(1.0, 0.72 + 0.28*grain, 0.5);

  /* ── lighting ── */
  vec3 L = uSunDir;
  float NoL = max(dot(N, L), 0.0);
  float sh = shadowAt(vWP + N*0.012, NoL);

  float rough = mix(0.96, 0.40, wet);
  rough = mix(rough, 0.13, sheen);
  rough = mix(rough, rough*0.82, packed*0.5);

  vec3 diff = albedo*(1.0/PI);
  float on = orenNayar(N, V, L, rough);
  vec3 direct = uSunColor*sh*(diff*on);

  /* a little forward scatter — sand glows when you look toward the sun */
  float fwd = pow(max(dot(V, -L), 0.0), 3.0)*(1.0 - NoL*0.6);
  direct += uSunColor*sh*albedo*fwd*0.055;

  vec3 amb = ambientFrom(N)*albedo*ao*micAO*1.38;
  // bounce off the flat beach into everything standing on it — this is most of
  // what lights the shaded side of a sandcastle on a real beach
  amb += (uSunColor*0.055 + ambientFrom(vec3(0.0,1.0,0.0))*0.55)
       * albedo*albedo*0.62*ao*vert;

  /* specular */
  float NoV = max(dot(N,V), 1e-4);
  vec3 H = normalize(V+L);
  float NoH = max(dot(N,H), 0.0);
  float VoH = max(dot(V,H), 0.0);
  vec3 f0 = mix(vec3(0.020), vec3(0.043), wet);
  f0 = mix(f0, vec3(0.055), sheen);
  float a2 = max(rough*rough, 0.0015);
  vec3 spec = F_Schlick(f0, VoH)*D_GGX(NoH, a2)*V_Smith(NoV, NoL, a2)*NoL;
  vec3 col = direct + amb + uSunColor*sh*spec;

  /* moonlight — the ninth tide arrives in the dark */
  float NoLm = max(dot(N, uMoonDir), 0.0);
  col += albedo*uMoonColor*NoLm*0.95;

  /* environment reflection on the wet sheen — mirror beach */
  if(sheen > 0.01){
    vec3 R = reflect(-V, N);
    vec3 env = skySample(R, mix(3.0, 0.4, sheen));
    float fres = pow(1.0 - NoV, 5.0);
    col += env*sheen*(0.030 + 0.30*fres);
  }

  /* every stylised look wants the same two lights to hand */
  vec3 sky3 = ambientFrom(vec3(0.0,1.0,0.0));
  vec3 sun3 = uSunColor + uMoonColor*3.0;

  /* ── Bucket & Spade shading: three steps of light and nothing between ── */
  if(uStyle > 0.5 && uStyle < 1.5){
    float key  = softBands(NoL*mix(0.55, 1.0, sh)*ao, 3.0, 0.13);
    /* Hold the light back toward neutral so the painted colours survive a
       low sun instead of being stained orange. */
    vec3 kc = sun3*0.145 + sky3*0.9;
    kc = mix(vec3(luma(kc)), kc, 0.60);
    vec3 lit   = albedo*kc;
    /* and take the shade off the lit tone, not off the ambient — a fixed
       fraction, cooled. At golden hour a pure-ambient shade goes to slate. */
    /* a low sun gets a warm shadow, a high one a cool blue one */
    float hi = smoothstep(0.06, 0.40, uSunDir.y);
    vec3 shadeTint = mix(vec3(0.66, 0.58, 0.55), vec3(0.50, 0.55, 0.68), hi);
    vec3 shade = lit*shadeTint + albedo*sky3*0.42;
    col = mix(shade, lit, key);
    /* a hot rim where the sand turns away — the toy's edge catches the sun */
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.2)*max(NoL, 0.18);
    col += (sun3*0.05 + sky3*0.6)*rim*0.55*albedo;
    /* and the backlight, which is the whole reason to face the low sun */
    float back = pow(max(dot(V, -L), 0.0), 2.0)*pow(1.0 - max(dot(N,V),0.0), 1.8);
    col += sun3*sh*back*albedo*0.14;
  }

  /* ── 2 · Marram: separate the light into five inks, screen the gaps ── */
  if(uStyle > 1.5 && uStyle < 2.5){
    float key = NoL*mix(0.42, 1.0, sh);
    /* the evening bias — the sun is always a little lower than it really is */
    key = pow(clamp(key, 0.0, 1.0), 0.82);
    float lum = key*0.74 + ao*0.26;
    lum *= 1.0 - wet*0.30 - sheen*0.16;
    lum += pow(1.0 - max(dot(N, V), 0.0), 3.0)*0.14;          // rim keeps its edge
    lum = clamp(lum*1.06 - 0.03, 0.0, 1.0);
    float nite = nightOf(uSunColor);
    col = screenPrint(lum, gl_FragCoord.xy, 0.38, 3.3,
                      mix(MAR_S0, NGT_S0, nite), mix(MAR_S1, NGT_S1, nite),
                      mix(MAR_S2, NGT_S2, nite), mix(MAR_S3, NGT_S3, nite),
                      mix(MAR_S4, NGT_S4, nite))*uInkGain;
    /* standing water prints in the sea's inks, not the sand's */
    float sl2 = seaLevelAt(uSeaBase, uTime);
    float wd2 = sl2 - vWP.y;
    if(wd2 > 0.0){
      vec3 wi = screenPrint(clamp(0.72 - wd2*0.30, 0.0, 1.0), gl_FragCoord.xy, 1.05, 3.3,
                            mix(MAR_W0, NGT_W0, nite), mix(MAR_W1, NGT_W1, nite),
                            mix(MAR_W2, NGT_W2, nite), mix(MAR_W3, NGT_W3, nite),
                            mix(MAR_W4, NGT_W4, nite))*uInkGain;
      col = mix(col, wi, clamp(wd2*3.4, 0.0, 0.92));
    }
  }

  /* ── 3 · Ordnance — the shore as a survey sheet ── */
  if(uStyle > 2.5 && uStyle < 3.5){
    /* after dark the survey sheet becomes a blueprint: the plate inverts */
    float nite = nightOf(uSunColor);
    vec3 paper = mix(vec3(0.945, 0.918, 0.850), vec3(0.075, 0.130, 0.235), nite);
    vec3 ink   = mix(vec3(0.255, 0.235, 0.215), vec3(0.800, 0.870, 0.930), nite);
    vec3 fill  = mix(vec3(0.905, 0.848, 0.700), vec3(0.105, 0.180, 0.300), nite);
    float line = contour(vWP.y, 0.16, 0.014);
    float idx  = contour(vWP.y, 0.80, 0.011);
    float steep = smoothstep(0.80, 0.32, N.y);
    /* hachures: short ticks running down the fall line */
    float hatch = step(0.55, fract((vWP.x + vWP.z)*5.5 + vWP.y*2.0));
    col = mix(paper, fill, 0.62 + 0.20*(1.0 - ao));
    col = mix(col, ink, clamp(line*0.42 + idx*0.55, 0.0, 1.0));
    col = mix(col, ink, steep*hatch*0.42);
    col *= 0.93 + 0.13*mix(0.4, 1.0, NoL*sh);
    col *= uInkGain;
  }

  /* ── 4 · Felt & Flannel — wrap-lit cloth, fibre on every edge ── */
  if(uStyle > 3.5 && uStyle < 4.5){
    vec3 a = saturate3(albedo, 1.08)*vec3(1.06, 1.00, 0.90);
    float wrap = clamp((NoL + 0.62)/1.62, 0.0, 1.0)*mix(0.62, 1.0, sh);
    float fuzz = fbm(vWP.xz*34.0 + 9.0, 3);
    vec3 lit = a*(sun3*0.125 + sky3*1.55);
    col = lit*mix(0.62, 1.14, wrap);
    col *= 0.92 + 0.18*fuzz;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    col += (sky3*1.25 + sun3*0.045)*rim*0.55*a*(0.55 + 0.85*fuzz);
    col = mix(col, col*vec3(0.92,0.94,1.02), 0.25);
  }

  /* ── 6 · Tin Toy — enamel over pressed tin ── */
  if(uStyle > 5.5 && uStyle < 6.5){
    vec3 a = saturate3(albedo, 1.30);
    float key = softBands(NoL*mix(0.5, 1.0, sh)*ao, 4.0, 0.055);
    vec3 H2 = normalize(V + L);
    float sp = pow(max(dot(N, H2), 0.0), 70.0);
    col = a*(sun3*0.105 + sky3*0.95)*mix(0.30, 1.0, key);
    col += sun3*0.055*smoothstep(0.20, 0.55, sp)*(0.55 + 0.45*step(0.5, fract(sp*7.0)));
    col *= 0.94 + 0.11*halftone(gl_FragCoord.xy, 0.5, 0.90, 2.1);
    float wear = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col = mix(col, vec3(0.78,0.76,0.70)*luma(sun3)*0.085, wear*0.55);
  }

  /* ── 7 · Sōsaku Hanga — flat blocks, wood grain in the fill ── */
  if(uStyle > 6.5 && uStyle < 7.5){
    float key = softBands(NoL*mix(0.48, 1.0, sh)*ao, 3.0, 0.19);
    float grain = fbmG(vec2(vWP.x*0.42, vWP.z*4.6) + 4.0, 2);
    float nite = nightOf(uSunColor);
    vec3 b1 = mix(vec3(0.900, 0.812, 0.628), vec3(0.400, 0.450, 0.560), nite);
    vec3 b2 = mix(vec3(0.660, 0.494, 0.352), vec3(0.190, 0.240, 0.360), nite);
    vec3 b3 = mix(vec3(0.322, 0.256, 0.246), vec3(0.070, 0.095, 0.170), nite);
    col = mix(b3, mix(b2, b1, smoothstep(0.34, 0.78, key)), smoothstep(0.0, 0.42, key));
    col = mix(col, col*vec3(0.86,0.90,1.0), wet*0.45);
    col *= 0.91 + 0.16*grain;
    col *= uInkGain;
  }

  /* lantern light — the only thing on this beach that is yours */
  for(int i=0;i<4;i++){
    float I = uLamps[i].w;
    if(I <= 0.0) continue;
    vec3 dv = uLamps[i].xyz - vWP;
    float r2 = dot(dv, dv);
    vec3 Ld = dv*inversesqrt(max(r2, 1e-4));
    float att = I/(1.0 + r2*2.1);
    float lam = max(dot(N, Ld), 0.0);
    col += albedo*vec3(1.40, 0.80, 0.32)*lam*att;
    col += vec3(1.30, 0.78, 0.34)*pow(max(dot(reflect(-Ld, N), V), 0.0), 24.0)*att*0.35*sheen;
  }

  /* the mica */
  if(uGlint > 0.5 && uStyle < 0.5){
    float gl = micaGlint(N, V, L, wp, dfade*(1.0 - sheen*0.7)*(1.0 - wet*0.45));
    col += uSunColor*sh*gl*7.0;
  }

  /* ── standing water: caustics and a cool cast ── */
  float sl = seaLevelAt(uSeaBase, uTime);
  float wdep = sl - vWP.y;
  if(wdep > 0.0){
    float cs = caustic(wp*1.35 + vec2(0.0, uTime*0.12), uTime);
    float atten = exp(-max(wdep,0.0)*0.55);
    col += uSunColor*sh*cs*atten*0.55*(0.4+0.6*NoL);
    col *= mix(vec3(1.0), vec3(0.55,0.82,0.86), clamp(wdep*0.9, 0.0, 0.75));
  }

  /* ── 5 · Rockpool — the whole shore under a foot of clear water ── */
  if(uStyle > 4.5 && uStyle < 5.5){
    float caus = caustic(wp*1.7 + vec2(0.0, uTime*0.11), uTime*0.9);
    col *= vec3(0.58, 0.94, 0.92);
    col += (uSunColor*0.040 + ambientFrom(vec3(0,1,0))*0.20)*caus*(0.45 + 0.55*NoL)*sh;
    float l5 = luma(col);
    col = mix(col, vec3(0.085, 0.300, 0.335)*(l5 + 0.05)*3.1, 0.34);
  }

  /* ── 8 · Midwinter — the same beach, out of season ── */
  if(uStyle > 7.5){
    float l8 = luma(col);
    col = mix(vec3(l8), col, 0.40)*vec3(0.88, 0.93, 1.05);
    col += vec3(0.010, 0.014, 0.022)*ambientFrom(vec3(0,1,0));
  }

  /* ── the cursor: a ring laid on the actual surface ── */
  if(uCursor2.x > 0.5){
    float d = length(wp - uCursor.xy);
    float r = uCursor.z;
    float ew = max(fw*1.6, r*0.012);
    vec3 cc = uCursor2.w > 1.5 ? vec3(0.36, 0.78, 0.86)
            : (uCursor2.w > 0.5 ? vec3(1.00, 0.82, 0.45) : vec3(1.00, 0.36, 0.26));
    /* the ring is drawn from a top-down projection, so on a wall it becomes a
       vertical smear — fade it out where the sand is steep. And it is drawn in
       linear radiance, so without the exposure term it is a pleasant hairline
       at noon and a searchlight at midnight. */
    cc *= (1.0 - vert*0.88)*uUIGain;

    if(uCursor3.x > 0.5){
      /* the mould's own footprint, drawn from the very function that will
         stamp it — what you line up is what turns out */
      vec2 rel = wp - uCursor.xy;
      float ro = uCursor3.z;
      float ca = cos(-ro), sa = sin(-ro);
      vec2 q = vec2(rel.x*ca - rel.y*sa, rel.x*sa + rel.y*ca)/r;
      vec2 ms = mouldShape(q, int(uCursor3.y + 0.5), uCursor3.w);
      /* a line two pixels wide whatever the mould's size or the camera's —
         fwidth of the coverage itself, not of the world position */
      float dc = fwidth(ms.x)*1.6 + 0.010;
      float edge = 1.0 - smoothstep(0.0, dc, abs(ms.x - 0.5));
      /* only the silhouette — a footprint circle would promise a disc of sand
         that the mould no longer leaves */
      col += cc*(edge*(1.25 + 0.75*uCursor2.z)
               + ms.x*(0.10 + 0.16*ms.y))*1.15;
    } else {
      float ring = smoothstep(r + ew, r, d) - smoothstep(r - ew*2.2, r - ew*3.4, d);
      float inner = (1.0 - smoothstep(r*uCursor2.y*0.6, r*uCursor2.y, d))*0.10;
      col += cc*(ring*(0.55 + 0.35*uCursor2.z) + inner)*1.15;
    }
  }

  col = applyFog(col, dist, -V);
  fragColor = vec4(col, 1.0);
}`;

/* ═══════════════════════════════════════════════════════════════════════ */
class Terrain {
  constructor(gl, sim, gridN, shadowN) {
    this.gl = gl; this.sim = sim;
    this.gridN = gridN;
    this.shadowN = shadowN;
    this.count = (gridN - 1) * (gridN - 1) * 6;
    this.shadowCount = (shadowN - 1) * (shadowN - 1) * 6;
    this.outerN = 224;
    this.outerCount = (this.outerN - 1) * (this.outerN - 1) * 6;
    const VS = T.HEAD + TERRAIN_VS;
    this.prog  = new T.Program(gl, VS, T.HEAD_S + T.COMMON + TERRAIN_FS, 'terrain');
    this.depth = new T.Program(gl, VS, T.HEAD + DEPTH_FS, 'terrainDepth');
    this.cursor  = new Float32Array([0, 0, 1, 0]);
    this.cursor2 = new Float32Array([0, 0.5, 0, 1]);
    this.cursor3 = new Float32Array([0, 0, 0, 8]);
    this.lamps   = new Float32Array(16);
  }

  /* the four nearest standing lanterns actually light the sand */
  setLamps(props, night, camPos) {
    const L = this.lamps;
    L.fill(0);
    const lit = [];
    for (const p of props) {
      if (p.type !== 'lantern' || p.health < 0.5) continue;
      const dx = p.x - camPos[0], dz = p.z - camPos[2];
      lit.push({ p, d: dx * dx + dz * dz });
    }
    lit.sort((a, b) => a.d - b.d);
    const I = 0.16 * (0.28 + 0.72 * night);
    for (let i = 0; i < Math.min(4, lit.length); i++) {
      const p = lit[i].p, o = i * 4;
      L[o] = p.x; L[o + 1] = p.y + 0.68 * p.scale; L[o + 2] = p.z; L[o + 3] = I * p.health;
    }
  }

  drawDepth(lightVP) {
    const gl = this.gl, s = this.sim;
    this.depth.use()
      .tex('uSand', s.tex)
      .set('uDomain', s.domain).set('uVP', lightVP).set('uGridN', this.shadowN)
      .set('uOuter', 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.shadowCount);
  }

  draw(env) {
    const gl = this.gl, s = this.sim;
    const p = this.prog.use();
    p.tex('uSand', s.tex).tex('uAO', s.aoTex).tex('uSky', env.sky.tex)
     .tex('uShadow', env.shadowTex);
    p.set('uDomain', s.domain).set('uTexel', s.texel).set('uRes', s.res)
     .set('uCell', s.cell).set('uVP', env.cam.vp).set('uGridN', this.gridN)
     .set('uOuter', 0).set('uCamPos', env.cam.pos)
     .set('uSunDir', env.sky.sunDir).set('uSunColor', env.sky.sunColor)
     .set('uMoonDir', env.sky.moonDir).set('uMoonColor', env.sky.moonColor)
     .set('uTime', env.time).set('uSeaBase', env.seaBase).set('uWaveAmp', env.waveAmp)
     .set('uFogK', env.fogK).set('uGlint', env.glint ? 1 : 0)
     .set('uLightVP', env.lightVP).set('uShadowTexel', 1 / env.shadowRes)
     .set('uShadowOn', env.shadowOn ? 1 : 0)
     .set('uCursor', this.cursor).set('uCursor2', this.cursor2)
     .set('uCursor3', this.cursor3).set('uLamps', this.lamps)
     .set('uUIGain', env.uiGain || 1.0).set('uStyle', env.style || 0)
     .set('uInkGain', env.inkGain || 1.0);
    /* the coast beyond the simulation: coarse and analytic, pushed back by a
       depth offset rather than a height offset so there is no visible step */
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2.0, 4.0);
    p.set('uOuter', 1).set('uGridN', this.outerN);
    gl.drawArrays(gl.TRIANGLES, 0, this.outerCount);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    p.set('uOuter', 0).set('uGridN', this.gridN);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}

T.Terrain = Terrain;

})(TW);
