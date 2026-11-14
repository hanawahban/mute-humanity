// WebGL map renderer. Every EIC visualization is a flat world map, so one fragment shader
// can place any of them: it turns each screen pixel into a longitude/latitude and reads that
// spot from each layer. Each layer's background (black space, grey land, the base map under
// rain, light green "clean air") is made transparent in the shader, so all six layers can be
// stacked on one map while the data stays visible.

export type KeyMode = 'bright' | 'saturated' | 'precip' | 'darkgreen' | 'warm' | 'opaque';
const MODE_ID: Record<KeyMode, number> = { bright: 0, saturated: 1, precip: 2, darkgreen: 3, warm: 4, opaque: 5 };

export interface GlLayer {
  source: TexImageSource;
  isVideo: boolean;
  mode: KeyMode;
  area: [number, number, number, number];
  masks: Array<[number, number, number, number]>; // logos and date stamps inside the frame
  alpha: number;
  boost: number; // brightness boost for faint layers
  floor: number; // for 'bright': how bright a pixel must be to count as data
}

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uSize;      // canvas size in device pixels
uniform vec3 uView;      // centre lon, centre lat, device pixels per degree
uniform sampler2D uTex;
uniform int uMode;       // -1 = base map
uniform vec4 uArea;
uniform vec4 uMask0;
uniform vec4 uMask1;
uniform float uAlpha;
uniform float uBoost;
uniform float uDim;
uniform float uFloor;
out vec4 outColor;

bool inRect(vec2 t, vec4 r) { return t.x >= r.x && t.x <= r.z && t.y >= r.y && t.y <= r.w; }

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  float lon = uView.x + (frag.x - uSize.x * 0.5) / uView.z;
  float lat = uView.y - (frag.y - uSize.y * 0.5) / uView.z;
  if (lat > 90.0 || lat < -90.0) { outColor = uMode < 0 ? vec4(0.016, 0.027, 0.05, 1.0) : vec4(0.0); return; }
  vec2 uv = vec2(fract((lon + 180.0) / 360.0), (90.0 - lat) / 180.0);
  vec2 t = vec2(mix(uArea.x, uArea.z, uv.x), mix(uArea.y, uArea.w, uv.y));
  vec3 c = texture(uTex, t).rgb;
  if (uMode < 0) { outColor = vec4(c * uDim, 1.0); return; }
  if (inRect(t, uMask0) || inRect(t, uMask1)) { outColor = vec4(0.0); return; }

  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float a = 1.0;
  if (uMode == 0) a = smoothstep(uFloor, uFloor + 0.3, mx);                       // light on a dark map
  else if (uMode == 1) a = smoothstep(0.18, 0.42, sat) * smoothstep(0.06, 0.22, mx); // colour on grey/black
  else if (uMode == 2) {                                                           // rain + clouds over a base map
    float rain = smoothstep(0.45, 0.65, sat) * smoothstep(0.4, 0.6, mx) * (1.0 - step(0.0, c.r - c.b) * step(0.0, c.g - c.b) * step(c.g, c.r * 1.15) * step(sat, 0.75));
    float cloud = (1.0 - smoothstep(0.1, 0.25, sat)) * smoothstep(0.55, 0.9, mx) * 0.75;
    a = max(rain, cloud);
  } else if (uMode == 3) {                                                         // NOx: white (clean) to dark green (polluted)
    float green = c.g - max(c.r, c.b);
    a = smoothstep(0.35, 0.8, 1.0 - mx) * step(0.05, green); // only the darker greens: real pollution
  } else if (uMode == 4) a = smoothstep(0.2, 0.5, c.r - c.b);                    // warm colours over a base map
  c = min(vec3(1.0), c * uBoost);
  a *= uAlpha;
  outColor = vec4(c * a, a);
}`;

interface TexEntry {
  tex: WebGLTexture;
  w: number;
  h: number;
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
    for (const n of ['uSize', 'uView', 'uTex', 'uMode', 'uArea', 'uMask0', 'uMask1', 'uAlpha', 'uBoost', 'uDim', 'uFloor']) this.u[n] = gl.getUniformLocation(prog, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private upload(src: TexImageSource, mipmap: boolean, entry?: TexEntry): TexEntry {
    const gl = this.gl;
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
    const none = [-1, -1, -1, -1] as const;
    for (const l of list) {
      let e = this.textures.get(l.source);
      if (!e || l.isVideo) {
        e = this.upload(l.source, false, e);
        this.textures.set(l.source, e);
      } else gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.uniform1i(this.u.uMode, MODE_ID[l.mode]);
      gl.uniform4f(this.u.uArea, ...l.area);
      gl.uniform4f(this.u.uMask0, ...(l.masks[0] ?? none));
      gl.uniform4f(this.u.uMask1, ...(l.masks[1] ?? none));
      gl.uniform1f(this.u.uAlpha, l.alpha);
      gl.uniform1f(this.u.uBoost, l.boost);
      gl.uniform1f(this.u.uFloor, l.floor);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
}
