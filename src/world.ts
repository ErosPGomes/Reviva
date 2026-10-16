import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BASES, BASE_HALF, FIELD_HALF, FIELD_TEX, generateFieldTexture, generateLayout, type FarmLayout } from "./fields";
import { hash2, valueNoise } from "./noise";
import { BillboardBatch } from "./particles";
import { cloudTexture } from "./textures";
import { FARM_R0, FARM_R1, Terrain, createTerrainMesh } from "./terrain";

export type Quality = "high" | "low";

export interface World {
  readonly terrain: Terrain;
  readonly layout: FarmLayout;
  readonly fog: THREE.Fog;
  readonly sunDir: THREE.Vector3;
  /** Céu e nuvens: escondidos na visão térmica (frios no infravermelho). */
  readonly coldObjects: readonly THREE.Object3D[];
  update(camera: THREE.Camera): void;
}

export const HORIZON = new THREE.Color(0xc9d7e4);
const ZENITH = new THREE.Color(0x3b67a8);
export const SUN_DIR = new THREE.Vector3(0.42, 0.78, 0.46).normalize();

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // fixa no plano distante: o céu nunca corta a geometria
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
  float s = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.12);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function createSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uHorizon: { value: HORIZON }, uZenith: { value: ZENITH }, uSun: { value: SUN_DIR } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

function coloredGeometry(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = ng.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  ng.deleteAttribute("uv");
  return ng;
}

/** Árvores instanciadas (tronco + copa numa geometria só com cor por vértice): 1 draw call por espécie. */
function buildTrees(scene: THREE.Scene, terrain: Terrain, layout: FarmLayout, quality: Quality): void {
  const broadleaf = mergeGeometries([
    coloredGeometry(new THREE.CylinderGeometry(0.3, 0.4, 2.6, 5).translate(0, 1.3, 0), 0x4a3524),
    coloredGeometry(new THREE.IcosahedronGeometry(3, 0).scale(1, 1.15, 1).translate(0, 5.4, 0), 0x3f6a26),
  ])!;
  const conifer = mergeGeometries([
    coloredGeometry(new THREE.CylinderGeometry(0.3, 0.4, 2, 5).translate(0, 1, 0), 0x4a3524),
    coloredGeometry(new THREE.ConeGeometry(2.6, 9, 6).translate(0, 6.5, 0), 0x2b4a22),
  ])!;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  const density = quality === "high" ? 1 : 0.5;
  const leafPts: number[] = [];
  const conPts: number[] = [];

  // Cercas vivas ao longo das divisas dos talhões, com falhas irregulares.
  for (const s of layout.treeLines) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const count = Math.floor((len / 11) * density);
    for (let k = 0; k < count; k++) {
      const h = hash2(Math.floor(s.x0 + k * 3), Math.floor(s.z0 - k * 5), 61);
      if (valueNoise((s.x0 + s.z0) / 50 + k / 6, 3.3, 5) < 0.38) continue;
      const t = (k + 0.5 + (h - 0.5) * 0.6) / count;
      leafPts.push(s.x0 + (s.x1 - s.x0) * t + (h - 0.5) * 3, s.z0 + (s.z1 - s.z0) * t + (hash2(k, 7, 63) - 0.5) * 3);
    }
  }
  // Mata na transição planície → serra, agrupada por ruído de baixa frequência.
  const target = Math.floor(4200 * density);
  for (let k = 0, tries = 0; k < target && tries < target * 12; tries++) {
    const a = hash2(tries, 1, 71) * Math.PI * 2;
    const r = FARM_R0 - 300 + hash2(tries, 2, 73) * (FARM_R1 + 1800 - FARM_R0);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (valueNoise(x / 650, z / 650, 77) < 0.5) continue;
    const h = terrain.heightAt(x, z);
    if (h > 650) continue;
    const slope = Math.abs(terrain.heightAt(x + 20, z) - h) + Math.abs(terrain.heightAt(x, z + 20) - h);
    if (slope > 22) continue;
    (h > 260 || hash2(tries, 3, 79) < 0.3 ? conPts : leafPts).push(x, z);
    k++;
  }

  const place = (geo: THREE.BufferGeometry, pts: number[], seed: number) => {
    const count = pts.length / 2;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const x = pts[i * 2]!;
      const z = pts[i * 2 + 1]!;
      const h = hash2(i, seed, 83);
      const sc = 0.75 + h * 0.7;
      q.setFromAxisAngle(up, h * 6.28);
      p.set(x, terrain.heightAt(x, z) - 0.3, z);
      s.set(sc, sc * (0.9 + hash2(i, seed, 85) * 0.3), sc);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      const v = 0.78 + hash2(i, seed, 87) * 0.4;
      mesh.setColorAt(i, c.setRGB(v * (0.95 + h * 0.1), v, v * 0.9));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  };
  place(broadleaf, leafPts, 1);
  place(conifer, conPts, 2);
}

