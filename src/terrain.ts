import * as THREE from "three";
import { fbm } from "./noise";
import { smoothstep } from "./math";

/** Mundo de 18 × 18 km. Planície agrícola no centro, serras na borda servem de limite natural e de horizonte. */
export const WORLD_HALF = 9000;
export const GRID_N = 256; // 70 m por célula: 66 mil vértices, leve até em celular
export const FARM_R0 = 4600;
export const FARM_R1 = 6000;
/** Raio de combate; além disso o jogador recebe aviso e depois é abatido. */
export const ARENA_RADIUS = 7000;

export function rawHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = (fbm(x / 1500, z / 1500, 3, 11) - 0.5) * 36;
  const m = smoothstep(FARM_R0 - 200, WORLD_HALF * 0.95, r);
  if (m > 0) {
    // Ruído "ridged" (1 - |2n - 1|) gera cristas afiadas em vez de colinas arredondadas.
    const ridged = 1 - Math.abs(fbm(x / 1700, z / 1700, 4, 23) * 2 - 1);
    const massif = 0.45 + fbm(x / 3200, z / 3200, 2, 5);
    h += m * m * (120 + ridged * ridged * 1100 * massif) + m * 80;
  }
  return h;
}

/**
 * Grade de alturas compartilhada entre malha e física. A colisão interpola exatamente os mesmos triângulos
 * que a GPU desenha, então o avião nunca "bate no ar" nem afunda visualmente no morro.
 */
export class Terrain {
  readonly n: number;
  readonly half: number;
  readonly step: number;
  readonly heights: Float32Array;

  constructor(n = GRID_N, half = WORLD_HALF, fn: (x: number, z: number) => number = rawHeight) {
    this.n = n;
    this.half = half;
    this.step = (2 * half) / n;
    this.heights = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        this.heights[j * (n + 1) + i] = fn(-half + i * this.step, -half + j * this.step);
      }
    }
  }

  private h(i: number, j: number): number {
    return this.heights[j * (this.n + 1) + i] ?? 0;
  }

  /** O(1). Triangulação idêntica à de `createTerrainMesh`: diagonal de (i+1, j) a (i, j+1). */
  heightAt(x: number, z: number): number {
    const n = this.n;
    const fx = Math.min(Math.max((x + this.half) / this.step, 0), n - 1e-6);
    const fz = Math.min(Math.max((z + this.half) / this.step, 0), n - 1e-6);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const ha = this.h(i, j);
    const hb = this.h(i + 1, j);
    const hc = this.h(i, j + 1);
    if (u + v <= 1) return ha + u * (hb - ha) + v * (hc - ha);
    const hd = this.h(i + 1, j + 1);
    return hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
  }
}

const TERRAIN_VERT_HEAD = /* glsl */ `
varying vec3 vWPos;
varying float vNy;`;

const TERRAIN_FRAG_HEAD = /* glsl */ `
uniform sampler2D uFields;
uniform float uFieldHalf;
uniform vec2 uFarm;
varying vec3 vWPos;
varying float vNy;

vec3 terrainColor() {
  vec2 fuv = (vWPos.xz + uFieldHalf) / (2.0 * uFieldHalf);
  vec4 f = texture2D(uFields, fuv);
  float r = length(vWPos.xz);
  float farm = 1.0 - smoothstep(uFarm.x, uFarm.y, r);

  // Fileiras de plantio procedurais: o alfa da textura guarda a orientação (0,5..1 → 0..π/2).
  // fwidth desliga o padrão quando a fileira fica menor que um pixel (evita moiré à distância).
  float hasRows = step(0.4, f.a);
  float ang = (f.a - 0.5) * 3.14159265;
  float phase = dot(vWPos.xz, vec2(cos(ang), sin(ang))) * 1.25;
  float k = hasRows * (1.0 - smoothstep(0.8, 2.5, fwidth(phase)));
  vec3 farmCol = f.rgb * (1.0 + 0.24 * k * sin(phase));

  float slope = 1.0 - vNy;
  float var = 0.5 + 0.5 * sin(vWPos.x * 0.0021 + sin(vWPos.z * 0.0017) * 2.0) * sin(vWPos.z * 0.0026);
  vec3 grass = mix(vec3(0.075, 0.13, 0.035), vec3(0.11, 0.17, 0.05), var);
  vec3 rock = vec3(0.16, 0.15, 0.13);
  vec3 snow = vec3(0.8, 0.83, 0.88);
  vec3 wild = mix(grass, rock, smoothstep(0.22, 0.42, slope));
  wild = mix(wild, rock * 1.2, smoothstep(380.0, 620.0, vWPos.y) * 0.7);
  wild = mix(wild, snow, smoothstep(720.0, 900.0, vWPos.y + var * 80.0) * (1.0 - smoothstep(0.35, 0.6, slope)));
  return mix(wild, farmCol, farm);
}`;

export function createTerrainMesh(t: Terrain, fields: THREE.Texture, fieldHalf: number): THREE.Mesh {
  const n = t.n;
  const row = n + 1;
  const pos = new Float32Array(row * row * 3);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = (j * row + i) * 3;
      pos[k] = -t.half + i * t.step;
      pos[k + 1] = t.heights[j * row + i] ?? 0;
      pos[k + 2] = -t.half + j * t.step;
    }
  }
  const index = new Uint32Array(n * n * 6);
  let p = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      index[p++] = a;
      index[p++] = c;
      index[p++] = b;
      index[p++] = b;
      index[p++] = c;
      index[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // Lambert + injeção de shader: herda luz e neblina do three sem reescrever um material inteiro.
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFields = { value: fields };
    shader.uniforms.uFieldHalf = { value: fieldHalf };
    shader.uniforms.uFarm = { value: new THREE.Vector2(FARM_R0, FARM_R1) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_VERT_HEAD}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = position;\nvNy = normal.y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_FRAG_HEAD}`)
      .replace("#include <map_fragment>", "diffuseColor.rgb *= terrainColor();");
  };
  mat.customProgramCacheKey = () => "terrain-v1";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  return mesh;
}
