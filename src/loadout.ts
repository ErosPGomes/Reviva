import type { MissileSpec } from "./weapons";

/**
 * Tabelas de balanceamento num único módulo: dificuldade, armas e boosts são dados, não código espalhado.
 * Ajustar o jogo = editar números aqui; a lógica em game.ts só consulta.
 */

/* ---------------- Dificuldade ---------------- */

export type Difficulty = "recruta" | "piloto" | "as";

export interface DifficultySpec {
  readonly label: string;
  readonly desc: string;
  readonly skillOffset: number; // somado à habilidade da IA (0..1)
  readonly enemyDamage: number; // multiplicador do canhão inimigo
  readonly aaDamage: number;
  readonly aaCooldown: number; // multiplicador do intervalo entre rajadas (menor = mais fogo)
  readonly damageTaken: number; // multiplicador final de dano no jogador
  readonly regenDelay: number; // s sem levar dano até começar a reparar
  readonly regenRate: number; // HP/s
  readonly extraEnemies: number;
  readonly scoreMult: number;
  /* Sensação de combate (o que decide se dá para vencer, não só quanto dano se leva) */
  readonly enemyAgility: number; // × taxas de arfagem/rolagem do caça inimigo
  readonly enemySpeed: number; // × velocidade máxima do inimigo
  readonly attackers: number; // quantos inimigos atacam ao mesmo tempo; os demais orbitam à distância
  readonly enemyGunCone: number; // × cone em que a IA aceita atirar
  readonly enemyGunRange: number; // m
  readonly enemyMissileCooldown: number; // × intervalo entre mísseis inimigos
  readonly aimAssist: number; // 0..1: quanto a rajada do jogador é puxada para o ponto de antecipação
  readonly aimAssistCone: number; // rad em que a assistência atua
  readonly hitScale: number; // × raio de acerto das balas do jogador
  readonly lockMult: number; // × tempo de trava dos mísseis do jogador
  readonly autoGcas: boolean; // recuperação automática antes de colidir com o terreno
}

export const DIFFICULTIES: Record<Difficulty, DifficultySpec> = {
  recruta: {
    label: "Recruta",
    desc: "Inimigos lentos para travar, antiaérea fraca, reparo rápido",
    skillOffset: -0.18,
    enemyDamage: 0.6,
    aaDamage: 0.55,
    aaCooldown: 1.4,
    damageTaken: 0.6,
    regenDelay: 4,
    regenRate: 8,
    extraEnemies: -1,
    scoreMult: 0.75,
    enemyAgility: 0.7,
    enemySpeed: 0.88,
    attackers: 1,
    enemyGunCone: 0.55,
    enemyGunRange: 650,
    enemyMissileCooldown: 2,
    aimAssist: 0.85,
    aimAssistCone: 0.14,
    hitScale: 1.6,
    lockMult: 0.55,
    autoGcas: true,
  },
  piloto: {
    label: "Piloto",
    desc: "Equilibrado",
    skillOffset: 0,
    enemyDamage: 1,
    aaDamage: 1,
    aaCooldown: 1,
    damageTaken: 1,
    regenDelay: 6,
    regenRate: 5,
    extraEnemies: 0,
    scoreMult: 1,
    enemyAgility: 0.85,
    enemySpeed: 0.95,
    attackers: 2,
    enemyGunCone: 0.8,
    enemyGunRange: 850,
    enemyMissileCooldown: 1.3,
    aimAssist: 0.55,
    aimAssistCone: 0.09,
    hitScale: 1.3,
    lockMult: 0.75,
    autoGcas: true,
  },
  as: {
    label: "Ás",
    desc: "IA agressiva, mais caças por onda, reparo lento",
    skillOffset: 0.2,
    enemyDamage: 1.35,
    aaDamage: 1.3,
    aaCooldown: 0.75,
    damageTaken: 1.25,
    regenDelay: 9,
    regenRate: 3,
    extraEnemies: 1,
    scoreMult: 1.5,
    enemyAgility: 1.05,
    enemySpeed: 1.02,
    attackers: 99,
    enemyGunCone: 1,
    enemyGunRange: 1000,
    enemyMissileCooldown: 0.9,
    aimAssist: 0.2,
    aimAssistCone: 0.05,
    hitScale: 1.1,
    lockMult: 1,
    autoGcas: false,
  },
};

/* ---------------- Metralhadoras ---------------- */

export type GunId = "cal30" | "cal50" | "m61";

export interface GunSpec {
  readonly id: GunId;
  readonly short: string;
  readonly name: string;
  readonly desc: string;
  readonly interval: number; // s entre disparos
  readonly damage: number;
  readonly speed: number; // m/s de boca
  readonly spread: number; // rad
  readonly heat: number; // por disparo; 1 = superaquecido
  readonly life: number; // s de voo do projétil (define o alcance)
  readonly color: number;
  readonly splash: number; // raio de estilhaço (0 = sem)
}

/*
 * Trade-offs (DPS sustentado até superaquecer, alcance = speed × life):
 * .30  → 30 tiros/s, fácil de acertar, aquece devagar (~100 tiros), alcance ~1,3 km
 * .50  → 15 tiros/s, dano alto por tiro, maior alcance (~2 km)
 * 20mm → explosivo com estilhaço, maior DPS, mas aquece em ~1,5 s
 */
