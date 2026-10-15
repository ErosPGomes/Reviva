import * as THREE from "three";
import type { Effects } from "./effects";
import { FX } from "./effects";
import { segmentPointDistSq, turnToward, randSigned, rand } from "./math";
import { createMissileMesh } from "./models";
import type { Terrain } from "./terrain";
import { WORLD_HALF } from "./terrain";
import type { Combatant, Team, Trackable } from "./types";

export interface WeaponEvents {
  hit(target: Combatant, damage: number, owner: Combatant | null, at: THREE.Vector3): void;
  splash(at: THREE.Vector3, radius: number, damage: number, team: Team, owner: Combatant | null): void;
  explosion(at: THREE.Vector3, scale: number): void;
}

const _tmp = new THREE.Vector3();
const _dir = new THREE.Vector3();

/* ---------------- Projéteis ---------------- */

class Bullet {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly color = new THREE.Color();
  life = 0;
  team: Team = "blue";
  owner: Combatant | null = null;
  damage = 0;
  airburst = false;
}

const BULLET_GRAVITY = 4.9; // meia gravidade: queda perceptível sem exigir compensação manual

export class BulletSystem {
  private readonly pool: Bullet[] = [];
  private live = 0;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly lines: THREE.LineSegments;

  constructor(scene: THREE.Scene, private readonly terrain: Terrain, private readonly fx: Effects, private readonly events: WeaponEvents, capacity = 800) {
    for (let i = 0; i < capacity; i++) this.pool.push(new Bullet());
    this.positions = new Float32Array(capacity * 6);
    this.colors = new Float32Array(capacity * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    scene.add(this.lines);
  }

  clear(): void {
    this.live = 0;
  }

  fire(
    owner: Combatant | null,
    team: Team,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
    inherit: THREE.Vector3,
    damage: number,
    spread: number,
    life: number,
    color: number,
    airburst: boolean,
  ): void {
    if (this.live >= this.pool.length) return;
    const b = this.pool[this.live++]!;
    _dir.set(dir.x + randSigned() * spread, dir.y + randSigned() * spread, dir.z + randSigned() * spread).normalize();
    b.pos.copy(origin);
    b.prev.copy(origin);
    b.vel.copy(inherit).addScaledVector(_dir, speed);
    b.life = life;
    b.team = team;
    b.owner = owner;
    b.damage = damage;
    b.airburst = airburst;
    b.color.setHex(color);
  }

  update(dt: number, targets: readonly Combatant[], glowBatchPush: (b: THREE.Vector3, c: THREE.Color) => void): void {
    let i = 0;
    let n = 0;
    while (i < this.live) {
      const b = this.pool[i]!;
      b.life -= dt;
      b.prev.copy(b.pos);
      b.vel.y -= BULLET_GRAVITY * dt;
      b.pos.addScaledVector(b.vel, dt);
      let dead = b.life <= 0;

      if (!dead) {
        for (const t of targets) {
          if (t.team === b.team || !t.isAlive()) continue;
          if (segmentPointDistSq(b.prev, b.pos, t.position) < t.radius * t.radius) {
            this.events.hit(t, b.damage, b.owner, b.pos);
            this.fx.hitSparks(b.pos);
            dead = true;
            break;
          }
        }
      }
      if (!dead && b.pos.y < this.terrain.heightAt(b.pos.x, b.pos.z)) {
        this.fx.dust(b.pos, 0.6);
        dead = true;
      }
      if (!dead && (Math.abs(b.pos.x) > WORLD_HALF || Math.abs(b.pos.z) > WORLD_HALF)) dead = true;
      if (b.life <= 0 && b.airburst) {
        this.fx.airburst(b.pos);
        this.events.splash(b.pos, 24, 7, b.team, b.owner);
      }

      if (dead) {
        const last = this.pool[--this.live]!;
        this.pool[this.live] = b;
        this.pool[i] = last;
        continue;
      }

      // Rastro de 0,025 s de trajetória: ~28 m a 1100 m/s. Cauda preta = invisível no blending aditivo.
      const o = n * 6;
      this.positions[o] = b.pos.x;
      this.positions[o + 1] = b.pos.y;
      this.positions[o + 2] = b.pos.z;
      this.positions[o + 3] = b.pos.x - b.vel.x * 0.025;
      this.positions[o + 4] = b.pos.y - b.vel.y * 0.025;
      this.positions[o + 5] = b.pos.z - b.vel.z * 0.025;
      this.colors[o] = b.color.r;
      this.colors[o + 1] = b.color.g;
      this.colors[o + 2] = b.color.b;
      this.colors[o + 3] = this.colors[o + 4] = this.colors[o + 5] = 0;
      glowBatchPush(b.pos, b.color);
      n++;
      i++;
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, n * 2);
    const pa = geo.getAttribute("position") as THREE.BufferAttribute;
    const ca = geo.getAttribute("color") as THREE.BufferAttribute;
    pa.clearUpdateRanges();
    pa.addUpdateRange(0, n * 6);
    pa.needsUpdate = true;
    ca.clearUpdateRanges();
    ca.addUpdateRange(0, n * 6);
    ca.needsUpdate = true;
  }
}

/* ---------------- Flares ---------------- */

export class Flare implements Trackable {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  age = 0;
  readonly life = rand(3.2, 4.2);

