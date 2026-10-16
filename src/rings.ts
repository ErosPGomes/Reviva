import * as THREE from "three";
import { hash2 } from "./noise";
import { segmentPointDistSq } from "./math";
import type { Terrain } from "./terrain";

/** Anéis no ar: atravessar concede vida, boost, munição ou carga do drone. */
export type RingKind = "health" | "boost" | "ammo" | "drone";

export const RING_INFO: Record<RingKind, { label: string; color: string }> = {
  health: { label: "Reparo +35", color: "#4ade80" },
  boost: { label: "Boost", color: "#6db4ff" },
  ammo: { label: "Munição e flares", color: "#f1f5f4" },
  drone: { label: "Drone +30%", color: "#c08cff" },
};

const KINDS: readonly RingKind[] = ["health", "boost", "ammo", "drone", "health", "boost", "drone"];
export const RING_RADIUS = 42;
const RESPAWN = 25;
const FIELD = 5200; // raio da área onde os anéis aparecem

export class Ring {
  readonly center = new THREE.Vector3();
  readonly normal = new THREE.Vector3();
  active = true;
  respawn = 0;

  constructor(
    readonly kind: RingKind,
    readonly mesh: THREE.Group,
  ) {}
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _hit = new THREE.Vector3();

/**
 * Travessia = o segmento (posição anterior → atual) cruza o plano do anel dentro do raio.
 * Teste por segmento: a 300 m/s o avião anda 5–10 m por quadro, mais que a espessura do anel.
 */
export function crossesRing(prev: THREE.Vector3, pos: THREE.Vector3, center: THREE.Vector3, normal: THREE.Vector3, radius: number): boolean {
  // Tolerância: passar a menos de 60% do raio do centro conta mesmo de raspão (o anel é recompensa, não teste de precisão).
  if (segmentPointDistSq(prev, pos, center) < (radius * 0.6) ** 2) return true;
  const d0 = _a.subVectors(prev, center).dot(normal);
  const d1 = _b.subVectors(pos, center).dot(normal);
  if (d0 === d1 || Math.sign(d0) === Math.sign(d1)) return false;
  const t = d0 / (d0 - d1);
  _hit.copy(prev).lerp(pos, t);
  return _hit.distanceTo(center) < radius;
}

export class RingSystem {
  readonly rings: Ring[] = [];
  private seed = 0;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    const torus = new THREE.TorusGeometry(RING_RADIUS, 1.6, 8, 48);
    const disc = new THREE.CircleGeometry(RING_RADIUS - 1, 32);
    for (const kind of KINDS) {
      const color = new THREE.Color(RING_INFO[kind].color);
      const group = new THREE.Group();
      // fog: false — o anel precisa ser visível de longe para o jogador planejar a rota.
      group.add(new THREE.Mesh(torus, new THREE.MeshBasicMaterial({ color, fog: false })));
      group.add(
        new THREE.Mesh(
          disc,
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, fog: false }),
        ),
      );
      const ring = new Ring(kind, group);
      this.place(ring);
      this.rings.push(ring);
      scene.add(group);
    }
  }

  private place(r: Ring): void {
    const k = this.seed++;
    const a = hash2(k, 3, 211) * Math.PI * 2;
    const d = 600 + hash2(k, 5, 223) * FIELD;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    r.center.set(x, this.terrain.heightAt(x, z) + 140 + hash2(k, 7, 227) * 520, z);
    const heading = hash2(k, 11, 229) * Math.PI * 2;
    r.normal.set(Math.sin(heading), 0, Math.cos(heading));
    r.mesh.position.copy(r.center);
    r.mesh.lookAt(_a.copy(r.center).add(r.normal));
    r.active = true;
    r.mesh.visible = true;
  }

  reset(): void {
    this.seed = 0;
    for (const r of this.rings) this.place(r);
  }

  /** Retorna o anel atravessado neste quadro (no máximo um). */
  update(dt: number, time: number, prev: THREE.Vector3, pos: THREE.Vector3): Ring | null {
    let passed: Ring | null = null;
    for (const r of this.rings) {
      if (!r.active) {
        r.respawn -= dt;
        if (r.respawn <= 0) this.place(r);
        continue;
      }
      r.mesh.scale.setScalar(1 + Math.sin(time * 3 + r.center.x) * 0.04);
      if (!passed && crossesRing(prev, pos, r.center, r.normal, RING_RADIUS)) {
        passed = r;
        r.active = false;
        r.respawn = RESPAWN;
        r.mesh.visible = false;
      }
    }
    return passed;
  }
}
