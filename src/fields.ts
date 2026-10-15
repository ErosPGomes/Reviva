import { hash2, valueNoise } from "./noise";
import { FARM_R0, FARM_R1 } from "./terrain";

/**
 * Lavouras em grade (estilo planície do meio-oeste, como no vídeo de referência): quadras de 800 m entre
 * estradas, cada uma dividida em 1–3 faixas × 1–3 talhões. Tudo derivado de hash, então layout, textura e
 * posição de fazendas/árvores concordam sem precisar guardar nada.
 */
export const FIELD_HALF = 6400;
export const FIELD_TEX = 2048; // 6,25 m/pixel; fileiras de plantio vêm do shader, não da textura
export const BLOCK = 800;
const BLOCKS = (2 * FIELD_HALF) / BLOCK;
const MAIN_ROAD_EVERY = 3;
const MAIN_HALF_W = 6;
const TRACK_HALF_W = 2.6;
const HEDGE_HALF_W = 1.6;

export interface BaseSite {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly runway: boolean;
}

export const BASES: readonly BaseSite[] = [
  { id: "A", x: 2000, z: -1600, runway: true },
  { id: "B", x: -2600, z: -600, runway: false },
  { id: "C", x: 300, z: -4000, runway: false },
];
export const BASE_HALF = 150;
export const RUNWAY_OFFSET_X = 420;
export const RUNWAY_HALF_W = 24;
export const RUNWAY_HALF_L = 800;

interface Field {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}
interface Strip {
  readonly zs: readonly number[];
  readonly fields: readonly Field[];
}
interface Block {
  readonly xs: readonly number[];
  readonly strips: readonly Strip[];
}

/** sRGB. Peso maior para verdes: o vídeo mostra soja/milho no meio do ciclo. */
const CROPS: readonly { c: readonly [number, number, number]; rows: boolean; w: number }[] = [
  { c: [92, 136, 50], rows: true, w: 4 },
  { c: [70, 112, 40], rows: true, w: 3 },
  { c: [126, 158, 68], rows: true, w: 2 },
  { c: [192, 170, 96], rows: true, w: 1.5 },
  { c: [166, 140, 86], rows: true, w: 1 },
  { c: [116, 92, 62], rows: true, w: 1 },
  { c: [90, 72, 50], rows: true, w: 0.8 },
  { c: [108, 146, 62], rows: false, w: 1.5 },
  { c: [84, 124, 50], rows: false, w: 1 },
];
const CROP_TOTAL = CROPS.reduce((s, c) => s + c.w, 0);

function pickCrop(h: number): (typeof CROPS)[number] {
  let acc = h * CROP_TOTAL;
  for (const c of CROPS) {
    acc -= c.w;
    if (acc <= 0) return c;
  }
  return CROPS[0]!;
}

function splits(n: number, a: number, b: number, salt: number): number[] {
  const out = [0];
  for (let i = 1; i < n; i++) out.push((BLOCK * (i + (hash2(a * 7 + i, b, salt) - 0.5) * 0.5)) / n);
  out.push(BLOCK);
  return out;
}

function makeBlock(bx: number, bz: number): Block {
  const nx = 1 + Math.floor(hash2(bx, bz, 7) * 3);
  const xs = splits(nx, bx, bz, 9);
  const strips: Strip[] = [];
  for (let ix = 0; ix < nx; ix++) {
    const nz = 1 + Math.floor(hash2(bx * 31 + ix, bz, 3) * 3);
    const zs = splits(nz, bx * 31 + ix, bz, 13);
    const w = xs[ix + 1]! - xs[ix]!;
    const fields: Field[] = [];
    for (let iz = 0; iz < nz; iz++) {
      const l = zs[iz + 1]! - zs[iz]!;
      const hf = hash2(bx * 5 + ix * 101, bz * 5 + iz * 103, 17);
      const crop = pickCrop(hf);
      const tone = 0.9 + hash2(bx + ix * 11, bz + iz * 13, 21) * 0.2;
      // Fileiras correm no sentido do lado maior do talhão (como na mecanização real); 20% invertidas.
      const alongZ = (l >= w) !== hash2(bx, bz * 3 + iz + ix * 7, 19) < 0.2;
      fields.push({
        r: crop.c[0] * tone,
        g: crop.c[1] * tone,
        b: crop.c[2] * tone,
        a: crop.rows ? (alongZ ? 128 : 255) : 0,
      });
    }
    strips.push({ zs, fields });
  }
  return { xs, strips };
}

const lineIsMain = (k: number): boolean => ((k % MAIN_ROAD_EVERY) + MAIN_ROAD_EVERY) % MAIN_ROAD_EVERY === 0;

