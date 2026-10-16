import * as THREE from "three";
import { clamp } from "./math";
import type { Terrain } from "./terrain";
import type { Trackable } from "./types";
import type { MissileSpec } from "./weapons";

/**
 * Apoio de drone (estilo MQ-9): ao encher a barra, o jogador assume a câmera térmica de um drone em órbita
 * a ~2 km de altura e designa alvos com laser. A arma é o AGM-114 Hellfire de guiagem laser semiativa:
 * o míssil persegue o ponto iluminado, então o jogador pode corrigir a mira até o impacto.
 * Variante N (termobárica) troca precisão por raio de explosão — melhor contra grupos e bases.
 */

export type DroneWarhead = "hellfire" | "thermo";

export const WARHEADS: Record<DroneWarhead, { name: string; short: string; spec: MissileSpec }> = {
  hellfire: {
    name: "AGM-114 Hellfire",
    short: "HELLFIRE",
    spec: { damage: 260, maxSpeed: 450, turnRate: 2.6, gimbal: 3.1, flareResist: 1, splash: 26, motorTime: 3 },
  },
  thermo: {
    name: "AGM-114N termobárico",
    short: "TERMOBÁRICO",
    spec: { damage: 190, maxSpeed: 420, turnRate: 2.2, gimbal: 3.1, flareResist: 1, splash: 75, motorTime: 3 },
  },
};

export const DRONE_TIME = 25; // s de operação
export const DRONE_SHOTS = 6;
const SHOT_INTERVAL = 1.1;
const ORBIT_RADIUS = 1700;
const ALTITUDE = 2000;
const AIM_SPEED = 650; // m/s do retículo no solo
const AIM_LIMIT = 2600; // distância máxima do retículo ao centro da órbita
const SNAP = 32; // m: retículo "gruda" em alvos próximos

/** Ponto iluminado pelo laser: um Trackable que o míssil persegue (posição atualizada a cada quadro). */
export class LaserSpot implements Trackable {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  live = false;
  isAlive(): boolean {
    return this.live;
  }
}

export class DroneOps {
  active = false;
  timeLeft = 0;
  shots = 0;
  cooldown = 0;
  warhead: DroneWarhead = "hellfire";
  readonly position = new THREE.Vector3();
  readonly aim = new THREE.Vector3();
  readonly spot = new LaserSpot();
  /** Alvo sob o retículo (o laser o acompanha). */
  snapped: Trackable | null = null;
  private readonly center = new THREE.Vector3();
  private orbit = 0;

  constructor(private readonly terrain: Terrain) {}

  start(center: THREE.Vector3): void {
    this.active = true;
    this.timeLeft = DRONE_TIME;
    this.shots = DRONE_SHOTS;
    this.cooldown = 0;
    this.center.set(center.x, 0, center.z);
    this.aim.set(center.x, this.terrain.heightAt(center.x, center.z), center.z);
    this.orbit = Math.random() * Math.PI * 2;
    this.spot.live = true;
    this.snapped = null;
  }

  stop(): void {
    this.active = false;
    this.spot.live = false;
    this.snapped = null;
  }

  /** stickX/stickY movem o retículo no plano do solo, relativos à direção da câmera. */
  update(dt: number, stickX: number, stickY: number, camera: THREE.Camera, targets: readonly Trackable[]): void {
    if (!this.active) return;
    this.timeLeft -= dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.orbit += dt * 0.09;
    const cy = this.terrain.heightAt(this.center.x, this.center.z);
    this.position.set(this.center.x + Math.cos(this.orbit) * ORBIT_RADIUS, cy + ALTITUDE, this.center.z + Math.sin(this.orbit) * ORBIT_RADIUS);

    // Eixos de movimento do retículo = frente/direita da câmera projetados no chão.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.aim.addScaledVector(right, stickX * AIM_SPEED * dt).addScaledVector(fwd, -stickY * AIM_SPEED * dt);
    const dx = this.aim.x - this.center.x;
    const dz = this.aim.z - this.center.z;
    const d = Math.hypot(dx, dz);
    if (d > AIM_LIMIT) {
      this.aim.x = this.center.x + (dx / d) * AIM_LIMIT;
      this.aim.z = this.center.z + (dz / d) * AIM_LIMIT;
    }
    this.aim.y = this.terrain.heightAt(this.aim.x, this.aim.z);

    // Gruda no alvo vivo mais próximo do retículo: o laser passa a seguir o veículo.
    let best: Trackable | null = null;
    let bd = SNAP;
    for (const t of targets) {
      if (!t.isAlive()) continue;
      const dd = Math.hypot(t.position.x - this.aim.x, t.position.z - this.aim.z);
      if (dd < bd) {
        bd = dd;
        best = t;
      }
    }
    this.snapped = best;
    this.spot.position.copy(best ? best.position : this.aim);
  }

  /** Câmera do drone: posição da órbita, olhando para o retículo, campo de visão estreito (zoom). */
  applyCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.position);
    camera.lookAt(this.aim);
    if (Math.abs(camera.fov - 24) > 0.01) {
      camera.fov = 24;
      camera.updateProjectionMatrix();
    }
  }

  canFire(): boolean {
    return this.active && this.shots > 0 && this.cooldown <= 0;
  }

  consumeShot(): void {
    this.shots--;
    this.cooldown = SHOT_INTERVAL;
  }

  get remainingFrac(): number {
    return clamp(this.timeLeft / DRONE_TIME, 0, 1);
  }
}
