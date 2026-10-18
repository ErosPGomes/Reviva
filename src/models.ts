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


function missileGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.14, 0.14, 3, 8).rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(0.14, 0.5, 8).rotateX(-Math.PI / 2).translate(0, 0, -1.75);
  const finH = new THREE.BoxGeometry(0.7, 0.04, 0.4).translate(0, 0, 1.3);
  const finV = new THREE.BoxGeometry(0.04, 0.7, 0.4).translate(0, 0, 1.3);
  return mergeGeometries([body, nose, finH, finV])!;
}

/** Silhueta de cada caça: forma de asa/empenagem, quilhas, motores e camuflagem. Todo o resto é compartilhado. */
export type JetVariant = "falcao" | "raptor" | "javali" | "relampago";

interface JetShape {
  readonly body: readonly [number, number, number]; // escala da fuselagem (largura, altura, comprimento)
  readonly wing: readonly [number, number][];
  readonly stab: readonly [number, number][];
  readonly fin: readonly [number, number][];
  readonly finX: number;
  readonly finCant: number;
  readonly finY: number;
  readonly pods: boolean; // motores em nacelas sobre a fuselagem traseira (avião de ataque ao solo)
  readonly pylonX: number;
  readonly camo: readonly [string, string, string, string];
}

const SHAPES: Record<JetVariant, JetShape> = {
  falcao: {
    body: [1.18, 0.82, 1],
    wing: [[1, -1.8], [6.8, 2.8], [6.8, 3.7], [1, 4.6]],
    stab: [[0.9, 5.6], [3.9, 7.6], [3.9, 8.4], [0.9, 8.6]],
    fin: [[4.6, 0], [7.7, 3.4], [8.6, 3.4], [8.5, 0]],
    finX: 0.95,
    finCant: 0.38,
    finY: 0.55,
    pods: false,
    pylonX: 3.6,
    camo: ["#8f969c", "#6f777e", "#aab0b5", "#565d63"],
  },
  // Furtivo: fuselagem achatada, asa em losango, quilhas curtas bem inclinadas, cinza escuro uniforme.
  raptor: {
    body: [1.38, 0.68, 1],
    wing: [[1, -3], [7.2, 2.6], [6.6, 4.2], [1, 4.8]],
    stab: [[1, 5.4], [4.4, 7.4], [4, 8.7], [1, 8.7]],
    fin: [[5, 0], [7.6, 2.6], [8.5, 2.6], [8.4, 0]],
    finX: 1.3,
    finCant: 0.55,
    finY: 0.4,
    pods: false,
    pylonX: 3.2,
    camo: ["#50565c", "#464b50", "#5a6066", "#3d4247"],
  },
  // Ataque ao solo (estilo A-10): asa reta e longa, motores em nacelas, quilhas nas pontas do estabilizador.
  javali: {
    body: [1.05, 1, 0.95],
    wing: [[1, 0], [9, 0.6], [9, 2.8], [1, 3.3]],
    stab: [[0.6, 7.1], [3.6, 7.3], [3.6, 8.7], [0.6, 8.7]],
    fin: [[6.9, -1.2], [7.5, 2.4], [8.7, 2.4], [8.8, -1.2]],
    finX: 3.6,
    finCant: 0,
    finY: 0.2,
    pods: true,
    pylonX: 4.6,
    camo: ["#6b6f4a", "#545838", "#83875e", "#3f4229"],
  },
  // Interceptador: delta grande, quilhas altas quase verticais, fuselagem longa, cinza-azulado claro.
  relampago: {
    body: [1.12, 0.85, 1.15],
    wing: [[1, -3.6], [6.4, 4.6], [6.4, 5.2], [1, 5.4]],
    stab: [[0.9, 7.6], [2.8, 8.6], [2.8, 9.2], [0.9, 9.3]],
    fin: [[4.4, 0], [7.6, 4.4], [8.6, 4.4], [8.8, 0]],
    finX: 1.05,
    finCant: 0.1,
    finY: 0.55,
    pods: false,
    pylonX: 3.4,
    camo: ["#a3b3bf", "#8c9ca8", "#b9c6cf", "#7b8a96"],
  },
};

