/* ============================================================================
   TIDEWRIGHT — core.js
   Math, WebGL2 helpers, async GPU readback, storage. No dependencies.
   ========================================================================== */
'use strict';
var TW = window.TW = window.TW || {};

(function (T) {

/* ─────────────────────────── scalar math ─────────────────────────── */
const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);
const sat   = x => x < 0 ? 0 : (x > 1 ? 1 : x);
const lerp  = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = sat((x - e0) / (e1 - e0 || 1e-9)); return t * t * (3 - 2 * t); };
const damp  = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const DEG = Math.PI / 180;

T.clamp = clamp; T.sat = sat; T.lerp = lerp; T.smoothstep = smoothstep; T.damp = damp; T.DEG = DEG;

/* deterministic RNG (mulberry32) */
T.rng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};

/* ─────────────────────────── vec3 ─────────────────────────── */
const V3 = T.V3 = {
  create: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
  set: (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add: (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub: (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale: (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  addScaled: (o, a, b, s) => { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: (o, a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o; },
  cross: (o, a, b) => {
    const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
    o[0] = x; o[1] = y; o[2] = z; return o;
  },
  lerp: (o, a, b, t) => { o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); return o; }
};

/* ─────────────────────────── mat4 (column-major) ─────────────────────────── */
const M4 = T.M4 = {
  create: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
  identity(o) { o.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); return o; },
  copy(o, a) { o.set(a); return o; },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0]=f/aspect; o[1]=0; o[2]=0; o[3]=0;
    o[4]=0; o[5]=f; o[6]=0; o[7]=0;
    o[8]=0; o[9]=0; o[10]=(far+near)*nf; o[11]=-1;
    o[12]=0; o[13]=0; o[14]=2*far*near*nf; o[15]=0;
    return o;
  },
  ortho(o, l, r, b, t, n, f) {
    const lr = 1/(l-r), bt = 1/(b-t), nf = 1/(n-f);
    o[0]=-2*lr; o[1]=0; o[2]=0; o[3]=0;
    o[4]=0; o[5]=-2*bt; o[6]=0; o[7]=0;
    o[8]=0; o[9]=0; o[10]=2*nf; o[11]=0;
    o[12]=(l+r)*lr; o[13]=(t+b)*bt; o[14]=(f+n)*nf; o[15]=1;
    return o;
  },
  lookAt(o, eye, center, up) {
    let z0 = eye[0]-center[0], z1 = eye[1]-center[1], z2 = eye[2]-center[2];
    let l = Math.hypot(z0,z1,z2) || 1; z0/=l; z1/=l; z2/=l;
    let x0 = up[1]*z2 - up[2]*z1, x1 = up[2]*z0 - up[0]*z2, x2 = up[0]*z1 - up[1]*z0;
    l = Math.hypot(x0,x1,x2);
    if (l < 1e-6) { x0 = 1; x1 = 0; x2 = 0; } else { x0/=l; x1/=l; x2/=l; }
    const y0 = z1*x2 - z2*x1, y1 = z2*x0 - z0*x2, y2 = z0*x1 - z1*x0;
    o[0]=x0; o[1]=y0; o[2]=z0; o[3]=0;
    o[4]=x1; o[5]=y1; o[6]=z1; o[7]=0;
    o[8]=x2; o[9]=y2; o[10]=z2; o[11]=0;
    o[12]=-(x0*eye[0]+x1*eye[1]+x2*eye[2]);
    o[13]=-(y0*eye[0]+y1*eye[1]+y2*eye[2]);
    o[14]=-(z0*eye[0]+z1*eye[1]+z2*eye[2]);
    o[15]=1;
    return o;
  },
  mul(o, a, b) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (let i = 0; i < 4; i++) {
      const b0=b[i*4], b1=b[i*4+1], b2=b[i*4+2], b3=b[i*4+3];
      o[i*4]   = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      o[i*4+1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      o[i*4+2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      o[i*4+3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    }
    return o;
  },
  invert(o, a) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
          b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
          b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
          b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det = b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!det) return null;
    det = 1 / det;
    o[0]=(a11*b11-a12*b10+a13*b09)*det; o[1]=(a02*b10-a01*b11-a03*b09)*det;
    o[2]=(a31*b05-a32*b04+a33*b03)*det; o[3]=(a22*b04-a21*b05-a23*b03)*det;
    o[4]=(a12*b08-a10*b11-a13*b07)*det; o[5]=(a00*b11-a02*b08+a03*b07)*det;
    o[6]=(a32*b02-a30*b05-a33*b01)*det; o[7]=(a20*b05-a22*b02+a23*b01)*det;
    o[8]=(a10*b10-a11*b08+a13*b06)*det; o[9]=(a01*b08-a00*b10-a03*b06)*det;
    o[10]=(a30*b04-a31*b02+a33*b00)*det; o[11]=(a21*b02-a20*b04-a23*b00)*det;
    o[12]=(a11*b07-a10*b09-a12*b06)*det; o[13]=(a00*b09-a01*b07+a02*b06)*det;
    o[14]=(a31*b01-a30*b03-a32*b00)*det; o[15]=(a20*b03-a21*b01+a22*b00)*det;
    return o;
  },
  transformPoint(out, m, p) {
    const x=p[0], y=p[1], z=p[2];
    let w = m[3]*x + m[7]*y + m[11]*z + m[15]; w = w || 1;
    out[0] = (m[0]*x + m[4]*y + m[8]*z + m[12]) / w;
    out[1] = (m[1]*x + m[5]*y + m[9]*z + m[13]) / w;
    out[2] = (m[2]*x + m[6]*y + m[10]*z + m[14]) / w;
    return out;
  },
  /* TRS with uniform-ish scale and Y rotation only (enough for our props) */
  trs(o, tx, ty, tz, ry, sx, sy, sz) {
    const c = Math.cos(ry), s = Math.sin(ry);
    o[0]=c*sx; o[1]=0; o[2]=-s*sx; o[3]=0;
    o[4]=0; o[5]=sy; o[6]=0; o[7]=0;
    o[8]=s*sz; o[9]=0; o[10]=c*sz; o[11]=0;
    o[12]=tx; o[13]=ty; o[14]=tz; o[15]=1;
    return o;
  }
};

/* ═══════════════════════════ GL wrapper ═══════════════════════════ */

function compile(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const lines = src.split('\n');
    let ctx = '';
    const m = /ERROR:\s*\d+:(\d+)/.exec(log);
    if (m) {
      const ln = parseInt(m[1], 10);
      for (let i = Math.max(0, ln - 4); i < Math.min(lines.length, ln + 3); i++)
        ctx += (i + 1 === ln ? '>> ' : '   ') + (i + 1) + ': ' + lines[i] + '\n';
    }
    console.error('[shader ' + name + ']\n' + log + '\n' + ctx);
    throw new Error('shader compile failed: ' + name + '\n' + log);
  }
  return sh;
}

