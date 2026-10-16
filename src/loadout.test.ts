import { describe, expect, it } from "vitest";
import { BOOSTS, BOOST_ORDER, DIFFICULTIES, GUNS, GUN_ORDER, MISSILES, MISSILE_ORDER } from "./loadout";

/** Invariantes de design: se alguém mexer nos números, o teste avisa quando um trade-off deixa de existir. */
describe("dificuldade", () => {
  const [easy, normal, hard] = [DIFFICULTIES.recruta, DIFFICULTIES.piloto, DIFFICULTIES.as];

  it("escala de forma monotônica do Recruta ao Ás", () => {
    for (const k of ["skillOffset", "enemyDamage", "aaDamage", "damageTaken", "regenDelay", "extraEnemies", "scoreMult"] as const) {
      expect(easy[k]).toBeLessThan(normal[k]);
      expect(normal[k]).toBeLessThan(hard[k]);
    }
    expect(easy.regenRate).toBeGreaterThan(hard.regenRate);
    for (const k of ["enemyAgility", "enemySpeed", "attackers", "enemyGunCone", "enemyGunRange", "lockMult"] as const) {
      expect(easy[k]).toBeLessThan(normal[k]);
      expect(normal[k]).toBeLessThan(hard[k]);
    }
    for (const k of ["aimAssist", "aimAssistCone", "hitScale", "enemyMissileCooldown"] as const) {
      expect(easy[k]).toBeGreaterThan(normal[k]);
      expect(normal[k]).toBeGreaterThan(hard[k]);
    }
    expect(easy.aaCooldown).toBeGreaterThan(hard.aaCooldown);
  });
});

describe("vantagem do jogador", () => {
  it("no Recruta e no Piloto o jogador curva mais que o inimigo", async () => {
    const { PLAYER_JET, ENEMY_JET } = await import("./flight");
    for (const d of [DIFFICULTIES.recruta, DIFFICULTIES.piloto]) {
      expect(PLAYER_JET.pitchRate).toBeGreaterThan(ENEMY_JET.pitchRate * d.enemyAgility * 1.4);
      expect(PLAYER_JET.maxSpeed).toBeGreaterThan(ENEMY_JET.maxSpeed * d.enemySpeed);
    }
  });
});

describe("metralhadoras", () => {
  const dps = (id: (typeof GUN_ORDER)[number]) => GUNS[id].damage / GUNS[id].interval;
  const burst = (id: (typeof GUN_ORDER)[number]) => 1 / GUNS[id].heat; // tiros até superaquecer
  const range = (id: (typeof GUN_ORDER)[number]) => GUNS[id].speed * GUNS[id].life;

  it("cada calibre tem uma vantagem própria", () => {
    expect(GUNS.cal30.interval).toBeLessThan(GUNS.cal50.interval); // .30 = maior cadência
    expect(burst("cal30")).toBeGreaterThan(burst("cal50")); // .30 = aquece mais devagar
    expect(range("cal50")).toBeGreaterThan(range("cal30")); // .50 = maior alcance
    expect(range("cal50")).toBeGreaterThan(range("m61"));
    expect(dps("m61")).toBeGreaterThan(dps("cal50")); // 20 mm = maior DPS
    expect(burst("m61")).toBeLessThan(burst("cal50")); // ...mas superaquece rápido
    expect(GUNS.m61.splash).toBeGreaterThan(0);
  });
});

describe("mísseis", () => {
  it("radar alcança mais e resiste a flares; IR trava mais rápido", () => {
    expect(MISSILES.radar.range).toBeGreaterThan(MISSILES.ir.range);
    expect(MISSILES.radar.spec.flareResist).toBeGreaterThan(MISSILES.ir.spec.flareResist);
    expect(MISSILES.ir.lockTime).toBeLessThan(MISSILES.radar.lockTime);
  });

  it("AGM só trava em solo e tem a maior ogiva", () => {
    expect(MISSILES.agm.targets).toBe("ground");
    for (const id of MISSILE_ORDER) expect(MISSILES.agm.spec.splash).toBeGreaterThanOrEqual(MISSILES[id].spec.splash);
  });

  it("foguetes não são guiados e saem em salva", () => {
    expect(MISSILES.rockets.guided).toBe(false);
    expect(MISSILES.rockets.salvo).toBeGreaterThan(1);
  });

  it("todo tipo tem ao menos um trilho e recarga positiva", () => {
    for (const id of MISSILE_ORDER) {
      expect(MISSILES[id].rails).toBeGreaterThanOrEqual(1);
      expect(MISSILES[id].reload).toBeGreaterThan(0);
    }
  });
});

describe("boosts", () => {
  it("teto acumulado nunca é menor que uma ativação", () => {
    for (const id of BOOST_ORDER) expect(BOOSTS[id].max).toBeGreaterThanOrEqual(BOOSTS[id].duration);
  });
});