export interface Farmstead {
  readonly x: number;
  readonly z: number;
  /** 0 ou π/2 — construções alinhadas à grade de estradas. */
  readonly rot: number;
  readonly seed: number;
}
export interface Segment {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}
export interface FarmLayout {
  readonly farmsteads: readonly Farmstead[];
  readonly treeLines: readonly Segment[];
}

function nearBase(x: number, z: number, margin: number): boolean {
  for (const b of BASES) {
    if (Math.abs(x - b.x) < BASE_HALF + margin && Math.abs(z - b.z) < BASE_HALF + margin) return true;
    if (
      b.runway &&
      Math.abs(x - (b.x + RUNWAY_OFFSET_X)) < RUNWAY_HALF_W + margin &&
      Math.abs(z - b.z) < RUNWAY_HALF_L + margin
    )
      return true;
  }
  return false;
}

/** Cache das quadras: o laço de 4 M de pixels consulta a quadra por índice em vez de recalcular hashes. */
function buildBlocks(): Block[] {
  const blocks: Block[] = [];
  for (let j = 0; j < BLOCKS; j++) {
    for (let i = 0; i < BLOCKS; i++) blocks.push(makeBlock(i - BLOCKS / 2, j - BLOCKS / 2));
  }
  return blocks;
}

export function generateLayout(): FarmLayout {
  const blocks = buildBlocks();
  const farmsteads: Farmstead[] = [];
  const treeLines: Segment[] = [];
  const inside = (x: number, z: number) => Math.hypot(x, z) < FARM_R0 - 250 && !nearBase(x, z, 120);

  for (let j = 0; j < BLOCKS; j++) {
    for (let i = 0; i < BLOCKS; i++) {
      const bx = i - BLOCKS / 2;
      const bz = j - BLOCKS / 2;
      const blk = blocks[j * BLOCKS + i]!;
      const x0 = bx * BLOCK;
      const z0 = bz * BLOCK;
      if (!inside(x0 + BLOCK / 2, z0 + BLOCK / 2)) continue;

      if (hash2(bx, bz, 41) < 0.4) {
        const corner = Math.floor(hash2(bx, bz, 43) * 4);
        const cx = corner & 1 ? x0 + BLOCK - 70 : x0 + 70;
        const cz = corner & 2 ? z0 + BLOCK - 65 : z0 + 65;
        if (inside(cx, cz)) {
          farmsteads.push({ x: cx, z: cz, rot: hash2(bx, bz, 47) < 0.5 ? 0 : Math.PI / 2, seed: bx * 97 + bz });
        }
      }
      for (let s = 1; s < blk.xs.length - 1; s++) {
        if (hash2(bx * 13 + s, bz, 51) < 0.55) {
          const x = x0 + blk.xs[s]!;
          treeLines.push({ x0: x, z0: z0 + 8, x1: x, z1: z0 + BLOCK - 8 });
        }
      }
      blk.strips.forEach((strip, ix) => {
        for (let s = 1; s < strip.zs.length - 1; s++) {
          if (hash2(bx * 17 + ix, bz * 5 + s, 53) < 0.45) {
            const z = z0 + strip.zs[s]!;
            treeLines.push({ x0: x0 + blk.xs[ix]! + 4, z0: z, x1: x0 + blk.xs[ix + 1]! - 4, z1: z });
          }
        }
      });
      if (!lineIsMain(bx) && hash2(bx, bz, 57) < 0.25) {
        treeLines.push({ x0: x0 + 7, z0: z0 + 10, x1: x0 + 7, z1: z0 + BLOCK - 10 });
      }
    }
  }
  return { farmsteads, treeLines: treeLines.filter((s) => inside((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2)) };
}

/**
 * Textura RGBA gerada direto em Uint8Array (não canvas 2D): o canal alfa carrega a orientação das fileiras e
 * o canvas pré-multiplicaria o alfa, destruindo a cor de pixels com alfa baixo.
 */
export function generateFieldTexture(layout: FarmLayout): Uint8Array {
  const size = FIELD_TEX;
  const data = new Uint8Array(size * size * 4);
  const blocks = buildBlocks();
  const mpp = (2 * FIELD_HALF) / size;
  const limit2 = (FARM_R1 + 150) ** 2;

  for (let py = 0; py < size; py++) {
    const z = -FIELD_HALF + (py + 0.5) * mpp;
    const bzi = Math.min(BLOCKS - 1, Math.floor((z + FIELD_HALF) / BLOCK));
    const bz = bzi - BLOCKS / 2;
    const lz = z - bz * BLOCK;
    const dz0 = lz;
    const dz1 = BLOCK - lz;
    const lineZ = dz0 < dz1 ? bz : bz + 1;
    const dZ = Math.min(dz0, dz1);
    const halfZ = lineIsMain(lineZ) ? MAIN_HALF_W : TRACK_HALF_W;

    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      const x = -FIELD_HALF + (px + 0.5) * mpp;
      if (x * x + z * z > limit2) {
        data[o] = 80;
        data[o + 1] = 110;
        data[o + 2] = 50;
        continue;
      }
      const grain = 1 + (hash2(px, py, 5) - 0.5) * 0.07;
      const light = (0.9 + valueNoise(x / 230, z / 230, 3) * 0.2) * grain;
      let r: number;
      let g: number;
      let b: number;
      let a = 0;

      const base = baseSurface(x, z);
      if (base === 1) {
        const lines = (Math.abs(((x % 60) + 60) % 60) < 1.5 || Math.abs(((z % 60) + 60) % 60) < 1.5) ? 0.85 : 1;
        r = g = b = 150 * lines * grain;
        g += 2;
      } else if (base === 2) {
        r = g = b = 78 * grain;
      } else {
        const bxi = Math.min(BLOCKS - 1, Math.floor((x + FIELD_HALF) / BLOCK));
        const bx = bxi - BLOCKS / 2;
        const lx = x - bx * BLOCK;
        const dx0 = lx;
        const dx1 = BLOCK - lx;
        const lineX = dx0 < dx1 ? bx : bx + 1;
        const dX = Math.min(dx0, dx1);
        const halfX = lineIsMain(lineX) ? MAIN_HALF_W : TRACK_HALF_W;

        if (dX < halfX || dZ < halfZ) {
          const main = (dX < halfX && halfX === MAIN_HALF_W) || (dZ < halfZ && halfZ === MAIN_HALF_W);
          if (main) r = g = b = 92 * grain;
          else {
            r = 158 * grain;
            g = 140 * grain;
            b = 104 * grain;
          }
        } else if (dX < halfX + 2.5 || dZ < halfZ + 2.5) {
          r = 96 * light;
          g = 118 * light;
          b = 62 * light;
        } else {
          const blk = blocks[bzi * BLOCKS + bxi]!;
          let ix = 0;
          while (ix < blk.xs.length - 2 && lx > blk.xs[ix + 1]!) ix++;
          const strip = blk.strips[ix]!;
          let iz = 0;
          while (iz < strip.zs.length - 2 && lz > strip.zs[iz + 1]!) iz++;
          const edge = Math.min(
            ix > 0 ? lx - blk.xs[ix]! : 1e9,
            ix < blk.xs.length - 2 ? blk.xs[ix + 1]! - lx : 1e9,
            iz > 0 ? lz - strip.zs[iz]! : 1e9,
            iz < strip.zs.length - 2 ? strip.zs[iz + 1]! - lz : 1e9,
          );
          if (edge < HEDGE_HALF_W) {
            r = 62 * light;
            g = 88 * light;
            b = 40 * light;
          } else {
            const f = strip.fields[iz]!;
            const wear = 0.95 + valueNoise(x / 55, z / 55, 9) * 0.1;
            r = f.r * light * wear;
            g = f.g * light * wear;
            b = f.b * light * wear;
            a = f.a;
          }
        }
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }

  // Pátios das fazendas: retângulos pequenos, mais barato pintar depois do que testar 60 fazendas por pixel.
  for (const f of layout.farmsteads) {
    const hw = f.rot === 0 ? 46 : 40;
    const hl = f.rot === 0 ? 40 : 46;
    const x0 = Math.floor((f.x - hw + FIELD_HALF) / mpp);
    const x1 = Math.ceil((f.x + hw + FIELD_HALF) / mpp);
    const z0 = Math.floor((f.z - hl + FIELD_HALF) / mpp);
    const z1 = Math.ceil((f.z + hl + FIELD_HALF) / mpp);
    for (let py = z0; py < z1; py++) {
      for (let px = x0; px < x1; px++) {
        const o = (py * size + px) * 4;
        const n = 1 + (hash2(px, py, 77) - 0.5) * 0.12;
        data[o] = 146 * n;
        data[o + 1] = 136 * n;
        data[o + 2] = 116 * n;
        data[o + 3] = 0;
      }
    }
  }
  return data;
}

/** 0 = lavoura, 1 = pátio de concreto da base, 2 = pista de pouso. */
function baseSurface(x: number, z: number): 0 | 1 | 2 {
  for (const b of BASES) {
    if (b.runway && Math.abs(x - (b.x + RUNWAY_OFFSET_X)) < RUNWAY_HALF_W && Math.abs(z - b.z) < RUNWAY_HALF_L) return 2;
    if (Math.abs(x - b.x) < BASE_HALF && Math.abs(z - b.z) < BASE_HALF) return 1;
  }
  return 0;
}
