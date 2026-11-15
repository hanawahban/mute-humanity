// WebGL map renderer. Every EIC visualization is a flat world map, so one fragment shader
// can place any of them: it turns each screen pixel into a longitude/latitude and reads that
// spot from each layer. Each layer's background (black space, gray land, the base map under
// rain, light green "clean air") is made transparent in the shader, so all six layers can be
// stacked on one map while the data stays visible.

export type KeyMode = 'bright' | 'saturated' | 'precip' | 'darkgreen' | 'warm' | 'opaque' | 'anomaly';
const MODE_ID: Record<KeyMode, number> = { bright: 0, saturated: 1, precip: 2, darkgreen: 3, warm: 4, opaque: 5, anomaly: 6 };

/** NOx is drawn as dark smog, not green. */
export const SMOG = { light: '#5a4636', dark: '#0d0907' };

export interface GlLayer {
  source: TexImageSource;
  isVideo: boolean;
  mode: KeyMode;
  area: [number, number, number, number];
  masks: Array<[number, number, number, number]>; // logos and date stamps inside the frame
  alpha: number;
  boost: number; // brightness boost for faint layers
  floor: number; // for 'bright': how bright a pixel must be to count as data
  grow?: number; // spread tiny points over this many texels (lightning)
}

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uSize;      // canvas size in device pixels
uniform vec3 uView;      // center lon, center lat, device pixels per degree
uniform sampler2D uTex;
uniform int uMode;       // -1 = base map
uniform vec4 uArea;
uniform vec4 uMask0;
uniform vec4 uMask1;
uniform float uAlpha;
uniform float uBoost;
uniform float uDim;
uniform float uFloor;
uniform float uGrow;
uniform vec4 uRect;      // mode -2 (detailed base map): its west, north, east, south in degrees     // >0: spread small bright points (lightning flashes) over this many texels
out vec4 outColor;

bool inRect(vec2 t, vec4 r) { return t.x >= r.x && t.x <= r.z && t.y >= r.y && t.y <= r.w; }

