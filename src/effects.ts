import * as THREE from "three";
import { BillboardBatch, ParticleSystem, type ParticlePreset } from "./particles";
import { glowTexture, smokeTexture } from "./textures";
import { rand, randomUnit } from "./math";

const P = (p: ParticlePreset): ParticlePreset => p;

export const FX = {
  missileSmoke: P({ life: [2.4, 3.4], size0: [1.6, 2.4], size1: [7, 10], c0: 0xe4e4e2, c1: 0xbdbdbb, alpha: 0.5, drag: 0.6, buoy: 1.2, fadeIn: 0.05, spin: 0.6 }),
  darkSmoke: P({ life: [3, 5], size0: [7, 11], size1: [26, 40], c0: 0x2e2a26, c1: 0x67676a, alpha: 0.72, drag: 1.1, buoy: 5, fadeIn: 0.1, spin: 0.4 }),
  wreckSmoke: P({ life: [2, 3.2], size0: [3, 5], size1: [12, 18], c0: 0x1f1c1a, c1: 0x5b5b5e, alpha: 0.7, drag: 1, buoy: 3, fadeIn: 0.05, spin: 0.5 }),
  column: P({ life: [6, 9], size0: [8, 12], size1: [40, 60], c0: 0x26231f, c1: 0x77777a, alpha: 0.55, drag: 0.4, buoy: 4, fadeIn: 0.5, spin: 0.15 }),
  dust: P({ life: [1.4, 2.4], size0: [2.5, 4], size1: [10, 15], c0: 0x8c7b5c, c1: 0xa89a7c, alpha: 0.6, drag: 2.2, buoy: 1.2, fadeIn: 0.04, spin: 0.5 }),
  flak: P({ life: [2.6, 3.6], size0: [5, 7], size1: [18, 24], c0: 0x232323, c1: 0x58585a, alpha: 0.85, drag: 1.6, buoy: 0.4, fadeIn: 0.03, spin: 0.3 }),
  flareSmoke: P({ life: [1.2, 1.8], size0: [1.4, 2], size1: [5, 7], c0: 0xf2f2f0, c1: 0xcfcfcd, alpha: 0.4, drag: 1.4, buoy: 1, fadeIn: 0.03, spin: 0.6 }),
  steam: P({ life: [1.2, 2], size0: [2, 3.2], size1: [9, 14], c0: 0xffffff, c1: 0xe8ecef, alpha: 0.42, drag: 1.6, buoy: 2.5, fadeIn: 0.05, spin: 0.4 }),
  vapor: P({ life: [0.5, 0.8], size0: [0.6, 0.9], size1: [2, 3], c0: 0xffffff, c1: 0xffffff, alpha: 0.28, drag: 0.5, buoy: 0, fadeIn: 0.05, spin: 0 }),
  flash: P({ life: [0.14, 0.2], size0: [26, 34], size1: [40, 52], c0: 0xfff1c4, c1: 0xffa040, alpha: 1, drag: 0, buoy: 0, fadeIn: 0.001, spin: 0 }),
  fire: P({ life: [0.5, 0.9], size0: [6, 9], size1: [12, 18], c0: 0xffd27a, c1: 0xff4a12, alpha: 0.9, drag: 2.2, buoy: 4, fadeIn: 0.02, spin: 1.5 }),
  wreckFire: P({ life: [0.25, 0.45], size0: [3, 4.5], size1: [1.5, 3], c0: 0xffd890, c1: 0xff5a1a, alpha: 0.9, drag: 1.5, buoy: 2, fadeIn: 0.01, spin: 2 }),
  spark: P({ life: [0.4, 0.8], size0: [1.2, 1.6], size1: [0.3, 0.5], c0: 0xffe3a0, c1: 0xff6020, alpha: 1, drag: 0.6, buoy: -14, fadeIn: 0.001, spin: 0 }),
  muzzle: P({ life: [0.04, 0.06], size0: [1.6, 2.2], size1: [2.4, 3], c0: 0xfff0b0, c1: 0xffa040, alpha: 1, drag: 0, buoy: 0, fadeIn: 0.001, spin: 0 }),
  flareGlow: P({ life: [0.12, 0.18], size0: [6, 8], size1: [3, 4], c0: 0xffffff, c1: 0xffc070, alpha: 1, drag: 0, buoy: 0, fadeIn: 0.001, spin: 0 }),
  motor: P({ life: [0.05, 0.08], size0: [2.4, 3], size1: [1.2, 1.6], c0: 0xffffff, c1: 0xffb060, alpha: 1, drag: 0, buoy: 0, fadeIn: 0.001, spin: 0 }),
} as const;