/** Sede de fazenda: casa, celeiro, galpão e silos (como os do vídeo). Tudo instanciado. */
function buildFarms(scene: THREE.Scene, terrain: Terrain, layout: FarmLayout): void {
  const prism = new THREE.ExtrudeGeometry(
    new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]),
    { depth: 1, bevelEnabled: false },
  ).translate(0, 0, -0.5);
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const silo = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
  const dome = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial();

  type Part = { x: number; z: number; y: number; w: number; h: number; d: number; color: number; rot: number };
  type Local = Omit<Part, "rot"> & { list: Part[] };
  const boxes: Part[] = [];
  const roofs: Part[] = [];
  const silos: Part[] = [];
  const domes: Part[] = [];

  for (const f of layout.farmsteads) {
    const h = (k: number) => hash2(f.seed, k, 91);
    const ground = terrain.heightAt(f.x, f.z) - 0.6;
    const barnColor = h(1) < 0.55 ? 0x8a3a2c : 0x9aa1a3;
    const local: Local[] = [
      { list: boxes, x: -18, z: -14, y: 0, w: 12, h: 6.5, d: 9, color: 0xe7e1d2 },
      { list: roofs, x: -18, z: -14, y: 6.5, w: 13, h: 3.6, d: 9.8, color: 0x5d3a30 },
      { list: boxes, x: 8, z: -12, y: 0, w: 22, h: 9, d: 14, color: barnColor },
      { list: roofs, x: 8, z: -12, y: 9, w: 23, h: 5, d: 14.6, color: 0x55595b },
      { list: boxes, x: -8, z: 16, y: 0, w: 18, h: 5.5, d: 9, color: 0xa9adab },
    ];
    const nSilos = 1 + Math.floor(h(2) * 3);
    for (let k = 0; k < nSilos; k++) {
      const sh = 16 + h(3 + k) * 8;
      const sx = 22 + k * 9.5;
      local.push({ list: silos, x: sx, z: 14, y: 0, w: 4, h: sh, d: 4, color: k % 2 ? 0xb9c2c7 : 0x7f99ad });
      local.push({ list: domes, x: sx, z: 14, y: sh, w: 4, h: 2.4, d: 4, color: 0xc9cfd2 });
    }
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    for (const { list, ...p } of local) {
      // Rotação em Y do three: x' = x·cos + z·sin, z' = −x·sin + z·cos.
      list.push({ ...p, x: f.x + p.x * c + p.z * s, z: f.z - p.x * s + p.z * c, y: ground + p.y, rot: f.rot });
    }
  }

  const make = (geo: THREE.BufferGeometry, parts: Part[]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, parts.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const c = new THREE.Color();
    parts.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      mesh.setMatrixAt(i, m.compose(pos.set(p.x, p.y, p.z), q, scl.set(p.w, p.h, p.d)));
      mesh.setColorAt(i, c.setHex(p.color));
    });
    mesh.computeBoundingSphere();
    scene.add(mesh);
  };
  make(box, boxes);
  make(prism, roofs);
  make(silo, silos);
  make(dome, domes);
}

