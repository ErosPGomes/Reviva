import * as THREE from "three";
import { createJetMesh, gearHeight, type JetVariant } from "./models";
import { LAKE, WATER_LEVEL } from "./terrain";
import { ctx2d } from "./textures";
import type { Combatant } from "./types";

/**
 * Porta-aviões (escala de um classe Nimitz: 336 × 88 m de convés) ancorado na baía ao sul. É o ponto de
 * partida de toda surtida — o caça sai pela catapulta 1 — e a plataforma da salva naval: 16 células de
 * lançamento vertical na popa disparam mísseis guiados por datalink contra os inimigos.
 * Proa para −Z (mesma proa inicial do jogador, rumo às bases). Coordenadas "locais" = relativas a CARRIER_POS.
 */
export const CARRIER_POS = new THREE.Vector3(LAKE.x, 0, LAKE.z + 200);
export const DECK_Y = WATER_LEVEL + 18;
/** Catapulta 1 (bombordo da proa): o centro do caça corre de z0 até z1. */
export const CATAPULT = { x: -9, z0: -40, z1: -166 } as const;
/** Aceleração da catapulta: 0 → ~84 m/s em 126 m (≈ 3 s), acima da velocidade de estol. */
export const CATAPULT_ACCEL = 28;

const DECK: readonly [number, number][] = [
  [-13, -168], [13, -168], [24, -150], [32, -110], [35, -30], [36, 110], [31, 158], [20, 168],
  [-18, 168], [-27, 152], [-30, 108], [-42, 50], [-44, 0], [-37, -40], [-25, -100], [-20, -140],
];
const HULL: readonly [number, number][] = [
  [0, -178], [12, -150], [19, -90], [20, 100], [17, 150], [10, 166], [-10, 166], [-17, 150], [-20, 100], [-19, -90], [-12, -150],
];
const TEX_HALF_X = 46;
const TEX_HALF_Z = 172;
/** Faixa de pouso em ângulo (9° para bombordo), da popa para a frente. */
const ANGLED = { x0: -6, z0: 168, angle: (9 * Math.PI) / 180 };

/** Laje extrudada a partir do contorno visto de cima: y da forma vira z local, espessura cresce para baixo. */
function slab(points: readonly [number, number][], depth: number, top: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, top, 0);
  return g;
}