const _d = new THREE.Vector3();

/** Fachada de efeitos: duas filas de partículas (fumaça opaca + brilho aditivo), cada uma 1 draw call. */
export class Effects {
  readonly smoke: ParticleSystem;
  readonly glow: ParticleSystem;

  constructor(scene: THREE.Scene, fog: THREE.Fog) {
    const smokeBatch = new BillboardBatch(3200, smokeTexture(), false, fog);
    const glowBatch = new BillboardBatch(2200, glowTexture(), true, fog);
    smokeBatch.mesh.renderOrder = 2;
    glowBatch.mesh.renderOrder = 3;
    scene.add(smokeBatch.mesh, glowBatch.mesh);
    this.smoke = new ParticleSystem(smokeBatch);
    this.glow = new ParticleSystem(glowBatch);
  }

  begin(): void {
    this.smoke.batch.begin();
    this.glow.batch.begin();
  }

  update(dt: number): void {
    this.smoke.update(dt);
    this.glow.update(dt);
  }

  end(): void {
    this.smoke.batch.end();
    this.glow.batch.end();
  }

  clear(): void {
    this.smoke.clear();
    this.glow.clear();
  }

  explosion(p: THREE.Vector3, scale = 1): void {
    this.glow.emit(FX.flash, p.x, p.y, p.z, 0, 0, 0, scale);
    for (let i = 0; i < 12; i++) {
      randomUnit(_d);
      const s = rand(4, 20) * scale;
      this.glow.emit(FX.fire, p.x + _d.x * 2 * scale, p.y + _d.y * 2 * scale, p.z + _d.z * 2 * scale, _d.x * s, _d.y * s, _d.z * s, scale);
    }
    for (let i = 0; i < 10; i++) {
      randomUnit(_d);
      const s = rand(3, 10) * scale;
      this.smoke.emit(FX.darkSmoke, p.x + _d.x * 3 * scale, p.y + _d.y * 3 * scale, p.z + _d.z * 3 * scale, _d.x * s, _d.y * s + 2, _d.z * s, scale);
    }
    for (let i = 0; i < 18; i++) {
      randomUnit(_d);
      const s = rand(30, 90);
      this.glow.emit(FX.spark, p.x, p.y, p.z, _d.x * s, _d.y * s + 15, _d.z * s);
    }
  }

  airburst(p: THREE.Vector3): void {
    this.glow.emit(FX.flash, p.x, p.y, p.z, 0, 0, 0, 0.35);
    for (let i = 0; i < 4; i++) {
      randomUnit(_d);
      this.smoke.emit(FX.flak, p.x + _d.x * 2, p.y + _d.y * 2, p.z + _d.z * 2, _d.x * 6, _d.y * 6, _d.z * 6);
    }
  }

  hitSparks(p: THREE.Vector3): void {
    this.glow.emit(FX.muzzle, p.x, p.y, p.z, 0, 0, 0, 1.6);
    for (let i = 0; i < 5; i++) {
      randomUnit(_d);
      const s = rand(20, 60);
      this.glow.emit(FX.spark, p.x, p.y, p.z, _d.x * s, _d.y * s, _d.z * s);
    }
  }

  dust(p: THREE.Vector3, scale = 1): void {
    for (let i = 0; i < 3; i++) {
      randomUnit(_d);
      this.smoke.emit(FX.dust, p.x, p.y + 1, p.z, _d.x * 4, Math.abs(_d.y) * 8 + 3, _d.z * 4, scale);
    }
  }

  groundBlast(p: THREE.Vector3, scale = 1): void {
    this.explosion(p, scale);
    for (let i = 0; i < 8; i++) {
      randomUnit(_d);
      this.smoke.emit(FX.dust, p.x + _d.x * 6, p.y + 1, p.z + _d.z * 6, _d.x * 18, Math.abs(_d.y) * 20 + 6, _d.z * 18, scale * 1.6);
    }
  }
}