function buildJetGeometry(shape: JetShape = SHAPES.falcao): JetGeometry {
  const profile: [number, number][] = [
    [0, -8.7], [0.9, -8.6], [1.05, -7.6], [1.2, -6], [1.3, -3], [1.3, 0],
    [1.2, 2.5], [1.02, 4.6], [0.8, 6.2], [0.52, 7.6], [0.22, 8.7], [0, 9.3],
  ];
  const fuselage = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 18)
    .rotateX(-Math.PI / 2)
    .scale(...shape.body);
  const canopy = new THREE.SphereGeometry(1, 16, 10).scale(0.62, 0.55, 2.2).translate(0, 0.75 * shape.body[1] / 0.82, -4.4);

  const wings = mergeGeometries([plate(shape.wing, 0.24), plate(mirrorX(shape.wing), 0.24)])!.translate(0, -0.25, 0);
  const stabs = mergeGeometries([plate(shape.stab, 0.16), plate(mirrorX(shape.stab), 0.16)])!;
  const fin = finPlate(shape.fin, 0.16);
  const side: THREE.BufferGeometry[] = shape.pods
    ? [
        new THREE.CylinderGeometry(0.8, 0.8, 3.6, 14).rotateX(Math.PI / 2).translate(1.7, 1.25, 5),
        new THREE.CylinderGeometry(0.8, 0.8, 3.6, 14).rotateX(Math.PI / 2).translate(-1.7, 1.25, 5),
        new THREE.BoxGeometry(0.5, 0.9, 2).translate(1.2, 0.8, 5),
        new THREE.BoxGeometry(0.5, 0.9, 2).translate(-1.2, 0.8, 5),
      ]
    : [
        new THREE.BoxGeometry(0.8, 1, 4.5).translate(1.45, -0.15, -1.2),
        new THREE.BoxGeometry(0.8, 1, 4.5).translate(-1.45, -0.15, -1.2),
      ];
  const intakes = mergeGeometries(side)!;
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
  tire: new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.9 }),
};
shared.dark.side = THREE.DoubleSide;

const geoCache = new Map<JetVariant, JetGeometry>();
const matCache = new Map<string, SchemeMaterials>();

function jetGeometry(variant: JetVariant): JetGeometry {
  let g = geoCache.get(variant);
  if (!g) geoCache.set(variant, (g = buildJetGeometry(SHAPES[variant])));
  return g;
}

function schemeMaterials(scheme: Scheme, variant: JetVariant): SchemeMaterials {
  const key = `${scheme}:${variant}`;
  const cached = matCache.get(key);
  if (cached) return cached;
  const [base, ...tones] = SHAPES[variant].camo;
  const camo =
    scheme === "blue"
      ? camoTexture(base, tones as [string, string, string], 3)
      : camoTexture("#7c7258", ["#5e5642", "#988c6c", "#433d2f"], 8);
  // UVs da Lathe vão de 0 a 1; as da Extrude estão em metros — repetições diferentes para o mesmo padrão.
  const bodyMap = camo.clone();
  bodyMap.repeat.set(3, 2);
  const wingMap = camo.clone();
  wingMap.repeat.set(0.12, 0.12);
  const metal = variant === "raptor" ? 0.3 : 0.12;
  const m: SchemeMaterials = {
    body: new THREE.MeshStandardMaterial({ map: bodyMap, roughness: 0.6, metalness: metal }),
    wing: new THREE.MeshStandardMaterial({ map: wingMap, roughness: 0.6, metalness: metal }),
    fin:
      scheme === "blue"
        ? new THREE.MeshStandardMaterial({ map: wingMap, roughness: 0.6, metalness: metal })
        : new THREE.MeshStandardMaterial({ color: 0x6a2a22, roughness: 0.6, metalness: 0.12 }),
  };
  matCache.set(key, m);
  return m;
}

