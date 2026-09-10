/* ============================================================================
   TIDEWRIGHT — particles.js
   Six thousand particles integrated entirely on the GPU with transform
   feedback: thrown sand, spray off the breaking crest, splash, and the dust
   that lifts off a dry wall the moment before it fails. They collide with the
   heightfield — a grain thrown up a slope lands back on the slope.
   ========================================================================== */
'use strict';

(function (T) {

const MAX = 6000;

const UPDATE_VS = `
layout(location=0) in vec4 aPos;   // xyz, life  (life < 0 = landed, deposit me)
layout(location=1) in vec4 aVel;   // xyz, maxLife
layout(location=2) in vec4 aMisc;  // size, type, moisture, volume (m³)

out vec4 vPos;
out vec4 vVel;
out vec4 vMisc;

uniform sampler2D uSand;
uniform vec4  uDomain;
uniform float uDt;
uniform float uTime;
uniform vec3  uWind;
uniform float uSeaBase;
` + T.COMMON + `
vec2 worldToUV(vec2 p){ return (p - uDomain.xy)/uDomain.zw; }
float gy(vec2 p){
  vec2 uv = worldToUV(p);
  float s = 0.0;
  if(uv.x>=0.0&&uv.x<=1.0&&uv.y>=0.0&&uv.y<=1.0) s = textureLod(uSand, uv, 0.0).r;
  return bedrock(p) + s;
}

void main(){
  vec3 p = aPos.xyz;
  float life = aPos.w;
  vec3 v = aVel.xyz;
  float type = aMisc.y;

  /* a grain marked last frame has had its volume handed to the heightfield;
     this frame it is simply gone */
  if(life < 0.0){
    life = 0.0;
  } else if(life > 0.0){
    float drag = (type < 0.5) ? 0.45 : (type < 1.5 ? 1.9 : (type < 2.5 ? 1.1 : 2.6));
    float grav = (type < 0.5) ? 9.4 : (type < 1.5 ? 4.6 : (type < 2.5 ? 8.2 : 0.55));
    float windK = (type < 0.5) ? 0.35 : (type < 1.5 ? 1.6 : (type < 2.5 ? 0.7 : 2.4));

    v += (uWind*windK - v*drag)*uDt;
    v.y -= grav*uDt;
    /* turbulence keyed off where the grain is, not off a stored seed — that
       slot now carries the moisture it is bringing with it */
    float sd = hash12(floor(p.xz*6.0));
    float tb = sin(uTime*2.3 + sd*37.0 + p.x*0.7)*0.5 + sin(uTime*3.7 + p.z*0.9)*0.5;
    v.x += tb*uDt*0.55*windK;
    v.z += cos(uTime*2.9 + sd*19.0)*uDt*0.45*windK;

    p += v*uDt;
    life -= uDt;

    float g = gy(p.xz);
    if(p.y < g){
      if(type < 0.5){          // sand lands, and hands over what it carries
        p.y = g;
        v = vec3(0.0);
        life = -1.0;
      } else if(type < 1.5){   // spray bounces once then dies
        p.y = g;
        v.y = abs(v.y)*0.22;
        v.xz *= 0.55;
        life -= uDt*3.0;
      } else {
        life = 0.0;
      }
    }
    /* a grain that runs out of air time still has to put its sand down */
    if(life <= 0.0 && type < 0.5 && aMisc.w > 0.0){ p.y = gy(p.xz); life = -1.0; }
    if(p.y < uSeaBase - 0.06 && type > 0.5) life -= uDt*4.0;
  }

  /* life is written through un-clamped: a negative value is the one-frame
     signal that this grain has landed and still owes the ground its volume */
  vPos  = vec4(p, max(life, -1.0));
  vVel  = vec4(v, aVel.w);
  vMisc = aMisc;
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const UPDATE_FS = `
out vec4 fragColor;
void main(){ fragColor = vec4(0.0); }`;

const DRAW_VS = `
layout(location=0) in vec4 aPos;
layout(location=1) in vec4 aVel;
layout(location=2) in vec4 aMisc;
uniform mat4  uVP;
uniform vec3  uCamPos;
uniform float uScreenH;
out vec4 vCol;
out float vType;
out float vSeed;
void main(){
  if(aPos.w <= 0.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 p = aPos.xyz;
  float t = clamp(aPos.w/max(aVel.w, 0.001), 0.0, 1.0);
  float d = distance(p, uCamPos);
  float size = aMisc.x*(1.0 + (1.0 - t)*(aMisc.y > 2.5 ? 2.4 : 0.15));
  gl_Position = uVP*vec4(p, 1.0);
  gl_PointSize = clamp(size*uScreenH/max(d, 0.15), 1.0, 96.0);
  float a = aMisc.y < 0.5 ? t : (aMisc.y < 1.5 ? smoothstep(0.0,0.25,t)*t
          : (aMisc.y < 2.5 ? t*t : smoothstep(0.0,0.35,t)*t*0.55));
  vCol = vec4(1.0, 1.0, 1.0, a);
  vType = aMisc.y;
  vSeed = aMisc.z;
}`;

const DRAW_FS = `
in vec4 vCol; in float vType; in float vSeed;
out vec4 fragColor;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
void main(){
  vec2 q = gl_PointCoord*2.0 - 1.0;
  float r2 = dot(q,q);
  if(r2 > 1.0) discard;
  float soft = vType < 0.5 ? smoothstep(1.0, 0.25, r2) : smoothstep(1.0, 0.0, r2);
  vec3 c;
  if(vType < 0.5)      c = vec3(0.62, 0.53, 0.40)*(uSunColor*0.30 + uAmbient*1.1);
  else if(vType < 1.5) c = vec3(1.00, 0.99, 0.97)*(uSunColor*0.24 + uAmbient*1.5);
  else if(vType < 2.5) c = vec3(0.72, 0.90, 0.93)*(uSunColor*0.20 + uAmbient*1.4);
  else                 c = vec3(0.70, 0.63, 0.52)*(uSunColor*0.16 + uAmbient*1.0);
  float a = vCol.a*soft*(vType > 2.5 ? 0.35 : 0.9);
  fragColor = vec4(c*a, a);
}`;

/* ─────────────────────────── handing the sand over ───────────────────────────
   A grain that has landed is drawn as a 5-pixel point into a scatter target.
   A 5-pixel point covers exactly 25 texel centres whatever its sub-pixel
   position, so an even 1/25 share puts back precisely the volume it was
   carrying — the field stays conserved to the grain, which is what the pail
   meter is quietly built on.                                                */
const DEPOSIT_VS = `
layout(location=0) in vec4 aPos;
layout(location=1) in vec4 aVel;
layout(location=2) in vec4 aMisc;
uniform vec4 uDomain;
out float vVol;
out float vMoist;
void main(){
  float life = aPos.w;
  vec2 uv = (aPos.xz - uDomain.xy)/uDomain.zw;
  bool ok = life < 0.0 && life > -2.0 && aMisc.w > 0.0 && aMisc.y < 0.5
            && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
  if(!ok){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = vec4(uv*2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 5.0;
  vVol = aMisc.w;
  vMoist = aMisc.z;
}`;

const DEPOSIT_FS = `
in float vVol; in float vMoist;
uniform float uCellArea;
out vec4 fragColor;
void main(){
  float h = vVol/uCellArea/25.0;
  fragColor = vec4(h, h*vMoist, 0.0, 1.0);
}`;

class Particles {
  constructor(gl, sim) {
    this.gl = gl; this.sim = sim;
    this.n = MAX;
    this.stride = 12 * 4;

    this.update = new T.Program(gl, T.HEAD + UPDATE_VS, T.HEAD + UPDATE_FS,
      'partUpdate', ['vPos', 'vVel', 'vMisc']);
    this.draw = new T.Program(gl, T.HEAD + DRAW_VS, T.HEAD + DRAW_FS, 'partDraw');
    this.pDep = new T.Program(gl, T.HEAD + DEPOSIT_VS, T.HEAD + DEPOSIT_FS, 'partDeposit');
    /* RGBA16F rather than 32F: additive blending into half-float is core in
       WebGL2, and 0.08-metre deposits have precision to spare */
    this.dep = new T.FBO(gl, sim.res, sim.res, {
      internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.NEAREST
    });

    const zero = new Float32Array(MAX * 12);
    this.buf = [gl.createBuffer(), gl.createBuffer()];
    this.vao = [];
    for (let i = 0; i < 2; i++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[i]);
      gl.bufferData(gl.ARRAY_BUFFER, zero, gl.DYNAMIC_COPY);
    }
    for (let i = 0; i < 2; i++) {
      const v = gl.createVertexArray();
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[i]);
      for (let a = 0; a < 3; a++) {
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 4, gl.FLOAT, false, this.stride, a * 16);
      }
      gl.bindVertexArray(null);
      this.vao.push(v);
    }
    this.tf = gl.createTransformFeedback();
    this.cur = 0;
    this.head = 0;
    this.pending = [];
    this.scratch = new Float32Array(12 * 512);
    this.wind = new Float32Array(3);
    this.ambient = new Float32Array([0.1, 0.12, 0.16]);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  spawn(type, x, y, z, vx, vy, vz, life, size, moist, vol) {
    if (this.pending.length >= 480 * 12) return;
    this.pending.push(x, y, z, life, vx, vy, vz, life,
                      size, type, moist || 0, vol || 0);
  }

  burst(type, x, y, z, n, speed, life, size, up) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random();
      const s = speed * (0.4 + Math.random() * 0.9);
      this.spawn(type, x + (Math.random()-0.5)*0.06, y + Math.random()*0.05, z + (Math.random()-0.5)*0.06,
        Math.cos(a) * s * (1 - e * 0.7), (up || 1) * s * (0.25 + e), Math.sin(a) * s * (1 - e * 0.7),
        life * (0.6 + Math.random() * 0.8), size * (0.7 + Math.random() * 0.7));
    }
  }

  _flush() {
    const gl = this.gl;
    const p = this.pending;
    if (!p.length) return;
    const count = p.length / 12;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[this.cur]);
    let i = 0;
    while (i < count) {
      const room = this.n - this.head;
      const take = Math.min(room, count - i);
      for (let k = 0; k < take * 12; k++) this.scratch[k] = p[(i * 12) + k];
      gl.bufferSubData(gl.ARRAY_BUFFER, this.head * this.stride, this.scratch, 0, take * 12);
      this.head = (this.head + take) % this.n;
      i += take;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    p.length = 0;
  }

  step(env, dt) {
    const gl = this.gl;
    /* The sand simulation leaves its own target bound, and this pass samples
       that very texture. Even under RASTERIZER_DISCARD that is a framebuffer
       feedback loop, and the driver answers by throwing away the draw — so the
       particles quietly stop moving. Unbind first. */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._flush();
    this.wind[0] = env.windVec[0]; this.wind[1] = env.windVec[1]; this.wind[2] = env.windVec[2];

    const src = this.cur, dst = 1 - this.cur;
    gl.enable(gl.RASTERIZER_DISCARD);
    const p = this.update.use();
    p.tex('uSand', this.sim.tex);
    p.set('uDomain', this.sim.domain).set('uDt', Math.min(dt, 0.05))
     .set('uTime', env.time).set('uWind', this.wind).set('uSeaBase', env.seaBase);
    gl.bindVertexArray(this.vao[src]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buf[dst]);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.n);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    gl.disable(gl.RASTERIZER_DISCARD);
    this.cur = dst;
  }

  /* scatter this frame's landings into a height/moisture target for the sim */
  depositPass(sim) {
    const gl = this.gl;
    this.dep.bind(true);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.pDep.use().set('uDomain', sim.domain).set('uCellArea', sim.cellArea);
    gl.bindVertexArray(this.vao[this.cur]);
    gl.drawArrays(gl.POINTS, 0, this.n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  get depositTex() { return this.dep.color[0]; }

  render(env, h) {
    const gl = this.gl;
    const sky = env.sky;
    this.ambient[0] = sky.sunColor[0] * 0.05 + 0.02;
    this.ambient[1] = sky.sunColor[1] * 0.06 + 0.026;
    this.ambient[2] = sky.sunColor[2] * 0.08 + 0.04;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.draw.use()
      .set('uVP', env.cam.vp).set('uCamPos', env.cam.pos)
      .set('uScreenH', h * 0.55)
      .set('uSunColor', sky.sunColor).set('uAmbient', this.ambient);
    gl.bindVertexArray(this.vao[this.cur]);
    gl.drawArrays(gl.POINTS, 0, this.n);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

T.Particles = Particles;

})(TW);
