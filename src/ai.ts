import * as THREE from "three";
import type { Aircraft } from "./aircraft";
import { bankAngle, forwardOf, type FlightControls } from "./flight";
import { clamp, rand } from "./math";
import type { Terrain } from "./terrain";
import { ARENA_RADIUS } from "./terrain";

export interface AIOutput {
  readonly controls: FlightControls;
  fireGun: boolean;
  fireMissile: boolean;
  deployFlares: boolean;
}

type Mode = "attack" | "evade" | "extend";

const _desired = new THREE.Vector3();
const _local = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _ahead = new THREE.Vector3();

/**
 * Piloto inimigo "inclina e puxa" (bank-to-turn), como pilotos reais: rola até o alvo ficar acima do
 * canopi e então puxa. Camadas de prioridade: evitar o chão > limite da arena > evasão > ataque.
 * `skill` (0..1) controla pontaria, tempo de travamento e chance de soltar flares.
 */
export class AIPilot {
  readonly out: AIOutput = {
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, assist: false },
    fireGun: false,
    fireMissile: false,
    deployFlares: false,
  };
  lockTime = 0;
  private missileCooldown = rand(5, 9);
  private burst = 0;
  private mode: Mode = "attack";
  private modeTimer = 0;
  private evadeSide = 1;

  constructor(readonly plane: Aircraft, readonly skill: number) {}

  /** Travamento em andamento: o HUD do jogador mostra aviso a partir de 0,3 s. */
  get locking(): boolean {
    return this.lockTime > 0.3;
  }

  think(dt: number, target: Aircraft, terrain: Terrain, threatened: boolean): AIOutput {
    const s = this.plane.flight;
    const o = this.out;
    const c = o.controls;
    o.fireGun = false;
    o.fireMissile = false;
    o.deployFlares = false;
    c.yaw = 0;
    this.missileCooldown -= dt;
    this.modeTimer -= dt;

    if (threatened && this.mode !== "evade") {
      this.mode = "evade";
      this.modeTimer = rand(2.2, 3.5);
      this.evadeSide = Math.random() < 0.5 ? -1 : 1;
      o.deployFlares = Math.random() < 0.3 + 0.6 * this.skill;
    }
    if (this.mode !== "attack" && this.modeTimer <= 0) this.mode = "attack";

    forwardOf(s.quat, _fwd);
    const dist = s.pos.distanceTo(target.position);
    const targetOk = target.alive;
    let throttle = 0.85;

    if (this.mode === "attack" && targetOk) {
      const t = Math.min(dist / 1000, 2.5) * (0.4 + 0.6 * this.skill);
      _aim.copy(target.position).addScaledVector(target.velocity, t);
      _desired.subVectors(_aim, s.pos).normalize();
      const ahead = _fwd.dot(_desired);
      if (dist < 260 && ahead > 0.5) {
        this.mode = "extend";
        this.modeTimer = rand(2.5, 4);
      }
      throttle = dist > 1600 ? 1 : dist < 600 && ahead > 0.7 ? 0.55 : 0.85;

      const angle = Math.acos(clamp(ahead, -1, 1));
      const gunCone = 0.035 + (1 - this.skill) * 0.03;
      if (angle < gunCone && dist < 1000) {
        this.burst += dt;
        o.fireGun = this.burst % 1.4 < 0.8;
      } else this.burst = 0;

      if (angle < 0.32 && dist > 600 && dist < 3000 && this.missileCooldown <= 0) {
        this.lockTime += dt;
        if (this.lockTime > 2.7 - this.skill * 0.7) {
          o.fireMissile = true;
          this.lockTime = 0;
          this.missileCooldown = rand(10, 15) - this.skill * 4;
        }
      } else this.lockTime = Math.max(0, this.lockTime - dt * 2);
    } else if (this.mode === "extend" || !targetOk) {
      // Afasta-se para ganhar distância e voltar de frente (evita "dança" colado no alvo).
      _desired.subVectors(s.pos, target.position).normalize().lerp(_fwd, 0.5);
      _desired.y = Math.max(_desired.y, 0.1);
      _desired.normalize();
      throttle = 1;
      this.lockTime = 0;
    } else {
      // Evasão: curva de quebra a ~80° para um lado, potência máxima.
      _desired.copy(_fwd);
      throttle = 1;
      this.lockTime = 0;
    }

    // Prioridades de segurança sobrepõem a intenção.
    _ahead.copy(s.pos).addScaledVector(s.vel, 4);
    const ground = Math.max(terrain.heightAt(s.pos.x, s.pos.z), terrain.heightAt(_ahead.x, _ahead.z));
    const alt = s.pos.y - ground;
    const safe = 160 + s.speed * 0.5;
    if (alt < safe) {
      _desired.y = Math.max(_desired.y, 0.35 + (safe - alt) / safe);
      _desired.normalize();
    }
    if (Math.hypot(s.pos.x, s.pos.z) > ARENA_RADIUS - 800) {
      _desired.lerp(_aim.set(-s.pos.x, 0, -s.pos.z).normalize(), 0.6).normalize();
    }
    if (s.pos.y > 3200) _desired.y = Math.min(_desired.y, -0.25);

    if (this.mode === "evade" && alt > safe) {
      const bankErr = this.evadeSide * 1.4 - bankAngle(s.quat);
      c.roll = clamp(bankErr * 2.5, -1, 1);
      c.pitch = 1;
    } else {
      this.steer(_desired);
    }
    c.throttle = throttle;
    return o;
  }

  private steer(desired: THREE.Vector3): void {
    const s = this.plane.flight;
    const c = this.out.controls;
    _invQ.copy(s.quat).invert();
    _local.copy(desired).applyQuaternion(_invQ);
    const off = Math.hypot(_local.x, _local.y);
    if (_local.z < 0 && off < 0.08) {
      // Alvo quase no eixo: correções finas com profundor e leme, mantendo asas próximas do nível.
      c.roll = clamp(-bankAngle(s.quat) * 1.2, -0.5, 0.5);
      c.pitch = clamp(_local.y * 10, -1, 1);
      c.yaw = clamp(_local.x * 10, -1, 1);
      return;
    }
    const rollErr = Math.atan2(_local.x, _local.y);
    c.roll = clamp(rollErr * 3, -1, 1);
    const aligned = Math.abs(rollErr) < 1.1 ? 1 : 0.25;
    c.pitch = clamp((_local.y * 4 + (_local.z > 0 ? 1 : 0)) * aligned, -0.4, 1);
  }
}