export interface JetMesh {
  readonly group: THREE.Group;
  setThrottle(throttle: number, time: number): void;
  setPylons(left: boolean, right: boolean): void;
  /** 1 = trem de pouso baixado, 0 = recolhido (valores intermediários animam a recolha). */
  setGear(t: number): void;
  /** Troca o modelo pendurado nos dois cabides: o míssil selecionado aparece na asa. */
  setLoadout(look: MissileLook): void;
}

/** Altura do centro do jato acima do piso com o trem baixado (rodas tocando o chão). */
const GEAR_DROP = 2.17;
export const gearHeight = (variant: JetVariant): number => GEAR_DROP * (variant === "javali" ? 1.12 : 1);

let gearGeo: { strut: THREE.BufferGeometry; wheel: THREE.BufferGeometry } | null = null;

/** Trem triciclo (bequilha + 2 principais). Pivô no topo da perna: escala Y recolhe para dentro da fuselagem. */
function createGear(): THREE.Group {
  gearGeo ??= {
    strut: new THREE.CylinderGeometry(0.09, 0.09, 1.5, 6).translate(0, -1.1, 0),
    wheel: new THREE.CylinderGeometry(0.32, 0.32, 0.24, 12).rotateZ(Math.PI / 2).translate(0, -GEAR_DROP + 0.32, 0),
  };
  const gear = new THREE.Group();
  for (const [x, z] of [[0, -6], [1.6, 1.5], [-1.6, 1.5]] as const) {
    const leg = new THREE.Group();
    leg.position.set(x, 0, z);
    leg.add(new THREE.Mesh(gearGeo.strut, shared.dark), new THREE.Mesh(gearGeo.wheel, shared.tire));
    gear.add(leg);
  }
  gear.visible = false;
  return gear;
}

