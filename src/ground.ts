import * as THREE from "three";
import { BASES } from "./fields";
import { createAAModel, createFuelModel, createTankModel, primeMaterials, setCharred, type GroundModel } from "./models";
import type { Terrain } from "./terrain";
import type { Combatant } from "./types";

export type GroundKind = "aa" | "tank" | "fuel";

const STATS: Record<GroundKind, { health: number; radius: number; score: number; label: string }> = {
  aa: { health: 60, radius: 7, score: 75, label: "Antiaérea" },
  tank: { health: 80, radius: 6.5, score: 50, label: "Blindado" },
  fuel: { health: 40, radius: 8, score: 25, label: "Combustível" },
};

export class GroundTarget implements Combatant {
  readonly team = "red" as const;
  readonly kind = "ground" as const;
  readonly velocity = new THREE.Vector3();
  readonly position: THREE.Vector3;
  readonly radius: number;
  readonly score: number;
  readonly label: string;
  readonly model: GroundModel;
  health: number;
  readonly maxHealth: number;
  alive = true;
  fireTimer = Math.random() * 3;
  burstLeft = 0;
  shotTimer = 0;
  smokeTime = 0;

  constructor(readonly type: GroundKind, readonly base: Base, pos: THREE.Vector3, yaw: number) {
    const st = STATS[type];
    this.health = this.maxHealth = st.health;
    this.radius = st.radius;
    this.score = st.score;
    this.label = st.label;
    this.model = type === "aa" ? createAAModel() : type === "tank" ? createTankModel() : createFuelModel();
    this.model.group.position.copy(pos);
    this.model.group.rotation.y = yaw;
    primeMaterials(this.model.group);
    // Centro de colisão um pouco acima do chão (meio do veículo).
    this.position = pos.clone().add(new THREE.Vector3(0, 2, 0));
  }

  isAlive(): boolean {
    return this.alive;
  }

  destroy(): void {
    this.alive = false;
    this.smokeTime = 30;
    setCharred(this.model.group, true);
    this.model.group.scale.set(1, this.type === "fuel" ? 0.35 : 0.75, 1);
    this.model.group.rotation.z = (Math.random() - 0.5) * 0.2;
  }

  restore(): void {
    this.alive = true;
    this.health = STATS[this.type].health;
    this.smokeTime = 0;
    this.burstLeft = 0;
    setCharred(this.model.group, false);
    this.model.group.scale.set(1, 1, 1);
    this.model.group.rotation.z = 0;
  }
}

export class Base {
  readonly targets: GroundTarget[] = [];
  readonly center: THREE.Vector3;
  captured = false;

  constructor(readonly id: string, x: number, y: number, z: number) {
    this.center = new THREE.Vector3(x, y, z);
  }

  get remaining(): number {
    return this.targets.reduce((n, t) => n + (t.alive ? 1 : 0), 0);
  }
}

/** Cada base: 3 antiaéreas em triângulo, 3 blindados em fila, 2 tanques de combustível. */
export function createBases(scene: THREE.Scene, terrain: Terrain): Base[] {
  return BASES.map((site) => {
    const base = new Base(site.id, site.x, terrain.heightAt(site.x, site.z), site.z);
    const add = (type: GroundKind, dx: number, dz: number, yaw: number) => {
      const x = site.x + dx;
      const z = site.z + dz;
      const t = new GroundTarget(type, base, new THREE.Vector3(x, terrain.heightAt(x, z), z), yaw);
      base.targets.push(t);
      scene.add(t.model.group);
    };
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      add("aa", Math.cos(a) * 105, Math.sin(a) * 105, a);
    }
    for (let k = 0; k < 3; k++) add("tank", 30 + k * 14, 40, 0.1 * k);
    add("fuel", 60, -60, 0);
    add("fuel", 80, -40, 0);
    return base;
  });
}
