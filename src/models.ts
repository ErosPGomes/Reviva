import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { camoTexture, shadowTexture } from "./textures";

/**
 * Modelos procedurais (sem arquivos .glb): zero download extra e geometrias compartilhadas entre todas as
 * instâncias — cada jato novo custa só os nós da cena, não memória de GPU.
 */

export type Scheme = "blue" | "red";

function plate(points: readonly [number, number][], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  // Forma no plano XY → asa deitada: y da forma vira z (corda para trás), espessura vira y.
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return g;
}

function finPlate(points: readonly [number, number][], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  // x da forma vira z, y continua altura, espessura vira x.
  g.rotateY(-Math.PI / 2);
  g.translate(thickness / 2, 0, 0);
  return g;
}

const mirrorX = (pts: readonly [number, number][]): [number, number][] => pts.map(([x, y]) => [-x, y]);

interface JetGeometry {
  fuselage: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  wings: THREE.BufferGeometry;
  stabs: THREE.BufferGeometry;
  fin: THREE.BufferGeometry;
  intakes: THREE.BufferGeometry;
  nozzle: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
  core: THREE.BufferGeometry;
  missile: THREE.BufferGeometry;
}

let jetGeo: JetGeometry | null = null;

function missileGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.14, 0.14, 3, 8).rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(0.14, 0.5, 8).rotateX(-Math.PI / 2).translate(0, 0, -1.75);
  const finH = new THREE.BoxGeometry(0.7, 0.04, 0.4).translate(0, 0, 1.3);
  const finV = new THREE.BoxGeometry(0.04, 0.7, 0.4).translate(0, 0, 1.3);
  return mergeGeometries([body, nose, finH, finV])!;
}

function buildJetGeometry(): JetGeometry {
  const profile: [number, number][] = [
    [0, -8.7], [0.9, -8.6], [1.05, -7.6], [1.2, -6], [1.3, -3], [1.3, 0],
    [1.2, 2.5], [1.02, 4.6], [0.8, 6.2], [0.52, 7.6], [0.22, 8.7], [0, 9.3],
  ];
  const fuselage = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 18)
    .rotateX(-Math.PI / 2)
    .scale(1.18, 0.82, 1);
  const canopy = new THREE.SphereGeometry(1, 16, 10).scale(0.62, 0.55, 2.2).translate(0, 0.75, -4.4);

  const wingR: [number, number][] = [[1, -1.8], [6.8, 2.8], [6.8, 3.7], [1, 4.6]];
  const stabR: [number, number][] = [[0.9, 5.6], [3.9, 7.6], [3.9, 8.4], [0.9, 8.6]];
  const wings = mergeGeometries([plate(wingR, 0.24), plate(mirrorX(wingR), 0.24)])!.translate(0, -0.25, 0);
  const stabs = mergeGeometries([plate(stabR, 0.16), plate(mirrorX(stabR), 0.16)])!;
  const fin = finPlate([[4.6, 0], [7.7, 3.4], [8.6, 3.4], [8.5, 0]], 0.16);
  const intakes = mergeGeometries([
    new THREE.BoxGeometry(0.8, 1, 4.5).translate(1.45, -0.15, -1.2),
    new THREE.BoxGeometry(0.8, 1, 4.5).translate(-1.45, -0.15, -1.2),
  ])!;
  const nozzle = new THREE.CylinderGeometry(0.72, 0.86, 1.4, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, 9.2);
  const glow = new THREE.CircleGeometry(0.66, 16).translate(0, 0, 9.85);
  // Cones com base na origem e ponta em z = 1: escala em z = comprimento da chama.
  const flame = new THREE.ConeGeometry(0.62, 1, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const core = new THREE.ConeGeometry(0.34, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  return { fuselage, canopy, wings, stabs, fin, intakes, nozzle, glow, flame, core, missile: missileGeometry() };
}

interface SchemeMaterials {
  body: THREE.Material;
  wing: THREE.Material;
  fin: THREE.Material;
}

const shared = {
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7, metalness: 0.4 }),
  glass: new THREE.MeshPhongMaterial({ color: 0x1f2c38, specular: 0xffffff, shininess: 90 }),
  missile: new THREE.MeshStandardMaterial({ color: 0xd9dbdc, roughness: 0.5, metalness: 0.2 }),
  glow: new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff8c42, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  core: new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  charred: new THREE.MeshLambertMaterial({ color: 0x1d1b19 }),
};
shared.dark.side = THREE.DoubleSide;

