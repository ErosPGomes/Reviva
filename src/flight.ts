import { Quaternion, Vector3 } from "three";
import { clamp } from "./math";

export const GRAVITY = 9.81;

/**
 * Modelo de voo arcade: o nariz manda, a velocidade é escalar com empuxo/arrasto/gravidade e o vetor
 * velocidade segue o nariz com atraso (`grip`), o que dá a derrapagem leve de curvas fortes sem a
 * instabilidade de um modelo aerodinâmico completo. Integra estável com dt até 50 ms.
 */
export interface FlightParams {
  readonly maxSpeed: number; // m/s em potência máxima (equilíbrio empuxo = arrasto)
  readonly minSpeed: number; // abaixo disso, estol: nariz cai e o avião afunda
  readonly maxThrust: number; // m/s²
  readonly pitchRate: number; // rad/s
  readonly rollRate: number;
  readonly yawRate: number;
  readonly grip: number; // 1/s
  readonly assistTurn: number; // rad/s de curva coordenada com 90° de inclinação (modo arcade)
}

export const PLAYER_JET: FlightParams = {
  maxSpeed: 310,
  minSpeed: 75,
  maxThrust: 34,
  pitchRate: 1.35,
  rollRate: 3.2,
  yawRate: 0.35,
  grip: 3.5,
  assistTurn: 0.55,
};

export const ENEMY_JET: FlightParams = {
  maxSpeed: 290,
  minSpeed: 75,
  maxThrust: 31,
  pitchRate: 1.15,
  rollRate: 2.6,
  yawRate: 0.3,
  grip: 3.5,
  assistTurn: 0,
};

export interface FlightState {
  readonly pos: Vector3;
  readonly quat: Quaternion;
  readonly vel: Vector3;
  speed: number;
  throttle: number;
}

export interface FlightControls {
  pitch: number; // +1 = nariz para cima
  roll: number; // +1 = asa direita para baixo
  yaw: number; // +1 = nariz para a direita
  throttle: number; // alvo 0..1
  assist: boolean;
}

const AX = new Vector3(1, 0, 0);
const AY = new Vector3(0, 1, 0);
const AZ = new Vector3(0, 0, 1);
const DOWN = new Vector3(0, -1, 0);
const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _axis = new Vector3();
const _q = new Quaternion();

/** Convenção three.js: frente = -Z, cima = +Y, direita = +X no espaço local. */
export const forwardOf = (q: Quaternion, out: Vector3): Vector3 => out.set(0, 0, -1).applyQuaternion(q);
export const upOf = (q: Quaternion, out: Vector3): Vector3 => out.set(0, 1, 0).applyQuaternion(q);
export const rightOf = (q: Quaternion, out: Vector3): Vector3 => out.set(1, 0, 0).applyQuaternion(q);

/** Inclinação lateral em rad: 0 nivelado, +π/2 asa direita para baixo, ±π invertido. */
export function bankAngle(q: Quaternion): number {
  rightOf(q, _r);
  upOf(q, _u);
  return Math.atan2(-_r.y, _u.y);
}

export function pitchAngle(q: Quaternion): number {
  return Math.asin(clamp(forwardOf(q, _f).y, -1, 1));
}

export function createFlightState(pos: Vector3, heading: number, speed: number, throttle = 0.7): FlightState {
  const quat = new Quaternion().setFromAxisAngle(AY, heading);
  const vel = forwardOf(quat, new Vector3()).multiplyScalar(speed);
  return { pos: pos.clone(), quat, vel, speed, throttle };
}

export function stepFlight(s: FlightState, c: FlightControls, dt: number, p: FlightParams): void {
  s.throttle += clamp(c.throttle - s.throttle, -0.9 * dt, 0.9 * dt);

  forwardOf(s.quat, _f);
  // Arrasto quadrático calibrado para que empuxo máximo = arrasto exatamente em maxSpeed.
  const drag = p.maxThrust / (p.maxSpeed * p.maxSpeed);
  const pull = Math.abs(c.pitch);
  // Ar rarefeito acima de 2,4 km derruba o empuxo: teto natural sem parede invisível.
  const density = clamp(1 - (s.pos.y - 2400) / 1600, 0.25, 1);
  const accel = s.throttle * p.maxThrust * density - drag * s.speed * s.speed * (1 + pull * 0.6) - GRAVITY * _f.y;
  s.speed = Math.max(0, s.speed + accel * dt);

  // Superfícies de controle perdem efeito em baixa velocidade; em alta, limite de G reduz a arfagem.
  const auth = clamp((s.speed - 25) / (p.minSpeed + 10), 0.2, 1);
  const gLimit = 1 - 0.35 * clamp((s.speed - 0.65 * p.maxSpeed) / (0.35 * p.maxSpeed), 0, 1);

  _q.setFromAxisAngle(AX, c.pitch * p.pitchRate * auth * gLimit * dt);
  s.quat.multiply(_q);
  _q.setFromAxisAngle(AZ, -c.roll * p.rollRate * auth * dt);
  s.quat.multiply(_q);
  _q.setFromAxisAngle(AY, -c.yaw * p.yawRate * auth * dt);
  s.quat.multiply(_q);

  if (c.assist && p.assistTurn > 0) {
    // Curva coordenada: inclinar já vira o avião em torno do eixo vertical do mundo (sem precisar puxar).
    const level = 1 - Math.abs(forwardOf(s.quat, _f).y);
    _q.setFromAxisAngle(AY, -Math.sin(bankAngle(s.quat)) * p.assistTurn * auth * level * dt);
    s.quat.premultiply(_q);
  }

  let sink = 0;
  if (s.speed < p.minSpeed) {
    const f = (p.minSpeed - s.speed) / p.minSpeed;
    forwardOf(s.quat, _f);
    _axis.crossVectors(_f, DOWN);
    if (_axis.lengthSq() > 1e-6) {
      _q.setFromAxisAngle(_axis.normalize(), f * 1.4 * dt);
      s.quat.premultiply(_q);
    }
    sink = f * 30;
  }
  s.quat.normalize();

  forwardOf(s.quat, _f);
  const k = 1 - Math.exp(-p.grip * dt);
  s.vel.x += (_f.x * s.speed - s.vel.x) * k;
  s.vel.y += (_f.y * s.speed - s.vel.y) * k;
  s.vel.z += (_f.z * s.speed - s.vel.z) * k;
  s.pos.addScaledVector(s.vel, dt);
  s.pos.y -= sink * dt;
}

/**
 * Converte "manche arcade" (X = inclinação desejada) em comando de rolagem. Perto da vertical a inclinação
 * é indefinida, então o manche passa a comandar a taxa de rolagem diretamente.
 */
export function arcadeRoll(q: Quaternion, stickX: number, maxBank = 1.35): number {
  const vertical = Math.abs(forwardOf(q, _f).y);
  const toBank = clamp((stickX * maxBank - bankAngle(q)) * 2.4, -1, 1);
  const w = clamp((vertical - 0.75) / 0.2, 0, 1);
  return toBank * (1 - w) + stickX * w;
}
