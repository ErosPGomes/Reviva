import { PLAYER_JET, type FlightParams } from "./flight";
import type { JetVariant } from "./models";

/**
 * Caças jogáveis. Cada um troca um ponto forte por um fraco — nenhum domina em tudo:
 * Falcão equilibrado · Espectro furtivo e ágil, mas frágil · Javali blindado e letal no solo, mas lento ·
 * Relâmpago o mais rápido, com radar de longo alcance, mas curva mal.
 */
export type FighterId = JetVariant;

export interface FighterSpec {
  readonly id: FighterId;
  readonly name: string;
  readonly role: string;
  readonly desc: string;
  readonly flight: FlightParams;
  readonly health: number;
  readonly armor: number; // × dano recebido
  readonly stealth: number; // × tempo para o inimigo travar; ÷ alcance da antiaérea
  readonly extraRails: number; // trilhos a mais por tipo de míssil
  readonly reloadMult: number; // × velocidade de recarga dos mísseis
  readonly groundGunMult: number; // × dano da metralhadora em alvos de solo
  readonly missileRangeMult: number; // × alcance de trava
  readonly flares: number;
  /** Notas 1–5 para o menu (velocidade, agilidade, blindagem, ataque ao solo). */
  readonly stats: readonly [number, number, number, number];
}

export const FIGHTERS: Record<FighterId, FighterSpec> = {
  falcao: {
    id: "falcao",
    name: "Falcão",
    role: "Multimissão",
    desc: "Equilibrado em tudo: o ponto de partida",
    flight: PLAYER_JET,
    health: 100,
    armor: 1,
    stealth: 1,
    extraRails: 0,
    reloadMult: 1,
    groundGunMult: 1,
    missileRangeMult: 1,
    flares: 3,
    stats: [3, 3, 3, 3],
  },
  raptor: {
    id: "raptor",
    name: "Espectro",
    role: "Furtivo",
    desc: "Inimigo demora 80% mais para travar, antiaérea enxerga menos; o mais ágil, porém frágil",
    flight: { ...PLAYER_JET, maxSpeed: 320, maxThrust: 36, pitchRate: 1.85, rollRate: 4.3 },
    health: 80,
    armor: 1.1,
    stealth: 1.8,
    extraRails: 0,
    reloadMult: 1,
    groundGunMult: 1,
    missileRangeMult: 1,
    flares: 2,
    stats: [4, 5, 2, 2],
  },
  javali: {
    id: "javali",
    name: "Javali",
    role: "Ataque ao solo",
    desc: "Blindado (170 de vida), metralhadora dobra o dano em solo, 3 trilhos por míssil; lento",
    flight: { ...PLAYER_JET, maxSpeed: 235, minSpeed: 55, maxThrust: 27, pitchRate: 1.5, rollRate: 3, assistTurn: 0.95 },
    health: 170,
    armor: 0.7,
    stealth: 0.85,
    extraRails: 1,
    reloadMult: 1,
    groundGunMult: 2.2,
    missileRangeMult: 0.9,
    flares: 4,
    stats: [1, 3, 5, 5],
  },
  relampago: {
    id: "relampago",
    name: "Relâmpago",
    role: "Interceptador",
    desc: "O mais rápido (1370 km/h), mísseis travam 35% mais longe e recarregam 25% mais rápido; curva aberta",
    flight: { ...PLAYER_JET, maxSpeed: 380, maxThrust: 46, pitchRate: 1.25, rollRate: 3, assistTurn: 0.6 },
    health: 95,
    armor: 1,
    stealth: 1,
    extraRails: 0,
    reloadMult: 1.25,
    groundGunMult: 0.9,
    missileRangeMult: 1.35,
    flares: 3,
    stats: [5, 2, 3, 2],
  },
};

export const FIGHTER_ORDER: readonly FighterId[] = ["falcao", "raptor", "javali", "relampago"];