  isAlive(): boolean {
    return this.age < this.life;
  }
}

export class FlareSystem {
  readonly list: Flare[] = [];

  spawn(pos: THREE.Vector3, vel: THREE.Vector3): Flare {
    const f = new Flare();
    f.position.copy(pos);
    f.velocity.copy(vel);
    this.list.push(f);
    return f;
  }

  clear(): void {
    this.list.length = 0;
  }

  update(dt: number, fx: Effects): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]!;
      f.age += dt;
      if (!f.isAlive()) {
        this.list.splice(i, 1);
        continue;
      }
      const d = Math.exp(-1.6 * dt);
      f.velocity.multiplyScalar(d);
      f.velocity.y -= 9.81 * dt * 0.6;
      f.position.addScaledVector(f.velocity, dt);
      fx.glow.emit(FX.flareGlow, f.position.x, f.position.y, f.position.z, 0, 0, 0);
      fx.smoke.emit(FX.flareSmoke, f.position.x, f.position.y, f.position.z, 0, 0, 0);
    }
  }
}

/* ---------------- Mísseis ---------------- */

export interface MissileSpec {
  readonly damage: number;
  readonly maxSpeed: number;
  readonly turnRate: number; // rad/s
  readonly gimbal: number; // ângulo máximo entre eixo e alvo antes de perder a trava
}

export const PLAYER_MISSILE: MissileSpec = { damage: 100, maxSpeed: 720, turnRate: 0.9, gimbal: 1.3 };
export const ENEMY_MISSILE: MissileSpec = { damage: 48, maxSpeed: 640, turnRate: 0.72, gimbal: 1.15 };

export class Missile {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly dir = new THREE.Vector3();
  speed = 0;
  age = 0;
  target: Trackable | null = null;
  owner: Combatant | null = null;
  team: Team = "blue";
  spec: MissileSpec = PLAYER_MISSILE;
  trail = 0;
  done = false;

  constructor(readonly mesh: THREE.Group) {}
}

const MISSILE_LIFE = 10;
const MOTOR_TIME = 2.6;
const PROXIMITY = 13;

export class MissileSystem {
  readonly active: Missile[] = [];
  private readonly spare: THREE.Group[] = [];
  private readonly look = new THREE.Matrix4();

  constructor(private readonly scene: THREE.Scene, private readonly terrain: Terrain, private readonly fx: Effects, private readonly events: WeaponEvents) {}

  launch(owner: Combatant, team: Team, origin: THREE.Vector3, dir: THREE.Vector3, speed: number, target: Trackable | null, spec: MissileSpec): Missile {
    const mesh = this.spare.pop() ?? createMissileMesh();
    this.scene.add(mesh);
    const m = new Missile(mesh);
    m.pos.copy(origin);
    m.prev.copy(origin);
    m.dir.copy(dir).normalize();
    m.speed = speed;
    m.target = target;
    m.owner = owner;
    m.team = team;
    m.spec = spec;
    this.active.push(m);
    return m;
  }

  clear(): void {
    for (const m of this.active) this.release(m);
    this.active.length = 0;
  }

