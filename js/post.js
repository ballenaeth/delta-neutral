/* ============================================================================
   TIDEWRIGHT — post.js
   HDR → bloom pyramid → volumetric-ish sun shafts → optional bokeh → ACES
   with a warm/cool split grade → vignette, grain, chromatic aberration → FXAA.
   ========================================================================== */
'use strict';

(function (T) {

const BRIGHT_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSrc;
uniform float uThresh, uKnee, uExposure;
void main(){
  vec3 c = texture(uSrc, vUV).rgb*uExposure;
  /* the sun disc is ~300× white after exposure; without a ceiling its glow
     alone floods every mip and the whole frame goes to paper */
  c = min(c, vec3(9.0));
  float l = max(max(c.r,c.g),c.b);
  float soft = clamp(l - uThresh + uKnee, 0.0, 2.0*uKnee);
  soft = soft*soft/(4.0*uKnee + 1e-4);
  float k = max(soft, l - uThresh)/max(l, 1e-4);
  fragColor = vec4(c*k, 1.0);
}`;

const DOWN_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main(){
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUV + t*vec2(-2,-2)).rgb;
  vec3 b = texture(uSrc, vUV + t*vec2( 0,-2)).rgb;
  vec3 c = texture(uSrc, vUV + t*vec2( 2,-2)).rgb;
  vec3 d = texture(uSrc, vUV + t*vec2(-1,-1)).rgb;
  vec3 e = texture(uSrc, vUV + t*vec2( 1,-1)).rgb;
  vec3 f = texture(uSrc, vUV + t*vec2(-2, 0)).rgb;
  vec3 g = texture(uSrc, vUV).rgb;
  vec3 h = texture(uSrc, vUV + t*vec2( 2, 0)).rgb;
  vec3 i = texture(uSrc, vUV + t*vec2(-1, 1)).rgb;
  vec3 j = texture(uSrc, vUV + t*vec2( 1, 1)).rgb;
  vec3 k = texture(uSrc, vUV + t*vec2(-2, 2)).rgb;
  vec3 l = texture(uSrc, vUV + t*vec2( 0, 2)).rgb;
  vec3 m = texture(uSrc, vUV + t*vec2( 2, 2)).rgb;
  vec3 o = g*0.125;
  o += (a+c+k+m)*0.03125;
  o += (b+f+h+l)*0.0625;
  o += (d+e+i+j)*0.125;
  fragColor = vec4(o, 1.0);
}`;

const UP_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uScale;
uniform float uWeight;
void main(){
  vec2 t = uTexel*uScale;
  vec3 o = texture(uSrc, vUV + t*vec2(-1,-1)).rgb*1.0;
  o += texture(uSrc, vUV + t*vec2( 0,-1)).rgb*2.0;
  o += texture(uSrc, vUV + t*vec2( 1,-1)).rgb*1.0;
  o += texture(uSrc, vUV + t*vec2(-1, 0)).rgb*2.0;
  o += texture(uSrc, vUV).rgb*4.0;
  o += texture(uSrc, vUV + t*vec2( 1, 0)).rgb*2.0;
  o += texture(uSrc, vUV + t*vec2(-1, 1)).rgb*1.0;
  o += texture(uSrc, vUV + t*vec2( 0, 1)).rgb*2.0;
  o += texture(uSrc, vUV + t*vec2( 1, 1)).rgb*1.0;
  fragColor = vec4(o/16.0*uWeight, 1.0);
}`;

const SHAFT_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2  uSun;
uniform float uAmount;
uniform float uOnScreen;
void main(){
  if(uOnScreen < 0.5 || uAmount <= 0.0){ fragColor = vec4(0.0); return; }
  vec2 d = (vUV - uSun)/24.0;
  vec2 uv = vUV;
  vec3 acc = vec3(0.0);
  float w = 1.0, tot = 0.0;
  for(int i=0;i<24;i++){
    acc += texture(uSrc, uv).rgb*w;
    tot += w;
    uv -= d;
    w *= 0.935;
  }
  float edge = smoothstep(1.6, 0.35, length(vUV - uSun));
  fragColor = vec4(acc/tot*uAmount*edge, 1.0);
}`;

const DOF_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSrc;
uniform sampler2D uDepth;
uniform vec2  uTexel;
uniform float uNear, uFar, uFocus, uAperture;
float linZ(float d){
  float z = d*2.0 - 1.0;
  return (2.0*uNear*uFar)/(uFar + uNear - z*(uFar - uNear));
}
void main(){
  float z = linZ(texture(uDepth, vUV).r);
  float coc = clamp(abs(z - uFocus)/max(uFocus,1.0)*uAperture, 0.0, 1.0);
  if(coc < 0.02){ fragColor = texture(uSrc, vUV); return; }
  vec3 acc = vec3(0.0); float tot = 0.0;
  float R = coc*26.0;
  const float GA = 2.39996323;
  for(int i=0;i<28;i++){
    float fi = float(i);
    float r = sqrt((fi+0.5)/28.0)*R;
    float a = fi*GA;
    vec2 o = vec2(cos(a), sin(a))*r*uTexel;
    float zs = linZ(texture(uDepth, vUV+o).r);
    float cs = clamp(abs(zs - uFocus)/max(uFocus,1.0)*uAperture, 0.0, 1.0);
    float w = (zs > z - 0.4) ? 1.0 : cs;
    acc += texture(uSrc, vUV+o).rgb*w;
    tot += w;
  }
  fragColor = vec4(acc/max(tot,1e-4), 1.0);
}`;

const COMP_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uShafts;
uniform sampler2D uDepth;
uniform float uExposure, uBloomK, uGrain, uTime, uVignette, uCA, uNight, uShaftK;
uniform float uStyle, uOutline, uNear, uFar;
uniform vec2  uTexel;
uniform vec3  uSunColor;

float linZ(vec2 uv){
  float z = texture(uDepth, uv).r*2.0 - 1.0;
  return (2.0*uNear*uFar)/(uFar + uNear - z*(uFar - uNear));
}
/* Laplacian of linear depth: flat slopes give nothing, silhouettes and
   creases give a line. Normalised by depth so it stays one line wide.
   Measured across two texels rather than one, and held to a coarser
   threshold: at one texel it answers to every sand ripple and every scrap of
   wave chop, and a key block that fires on all of them is not a key block,
   it is hatching. */
float inkEdge(vec2 uv){
  vec2 t = uTexel*2.0;
  float c = linZ(uv);
  float e = abs(linZ(uv - vec2(t.x,0.0)) + linZ(uv + vec2(t.x,0.0)) - 2.0*c)
          + abs(linZ(uv - vec2(0.0,t.y)) + linZ(uv + vec2(0.0,t.y)) - 2.0*c);
  return smoothstep(0.0075, 0.026, e/max(c, 0.6));
}

vec3 grade(vec3 c){
  // lift the shadows toward the sea, push the highlights toward the sun
  float l = luma(c);
  vec3 shadow = vec3(0.030, 0.052, 0.084);
  vec3 high   = vec3(1.045, 1.000, 0.938);
  c = c*mix(vec3(1.0), high, smoothstep(0.30, 1.0, l));
  c += shadow*(1.0 - smoothstep(0.0, 0.55, l))*0.34;
  // a little warmth through the midtones — this is a holiday, not a documentary
  c *= mix(vec3(1.0), vec3(1.028, 1.004, 0.972), smoothstep(0.08, 0.62, l));
  float g = luma(c);
  c = mix(vec3(g), c, 1.15);
  return c;
}

void main(){
  vec2 uv = vUV;
  vec2 ctr = uv - 0.5;
  float r2 = dot(ctr, ctr);

  vec3 c;
  if(uCA > 0.0001){
    float k = uCA*0.0028*(0.25 + r2*3.0);
    c.r = texture(uScene, uv + ctr*k).r;
    c.g = texture(uScene, uv).g;
    c.b = texture(uScene, uv - ctr*k).b;
  } else {
    c = texture(uScene, uv).rgb;
  }
  c *= uExposure;

  vec3 bloom = texture(uBloom, uv).rgb;
  c += bloom*uBloomK*0.34;
  c += texture(uShafts, uv).rgb*uShaftK;

  /* the water pass leaves "how much of this pixel is not sea" in the alpha */
  float dry  = clamp(texture(uScene, uv).a, 0.0, 1.0);
  float inkD = inkEdge(uv)*smoothstep(340.0, 30.0, linZ(uv))*dry;

  if(uStyle > 1.5){
    /* The printed looks author their colours directly, so no tonemap — just
       press them onto paper. */
    c = clamp(c, 0.0, 1.0);
    float fib = fbm(uv*vec2(430.0, 130.0), 3)*0.5 + fbm(uv*vec2(130.0, 430.0) + 7.0, 3)*0.5;

    if(uStyle < 2.5 || (uStyle > 6.5 && uStyle < 7.5)){
      /* Marram and Hanga: pull one ink out of register */
      vec2 mr = vec2(0.85, -0.55)*uTexel;
      c = vec3(clamp(texture(uScene, uv + mr).r*uExposure, 0.0, 1.0), c.g,
               clamp(texture(uScene, uv - mr*0.75).b*uExposure, 0.0, 1.0));
    }
    if(uStyle < 4.5 || (uStyle > 6.5 && uStyle < 7.5)){
      c *= 0.935 + 0.105*fib;                                    // paper fibre
      /* ragged, but at the scale of a gouge slipping in the block — the old
         300-cycle noise broke every line into four-pixel dashes, which reads
         as stray hair rather than as a cut */
      float ink = inkD*uOutline*(0.55 + 0.55*fbm(uv*34.0, 2));
      c = mix(c, vec3(0.150, 0.118, 0.108), ink*0.80);
    }
    if(uStyle > 4.5 && uStyle < 5.5){                            /* Rockpool */
      float wob = fbm(uv*3.2 + uTime*0.06, 3);
      c *= 0.90 + 0.16*wob;
      c += vec3(0.02, 0.05, 0.05)*pow(1.0 - length(uv - 0.5), 2.0);
    }
    if(uStyle > 5.5 && uStyle < 6.5){                            /* Tin Toy */
      c = mix(vec3(luma(c)), c, 1.18);
      c = mix(c, smoothstep(vec3(0.02), vec3(0.98), c), 0.45);
      c = mix(c, c*vec3(0.34,0.30,0.30), inkD*uOutline*0.55);
    }
    if(uStyle > 7.5){                                            /* Midwinter */
      c = mix(c, smoothstep(vec3(-0.05), vec3(1.05), c), 0.35);
      c *= 0.96 + 0.06*fib;
    }
  } else if(uStyle > 0.5){
    /* high key, pushed colour, and a soft brown line round everything */
    c = pow(c, vec3(0.90));
    c = mix(vec3(luma(c)), c, 1.34);
    c *= vec3(1.035, 1.005, 0.965);
    c = tonemapACES(c*1.06);
    c = mix(c, smoothstep(vec3(0.0), vec3(1.0), c), 0.32);
    /* thin the line with distance the way an illustrator does — otherwise the
       horizon itself gets inked, which looks like a mistake because it is */
    c = mix(c, c*vec3(0.32, 0.26, 0.28), inkD*uOutline*0.88);
  } else {
    c = grade(c);
    c = tonemapACES(c);
  }

  // vignette
  float vig = 1.0 - uVignette*smoothstep(0.18, 0.86, r2*1.35);
  c *= vig;

  // grain — coarser and cooler at night, the way pushed film goes
  float n = hash12(gl_FragCoord.xy + fract(uTime)*vec2(311.7, 127.1));
  float amt = uGrain*(0.024 + 0.055*uNight)*(1.15 - luma(c)*0.55);
  c += (n - 0.5)*amt;

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const FXAA_FS = `
in vec2 vUV; out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main(){
  vec3 rgbNW = texture(uSrc, vUV + vec2(-1,-1)*uTexel).rgb;
  vec3 rgbNE = texture(uSrc, vUV + vec2( 1,-1)*uTexel).rgb;
  vec3 rgbSW = texture(uSrc, vUV + vec2(-1, 1)*uTexel).rgb;
  vec3 rgbSE = texture(uSrc, vUV + vec2( 1, 1)*uTexel).rgb;
  vec3 rgbM  = texture(uSrc, vUV).rgb;
  vec3 lw = vec3(0.299, 0.587, 0.114);
  float lNW = dot(rgbNW, lw), lNE = dot(rgbNE, lw);
  float lSW = dot(rgbSW, lw), lSE = dot(rgbSE, lw), lM = dot(rgbM, lw);
  float lMin = min(lM, min(min(lNW,lNE), min(lSW,lSE)));
  float lMax = max(lM, max(max(lNW,lNE), max(lSW,lSE)));
  vec2 dir = vec2(-((lNW+lNE)-(lSW+lSE)), ((lNW+lSW)-(lNE+lSE)));
  float reduce = max((lNW+lNE+lSW+lSE)*0.03125, 0.0078125);
  float rcp = 1.0/(min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir*rcp, vec2(-8.0), vec2(8.0))*uTexel;
  vec3 rgbA = 0.5*(texture(uSrc, vUV + dir*(1.0/3.0-0.5)).rgb +
                   texture(uSrc, vUV + dir*(2.0/3.0-0.5)).rgb);
  vec3 rgbB = rgbA*0.5 + 0.25*(texture(uSrc, vUV - dir*0.5).rgb +
                               texture(uSrc, vUV + dir*0.5).rgb);
  float lB = dot(rgbB, lw);
  fragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
}`;

class Post {
  constructor(gl) {
    this.gl = gl;
    const H = T.HEAD + T.COMMON;
    this.pBright = new T.Program(gl, T.FS_VS, T.HEAD + BRIGHT_FS, 'bright');
    this.pDown   = new T.Program(gl, T.FS_VS, T.HEAD + DOWN_FS, 'down');
    this.pUp     = new T.Program(gl, T.FS_VS, T.HEAD + UP_FS, 'up');
    this.pShaft  = new T.Program(gl, T.FS_VS, T.HEAD + SHAFT_FS, 'shafts');
    this.pDof    = new T.Program(gl, T.FS_VS, T.HEAD + DOF_FS, 'dof');
    this.pComp   = new T.Program(gl, T.FS_VS, H + COMP_FS, 'composite');
    this.pFxaa   = new T.Program(gl, T.FS_VS, T.HEAD + FXAA_FS, 'fxaa');
    this.mips = [];
    this.texel = new Float32Array(2);
    this.sun = new Float32Array(2);
    this.w = 0; this.h = 0;
  }

  resize(w, h) {
    const gl = this.gl;
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    this.mips.forEach(f => f.dispose());
    this.mips = [];
    const opt = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR };
    let mw = Math.max(2, w >> 1), mh = Math.max(2, h >> 1);
    for (let i = 0; i < 6 && mw > 4 && mh > 4; i++) {
      this.mips.push(new T.FBO(gl, mw, mh, opt));
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
    }
    if (this.shaft) this.shaft.dispose();
    this.shaft = new T.FBO(gl, Math.max(4, w >> 2), Math.max(4, h >> 2), opt);
    if (this.ldr) this.ldr.dispose();
    this.ldr = new T.FBO(gl, w, h, { internal: gl.RGBA8, filter: gl.LINEAR });
    if (this.dofFbo) this.dofFbo.dispose();
    this.dofFbo = new T.FBO(gl, w, h, opt);
  }

  render(sceneTex, depthTex, P) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const quad = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

    let src = sceneTex;

    /* depth of field (photo mode) */
    if (P.aperture > 0.01) {
      this.dofFbo.bind();
      this.texel[0] = 1 / this.w; this.texel[1] = 1 / this.h;
      this.pDof.use().tex('uSrc', src).tex('uDepth', depthTex)
        .set('uTexel', this.texel).set('uNear', P.near).set('uFar', P.far)
        .set('uFocus', P.focus).set('uAperture', P.aperture);
      quad();
      src = this.dofFbo.color[0];
    }

    /* bright pass */
    const m0 = this.mips[0];
    m0.bind();
    this.pBright.use().tex('uSrc', src)
      .set('uThresh', 1.05).set('uKnee', 0.62).set('uExposure', P.exposure);
    quad();

    /* down */
    for (let i = 1; i < this.mips.length; i++) {
      const prev = this.mips[i - 1], cur = this.mips[i];
      cur.bind();
      this.texel[0] = 1 / prev.w; this.texel[1] = 1 / prev.h;
      this.pDown.use().tex('uSrc', prev.color[0]).set('uTexel', this.texel);
      quad();
    }
    /* up + accumulate */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const cur = this.mips[i], hi = this.mips[i + 1];
      cur.bind();
      this.texel[0] = 1 / hi.w; this.texel[1] = 1 / hi.h;
      this.pUp.use().tex('uSrc', hi.color[0]).set('uTexel', this.texel)
        .set('uScale', 1.0).set('uWeight', 0.62);
      quad();
    }
    gl.disable(gl.BLEND);

    /* sun shafts from the bright buffer */
    this.shaft.bind(true);
    this.sun[0] = P.sunScreen[0]; this.sun[1] = P.sunScreen[1];
    this.pShaft.use().tex('uSrc', this.mips[1] ? this.mips[1].color[0] : m0.color[0])
      .set('uSun', this.sun).set('uAmount', P.shafts)
      .set('uOnScreen', P.sunOnScreen ? 1 : 0);
    quad();

    /* composite */
    this.ldr.bind();
    this.texel[0] = 1 / this.w; this.texel[1] = 1 / this.h;
    this.pComp.use().tex('uScene', src).tex('uBloom', m0.color[0]).tex('uShafts', this.shaft.color[0])
      .tex('uDepth', depthTex)
      .set('uStyle', P.style || 0).set('uOutline', P.outline === undefined ? 1 : P.outline)
      .set('uNear', P.near).set('uFar', P.far).set('uTexel', this.texel)
      .set('uExposure', P.exposure).set('uBloomK', P.bloom).set('uGrain', P.grain)
      .set('uTime', P.time).set('uVignette', P.vignette).set('uCA', P.ca)
      .set('uNight', P.night).set('uShaftK', P.shafts > 0 ? 0.34 : 0.0)
      .set('uSunColor', P.sunColor);
    quad();

    /* FXAA to the screen */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, P.outW, P.outH);
    this.texel[0] = 1 / this.w; this.texel[1] = 1 / this.h;
    this.pFxaa.use().tex('uSrc', this.ldr.color[0]).set('uTexel', this.texel);
    quad();
  }
}

T.Post = Post;

})(TW);
