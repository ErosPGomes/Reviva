import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PHASES, objectiveStatus, phaseComplete, type Counters } from "./campaign";
import { FIGHTERS, FIGHTER_ORDER } from "./fighters";
import { crossesRing } from "./rings";

const counters = (o: Partial<Counters> = {}): Counters => ({ kills: 0, ground: 0, rings: 0, bossDown: false, captured: new Set(), ...o });

describe("campanha", () => {
  it("tem 5 fases e termina no chefe", () => {
    expect(PHASES).toHaveLength(5);
    expect(PHASES[4]!.boss).toBe(true);
    expect(PHASES.slice(0, 4).every((p) => !p.boss)).toBe(true);
  });

  it("abates contam só a partir do início da fase", () => {
    const start = counters({ kills: 5 });
    const st = objectiveStatus({ kind: "kills", count: 3 }, counters({ kills: 7 }), start);
    expect(st.current).toBe(2);
    expect(st.done).toBe(false);
    expect(objectiveStatus({ kind: "kills", count: 3 }, counters({ kills: 8 }), start).done).toBe(true);
  });

  it("bases contam pelo estado atual e exigem todas as listadas", () => {
    const o = { kind: "bases", ids: ["B", "C"] } as const;
    expect(objectiveStatus(o, counters({ captured: new Set(["B"]) }), counters()).done).toBe(false);
    expect(objectiveStatus(o, counters({ captured: new Set(["B", "C"]) }), counters()).done).toBe(true);
  });

  it("fase só conclui com todos os objetivos", () => {
    const ph = PHASES[1]!; // anéis + alvos em solo
    expect(phaseComplete(ph, counters({ rings: 3 }), counters())).toBe(false);
    expect(phaseComplete(ph, counters({ rings: 3, ground: 4 }), counters())).toBe(true);
  });

  it("progresso nunca passa do necessário", () => {
    expect(objectiveStatus({ kind: "ground", count: 4 }, counters({ ground: 99 }), counters()).current).toBe(4);
  });
});

describe("anéis", () => {
  const c = new Vector3(0, 100, 0);
  const n = new Vector3(0, 0, 1);

  it("detecta travessia pelo centro mesmo com passo grande (10 m/quadro)", () => {
    expect(crossesRing(new Vector3(0, 100, -5), new Vector3(0, 100, 5), c, n, 30)).toBe(true);
  });

  it("ignora passagem por fora do raio", () => {
    expect(crossesRing(new Vector3(40, 100, -5), new Vector3(40, 100, 5), c, n, 30)).toBe(false);
  });

  it("ignora movimento paralelo ao plano longe do centro", () => {
    expect(crossesRing(new Vector3(-5, 100, 25), new Vector3(5, 100, 25), c, n, 30)).toBe(false);
  });

  it("conta passagem de raspão perto do centro", () => {
    expect(crossesRing(new Vector3(-5, 100, 8), new Vector3(5, 100, 8), c, n, 30)).toBe(true);
  });
});

describe("caças", () => {
  const by = <K extends keyof (typeof FIGHTERS)["falcao"]>(k: K) => FIGHTER_ORDER.map((id) => FIGHTERS[id][k]);

  it("cada caça é o melhor em algo e paga por isso", () => {
    const speed = FIGHTER_ORDER.map((id) => FIGHTERS[id].flight.maxSpeed);
    const pitch = FIGHTER_ORDER.map((id) => FIGHTERS[id].flight.pitchRate);
    expect(Math.max(...speed)).toBe(FIGHTERS.relampago.flight.maxSpeed);
    expect(Math.min(...pitch)).toBe(FIGHTERS.relampago.flight.pitchRate);
    expect(Math.max(...pitch)).toBe(FIGHTERS.raptor.flight.pitchRate);
    expect(Math.min(...(by("health") as number[]))).toBe(FIGHTERS.raptor.health);
    expect(Math.max(...(by("health") as number[]))).toBe(FIGHTERS.javali.health);
    expect(Math.min(...speed)).toBe(FIGHTERS.javali.flight.maxSpeed);
    expect(FIGHTERS.javali.groundGunMult).toBeGreaterThan(1);
    expect(FIGHTERS.raptor.stealth).toBeGreaterThan(1);
  });
});
