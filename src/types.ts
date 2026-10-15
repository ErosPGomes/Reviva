import type { Vector3 } from "three";

export type Team = "blue" | "red";

/** Qualquer coisa que um míssil consegue perseguir (aviões, alvos terrestres, flares). */
export interface Trackable {
  readonly position: Vector3;
  readonly velocity: Vector3;
  isAlive(): boolean;
}

/** Alvo que recebe dano. `radius` é generoso de propósito: acertar um caça a 300 m/s precisa ser divertido. */
export interface Combatant extends Trackable {
  readonly team: Team;
  readonly kind: "air" | "ground";
  readonly radius: number;
}