const schemes = new Map<Scheme, SchemeMaterials>();

function schemeMaterials(scheme: Scheme): SchemeMaterials {
  const cached = schemes.get(scheme);
  if (cached) return cached;
  const camo =
    scheme === "blue"
      ? camoTexture("#8f969c", ["#6f777e", "#aab0b5", "#565d63"], 3)
      : camoTexture("#7c7258", ["#5e5642", "#988c6c", "#433d2f"], 8);
  // UVs da Lathe vão de 0 a 1; as da Extrude estão em metros — repetições diferentes para o mesmo padrão.
  const bodyMap = camo.clone();
  bodyMap.repeat.set(3, 2);
  const wingMap = camo.clone();
  wingMap.repeat.set(0.12, 0.12);
  const m: SchemeMaterials = {
    body: new THREE.MeshStandardMaterial({ map: bodyMap, roughness: 0.6, metalness: 0.12 }),
    wing: new THREE.MeshStandardMaterial({ map: wingMap, roughness: 0.6, metalness: 0.12 }),
    fin:
      scheme === "blue"
        ? new THREE.MeshStandardMaterial({ map: wingMap, roughness: 0.6, metalness: 0.12 })
        : new THREE.MeshStandardMaterial({ color: 0x6a2a22, roughness: 0.6, metalness: 0.12 }),
  };
  schemes.set(scheme, m);
  return m;
}

export interface JetMesh {
  readonly group: THREE.Group;
  setThrottle(throttle: number, time: number): void;
  setPylons(left: boolean, right: boolean): void;
}

export function createJetMesh(scheme: Scheme): JetMesh {
  jetGeo ??= buildJetGeometry();
  const g = jetGeo;
  const m = schemeMaterials(scheme);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g.fuselage, m.body));
  group.add(new THREE.Mesh(g.wings, m.wing));
  group.add(new THREE.Mesh(g.stabs, m.wing));
  group.add(new THREE.Mesh(g.intakes, m.body));
  group.add(new THREE.Mesh(g.canopy, shared.glass));
  group.add(new THREE.Mesh(g.nozzle, shared.dark));
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.95, 0.55, 0);
    pivot.rotation.z = -side * 0.38;
    pivot.add(new THREE.Mesh(g.fin, m.fin));
    group.add(pivot);
  }
  const pylons = [1, -1].map((side) => {
    const ms = new THREE.Mesh(g.missile, shared.missile);
    ms.position.set(side * 3.6, -0.6, 1.6);
    group.add(ms);
    return ms;
  });

  const glow = new THREE.Mesh(g.glow, shared.glow);
  const flame = new THREE.Mesh(g.flame, shared.flame);
  const core = new THREE.Mesh(g.core, shared.core);
  flame.position.z = core.position.z = 9.9;
  group.add(glow, flame, core);

  return {
    group,
    setThrottle(t, time) {
      const flicker = 0.92 + Math.sin(time * 53) * 0.05 + Math.sin(time * 31) * 0.03;
      // Pós-combustão acima de 85%: chama longa; abaixo, só um brilho curto no bocal.
      const ab = Math.max(0, (t - 0.85) / 0.15);
      const len = (0.6 + t * 1.6 + ab * 4.5) * flicker;
      flame.scale.set(1, 1, len);
      core.scale.set(1, 1, len * 0.6);
      flame.visible = core.visible = t > 0.05;
      glow.scale.setScalar(0.85 + t * 0.2);
    },
    setPylons(left, right) {
      pylons[0]!.visible = right;
      pylons[1]!.visible = left;
    },
  };
}