class Program {
  constructor(gl, vsSrc, fsSrc, name, tfVaryings) {
    this.gl = gl; this.name = name || 'prog';
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, this.name + '.vert');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, this.name + '.frag');
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    if (tfVaryings) gl.transformFeedbackVaryings(p, tfVaryings, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('link failed: ' + this.name + '\n' + gl.getProgramInfoLog(p));
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.p = p;
    this.u = {}; this.a = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i);
      const nm = info.name.replace(/\[0\]$/, '');
      this.u[nm] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(p, i);
      this.a[info.name] = gl.getAttribLocation(p, info.name);
    }
    this._unit = 0;
  }
  use() { this.gl.useProgram(this.p); this._unit = 0; return this; }
  /* generic uniform setter, dispatched by reflected type */
  set(name, v) {
    const gl = this.gl, e = this.u[name];
    if (!e) return this;
    const t = e.type;
    switch (t) {
      case gl.FLOAT:      gl.uniform1f(e.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(e.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(e.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(e.loc, v); break;
      case gl.INT: case gl.BOOL: gl.uniform1i(e.loc, v); break;
      case gl.INT_VEC2:   gl.uniform2iv(e.loc, v); break;
      case gl.INT_VEC3:   gl.uniform3iv(e.loc, v); break;
      case gl.INT_VEC4:   gl.uniform4iv(e.loc, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(e.loc, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(e.loc, false, v); break;
      default:            gl.uniform1f(e.loc, v);
    }
    return this;
  }
  /* bind a texture to the next free unit */
  tex(name, texture, target) {
    const gl = this.gl, e = this.u[name];
    if (!e) return this;
    const unit = this._unit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target || gl.TEXTURE_2D, texture);
    gl.uniform1i(e.loc, unit);
    return this;
  }
  setAll(obj) { for (const k in obj) this.set(k, obj[k]); return this; }
}
T.Program = Program;

/* ─────────────────────────── textures & FBOs ─────────────────────────── */
function makeTex(gl, o) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const w = o.w, h = o.h;
  const internal = o.internal || gl.RGBA8;
  const format   = o.format   || gl.RGBA;
  const type     = o.type     || gl.UNSIGNED_BYTE;
  if (o.levels && o.levels > 1) {
    gl.texStorage2D(gl.TEXTURE_2D, o.levels, internal, w, h);
    if (o.data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, type, o.data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, o.data || null);
  }
  const filt = o.filter || gl.LINEAR;
  const minf = o.min || (o.levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : filt);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
  const wrapS = o.wrapS || o.wrap || gl.CLAMP_TO_EDGE;
  const wrapT = o.wrapT || o.wrap || gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  if (o.compare) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  }
  t._w = w; t._h = h;
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}
T.makeTex = makeTex;

class FBO {
  constructor(gl, w, h, opts) {
    opts = opts || {};
    this.gl = gl; this.w = w; this.h = h;
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    this.color = [];
    const n = opts.color === undefined ? 1 : opts.color;
    for (let i = 0; i < n; i++) {
      const t = makeTex(gl, {
        w, h,
        internal: opts.internal || gl.RGBA8,
        format: opts.format || gl.RGBA,
        type: opts.type || gl.UNSIGNED_BYTE,
        filter: opts.filter || gl.LINEAR,
        min: opts.min,
        levels: opts.levels,
        wrap: opts.wrap || gl.CLAMP_TO_EDGE
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      this.color.push(t);
    }
    if (n === 0) {
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    } else if (n > 1) {
      const bufs = [];
      for (let i = 0; i < n; i++) bufs.push(gl.COLOR_ATTACHMENT0 + i);
      gl.drawBuffers(bufs);
    }
    if (opts.depth) {
      if (opts.depthTex) {
        this.depth = makeTex(gl, {
          w, h, internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT,
          type: gl.UNSIGNED_INT, filter: gl.NEAREST, compare: opts.compare
        });
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
      } else {
        this.rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rb);
      }
    }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn('FBO incomplete 0x' + st.toString(16), w, h, opts);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bind(clear) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, this.w, this.h);
    if (clear) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | (this.depth || this.rb ? gl.DEPTH_BUFFER_BIT : 0)); }
    return this;
  }
  dispose() {
    const gl = this.gl;
    this.color.forEach(t => gl.deleteTexture(t));
    if (this.depth) gl.deleteTexture(this.depth);
    if (this.rb) gl.deleteRenderbuffer(this.rb);
    gl.deleteFramebuffer(this.fb);
  }
}
T.FBO = FBO;

