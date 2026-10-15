import { Vector3 } from "three";

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Fator de suavização exponencial independente de FPS: 1 - e^(-k·dt). Um lerp com t fixo varia com a taxa de quadros. */
export const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);

export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
export const randSigned = (): number => Math.random() * 2 - 1;

/** Vetor unitário uniforme na esfera (método de Marsaglia via z uniforme), sem rejeição. */
export function randomUnit(out: Vector3): Vector3 {
  const z = randSigned();
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

const _ab = new Vector3();
const _ac = new Vector3();

/**
 * Distância² do ponto `c` ao segmento `ab`. Projéteis andam 15–20 m por quadro; testar só a posição final
 * deixaria balas atravessarem alvos de 9 m de raio ("tunneling"). O teste por segmento é O(1) e elimina isso.
 */
export function segmentPointDistSq(a: Vector3, b: Vector3, c: Vector3): number {
  _ab.subVectors(b, a);
  _ac.subVectors(c, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-9 ? clamp(_ac.dot(_ab) / len2, 0, 1) : 0;
  return _ac.addScaledVector(_ab, -t).lengthSq();
}

const _axis = new Vector3();

/** Gira `dir` (unitário) em direção a `desired` (unitário) por no máximo `maxAngle` rad. Retorna o ângulo restante. */
export function turnToward(dir: Vector3, desired: Vector3, maxAngle: number): number {
  const angle = dir.angleTo(desired);
  if (angle <= maxAngle) {
    dir.copy(desired);
    return 0;
  }
  _axis.crossVectors(dir, desired);
  if (_axis.lengthSq() < 1e-12) {
    // Vetores opostos: qualquer eixo perpendicular serve.
    _axis.set(0, 1, 0).cross(dir);
    if (_axis.lengthSq() < 1e-12) _axis.set(1, 0, 0);
  }
  dir.applyAxisAngle(_axis.normalize(), maxAngle).normalize();
  return angle - maxAngle;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}
