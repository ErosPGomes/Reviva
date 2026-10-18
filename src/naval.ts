import type { Vector3 } from "three";
import type { Combatant } from "./types";
import type { MissileSpec } from "./weapons";

/**
 * Salva naval: o porta-aviões dispara mísseis superfície-ar (estilo ESSM) de células de lançamento vertical.
 * Sobem retos ~1 s, depois guiam por datalink até o alvo. Longo alcance e quase imunes a flares, mas é um
 * recurso raro: liberado por conquista e recarregado só por sequências de abates e bases neutralizadas.
 */
export const NAVAL_MISSILE: MissileSpec = {
  damage: 170,
  maxSpeed: 860,
  turnRate: 1.7,
  gimbal: Math.PI, // datalink do navio: o míssil nunca "perde" o alvo por ângulo
  flareResist: 0.85,
  splash: 36,
  motorTime: 9,
  look: "naval",
  life: 24,
  guideDelay: 0.9,
};

export const NAVAL = {
  salvo: 4, // mísseis por salva
  stagger: 0.28, // s entre lançamentos
  maxCharges: 2,
  launchSpeed: 45, // m/s ao sair da célula
} as const;

/**
 * Escolhe os alvos da salva: caças inimigos vivos, do mais perto do jogador para o mais longe (quem ameaça
 * primeiro); sem caças, os alvos em solo mais próximos. Com menos alvos que mísseis, repete a lista —
 * o Ás inimigo, com 320 de vida, recebe mais de um.
 */
export function pickNavalTargets(candidates: readonly Combatant[], from: Vector3, count: number): Combatant[] {
  const alive = candidates.filter((c) => c.team === "red" && c.isAlive());
  const air = alive.filter((c) => c.kind === "air");
  const pool = (air.length ? air : alive).slice().sort((a, b) => a.position.distanceToSquared(from) - b.position.distanceToSquared(from));
  if (!pool.length) return [];
  return Array.from({ length: count }, (_, k) => pool[k % pool.length]!);
}