/* ─────────────────────────── fullscreen triangle ─────────────────────────── */
T.FS_VS = `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  vUV = p;
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

/* ───────────────────── async GPU readback (PBO + fence) ───────────────────── */
class AsyncReader {
  constructor(gl, w, h, format, type, bytes) {
    this.gl = gl; this.w = w; this.h = h;
    this.format = format; this.type = type;
    this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.out = new Float32Array(bytes / 4);
    this.sync = null; this.pending = false; this.ready = false;
    this.fails = 0;
  }
  /* call with the source FBO bound */
  request() {
    if (this.pending || this.fails > 4) return;
    const gl = this.gl;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, this.w, this.h, this.format, this.type, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!this.sync) { this.fails++; return; }
    this.pending = true;
  }
  poll() {
    if (!this.pending) return false;
    const gl = this.gl;
    /* SYNC_FLUSH_COMMANDS_BIT: without it the fence can sit unsignalled
       forever if nothing else flushes the queue. */
    const st = gl.clientWaitSync(this.sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
    if (st === gl.WAIT_FAILED) { gl.deleteSync(this.sync); this.sync = null; this.pending = false; this.fails++; return false; }
    if (st === gl.TIMEOUT_EXPIRED) return false;
    gl.deleteSync(this.sync); this.sync = null; this.pending = false;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.ready = true;
    return true;
  }
}
T.AsyncReader = AsyncReader;

/* ─────────────────────────── storage (file:// safe) ─────────────────────────── */
const memStore = {};
T.store = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); }
    catch (e) { return k in memStore ? memStore[k] : def; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { memStore[k] = v; }
  },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete memStore[k]; } }
};

/* ─────────────────────────── misc ─────────────────────────── */
T.fmtTime = s => {
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
T.roman = n => ['—','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][n] || String(n);

/* value noise on the CPU — used for prop scatter, matches the GLSL flavour loosely */
T.hash2 = (x, y) => {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

})(TW);