/** Pintura do convés: catapultas, faixa em ângulo com cabos de parada, elevadores e numeral na proa. */
function deckTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 2048;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = ctx2d(cv);
  const px = (x: number) => ((x + TEX_HALF_X) / (2 * TEX_HALF_X)) * W;
  const py = (z: number) => ((TEX_HALF_Z - z) / (2 * TEX_HALF_Z)) * H;
  const m = W / (2 * TEX_HALF_X); // pixels por metro
  g.fillStyle = "#3a3e42";
  g.fillRect(0, 0, W, H);
  // Desgaste: manchas de pneu e óleo.
  for (let k = 0; k < 2600; k++) {
    const a = Math.random() * 0.08;
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.5})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 6, 1 + Math.random() * 18);
  }
  const line = (x0: number, z0: number, x1: number, z1: number, color: string, width: number, dash: number[] = []) => {
    g.strokeStyle = color;
    g.lineWidth = width * m;
    g.setLineDash(dash.map((d) => d * m));
    g.beginPath();
    g.moveTo(px(x0), py(z0));
    g.lineTo(px(x1), py(z1));
    g.stroke();
    g.setLineDash([]);
  };
  // Borda do convés.
  g.strokeStyle = "rgba(240,240,235,0.55)";
  g.lineWidth = 0.5 * m;
  g.beginPath();
  DECK.forEach(([x, z], i) => (i ? g.lineTo(px(x * 0.97), py(z * 0.985)) : g.moveTo(px(x * 0.97), py(z * 0.985))));
  g.closePath();
  g.stroke();
  // Faixa em ângulo: bordas brancas, eixo tracejado, cabos de parada e marcas de toque.
  // Eixo da faixa (para a frente e para bombordo) e perpendicular a ele; `s` metros desde a popa.
  const [dx, dz] = [-Math.sin(ANGLED.angle), -Math.cos(ANGLED.angle)];
  const [qx, qz] = [Math.cos(ANGLED.angle), -Math.sin(ANGLED.angle)];
  const along = (s: number, side: number): [number, number] => [ANGLED.x0 + dx * s + qx * side, ANGLED.z0 + dz * s + qz * side];
  for (const side of [-11, 11]) {
    const [x0, z0] = along(0, side);
    const [x1, z1] = along(215, side);
    line(x0, z0, x1, z1, "rgba(245,245,240,0.85)", 0.5);
  }
  {
    const [x0, z0] = along(4, 0);
    const [x1, z1] = along(215, 0);
    line(x0, z0, x1, z1, "rgba(245,245,240,0.9)", 0.45, [6, 5]);
  }
  for (const s of [32, 44, 56, 68]) {
    const [x0, z0] = along(s, -12);
    const [x1, z1] = along(s, 12);
    line(x0, z0, x1, z1, "rgba(30,30,30,0.9)", 0.35);
  }
  for (let k = 0; k < 6; k++) {
    for (const side of [-7, 7]) {
      const [x0, z0] = along(80 + k * 8, side);
      const [x1, z1] = along(84 + k * 8, side);
      line(x0, z0, x1, z1, "rgba(245,245,240,0.8)", 1.4);
    }
  }
  // Catapultas da proa: trilho escuro com tracejado branco e linha amarela de alinhamento.
  for (const x of [CATAPULT.x, -CATAPULT.x]) {
    line(x, CATAPULT.z0 + 6, x, -166, "#1e2023", 0.7);
    line(x, CATAPULT.z0 + 6, x, -166, "rgba(245,245,240,0.8)", 0.18, [2, 3]);
    line(x - 2.4, CATAPULT.z0 + 4, x - 2.4, -160, "rgba(232,196,64,0.75)", 0.25);
    line(x + 2.4, CATAPULT.z0 + 4, x + 2.4, -160, "rgba(232,196,64,0.75)", 0.25);
  }
  // Linha de táxi amarela pelo eixo do navio.
  line(0, 160, 0, -150, "rgba(232,196,64,0.55)", 0.3);
  // Elevadores (contorno listrado).
  g.setLineDash([1.2 * m, 1.2 * m]);
  g.strokeStyle = "rgba(232,196,64,0.8)";
  g.lineWidth = 0.4 * m;
  for (const [x, z, w, d] of [[27, -78, 16, 22], [27, 52, 16, 22], [-33, 72, 16, 20]] as const) {
    g.strokeRect(px(x - w / 2), py(z + d / 2), w * m, d * m);
  }
  g.setLineDash([]);
  // Numeral da proa, lido de quem está no convés olhando para a frente.
  g.save();
  g.translate(px(0), py(-138));
  g.fillStyle = "rgba(240,240,235,0.85)";
  g.font = `700 ${18 * m}px "Chakra Petch", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("07", 0, 0);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // UV das tampas da extrusão = coordenadas da forma em metros → mapeia o retângulo da textura.
  tex.repeat.set(1 / (2 * TEX_HALF_X), 1 / (2 * TEX_HALF_Z));
  tex.offset.set(0.5, 0.5);
  return tex;
}

interface Hatch {
  readonly pivot: THREE.Object3D;
  readonly world: THREE.Vector3;
  open: number; // s restantes aberta
}

export class Carrier {
  readonly group = new THREE.Group();
  /** Dono dos mísseis navais: time azul, fora da lista de alvos (o navio não leva dano). */
  readonly unit: Combatant;
  private readonly radar: THREE.Object3D;
  private readonly radar2: THREE.Object3D;
  private readonly deflector: THREE.Object3D;
  private deflectorUp = 0;
  private deflectorTarget = 0;
  private readonly shuttle: THREE.Object3D;
  private readonly hatches: Hatch[] = [];
  private nextHatch = 0;

  constructor(scene: THREE.Scene) {
    const g = this.group;
    g.position.copy(CARRIER_POS);
    const hullMat = new THREE.MeshLambertMaterial({ color: 0x6c747a });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x2f3438 });
    const deckMat = new THREE.MeshLambertMaterial({ map: deckTexture() });
    const islandMat = new THREE.MeshLambertMaterial({ color: 0x858d93 });
    const glassMat = new THREE.MeshPhongMaterial({ color: 0x1a2630, specular: 0x8899aa, shininess: 80 });

    const hullTop = DECK_Y - 1.6;
    g.add(new THREE.Mesh(slab(HULL, hullTop - (WATER_LEVEL - 4), hullTop), hullMat));
    // Linha d'água: faixa escura logo acima da água.
    const boot = new THREE.Mesh(slab(HULL, 2.2, WATER_LEVEL + 1.2), new THREE.MeshLambertMaterial({ color: 0x3b2622 }));
    boot.scale.set(1.012, 1, 1.004);
    g.add(boot);
    g.add(new THREE.Mesh(slab(DECK, 1.6, DECK_Y), [deckMat, darkMat]));

    // Ilha (superestrutura) a boreste: blocos, ponte com janelas, mastro e dois radares girando.
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    box(8, 14, 44, 31, DECK_Y + 7, 14, islandMat);
    box(7, 6, 30, 31, DECK_Y + 17, 8, islandMat);
    box(7.6, 3, 18, 31, DECK_Y + 21.5, 2, islandMat);
    box(7.8, 1.2, 18.2, 31, DECK_Y + 21.8, 2, glassMat);
    box(7.8, 1, 10, 31, DECK_Y + 18.6, -4, glassMat);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 14, 8), darkMat);
    mast.position.set(31, DECK_Y + 30, 6);
    g.add(mast);
    box(9, 0.4, 0.4, 31, DECK_Y + 31, 6, darkMat);
    this.radar = new THREE.Group();
    this.radar.position.set(31, DECK_Y + 36.5, 6);
    this.radar.add(new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.3, 0.3), darkMat));
    g.add(this.radar);
    this.radar2 = new THREE.Group();
    this.radar2.position.set(31, DECK_Y + 24.5, 18);
    this.radar2.add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 0.25), islandMat));
    g.add(this.radar2);

    // Defletor de jato atrás da catapulta 1: articulado na borda dianteira, ergue antes do lançamento.
    this.deflector = new THREE.Group();
    this.deflector.position.set(CATAPULT.x, DECK_Y + 0.05, CATAPULT.z0 + 12);
    this.deflector.add(new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 4.2).translate(0, 0.15, 2.1), darkMat));
    g.add(this.deflector);
    this.shuttle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 1.4), new THREE.MeshLambertMaterial({ color: 0xc9a43c }));
    this.shuttle.position.set(CATAPULT.x, DECK_Y + 0.17, CATAPULT.z0 - 6);
    g.add(this.shuttle);

    // Células de lançamento vertical: 2 blocos de 2 × 4 na popa (boreste e bombordo).
    const hatchMat = new THREE.MeshLambertMaterial({ color: 0x8a9298 });
    for (const [bx, bz] of [[28, 124], [-22, 132]] as const) {
      box(3.6, 0.6, 6.4, bx, DECK_Y + 0.3, bz, darkMat);
      for (let c = 0; c < 2; c++) {
        for (let r = 0; r < 4; r++) {
          const pivot = new THREE.Group();
          const x = bx - 0.8 + c * 1.6;
          const z = bz - 2.4 + r * 1.6;
          pivot.position.set(x - 0.65, DECK_Y + 0.62, z);
          pivot.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.3).translate(0.65, 0, 0), hatchMat));
          g.add(pivot);
          this.hatches.push({ pivot, world: new THREE.Vector3(CARRIER_POS.x + x, DECK_Y + 0.7, CARRIER_POS.z + z), open: 0 });
        }
      }
    }

    // Caças estacionados (trem baixado, motores desligados): dão escala ao convés.
    const parked: [JetVariant, number, number, number][] = [
      ["javali", 24, -72, 2.3],
      ["raptor", 23, -96, 2.3],
      ["relampago", 18, 150, 0.6],
    ];
    for (const [variant, x, z, rot] of parked) {
      const jet = createJetMesh("blue", variant);
      jet.setGear(1);
      jet.setThrottle(0, 0);
      jet.group.position.set(x, DECK_Y + gearHeight(variant), z);
      jet.group.rotation.y = rot;
      g.add(jet.group);
    }

    scene.add(g);
    this.unit = {
      team: "blue",
      kind: "ground",
      radius: 0,
      position: new THREE.Vector3(CARRIER_POS.x, DECK_Y, CARRIER_POS.z),
      velocity: new THREE.Vector3(),
      isAlive: () => true,
    };
  }

  /** Posição (mundo) do centro do caça na catapulta, `z` local ao longo do trilho. */
  catapultPoint(z: number, variant: JetVariant, out: THREE.Vector3): THREE.Vector3 {
    return out.set(CARRIER_POS.x + CATAPULT.x, DECK_Y + gearHeight(variant), CARRIER_POS.z + z);
  }

  /** Coordenada z local de um ponto do mundo. */
  localZ(p: THREE.Vector3): number {
    return p.z - CARRIER_POS.z;
  }

  setDeflector(up: boolean): void {
    this.deflectorTarget = up ? 1 : 0;
  }

  /** Lançadeira acompanha a bequilha do caça durante o lançamento. */
  setShuttle(localZ: number): void {
    this.shuttle.position.z = localZ;
  }

  /** Abre a próxima célula e devolve o ponto de saída do míssil (mundo). */
  openCell(): THREE.Vector3 {
    // Alterna blocos (boreste/bombordo, 8 células cada) para a salva sair dos dois lados.
    const k = this.nextHatch++;
    const h = this.hatches[((k % 2) * 8 + (Math.floor(k / 2) % 8)) % this.hatches.length]!;
    h.open = 2.5;
    return h.world;
  }

  /** Casco, convés e ilha como obstáculo sólido (o avião não atravessa o navio). */
  collides(p: THREE.Vector3): boolean {
    const x = p.x - CARRIER_POS.x;
    const z = p.z - CARRIER_POS.z;
    if (x > 26 && x < 36 && z > -10 && z < 38 && p.y < DECK_Y + 38) return true;
    return Math.abs(z) < 168 && x > -44 && x < 36 && p.y < DECK_Y + 0.3 && p.y > WATER_LEVEL - 1;
  }

  update(dt: number): void {
    this.radar.rotation.y += dt * 2.2;
    this.radar2.rotation.y -= dt * 1.1;
    this.deflectorUp += (this.deflectorTarget - this.deflectorUp) * Math.min(1, dt * 2.5);
    this.deflector.rotation.x = -1.05 * this.deflectorUp;
    for (const h of this.hatches) {
      h.open = Math.max(0, h.open - dt);
      const target = h.open > 0.6 ? 1 : 0;
      h.pivot.rotation.z += (target * 1.9 - h.pivot.rotation.z) * Math.min(1, dt * 6);
    }
  }
}
