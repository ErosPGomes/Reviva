import { FIGHTERS, type FighterId } from "./fighters";
import { GUNS, MISSILES, type GunId, type MissileId } from "./loadout";

/**
 * Fichas comparativas do hangar (menu). Cada linha é normalizada pelo melhor valor entre as opções da mesma
 * categoria, então as barras mostram a diferença entre escolhas, não números absolutos sem contexto.
 */
export interface StatRow {
  readonly label: string;
  readonly value: number; // 0..1
  readonly text: string;
}

const num = (v: number, digits = 1): string => v.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const km = (m: number): string => `${num(m / 1000)} km`;
const norm = (v: number, max: number): number => Math.max(0.04, Math.min(1, v / max));

/** Foguetes não guiados: alcance útil estimado pelo voo balístico com motor (~1,5 km). */
const UNGUIDED_RANGE = 1500;

export function fighterRows(id: FighterId): StatRow[] {
  const f = FIGHTERS[id];
  const maxSpeed = Math.max(...Object.values(FIGHTERS).map((x) => x.flight.maxSpeed));
  const maxHp = Math.max(...Object.values(FIGHTERS).map((x) => x.health));
  return [
    { label: "Velocidade", value: norm(f.flight.maxSpeed, maxSpeed), text: `${Math.round(f.flight.maxSpeed * 3.6)} km/h` },
    { label: "Agilidade", value: f.stats[1] / 5, text: `${Math.round((f.flight.pitchRate * 180) / Math.PI)}°/s` },
    { label: "Blindagem", value: norm(f.health / f.armor, maxHp / 0.7), text: `${f.health} HP` },
    { label: "Ataque ao solo", value: f.stats[3] / 5, text: `×${num(f.groundGunMult)} canhão` },
    { label: "Furtividade", value: norm(f.stealth, 1.8), text: f.stealth > 1 ? `trava ${Math.round((f.stealth - 1) * 100)}% + lenta` : f.stealth < 1 ? "fácil de travar" : "padrão" },
  ];
}

export function missileRows(id: MissileId): StatRow[] {
  const m = MISSILES[id];
  const all = Object.values(MISSILES);
  const maxRange = Math.max(...all.map((x) => x.range));
  const maxDmg = Math.max(...all.map((x) => x.spec.damage * x.salvo));
  const maxSplash = Math.max(...all.map((x) => x.spec.splash));
  const range = m.guided ? m.range : UNGUIDED_RANGE;
  return [
    { label: "Alcance", value: norm(range, maxRange), text: m.guided ? km(range) : `~${km(range)}` },
    { label: "Trava", value: m.guided ? norm(2.4 - m.lockTime, 2.4 - 0.8) : 0, text: m.guided ? `${num(m.lockTime)} s` : "sem trava" },
    { label: "Dano", value: norm(m.spec.damage * m.salvo, maxDmg), text: m.salvo > 1 ? `${m.salvo} × ${m.spec.damage}` : String(m.spec.damage) },
    { label: "Raio", value: norm(m.spec.splash, maxSplash), text: `${m.spec.splash} m` },
    { label: "Contra flares", value: m.guided ? m.spec.flareResist : 1, text: m.guided ? `${Math.round(m.spec.flareResist * 100)}%` : "imune" },
    { label: "Recarga", value: norm(12 - m.reload, 12 - 5.5), text: `${num(m.reload)} s × ${m.rails} trilhos` },
  ];
}

export function missileTargets(id: MissileId): string {
  const t = MISSILES[id].targets;
  return t === "air" ? "Só alvos aéreos" : t === "ground" ? "Só alvos em solo" : "Ar e solo";
}

export function gunRows(id: GunId): StatRow[] {
  const g = GUNS[id];
  const all = Object.values(GUNS);
  const rate = (x: (typeof all)[number]) => 1 / x.interval;
  const dps = (x: (typeof all)[number]) => x.damage / x.interval;
  const burst = (x: (typeof all)[number]) => 1 / x.heat;
  return [
    { label: "Cadência", value: norm(rate(g), Math.max(...all.map(rate))), text: `${Math.round(rate(g) * 60)} tiros/min` },
    { label: "Dano/tiro", value: norm(g.damage + g.splash * 0.4, Math.max(...all.map((x) => x.damage + x.splash * 0.4))), text: g.splash ? `${num(g.damage)} + estilhaço` : num(g.damage) },
    { label: "Alcance", value: norm(g.speed * g.life, Math.max(...all.map((x) => x.speed * x.life))), text: km(g.speed * g.life) },
    { label: "Rajada", value: norm(burst(g), Math.max(...all.map(burst))), text: `~${Math.round(burst(g))} tiros até aquecer` },
    { label: "Dano/s", value: norm(dps(g), Math.max(...all.map(dps))), text: `${Math.round(dps(g))}` },
  ];
}