float hue(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float d = mx - min(c.r, min(c.g, c.b));
  if (d < 1e-4) return 0.0;
  float h;
  if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return h * 60.0;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  float lon = uView.x + (frag.x - uSize.x * 0.5) / uView.z;
  float lat = uView.y - (frag.y - uSize.y * 0.5) / uView.z;
  if (lat > 90.0 || lat < -90.0) { outColor = uMode < 0 ? vec4(0.016, 0.027, 0.05, 1.0) : vec4(0.0); return; }
  if (uMode == -2) {
    float l = uRect.x + mod(lon - uRect.x, 360.0);
    vec2 d = vec2((l - uRect.x) / (uRect.z - uRect.x), (uRect.y - lat) / (uRect.y - uRect.w));
    if (d.x < 0.0 || d.x > 1.0 || d.y < 0.0 || d.y > 1.0) { outColor = vec4(0.0); return; }
    vec4 dc = texture(uTex, d);
    outColor = vec4(dc.rgb * uDim * dc.a, dc.a);
    return;
  }
  vec2 uv = vec2(fract((lon + 180.0) / 360.0), (90.0 - lat) / 180.0);
  vec2 t = vec2(mix(uArea.x, uArea.z, uv.x), mix(uArea.y, uArea.w, uv.y));
  vec3 c = texture(uTex, t).rgb;
  if (uMode < 0) { outColor = vec4(c * uDim, 1.0); return; }
  if (uGrow > 0.0) {
    // a flash is a pixel or two in the NASA frame: take the brightest of a few neighbors so it reads
    vec2 px = uGrow / vec2(textureSize(uTex, 0));
    vec3 n[4] = vec3[4](texture(uTex, t + vec2(px.x, 0.0)).rgb, texture(uTex, t - vec2(px.x, 0.0)).rgb,
                        texture(uTex, t + vec2(0.0, px.y)).rgb, texture(uTex, t - vec2(0.0, px.y)).rgb);
    for (int i = 0; i < 4; i++) if (max(n[i].r, max(n[i].g, n[i].b)) > max(c.r, max(c.g, c.b))) c = n[i];
  }
  if (inRect(t, uMask0) || inRect(t, uMask1)) { outColor = vec4(0.0); return; }

  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float a = 1.0;
  if (uMode == 0) a = smoothstep(uFloor, uFloor + 0.3, mx);                       // light on a dark map
  else if (uMode == 1) a = smoothstep(0.18, 0.42, sat) * smoothstep(0.06, 0.22, mx); // color on gray/black
  else if (uMode == 2) {                                                           // rain + clouds over a base map
    float rain = smoothstep(0.45, 0.65, sat) * smoothstep(0.4, 0.6, mx) * (1.0 - step(0.0, c.r - c.b) * step(0.0, c.g - c.b) * step(c.g, c.r * 1.15) * step(sat, 0.75));
    float cloud = (1.0 - smoothstep(0.1, 0.25, sat)) * smoothstep(0.55, 0.9, mx) * 0.75;
    a = max(rain, cloud);
  } else if (uMode == 3 || uMode == 4) {                                           // NOx, shown as dark smog
    float t;
    if (uMode == 3) {                                                              // real: white (clean) to dark green (polluted)
      float green = c.g - max(c.r, c.b);
      t = smoothstep(0.25, 0.75, 1.0 - mx) * step(0.04, green);
    } else t = smoothstep(0.2, 0.5, c.r - c.b);                                   // placeholder: yellow to red
    // a see-through haze, not a black blanket: CO₂ and city lights are drawn above it and show through
    c = mix(vec3(0.42, 0.37, 0.33), vec3(0.11, 0.09, 0.08), t);
    a = smoothstep(0.05, 0.6, t) * 0.75;
  } else if (uMode == 6) {                                                         // temperature: a soft warm/cool wash
    // NASA's map is drawn in 2° blocks with borders burned in. Read a blurred neighborhood (5 x 5
    // taps 0.9° apart, weighted toward the middle), leaving out the borders, gray "no data" and the
    // white of "no change", then redraw it as a calm tint: ember where it got warmer, slate blue
    // where colder, see-through where little changed, so the other layers stay readable on top.
    vec2 st = vec2((uArea.z - uArea.x) / 360.0, (uArea.w - uArea.y) / 180.0) * 0.9;
    float warm = 0.0;
    float cool = 0.0;
    float wsum = 0.0;
    for (int dy = -2; dy <= 2; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        vec3 s = texture(uTex, t + vec2(float(dx), float(dy)) * st).rgb;
        float smx = max(s.r, max(s.g, s.b));
        float smn = min(s.r, min(s.g, s.b));
        float ssat = smx > 0.0 ? (smx - smn) / smx : 0.0;
        float w = smoothstep(0.04, 0.22, ssat) * smoothstep(0.08, 0.25, smx) * exp(-0.35 * float(dx * dx + dy * dy));
        float k = clamp((1.0 - smn - 0.15) / 0.8, 0.0, 1.0); // how far from white: how big the change
        if (s.r > s.b) warm += w * k; else cool += w * k;
        wsum += w;
      }
    }
    float v = wsum > 0.05 ? (warm - cool) / wsum : 0.0; // -1 colder .. +1 warmer
    vec3 ember = vec3(0.82, 0.45, 0.30);
    vec3 slate = vec3(0.40, 0.58, 0.74);
    c = v > 0.0 ? ember * (0.75 + 0.25 * v) : slate * (0.75 - 0.25 * v);
    a = smoothstep(0.3, 1.0, abs(v)) * smoothstep(0.4, 3.0, wsum) * 0.5; // about +1 °C: a light wash; +2 °C: clear
  }
  c = min(vec3(1.0), c * uBoost);
  a *= uAlpha;
  outColor = vec4(c * a, a);
}`;

interface TexEntry {
  tex: WebGLTexture;
  w: number;
  h: number;
  time?: number;
  again?: number; // uploads left after a jump, until the new frame has surely arrived
}

export class MapRenderer {
  private gl: WebGL2RenderingContext;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private textures = new Map<TexImageSource, TexEntry>();
  private base: TexEntry | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);
    for (const n of ['uSize', 'uView', 'uTex', 'uMode', 'uArea', 'uMask0', 'uMask1', 'uAlpha', 'uBoost', 'uDim', 'uFloor', 'uGrow', 'uRect']) this.u[n] = gl.getUniformLocation(prog, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private still: HTMLCanvasElement | null = null;
  private upload(src: TexImageSource, mipmap: boolean, entry?: TexEntry): TexEntry {
    const gl = this.gl;
    // A paused video that was just moved (Then / Now, scrubbing) can hand WebGL an old frame in
    // Chrome while a 2D canvas already gets the new one: go through a canvas for paused videos.
    if (src instanceof HTMLVideoElement && src.paused && src.videoWidth) {
      const c = (this.still ??= document.createElement('canvas'));
      if (c.width !== src.videoWidth || c.height !== src.videoHeight) {
        c.width = src.videoWidth;
        c.height = src.videoHeight;
      }
      c.getContext('2d')!.drawImage(src, 0, 0);
      src = c;
    }
    const e = entry ?? { tex: gl.createTexture()!, w: 0, h: 0 };
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return e;
  }

  setBase(img: HTMLImageElement) {
    this.base = this.upload(img, true);
  }

  private detail: (TexEntry & { rect: [number, number, number, number]; version: number }) | null = null;
  /** The detailed base map for the current area (see detail.ts), or null to use only the bundled one. */
  setDetail(d: { canvas: HTMLCanvasElement; west: number; north: number; east: number; south: number; version: number } | null) {
    if (!d) {
      if (this.detail) this.gl.deleteTexture(this.detail.tex);
      this.detail = null;
      return;
    }
    if (this.detail?.version === d.version) return;
    const e = this.upload(d.canvas, true, this.detail ?? undefined);
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    this.detail = { ...e, rect: [d.west, d.north, d.east, d.south], version: d.version };
  }

  draw(view: { lon: number; lat: number; k: number }, dim: number, list: GlLayer[]) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.016, 0.027, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.uSize, width, height);
    gl.uniform3f(this.u.uView, view.lon, view.lat, view.k);
    gl.uniform1i(this.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    if (this.base) {
      gl.bindTexture(gl.TEXTURE_2D, this.base.tex);
      gl.uniform1i(this.u.uMode, -1);
      gl.uniform4f(this.u.uArea, 0, 0, 1, 1);
      gl.uniform1f(this.u.uDim, dim);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (this.detail) {
      gl.bindTexture(gl.TEXTURE_2D, this.detail.tex);
      gl.uniform1i(this.u.uMode, -2);
      gl.uniform4f(this.u.uRect, ...this.detail.rect);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    const none = [-1, -1, -1, -1] as const;
    for (const l of list) {
      let e = this.textures.get(l.source);
      // Uploading a 2048 px video frame is expensive: only do it when the frame has changed.
      const t = l.isVideo ? (l.source as HTMLVideoElement).currentTime : 0;
      if (!e || (l.isVideo && (e.time !== t || (e.again ?? 0) > 0))) {
        const moved = !e || e.time !== t;
        e = this.upload(l.source, false, e);
        e.again = moved ? 12 : (e.again ?? 1) - 1;
        e.time = t;
        this.textures.set(l.source, e);
      } else gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.uniform1i(this.u.uMode, MODE_ID[l.mode]);
      gl.uniform4f(this.u.uArea, ...l.area);
      gl.uniform4f(this.u.uMask0, ...(l.masks[0] ?? none));
      gl.uniform4f(this.u.uMask1, ...(l.masks[1] ?? none));
      gl.uniform1f(this.u.uAlpha, l.alpha);
      gl.uniform1f(this.u.uBoost, l.boost);
      gl.uniform1f(this.u.uFloor, l.floor);
      gl.uniform1f(this.u.uGrow, l.grow ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // a clip swapped for its sharper version leaves its old video behind, emptied: free its texture
    for (const [src, e] of this.textures) {
      if (src instanceof HTMLVideoElement && !src.getAttribute('src')) {
        gl.deleteTexture(e.tex);
        this.textures.delete(src);
      }
    }
  }
}