  private release(m: Missile): void {
    this.scene.remove(m.mesh);
    this.spare.push(m.mesh);
  }

  /** Flares: cada míssil que persegue `victim` tem `chance` de trocar de alvo para o flare. */
  decoy(victim: Trackable, flare: Flare, chance: number): void {
    for (const m of this.active) if (m.target === victim && Math.random() < chance) m.target = flare;
  }

  threatsTo(victim: Trackable): { count: number; nearest: number; from: THREE.Vector3 | null } {
    let count = 0;
    let nearest = Infinity;
    let from: THREE.Vector3 | null = null;
    for (const m of this.active) {
      if (m.target !== victim) continue;
      count++;
      const d = m.pos.distanceTo(victim.position);
      if (d < nearest) {
        nearest = d;
        from = m.pos;
      }
    }
    return { count, nearest, from };
  }

  update(dt: number, targets: readonly Combatant[]): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i]!;
      m.age += dt;
      m.prev.copy(m.pos);
      m.speed = m.age < MOTOR_TIME ? Math.min(m.spec.maxSpeed, m.speed + 240 * dt) : Math.max(150, m.speed - 30 * dt);

      if (m.target && !m.target.isAlive()) m.target = null;
      if (m.target && m.age > 0.25) {
        // Perseguição com antecipação (lead) — t_go ≈ distância / velocidade do míssil.
        const tgo = Math.min(4, m.pos.distanceTo(m.target.position) / Math.max(m.speed, 1));
        _tmp.copy(m.target.position).addScaledVector(m.target.velocity, tgo).sub(m.pos).normalize();
        if (m.dir.angleTo(_tmp) > m.spec.gimbal) m.target = null;
        else turnToward(m.dir, _tmp, m.spec.turnRate * dt * Math.min(1, m.speed / 300));
      }
      m.pos.addScaledVector(m.dir, m.speed * dt);

      let hit: Combatant | null = null;
      if (m.age > 0.3) {
        for (const t of targets) {
          if (t.team === m.team || !t.isAlive()) continue;
          const r = PROXIMITY + t.radius * 0.5;
          if (segmentPointDistSq(m.prev, m.pos, t.position) < r * r) {
            hit = t;
            break;
          }
        }
      }
      const tgt = m.target;
      const nearFlare = tgt instanceof Flare && m.pos.distanceTo(tgt.position) < 10;
      const ground = m.pos.y < this.terrain.heightAt(m.pos.x, m.pos.z);

      if (hit || ground || nearFlare || m.age > MISSILE_LIFE) {
        if (hit) this.events.hit(hit, m.spec.damage, m.owner, m.pos);
        if (hit || ground || nearFlare) {
          this.events.splash(m.pos, 30, m.spec.damage * 0.5, m.team, m.owner);
          this.events.explosion(m.pos, ground ? 1.1 : 0.8);
          if (ground) this.fx.dust(m.pos, 2);
        }
        this.release(m);
        this.active.splice(i, 1);
        continue;
      }

      m.mesh.position.copy(m.pos);
      // Matrix4.lookAt alinha -Z com (alvo - olho): exatamente a ponta do modelo.
      this.look.lookAt(m.pos, _tmp.copy(m.pos).add(m.dir), THREE.Object3D.DEFAULT_UP);
      m.mesh.quaternion.setFromRotationMatrix(this.look);

      if (m.age < MOTOR_TIME + 0.4) {
        this.fx.glow.emit(FX.motor, m.pos.x - m.dir.x * 1.8, m.pos.y - m.dir.y * 1.8, m.pos.z - m.dir.z * 1.8, 0, 0, 0);
        m.trail += dt;
        // Fumaça a cada ~6 m de voo: rastro contínuo independente da taxa de quadros.
        const every = 6 / Math.max(m.speed, 1);
        while (m.trail > every) {
          m.trail -= every;
          const back = (m.trail / every) * 6;
          this.fx.smoke.emit(
            FX.missileSmoke,
            m.pos.x - m.dir.x * (2 + back),
            m.pos.y - m.dir.y * (2 + back),
            m.pos.z - m.dir.z * (2 + back),
            randSigned() * 1.5, randSigned() * 1.5, randSigned() * 1.5,
          );
        }
      }
    }
  }
}