export function createJetMesh(scheme: Scheme, variant: JetVariant = "falcao"): JetMesh {
  const g = jetGeometry(variant);
  const shape = SHAPES[variant];
  const m = schemeMaterials(scheme, variant);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g.fuselage, m.body));
  group.add(new THREE.Mesh(g.wings, m.wing));
  group.add(new THREE.Mesh(g.stabs, m.wing));
  group.add(new THREE.Mesh(g.intakes, shape.pods ? shared.dark : m.body));
  group.add(new THREE.Mesh(g.canopy, shared.glass));
  group.add(new THREE.Mesh(g.nozzle, shared.dark));
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * shape.finX, shape.finY, 0);
    pivot.rotation.z = -side * shape.finCant;
    pivot.add(new THREE.Mesh(g.fin, m.fin));
    group.add(pivot);
  }
  const pylons = [1, -1].map((side) => {
    const ms = new THREE.Group();
    ms.position.set(side * shape.pylonX, -0.6, 1.6);
    ms.add(createMissileModel("ir"));
    group.add(ms);
    return ms;
  });
  let look: MissileLook = "ir";
  const gear = createGear();
  group.add(gear);

  const glow = new THREE.Mesh(g.glow, shared.glow);
  const flame = new THREE.Mesh(g.flame, shared.flame);
  const core = new THREE.Mesh(g.core, shared.core);
  flame.position.z = core.position.z = 9.9;
  group.add(glow, flame, core);
  group.scale.setScalar(variant === "javali" ? 1.12 : 1);

  return {
    group,
    setGear(t) {
      gear.visible = t > 0.02;
      for (const leg of gear.children) leg.scale.y = Math.max(0.02, t);
    },
    setLoadout(next) {
      if (next === look) return;
      look = next;
      for (const p of pylons) {
        p.clear();
        p.add(createMissileModel(next));
      }
    },
    setThrottle(t, time) {
      const flicker = 0.92 + Math.sin(time * 53) * 0.05 + Math.sin(time * 31) * 0.03;
      // Pós-combustão acima de 85%: chama longa; abaixo, só um brilho curto no bocal.
      const ab = shape.pods ? 0 : Math.max(0, (t - 0.85) / 0.15);
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

/** Míssil em voo: modelo do tipo + brilho do motor na cauda. */
export function createMissileMesh(look: MissileLook = "ir"): THREE.Group {
  const g = jetGeometry("falcao");
  const group = new THREE.Group();
  group.add(createMissileModel(look));
  const glow = new THREE.Mesh(g.glow, shared.glow);
  const s = look === "rocket" ? 0.2 : 0.35 * (MISSILE_DEFS[look].r / 0.13) ** 0.5;
  // A escala também multiplica o deslocamento embutido na geometria (z = 9,85).
  glow.scale.setScalar(s);
  glow.position.z = MISSILE_DEFS[look].len / 2 + 0.05 - 9.85 * s;
  group.add(glow);
  return group;
}

/* ---------- Mísseis por tipo ---------- */

/**
 * Cada míssil tem silhueta própria, para o jogador reconhecer o que carrega (no menu, na asa e em voo):
 * IR fino com canards e domo de vidro · Radar longo e branco · AGM grosso, asas de corda longa ·
 * Foguetes num casulo de tubos · Naval (do porta-aviões) grande, branco com faixa vermelha.
 */
export type MissileLook = "ir" | "radar" | "agm" | "rockets" | "rocket" | "naval";

interface MissileDef {
  readonly len: number;
  readonly r: number;
  readonly body: number;
  readonly nose: number;
  readonly band: number;
  readonly noseLen: number;
  readonly blunt: boolean; // domo arredondado (buscador óptico) em vez de ogiva
  readonly fins: readonly (readonly [number, number, number])[]; // [posição ao longo do corpo (0 = cauda, 1 = ponta), envergadura, corda]
  readonly bandAt: number;
  readonly pod?: boolean;
}

export const MISSILE_DEFS: Record<MissileLook, MissileDef> = {
  ir: { len: 3, r: 0.13, body: 0xc9ccce, nose: 0x1f2c38, band: 0xd9b23a, noseLen: 0.32, blunt: true, fins: [[0.82, 0.24, 0.22], [0.07, 0.36, 0.34]], bandAt: 0.72 },
  radar: { len: 3.65, r: 0.17, body: 0xeef0f1, nose: 0xa3a8ad, band: 0x8a5a2b, noseLen: 0.75, blunt: false, fins: [[0.5, 0.28, 0.5], [0.06, 0.32, 0.36]], bandAt: 0.3 },
  agm: { len: 2.5, r: 0.2, body: 0x6f7550, nose: 0x22323c, band: 0xe0b83a, noseLen: 0.22, blunt: true, fins: [[0.42, 0.42, 1.15], [0.05, 0.3, 0.3]], bandAt: 0.8 },
  rockets: { len: 2.3, r: 0.33, body: 0x5d6250, nose: 0x1b1d1e, band: 0x3e4236, noseLen: 0.12, blunt: false, fins: [], bandAt: 0.5, pod: true },
  rocket: { len: 1.5, r: 0.06, body: 0xbfc2b5, nose: 0x5a5e55, band: 0xd9b23a, noseLen: 0.22, blunt: false, fins: [[0.06, 0.12, 0.14]], bandAt: 0.7 },
  naval: { len: 3.9, r: 0.2, body: 0xf1f2f3, nose: 0xd0d4d8, band: 0xb3342b, noseLen: 0.7, blunt: false, fins: [[0.5, 0.14, 1.6], [0.05, 0.36, 0.4]], bandAt: 0.62 },
};

const missileCache = new Map<MissileLook, { geo: THREE.BufferGeometry; mats: THREE.Material[] }>();

function buildMissile(look: MissileLook): { geo: THREE.BufferGeometry; mats: THREE.Material[] } {
  const d = MISSILE_DEFS[look];
  const half = d.len / 2;
  const tip = half;
  const shoulder = half - d.noseLen;
  // Perfis em (raio, posição): +posição = ponta. rotateX(−π/2) leva a ponta para −Z (frente do three).
  const lathe = (pts: [number, number][], seg = 14) =>
    new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg).rotateX(-Math.PI / 2);
  const body = lathe(d.pod
    ? [[0, -half], [d.r * 0.7, -half], [d.r, -half + 0.25], [d.r, shoulder], [d.r * 0.98, shoulder + 0.001]]
    : [[0, -half], [d.r * 0.85, -half], [d.r, -half + 0.08], [d.r, shoulder]]);
  const nosePts: [number, number][] = [];
  if (d.pod) {
    nosePts.push([d.r * 0.98, shoulder], [d.r * 0.9, tip], [0, tip]);
  } else {
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      // Domo: quarto de círculo; ogiva: perfil tangente afinando até a ponta.
      const r = d.blunt ? d.r * Math.cos((t * Math.PI) / 2) : d.r * (1 - t * t);
      const y = d.blunt ? shoulder + d.noseLen * Math.sin((t * Math.PI) / 2) : shoulder + d.noseLen * t;
      nosePts.push([Math.max(r, 0.0001), y]);
    }
    nosePts.push([0, tip]);
  }
  const nose = lathe(nosePts);
  const accents: THREE.BufferGeometry[] = [];
  const band = new THREE.CylinderGeometry(d.r * 1.02, d.r * 1.02, Math.max(0.06, d.len * 0.03), 14)
    .rotateX(Math.PI / 2)
    .translate(0, 0, -(-half + d.bandAt * d.len));
  accents.push(band);
  if (d.pod) {
    // Boca dos tubos: 7 aros escuros na face frontal do casulo.
    for (let k = 0; k < 7; k++) {
      const a = (k / 6) * Math.PI * 2;
      const rr = k === 6 ? 0 : d.r * 0.55;
      accents.push(new THREE.TorusGeometry(0.07, 0.022, 5, 10).translate(Math.cos(a) * rr, Math.sin(a) * rr, -tip - 0.01));
    }
  }
  const fins: THREE.BufferGeometry[] = [];
  for (const [at, span, chord] of d.fins) {
    const z = -(-half + at * d.len);
    const reach = d.r + span;
    fins.push(new THREE.BoxGeometry(reach * 2, 0.03, chord).translate(0, 0, z));
    fins.push(new THREE.BoxGeometry(0.03, reach * 2, chord).translate(0, 0, z));
  }
  // Um grupo de material por parte: 0 corpo, 1 ponta (vidro/radome), 2 faixa e tubos, 3 aletas.
  const flat = (list: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(list.map((p) => (p.index ? p.toNonIndexed() : p)))!;
    g.deleteAttribute("uv");
    return g;
  };
  const all = [flat([body]), flat([nose]), flat(accents), ...(fins.length ? [flat(fins)] : [])];
  const geo = mergeGeometries(all, true)!;
  const mat = (c: number, rough = 0.5, metal = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
  const noseMat = d.blunt && !d.pod ? new THREE.MeshPhongMaterial({ color: d.nose, specular: 0xffffff, shininess: 90 }) : mat(d.nose, 0.6, 0.1);
  const mats = [mat(d.body), noseMat, mat(d.band, 0.6, 0.1), mat(d.body, 0.55, 0.25)];
  return { geo, mats: mats.slice(0, all.length) };
}

/** Modelo estático do míssil (sem brilho de motor), ponta para −Z, centro no meio do corpo. */
export function createMissileModel(look: MissileLook): THREE.Mesh {
  let m = missileCache.get(look);
  if (!m) missileCache.set(look, (m = buildMissile(look)));
  return new THREE.Mesh(m.geo, m.mats);
}

/* ---------- Metralhadoras (só para a prévia do menu) ---------- */

export type GunLook = "cal30" | "cal50" | "m61";

export interface GunModel {
  readonly group: THREE.Group;
  /** Gira (rotativa) ou recua (cano único) durante a rajada. */
  readonly barrels: THREE.Object3D;
  /** Posição da boca do cano no espaço local do grupo. */
  readonly muzzle: THREE.Vector3;
}

const gunMats = {
  steel: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.45, metalness: 0.75 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x222528, roughness: 0.6, metalness: 0.6 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc8a14a, roughness: 0.35, metalness: 0.9 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x4f5541, roughness: 0.7, metalness: 0.3 }),
};

