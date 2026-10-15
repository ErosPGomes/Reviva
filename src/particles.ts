import * as THREE from "three";
import { lerp } from "./math";

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSizeRot;
attribute vec4 iColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  vUv = uv;
  vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y);
  float s = sin(iSizeRot.y);
  mv.xy += mat2(c, s, -s, c) * position.xy * iSizeRot.x;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vColor.a;
  #ifdef ADDITIVE
    gl_FragColor = vec4(vColor.rgb * t.rgb, a * (1.0 - vFog));
  #else
    gl_FragColor = vec4(mix(vColor.rgb * t.rgb, uFogColor, vFog), a);
  #endif
  #include <colorspace_fragment>
}`;

/**
 * Billboards instanciados: milhares de partículas em 1 draw call. Quads expandidos no espaço da câmera
 * (não gl_POINTS), então não há o limite de tamanho de ponto da GPU — explosões próximas não "encolhem".
 */
export class BillboardBatch {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly pos: Float32Array;
  private readonly sizeRot: Float32Array;
  private readonly color: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private count = 0;

  constructor(readonly capacity: number, map: THREE.Texture, additive: boolean, fog: THREE.Fog) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    this.pos = new Float32Array(capacity * 3);
    this.sizeRot = new Float32Array(capacity * 2);
    this.color = new Float32Array(capacity * 4);
    const aPos = new THREE.InstancedBufferAttribute(this.pos, 3);
    const aSR = new THREE.InstancedBufferAttribute(this.sizeRot, 2);
    const aCol = new THREE.InstancedBufferAttribute(this.color, 4);
    this.attrs = [aPos, aSR, aCol];
    for (const a of this.attrs) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPos", aPos);
    geo.setAttribute("iSizeRot", aSR);
    geo.setAttribute("iColor", aCol);
    geo.instanceCount = 0;
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        uFogColor: { value: fog.color },
        uFogNear: { value: fog.near },
        uFogFar: { value: fog.far },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: "" } : {},
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, z: number, size: number, rot: number, r: number, g: number, b: number, a: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.sizeRot[i * 2] = size;
    this.sizeRot[i * 2 + 1] = rot;
    this.color[i * 4] = r;
    this.color[i * 4 + 1] = g;
    this.color[i * 4 + 2] = b;
    this.color[i * 4 + 3] = a;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    // Envia só a faixa usada no quadro, não o buffer inteiro.
    const sizes = [3, 2, 4];
    this.attrs.forEach((a, k) => {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * sizes[k]!);
      a.needsUpdate = true;
    });
  }
}

export interface ParticlePreset {
  readonly life: readonly [number, number];
  readonly size0: readonly [number, number];
  readonly size1: readonly [number, number];
  readonly c0: number;
  readonly c1: number;
  readonly alpha: number;
  readonly drag: number;
  readonly buoy: number; // aceleração vertical (+ sobe, - cai)
  readonly fadeIn: number;
  readonly spin: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  s0: number;
  s1: number;
  c0: THREE.Color;
  c1: THREE.Color;
  alpha: number;
  drag: number;
  buoy: number;
  fadeIn: number;
  rot: number;
  spin: number;
}

const between = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);
const colorCache = new Map<number, THREE.Color>();
const col = (hex: number): THREE.Color => {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)));
  return c;
};

/** Pool pré-alocado com remoção por troca (swap-remove): emit/kill O(1), zero alocação por quadro. */
export class ParticleSystem {
  private readonly pool: Particle[] = [];
  private live = 0;

  constructor(readonly batch: BillboardBatch) {
    for (let i = 0; i < batch.capacity; i++) {
      this.pool.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 1,
        c0: col(0xffffff), c1: col(0xffffff), alpha: 1, drag: 0, buoy: 0, fadeIn: 0, rot: 0, spin: 0,
      });
    }
  }

  get count(): number {
    return this.live;
  }

  emit(p: ParticlePreset, x: number, y: number, z: number, vx: number, vy: number, vz: number, scale = 1): void {
    if (this.live >= this.pool.length) return;
    const q = this.pool[this.live++]!;
    q.x = x;
    q.y = y;
    q.z = z;
    q.vx = vx;
    q.vy = vy;
    q.vz = vz;
    q.age = 0;
    q.life = between(p.life);
    q.s0 = between(p.size0) * scale;
    q.s1 = between(p.size1) * scale;
    q.c0 = col(p.c0);
    q.c1 = col(p.c1);
    q.alpha = p.alpha;
    q.drag = p.drag;
    q.buoy = p.buoy;
    q.fadeIn = p.fadeIn;
    q.rot = Math.random() * Math.PI * 2;
    q.spin = (Math.random() * 2 - 1) * p.spin;
  }

  clear(): void {
    this.live = 0;
  }

  update(dt: number): void {
    const b = this.batch;
    let i = 0;
    while (i < this.live) {
      const q = this.pool[i]!;
      q.age += dt;
      if (q.age >= q.life) {
        const last = this.pool[--this.live]!;
        this.pool[this.live] = q;
        this.pool[i] = last;
        continue;
      }
      const d = Math.exp(-q.drag * dt);
      q.vx *= d;
      q.vy = q.vy * d + q.buoy * dt;
      q.vz *= d;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.rot += q.spin * dt;
      const t = q.age / q.life;
      const grow = 1 - (1 - t) * (1 - t);
      const a = q.alpha * Math.min(1, q.age / Math.max(q.fadeIn, 1e-3)) * (1 - t);
      b.push(
        q.x, q.y, q.z, lerp(q.s0, q.s1, grow), q.rot,
        lerp(q.c0.r, q.c1.r, t), lerp(q.c0.g, q.c1.g, t), lerp(q.c0.b, q.c1.b, t), a,
      );
      i++;
    }
  }
}
