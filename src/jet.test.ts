import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { generateFieldTexture, generateLayout, BASES, FIELD_TEX } from "./fields";
import {
  PLAYER_JET,
  arcadeRoll,
  bankAngle,
  createFlightState,
  forwardOf,
  pitchAngle,
  stepFlight,
  type FlightControls,
} from "./flight";
import { segmentPointDistSq, turnToward } from "./math";
import { Terrain } from "./terrain";

const neutral = (throttle: number): FlightControls => ({ pitch: 0, roll: 0, yaw: 0, throttle, assist: false });
const run = (seconds: number, fn: () => void) => {
  for (let t = 0; t < seconds; t += 1 / 60) fn();
};

describe("modelo de voo", () => {
  it("em potência máxima nivelado converge para maxSpeed", () => {
    const s = createFlightState(new Vector3(0, 1000, 0), 0, 150, 1);
    run(60, () => stepFlight(s, neutral(1), 1 / 60, PLAYER_JET));
    expect(s.speed).toBeGreaterThan(PLAYER_JET.maxSpeed * 0.97);
    expect(s.speed).toBeLessThan(PLAYER_JET.maxSpeed * 1.01);
  });

  it("velocidade de equilíbrio escala com √potência", () => {
    const s = createFlightState(new Vector3(0, 1000, 0), 0, 200, 0.5);
    run(80, () => stepFlight(s, neutral(0.5), 1 / 60, PLAYER_JET));
    expect(s.speed).toBeCloseTo(PLAYER_JET.maxSpeed * Math.sqrt(0.5), -1);
  });

  it("puxar o manche faz subir; nariz segue o comando", () => {
    const s = createFlightState(new Vector3(0, 500, 0), 0, 220);
    run(1, () => stepFlight(s, { ...neutral(0.8), pitch: 1 }, 1 / 60, PLAYER_JET));
    expect(pitchAngle(s.quat)).toBeGreaterThan(0.5);
    expect(s.vel.y).toBeGreaterThan(50);
  });

  it("rolagem positiva abaixa a asa direita (inclinação positiva)", () => {
    const s = createFlightState(new Vector3(0, 500, 0), 0, 220);
    run(0.25, () => stepFlight(s, { ...neutral(0.8), roll: 1 }, 1 / 60, PLAYER_JET));
    expect(bankAngle(s.quat)).toBeGreaterThan(0.3);
  });

  it("modo arcade: inclinar já faz a proa girar para o lado da inclinação", () => {
    const s = createFlightState(new Vector3(0, 800, 0), 0, 220);
    run(3, () => {
      const roll = arcadeRoll(s.quat, 1);
      stepFlight(s, { pitch: 0, roll, yaw: 0, throttle: 0.8, assist: true }, 1 / 60, PLAYER_JET);
    });
    const f = forwardOf(s.quat, new Vector3());
    expect(f.x).toBeGreaterThan(0.3); // frente inicial é -Z; virar à direita leva a +X
    expect(bankAngle(s.quat)).toBeCloseTo(1.35, 0);
  });

  it("estol: sem potência e com nariz alto, o nariz cai", () => {
    const s = createFlightState(new Vector3(0, 2000, 0), 0, 60, 0);
    s.quat.setFromAxisAngle(new Vector3(1, 0, 0), 0.6);
    const before = pitchAngle(s.quat);
    run(3, () => stepFlight(s, neutral(0), 1 / 60, PLAYER_JET));
    expect(pitchAngle(s.quat)).toBeLessThan(before - 0.3);
  });

  it("quaternion permanece normalizado em manobras longas", () => {
    const s = createFlightState(new Vector3(0, 2000, 0), 0, 250);
    run(30, () => stepFlight(s, { pitch: 0.7, roll: 0.4, yaw: 0.2, throttle: 1, assist: true }, 1 / 60, PLAYER_JET));
    expect(s.quat.length()).toBeCloseTo(1, 6);
    expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z)).toBe(true);
  });
});

describe("terreno", () => {
  const t = new Terrain(32, 1000, (x, z) => Math.sin(x / 200) * 40 + z * 0.05);

  it("heightAt reproduz exatamente os vértices da malha", () => {
    for (const [i, j] of [[0, 0], [5, 7], [31, 31], [32, 32]] as const) {
      const x = -t.half + i * t.step;
      const z = -t.half + j * t.step;
      expect(t.heightAt(x, z)).toBeCloseTo(t.heights[j * 33 + i]!, 4);
    }
  });

  it("é contínuo através da diagonal dos triângulos", () => {
    const x0 = -t.half + 10 * t.step;
    const z0 = -t.half + 10 * t.step;
    const eps = 1e-3;
    const onDiag = (u: number) => [x0 + u * t.step, z0 + (1 - u) * t.step] as const;
    for (const u of [0.2, 0.5, 0.8]) {
      const [x, z] = onDiag(u);
      expect(t.heightAt(x - eps, z - eps)).toBeCloseTo(t.heightAt(x + eps, z + eps), 1);
    }
  });

  it("fora do mapa usa a borda (sem NaN)", () => {
    expect(Number.isFinite(t.heightAt(1e6, -1e6))).toBe(true);
  });
});

describe("geometria de armas", () => {
  it("segmento detecta alvo que um teste de ponto final perderia", () => {
    const a = new Vector3(0, 0, -20);
    const b = new Vector3(0, 0, 20);
    expect(segmentPointDistSq(a, b, new Vector3(3, 0, 0))).toBeCloseTo(9);
    expect(segmentPointDistSq(a, b, new Vector3(0, 0, 30))).toBeCloseTo(100);
  });

  it("turnToward respeita o limite de ângulo e converge", () => {
    const dir = new Vector3(0, 0, -1);
    const want = new Vector3(1, 0, 0);
    const left = turnToward(dir, want, 0.1);
    expect(left).toBeCloseTo(Math.PI / 2 - 0.1, 5);
    expect(dir.length()).toBeCloseTo(1, 6);
    for (let k = 0; k < 20; k++) turnToward(dir, want, 0.1);
    expect(dir.distanceTo(want)).toBeLessThan(1e-6);
  });

  it("turnToward lida com direções opostas", () => {
    const dir = new Vector3(0, 0, -1);
    turnToward(dir, new Vector3(0, 0, 1), 0.2);
    expect(dir.angleTo(new Vector3(0, 0, -1))).toBeCloseTo(0.2, 5);
  });
});

describe("lavouras", () => {
  const layout = generateLayout();

  it("layout é determinístico", () => {
    expect(generateLayout()).toEqual(layout);
  });

  it("nenhuma fazenda dentro de base inimiga", () => {
    for (const f of layout.farmsteads) {
      for (const b of BASES) expect(Math.hypot(f.x - b.x, f.z - b.z)).toBeGreaterThan(200);
    }
  });

  it("textura tem o tamanho esperado e alfa só nos valores de fileira", () => {
    const data = generateFieldTexture(layout);
    expect(data.length).toBe(FIELD_TEX * FIELD_TEX * 4);
    const alphas = new Set<number>();
    for (let i = 3; i < data.length; i += 4 * 97) alphas.add(data[i]!);
    for (const a of alphas) expect([0, 128, 255]).toContain(a);
  });
});
