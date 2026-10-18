/**
 * Conquistas permanentes (salvas no navegador). A principal, Guardião da Frota, libera de vez a salva de
 * mísseis do porta-aviões; as outras marcam marcos da campanha naval.
 */
export type AchievementId = "catapulta" | "guardiao" | "almirante";

export interface AchievementSpec {
  readonly title: string;
  readonly desc: string;
  readonly reward: string; // menu, depois de obtida
  readonly hud: string; // linha curta do aviso em jogo
  readonly icon: string;
}

export const ACHIEVEMENTS: Record<AchievementId, AchievementSpec> = {
  catapulta: { title: "Catapulta!", desc: "Decole do porta-aviões", reward: "Asas de convés", hud: "Primeira decolagem do porta-aviões", icon: "🛫" },
  guardiao: {
    title: "Guardião da Frota",
    desc: "Derrube 3 caças em sequência",
    reward: "Salva naval liberada: V lança 4 mísseis do porta-aviões contra os inimigos",
    hud: "Salva naval liberada · V lança 4 mísseis do porta-aviões",
    icon: "🛡️",
  },
  almirante: { title: "Fogo do Almirante", desc: "Abata um caça com a salva naval", reward: "Medalha naval", hud: "Abate com míssil do porta-aviões", icon: "⚓" },
};

export const ACHIEVEMENT_ORDER: readonly AchievementId[] = ["catapulta", "guardiao", "almirante"];

/** Abates seguidos que contam como "sequência" para a conquista e para recarregar a salva. */
export const NAVAL_STREAK = 3;

/** Salvas no início da surtida: 1 se a conquista já foi obtida, senão nenhuma (a salva está bloqueada). */
export const startingCharges = (unlocked: ReadonlySet<AchievementId>): number => (unlocked.has("guardiao") ? 1 : 0);

/** A sequência rende uma salva a cada múltiplo de NAVAL_STREAK (3, 6, 9…). */
export const streakGrantsCharge = (streak: number): boolean => streak > 0 && streak % NAVAL_STREAK === 0;

export function parseAchievements(raw: unknown): Set<AchievementId> {
  const out = new Set<AchievementId>();
  if (Array.isArray(raw)) for (const v of raw) if (typeof v === "string" && v in ACHIEVEMENTS) out.add(v as AchievementId);
  return out;
}