export function createMissileMesh(): THREE.Group {
  jetGeo ??= buildJetGeometry();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(jetGeo.missile, shared.missile));
  const glow = new THREE.Mesh(jetGeo.glow, shared.glow);
  // A escala também multiplica o deslocamento embutido na geometria (z = 9,85).
  glow.scale.setScalar(0.35);
  glow.position.z = 1.55 - 9.85 * 0.35;
  group.add(glow);
  return group;
}

let shadowRes: { geo: THREE.BufferGeometry; tex: THREE.Texture } | null = null;

export function createShadowMesh(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  shadowRes ??= { geo: new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), tex: shadowTexture() };
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: shadowRes.tex,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(shadowRes.geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

/* ---------- Alvos terrestres ---------- */

const groundMats = {
  olive: new THREE.MeshLambertMaterial({ color: 0x575c38 }),
  sand: new THREE.MeshLambertMaterial({ color: 0x8c7d57 }),
  track: new THREE.MeshLambertMaterial({ color: 0x2c2a26 }),
  steel: new THREE.MeshLambertMaterial({ color: 0x4f5550 }),
  bags: new THREE.MeshLambertMaterial({ color: 0x9a8a62, flatShading: true }),
  tank: new THREE.MeshLambertMaterial({ color: 0xc9ccc6 }),
  band: new THREE.MeshLambertMaterial({ color: 0x9a3a2c }),
};

export interface GroundModel {
  readonly group: THREE.Group;
  readonly turret: THREE.Object3D | null;
  readonly barrels: THREE.Object3D | null;
}

export function createTankModel(): GroundModel {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.4, 7).translate(0, 0.9, 0), groundMats.olive);
  const treadL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 7.4).translate(-1.9, 0.55, 0), groundMats.track);
  const treadR = treadL.clone();
  treadR.position.x = 3.8;
  const turret = new THREE.Group();
  turret.position.y = 1.6;
  turret.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 2.8).translate(0, 0.45, 0.3), groundMats.olive));
  const barrels = new THREE.Group();
  barrels.position.set(0, 0.5, -1);
  barrels.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 4.5, 6).rotateX(Math.PI / 2).translate(0, 0, -2.25), groundMats.steel));
  turret.add(barrels);
  group.add(hull, treadL, treadR, turret);
  return { group, turret, barrels };
}

export function createAAModel(): GroundModel {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.TorusGeometry(4, 0.7, 5, 14).rotateX(Math.PI / 2).translate(0, 0.4, 0), groundMats.bags));
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 1.2, 10).translate(0, 0.6, 0), groundMats.steel));
  const turret = new THREE.Group();
  turret.position.y = 1.2;
  turret.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.2).translate(0, 0.7, 0), groundMats.sand));
  const barrels = new THREE.Group();
  barrels.position.set(0, 1.0, 0);
  for (const s of [-0.45, 0.45]) {
    barrels.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4, 6).rotateX(Math.PI / 2).translate(s, 0, -2.2), groundMats.steel));
  }
  turret.add(barrels);
  group.add(turret);
  return { group, turret, barrels };
}

export function createFuelModel(): GroundModel {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 8, 18).translate(0, 4, 0), groundMats.tank));
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(6.05, 6.05, 1, 18).translate(0, 6.2, 0), groundMats.band));
  return { group, turret: null, barrels: null };
}

/** Troca todos os materiais por "carbonizado" e guarda os originais para restaurar quando a base é reocupada. */
export function setCharred(group: THREE.Object3D, charred: boolean): void {
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const ud = o.userData as { original?: THREE.Material };
    if (charred) {
      ud.original ??= o.material as THREE.Material;
      o.material = shared.charred;
    } else if (ud.original) {
      o.material = ud.original;
    }
  });
}