export const GUNS: Record<GunId, GunSpec> = {
  cal30: {
    id: "cal30",
    short: ".30",
    name: "Metralhadora .30",
    desc: "7,62 mm · cadência alta, aquece devagar",
    interval: 1 / 30,
    damage: 4.5,
    speed: 950,
    spread: 0.0055,
    heat: 0.0105,
    life: 1.4,
    color: 0xfff1b8,
    splash: 0,
  },
  cal50: {
    id: "cal50",
    short: ".50",
    name: "Metralhadora .50",
    desc: "12,7 mm · dano alto, maior alcance",
    interval: 1 / 15,
    damage: 10.5,
    speed: 900,
    spread: 0.004,
    heat: 0.02,
    life: 2.2,
    color: 0xffd38a,
    splash: 0,
  },
  m61: {
    id: "m61",
    short: "20mm",
    name: "Canhão 20 mm",
    desc: "Explosivo · maior dano, superaquece rápido",
    interval: 1 / 22,
    damage: 12,
    speed: 1050,
    spread: 0.006,
    heat: 0.03,
    life: 1.8,
    color: 0xff9a5a,
    splash: 7,
  },
};

export const GUN_ORDER: readonly GunId[] = ["cal30", "cal50", "m61"];

/* ---------------- Mísseis ---------------- */

export type MissileId = "ir" | "radar" | "agm" | "rockets";

export interface MissileLoadout {
  readonly id: MissileId;
  readonly short: string;
  readonly name: string;
  readonly desc: string;
  readonly guided: boolean;
  readonly targets: "air" | "ground" | "any";
  readonly lockTime: number;
  readonly range: number;
  readonly cone: number; // rad do eixo para iniciar a trava
  readonly rails: number;
  readonly reload: number;
  readonly salvo: number; // projéteis por disparo
  readonly spec: MissileSpec;
}

export const MISSILES: Record<MissileId, MissileLoadout> = {
  ir: {
    id: "ir",
    short: "IR",
    name: "Víbora IR",
    desc: "Infravermelho · trava rápida, curto alcance, sensível a flares",
    guided: true,
    targets: "any",
    lockTime: 1,
    range: 3200,
    cone: 0.3,
    rails: 2,
    reload: 5.5,
    salvo: 1,
    spec: { damage: 100, maxSpeed: 720, turnRate: 0.95, gimbal: 1.3, flareResist: 0.15, splash: 30, motorTime: 2.6 },
  },
  radar: {
    id: "radar",
    short: "RDR",
    name: "Lança Radar",
    desc: "Radar ativo · 6 km, ignora a maioria dos flares, trava lenta",
    guided: true,
    targets: "air",
    lockTime: 2,
    range: 6000,
    cone: 0.24,
    rails: 2,
    reload: 9,
    salvo: 1,
    spec: { damage: 100, maxSpeed: 900, turnRate: 0.62, gimbal: 1, flareResist: 0.75, splash: 30, motorTime: 4 },
  },
  agm: {
    id: "agm",
    short: "AGM",
    name: "Martelo Ar-Solo",
    desc: "Só alvos em solo · ogiva pesada, raio de 60 m",
    guided: true,
    targets: "ground",
    lockTime: 0.8,
    range: 3600,
    cone: 0.36,
    rails: 2,
    reload: 6,
    salvo: 1,
    spec: { damage: 220, maxSpeed: 520, turnRate: 1.2, gimbal: 1.5, flareResist: 1, splash: 60, motorTime: 3.5 },
  },
  rockets: {
    id: "rockets",
    short: "FGT",
    name: "Enxame de Foguetes",
    desc: "Não guiados · salva de 8, bom contra blindados e bases",
    guided: false,
    targets: "any",
    lockTime: 0,
    range: 0,
    cone: 0,
    rails: 1,
    reload: 6,
    salvo: 8,
    spec: { damage: 40, maxSpeed: 700, turnRate: 0, gimbal: 0, flareResist: 1, splash: 20, motorTime: 1.2 },
  },
};

export const MISSILE_ORDER: readonly MissileId[] = ["ir", "radar", "agm", "rockets"];

/* ---------------- Boosts ---------------- */

export type BoostId = "speed" | "damage" | "reload" | "shield";

export interface BoostSpec {
  readonly label: string;
  readonly short: string;
  readonly color: string;
  readonly duration: number;
  readonly max: number; // teto acumulado ao renovar
}

export const BOOSTS: Record<BoostId, BoostSpec> = {
  speed: { label: "Pós-combustão extra", short: "VEL", color: "#6db4ff", duration: 10, max: 20 },
  damage: { label: "Munição perfurante", short: "DAN", color: "#ff7a45", duration: 12, max: 24 },
  reload: { label: "Recarga rápida", short: "REC", color: "#5fe3cf", duration: 12, max: 24 },
  shield: { label: "Blindagem reativa", short: "BLD", color: "#e8d36a", duration: 10, max: 20 },
};

export const BOOST_ORDER: readonly BoostId[] = ["speed", "damage", "reload", "shield"];

/** Efeitos numéricos dos boosts (lidos pelo jogo a cada quadro). */
export const BOOST_FX = {
  speedMax: 1.3, // × velocidade máxima
  speedThrust: 1.75, // × empuxo (aceleração percebida)
  damage: 1.5,
  reloadRate: 3, // × velocidade de recarga dos trilhos
  heatRate: 0.5, // × calor por disparo
  shield: 0.4, // × dano recebido
  streakWindow: 25, // s sem abate até zerar a sequência
} as const;
