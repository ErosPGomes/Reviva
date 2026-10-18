import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_ORDER, parseAchievements, startingCharges, streakGrantsCharge } from "./achievements";
import { CARRIER_POS, CATAPULT, CATAPULT_ACCEL, DECK_Y } from "./carrier";
import { PLAYER_JET } from "./flight";
import { FIGHTER_ORDER } from "./fighters";
import { GUN_ORDER, MISSILES, MISSILE_ORDER } from "./loadout";
import { NAVAL, pickNavalTargets } from "./naval";
import { fighterRows, gunRows, missileRows } from "./stats";
import { LAKE, Terrain, WATER_LEVEL } from "./terrain";
import type { Combatant } from "./types";

const unit = (team: "red" | "blue", kind: "air" | "ground", x: number, alive = true): Combatant => ({
  team,
  kind,
  radius: 5,
  position: new Vector3(x, 0, 0),
  velocity: new Vector3(),
  isAlive: () => alive,
});

describe("salva naval", () => {
  const from = new Vector3(0, 0, 0);

  it("prioriza caças vivos, do mais perto para o mais longe", () => {
    const far = unit("red", "air", 900);
    const near = unit("red", "air", 200);
    const tank = unit("red", "ground", 50);
    const picked = pickNavalTargets([far, tank, near, unit("red", "air", 10, false), unit("blue", "air", 5)], from, 2);
    expect(picked).toEqual([near, far]);
  });

  it("sem caças, mira alvos em solo; com poucos alvos, repete a lista", () => {
    const a = unit("red", "ground", 300);
    const b = unit("red", "ground", 100);
    expect(pickNavalTargets([a, b], from, NAVAL.salvo)).toEqual([b, a, b, a]);
  });

  it("sem inimigos não gasta a salva", () => {
    expect(pickNavalTargets([unit("blue", "air", 1)], from, 4)).toEqual([]);
  });
});

describe("conquistas", () => {
  it("salva começa bloqueada e a conquista Guardião dá 1 por surtida", () => {
    expect(startingCharges(new Set())).toBe(0);
    expect(startingCharges(new Set(["guardiao"]))).toBe(1);
  });

  it("cada 3 abates seguidos rendem uma salva", () => {
    expect([1, 2, 3, 4, 5, 6].map(streakGrantsCharge)).toEqual([false, false, true, false, false, true]);
  });

  it("ignora valores salvos inválidos", () => {
    expect([...parseAchievements(["guardiao", "xyz", 3, "catapulta"])]).toEqual(["guardiao", "catapulta"]);
    expect(parseAchievements("lixo").size).toBe(0);
    expect(ACHIEVEMENT_ORDER).toContain("guardiao");
  });
});

describe("porta-aviões e baía", () => {
  const t = new Terrain();

  it("a superfície da baía é a água (colisão), mas o fundo desenhado fica bem abaixo", () => {
    expect(t.heightAt(LAKE.x, LAKE.z)).toBe(WATER_LEVEL);
    expect(t.groundAt(LAKE.x, LAKE.z)).toBeLessThan(WATER_LEVEL - 8);
  });

  it("o navio está na água e o convés fica acima dela", () => {
    expect(t.heightAt(CARRIER_POS.x, CARRIER_POS.z)).toBe(WATER_LEVEL);
    expect(t.heightAt(CARRIER_POS.x, CARRIER_POS.z + CATAPULT.z1 - 1200)).toBe(WATER_LEVEL); // 1,2 km de água livre à frente da proa
    expect(DECK_Y - WATER_LEVEL).toBeGreaterThan(15);
  });

  it("a catapulta lança acima da velocidade de estol de todos os caças", () => {
    const run = CATAPULT.z0 - CATAPULT.z1;
    const v = Math.sqrt(2 * CATAPULT_ACCEL * run);
    expect(v).toBeGreaterThan(PLAYER_JET.minSpeed);
    expect(v).toBeGreaterThan(55 + 20); // Javali (o mais lento) com folga
  });
});

describe("fichas do hangar", () => {
  it("todas as barras ficam entre 0 e 1 e o melhor de cada linha chega a 1", () => {
    const sets = [FIGHTER_ORDER.map(fighterRows), MISSILE_ORDER.map(missileRows), GUN_ORDER.map(gunRows)];
    for (const rows of sets) {
      for (const list of rows) for (const r of list) expect(r.value).toBeGreaterThanOrEqual(0), expect(r.value).toBeLessThanOrEqual(1);
    }
    const ranges = MISSILE_ORDER.map((id) => missileRows(id)[0]!.value);
    expect(Math.max(...ranges)).toBe(1);
  });

  it("foguetes não guiados aparecem sem trava", () => {
    expect(MISSILES.rockets.guided).toBe(false);
    expect(missileRows("rockets")[1]!.text).toBe("sem trava");
  });
});