const tube = (r: number, len: number, z: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2).translate(0, 0, z);

/** Cano para −Z. Medidas aproximadas das armas reais (M240, M2 Browning, M61 Vulcan). */
export function createGunModel(look: GunLook): GunModel {
  const group = new THREE.Group();
  const barrels = new THREE.Group();
  group.add(barrels);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = group) => parent.add(new THREE.Mesh(g, m));
  // Cinta de munição: cartuchos de latão pendurados à esquerda do receptor.
  const belt = (n: number, size: number, x: number, z0: number) => {
    const geo = tube(size * 0.3, size * 2.2, 0, 6).rotateY(Math.PI / 2);
    for (let k = 0; k < n; k++) {
      const c = new THREE.Mesh(geo, gunMats.brass);
      c.position.set(x - size * 1.2, -k * size * 0.75 - size, z0);
      group.add(c);
    }
  };
  if (look === "cal30") {
    mesh(new THREE.BoxGeometry(0.11, 0.16, 0.62).translate(0, 0, 0.1), gunMats.dark);
    mesh(new THREE.BoxGeometry(0.09, 0.05, 0.3).translate(0, 0.1, 0.05), gunMats.steel);
    mesh(tube(0.017, 0.62, -0.5), gunMats.steel, barrels);
    mesh(tube(0.026, 0.07, -0.84), gunMats.dark, barrels);
    mesh(tube(0.03, 0.18, -0.26), gunMats.dark, barrels);
    belt(7, 0.03, -0.06, 0.1);
    return { group, barrels, muzzle: new THREE.Vector3(0, 0, -0.9) };
  }
  if (look === "cal50") {
    mesh(new THREE.BoxGeometry(0.2, 0.24, 0.85).translate(0, 0, 0.25), gunMats.dark);
    mesh(new THREE.BoxGeometry(0.16, 0.06, 0.4).translate(0, 0.15, 0.2), gunMats.steel);
    for (const s of [-1, 1]) mesh(tube(0.018, 0.18, 0).rotateX(Math.PI / 2).translate(s * 0.09, -0.03, 0.75), gunMats.olive);
    mesh(tube(0.055, 0.42, -0.36, 12), gunMats.steel, barrels);
    for (let k = 0; k < 5; k++) mesh(tube(0.058, 0.025, -0.2 - k * 0.075, 12), gunMats.dark, barrels);
    mesh(tube(0.03, 1.15, -1.1), gunMats.steel, barrels);
    mesh(tube(0.04, 0.08, -1.7), gunMats.dark, barrels);
    belt(8, 0.05, -0.1, 0.25);
    return { group, barrels, muzzle: new THREE.Vector3(0, 0, -1.76) };
  }
  // M61 Vulcan: 6 canos em torno do eixo, carcaça com motor de acionamento e tambor de munição.
  mesh(tube(0.17, 0.5, 0.35, 16), gunMats.dark);
  mesh(new THREE.BoxGeometry(0.16, 0.14, 0.32).translate(0.18, 0.08, 0.45), gunMats.olive);
  mesh(tube(0.26, 0.5, 0.95, 18), gunMats.olive);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    mesh(tube(0.028, 1.5, -0.65).translate(Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0), gunMats.steel, barrels);
  }
  for (const z of [-0.3, -0.9, -1.33]) mesh(tube(0.135, 0.05, z, 16), gunMats.dark, barrels);
  return { group, barrels, muzzle: new THREE.Vector3(0, 0, -1.42) };
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
/** Guarda o material original de cada malha já na criação: trocas temporárias (visão térmica) não o sobrescrevem. */
export function primeMaterials(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) (o.userData as { original?: THREE.Material }).original = o.material as THREE.Material;
  });
}

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