/** Hangares e torre de cada base inimiga (estáticos; os alvos destrutíveis ficam em ground.ts). */
function buildBaseStructures(scene: THREE.Scene, terrain: Terrain): void {
  const hangarGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
  const hangarMat = new THREE.MeshLambertMaterial({ color: 0x6d7468 });
  const towerMat = new THREE.MeshLambertMaterial({ color: 0xb7b4a8 });
  const cabMat = new THREE.MeshPhongMaterial({ color: 0x2b3a44, shininess: 80 });
  for (const b of BASES) {
    const y = terrain.heightAt(b.x, b.z);
    for (const [dx, dz] of [[-95, -85], [-95, -20]] as const) {
      const h = new THREE.Mesh(hangarGeo, hangarMat);
      h.scale.set(16, 13, 40);
      h.rotation.y = Math.PI / 2;
      h.position.set(b.x + dx, y - 0.5, b.z + dz);
      scene.add(h);
    }
    const tower = new THREE.Mesh(new THREE.BoxGeometry(5, 15, 5).translate(0, 7.5, 0), towerMat);
    tower.position.set(b.x + BASE_HALF - 25, y - 0.5, b.z - BASE_HALF + 25);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 8).translate(0, 16.7, 0), cabMat);
    cab.position.copy(tower.position);
    scene.add(tower, cab);
  }
}

function buildClouds(scene: THREE.Scene, fog: THREE.Fog): THREE.Object3D {
  const puffs = 34 * 8;
  // Nuvens usam neblina mais longa: no horizonte ainda aparecem, como no vídeo.
  const batch = new BillboardBatch(puffs, cloudTexture(), false, new THREE.Fog(fog.color, fog.near * 3, fog.far * 1.4));
  batch.begin();
  for (let k = 0; k < 34; k++) {
    const a = hash2(k, 1, 101) * Math.PI * 2;
    const r = 1500 + hash2(k, 2, 103) * 9000;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cy = 1300 + hash2(k, 3, 107) * 1100;
    const size = 0.6 + hash2(k, 4, 109) * 0.9;
    for (let p = 0; p < 8; p++) {
      const ox = (hash2(k, p, 113) - 0.5) * 700 * size;
      const oz = (hash2(k, p, 127) - 0.5) * 380 * size;
      const oy = (hash2(k, p, 131) - 0.5) * 90 * size;
      const shade = 0.82 + (oy / (90 * size) + 0.5) * 0.18;
      batch.push(cx + ox, cy + oy, cz + oz, (260 + hash2(k, p, 137) * 260) * size, hash2(k, p, 139) * 6.28, shade, shade, shade * 1.02, 0.8);
    }
  }
  batch.end();
  batch.mesh.renderOrder = 1;
  scene.add(batch.mesh);
  return batch.mesh;
}

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: Quality): World {
  const terrain = new Terrain();
  const layout = generateLayout();

  const tex = new THREE.DataTexture(generateFieldTexture(layout), FIELD_TEX, FIELD_TEX, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // Anisotropia é o que mantém as lavouras nítidas em ângulo rasante (voo baixo).
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;

  const fog = new THREE.Fog(HORIZON, 1400, 15000);
  scene.fog = fog;
  scene.background = HORIZON;

  scene.add(new THREE.HemisphereLight(0xc4d6ec, 0x7a8456, 1.2));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);

  const sky = createSky();
  scene.add(sky);
  scene.add(createTerrainMesh(terrain, tex, FIELD_HALF));
  buildTrees(scene, terrain, layout, quality);
  buildFarms(scene, terrain, layout);
  buildBaseStructures(scene, terrain);
  const clouds = buildClouds(scene, fog);

  return {
    terrain,
    layout,
    fog,
    sunDir: SUN_DIR,
    coldObjects: [sky, clouds],
    update(camera) {
      sky.position.copy(camera.position);
    },
  };
}
