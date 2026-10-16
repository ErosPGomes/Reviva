import * as THREE from "three";
import { createFlightState, type FlightParams, type FlightState } from "./flight";
import { createJetMesh, createShadowMesh, type JetMesh, type JetVariant } from "./models";
import type { Combatant, Team } from "./types";

export const MAX_FLARES = 3;

export class Aircraft implements Combatant {
  readonly kind = "air" as const;
  readonly radius = 9;
  readonly flight: FlightState;
  readonly mesh: JetMesh;
  readonly shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  health = 100;
  maxHealth = 100;
  maxFlares = MAX_FLARES;
  alive = true;
  /** Destroços já atingiram o chão e saíram da cena. */
  removed = false;
  wreckSpin = 0;
  wreckAge = 0;

  gunCooldown = 0;
  gunHeat = 0;
  overheated = false;
  gunSide = 1;
  /** Tempo restante de recarga de cada trilho de míssil (0 = pronto). */
  readonly rails: [number, number] = [0, 0];
  flares = MAX_FLARES;
  flareRecharge = 0;
  flareQueue = 0;
  flareTimer = 0;
  lastHitAt = -100;

  constructor(
    readonly team: Team,
    readonly name: string,
    readonly params: FlightParams,
    pos: THREE.Vector3,
    heading: number,
    speed: number,
    variant: JetVariant = "falcao",
  ) {
    this.flight = createFlightState(pos, heading, speed);
    this.mesh = createJetMesh(team, variant);
    this.shadow = createShadowMesh();
  }

  get position(): THREE.Vector3 {
    return this.flight.pos;
  }

  get velocity(): THREE.Vector3 {
    return this.flight.vel;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  isAlive(): boolean {
    return this.alive;
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.mesh.group, this.shadow);
  }

  removeFrom(scene: THREE.Scene): void {
    scene.remove(this.mesh.group, this.shadow);
  }

  sync(time: number): void {
    const g = this.mesh.group;
    g.position.copy(this.flight.pos);
    g.quaternion.copy(this.flight.quat);
    this.mesh.setThrottle(this.alive ? this.flight.throttle : 0, time);
    this.mesh.setPylons(this.rails[1] <= 0, this.rails[0] <= 0);
  }
}
