/**
 * Campanha em 5 fases com objetivos. Funções puras (sem three.js): o progresso é calculado a partir de
 * contadores, então é testável sem renderizar nada.
 */

export type Objective =
  | { readonly kind: "kills"; readonly count: number }
  | { readonly kind: "ground"; readonly count: number }
  | { readonly kind: "rings"; readonly count: number }
  | { readonly kind: "bases"; readonly ids: readonly string[] }
  | { readonly kind: "boss" };

export interface PhaseSpec {
  readonly title: string;
  readonly brief: string;
  readonly objectives: readonly Objective[];
  /** Caças inimigos simultâneos (repostos ao serem abatidos). */
  readonly enemies: number;
  readonly skill: number; // habilidade base da IA nesta fase (somada à dificuldade)
  readonly boss: boolean;
}

export const PHASES: readonly PhaseSpec[] = [
  {
    title: "Primeiro contato",
    brief: "Uma patrulha inimiga cruza as lavouras. Derrube 3 caças.",
    objectives: [{ kind: "kills", count: 3 }],
    enemies: 2,
    skill: 0.25,
    boss: false,
  },
  {
    title: "Rota dos anéis",
    brief: "Atravesse 3 anéis de suprimento e destrua 4 alvos em solo.",
    objectives: [
      { kind: "rings", count: 3 },
      { kind: "ground", count: 4 },
    ],
    enemies: 1,
    skill: 0.3,
    boss: false,
  },
  {
    title: "Silêncio na base A",
    brief: "Neutralize a base A. Use o drone se a antiaérea apertar.",
    objectives: [{ kind: "bases", ids: ["A"] }],
    enemies: 2,
    skill: 0.4,
    boss: false,
  },
  {
    title: "Tempestade",
    brief: "Neutralize as bases B e C e derrube 4 caças da escolta.",
    objectives: [
      { kind: "bases", ids: ["B", "C"] },
      { kind: "kills", count: 4 },
    ],
    enemies: 3,
    skill: 0.5,
    boss: false,
  },
  {
    title: "O Ás inimigo",
    brief: "O comandante inimigo decolou. Derrube o Ás Lâmina.",
    objectives: [{ kind: "boss" }],
    enemies: 2,
    skill: 0.6,
    boss: true,
  },
];

export interface Counters {
  kills: number;
  ground: number;
  rings: number;
  bossDown: boolean;
  captured: ReadonlySet<string>;
}

export interface ObjectiveStatus {
  readonly label: string;
  readonly current: number;
  readonly need: number;
  readonly done: boolean;
}

/** `start` = contadores no início da fase; abates/alvos/anéis contam só a partir dali. Bases contam pelo estado atual. */
export function objectiveStatus(o: Objective, now: Counters, start: Counters): ObjectiveStatus {
  switch (o.kind) {
    case "kills": {
      const cur = Math.min(o.count, now.kills - start.kills);
      return { label: "Caças abatidos", current: cur, need: o.count, done: cur >= o.count };
    }
    case "ground": {
      const cur = Math.min(o.count, now.ground - start.ground);
      return { label: "Alvos em solo", current: cur, need: o.count, done: cur >= o.count };
    }
    case "rings": {
      const cur = Math.min(o.count, now.rings - start.rings);
      return { label: "Anéis", current: cur, need: o.count, done: cur >= o.count };
    }
    case "bases": {
      const cur = o.ids.filter((id) => now.captured.has(id)).length;
      return { label: `Base${o.ids.length > 1 ? "s" : ""} ${o.ids.join(" e ")}`, current: cur, need: o.ids.length, done: cur >= o.ids.length };
    }
    case "boss":
      return { label: "Ás Lâmina", current: now.bossDown ? 1 : 0, need: 1, done: now.bossDown };
  }
}

export function phaseComplete(p: PhaseSpec, now: Counters, start: Counters): boolean {
  return p.objectives.every((o) => objectiveStatus(o, now, start).done);
}
