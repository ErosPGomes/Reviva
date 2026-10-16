import * as THREE from "three";
import { AIPilot } from "./ai";
import { Aircraft, MAX_FLARES } from "./aircraft";
import type { Sfx } from "./audio";
import { Effects, FX } from "./effects";
import {
  ENEMY_JET,
  PLAYER_JET,
  arcadeRoll,
  bankAngle,
  forwardOf,
  rightOf,
  stepFlight,
  upOf,
  type FlightControls,
} from "./flight";
import { createBases, type Base, type GroundTarget } from "./ground";
import type { Hud } from "./hud";
import type { InputFrame } from "./input";
import { clamp, damp, rand, randSigned } from "./math";
import { ARENA_RADIUS, type Terrain } from "./terrain";
import type { Combatant } from "./types";
import {
  BOOSTS,
  BOOST_FX,
  BOOST_ORDER,
  DIFFICULTIES,
  GUNS,
  GUN_ORDER,
  MISSILES,
  MISSILE_ORDER,
  type BoostId,
  type Difficulty,
  type GunId,
  type MissileId,
} from "./loadout";
import { BulletSystem, ENEMY_MISSILE, FlareSystem, MissileSystem, type WeaponEvents } from "./weapons";
import { buildWorld, type Quality, type World } from "./world";

const BOOSTED_JET = { ...PLAYER_JET, maxSpeed: PLAYER_JET.maxSpeed * BOOST_FX.speedMax, maxThrust: PLAYER_JET.maxThrust * BOOST_FX.speedThrust };

export interface Settings {
  arcade: boolean;
  invertY: boolean;
  quality: Quality;
  sound: boolean;
  difficulty: Difficulty;
  gun: GunId;
  missile: MissileId;
}

export interface GameStats {
  bestStreak: number;
  score: number;
  kills: number;
  groundKills: number;
  wave: number;
  time: number;
}

export type Phase = "attract" | "playing" | "dying" | "over";

export interface Enemy {
  readonly plane: Aircraft;
  readonly pilot: AIPilot;
}

export interface HudMessage {
  readonly text: string;
  readonly color: string;
  readonly t: number;
  readonly big: boolean;
}

export interface FeedLine {
  readonly text: string;
  readonly t: number;
  readonly mine: boolean;
}

export const COLORS = { teal: "#5fe3cf", amber: "#ffa043", red: "#ff5146", white: "#eef6f5", blue: "#6db4ff" } as const;

const CALLSIGNS = ["Víbora", "Corvo", "Lobo", "Chacal", "Cobra", "Abutre", "Escorpião"];
const PLAYER_START = new THREE.Vector3(0, 0, 4300);
const OUT_LIMIT = 10;
const LOCK_GRACE = 0.8; // s que o sensor tolera o alvo fora do cone de rastreio

export interface DamageIndicator {
  readonly from: THREE.Vector3;
  readonly t: number;
}

export interface Popup {
  readonly text: string;
  readonly color: string;
  readonly t: number;
}

const freshRails = (): Record<MissileId, number[]> =>
  Object.fromEntries(MISSILE_ORDER.map((id) => [id, new Array<number>(MISSILES[id].rails).fill(0)])) as Record<MissileId, number[]>;
const freshBoosts = (): Record<BoostId, number> =>
  Object.fromEntries(BOOST_ORDER.map((id) => [id, 0])) as Record<BoostId, number>;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1);
const _offset = new THREE.Vector3();
const _assist = new THREE.Vector3();
const _assistBest = new THREE.Vector3();

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly terrain: Terrain;
  readonly effects: Effects;
  readonly bullets: BulletSystem;
  readonly missiles: MissileSystem;
  readonly flares = new FlareSystem();
  readonly bases: Base[];
  readonly ground: GroundTarget[];

  player: Aircraft;
  enemies: Enemy[] = [];
  phase: Phase = "attract";
  cameraMode: "chase" | "cockpit" = "chase";

  time = 0;
  score = 0;
  kills = 0;
  groundKills = 0;
  wave = 0;
  flightTime = 0;
  outTimer = 0;
  pullUp = false;
  /** Auto-GCAS assumiu o controle neste quadro (HUD avisa). */
  gcas = false;
  hitMarker = 0;
  killMarker = 0;
  damageFlash = 0;
  readonly lock = { target: null as Combatant | null, time: 0, locked: false, grace: 0 };
  readonly threat = { missiles: 0, nearest: Infinity, from: null as THREE.Vector3 | null, locking: false };
  messages: HudMessage[] = [];
  feed: FeedLine[] = [];
  /** Tempo necessário para travar com o míssil selecionado (o HUD desenha o progresso). */
  get lockTimeNeeded(): number {
    return MISSILES[this.missile].lockTime * this.difficulty.lockMult;
  }

  /* Armamento e boosts do jogador */
  gun: GunId = "cal50";
  missile: MissileId = "ir";
  rails = freshRails();
  boosts = freshBoosts();
  streak = 0;
  bestStreak = 0;
  damageIndicators: DamageIndicator[] = [];
  popups: Popup[] = [];
  private streakTimer = 0;
  onGameOver: (s: GameStats) => void = () => {};

  private pendingWave = false;
  private waveTimer = 0;
  private rebuildTimer = 0;
  private deathTimer = 0;
  private shake = 0;
  private orbit = 0;
  private readonly deathFocus = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private readonly combatants: Combatant[] = [];
  private readonly controls: FlightControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, assist: true };
  private lastFov = 0;

  constructor(
    canvas: HTMLCanvasElement,
    readonly sfx: Sfx,
    readonly settings: Settings,
    readonly hud: Hud,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality === "high", powerPreference: "high-performance" });
    this.camera = new THREE.PerspectiveCamera(64, 1, 1.5, 22000);
    this.applyQuality();
    this.world = buildWorld(this.scene, this.renderer, settings.quality);
    this.terrain = this.world.terrain;
    this.effects = new Effects(this.scene, this.world.fog);

    const events: WeaponEvents = {
      hit: (t, dmg, owner) => this.damage(t, dmg, owner),
      splash: (at, radius, dmg, team, owner) => {
        for (const t of this.combatants) {
          if (t.team === team || !t.isAlive()) continue;
          const d = t.position.distanceTo(at);
          if (d < radius + t.radius * 0.5) this.damage(t, dmg * (1 - d / (radius + t.radius * 0.5)), owner);
        }
      },
      explosion: (at, scale) => {
        this.effects.explosion(at, scale);
        this.sfx.explosion(at.distanceTo(this.camera.position));
      },
    };
    this.bullets = new BulletSystem(this.scene, this.terrain, this.effects, events);
    this.missiles = new MissileSystem(this.scene, this.terrain, this.effects, events);
    this.bases = createBases(this.scene, this.terrain);
    this.ground = this.bases.flatMap((b) => b.targets);
    this.player = this.spawnPlayer();
    this.camQuat.copy(this.player.flight.quat);
  }

  applyQuality(): void {
    const cap = this.settings.quality === "high" ? 1.75 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
  }

  private spawnPlayer(): Aircraft {
    const pos = PLAYER_START.clone();
    pos.y = this.terrain.heightAt(pos.x, pos.z) + 320;
    const p = new Aircraft("blue", "Você", PLAYER_JET, pos, 0, 210);
    p.addTo(this.scene);
    return p;
  }

  /** Reinicia a partida sem recriar terreno/texturas (o caro da inicialização). */
  newGame(throttle: number): void {
    for (const e of this.enemies) e.plane.removeFrom(this.scene);
    this.enemies = [];
    this.bullets.clear();
    this.missiles.clear();
    this.flares.clear();
    this.effects.clear();
    for (const b of this.bases) {
      b.captured = false;
      for (const t of b.targets) t.restore();
    }
    this.player.removeFrom(this.scene);
    this.player = this.spawnPlayer();
    this.player.flight.throttle = throttle;
    this.camQuat.copy(this.player.flight.quat);
    this.score = this.kills = this.groundKills = this.wave = 0;
    this.flightTime = this.outTimer = 0;
    this.pendingWave = true;
    this.waveTimer = 2.5;
    this.rebuildTimer = 0;
    this.lock.target = null;
    this.lock.time = 0;
    this.lock.locked = false;
    this.messages = [];
    this.feed = [];
    this.damageFlash = this.hitMarker = this.killMarker = 0;
    this.gun = this.settings.gun;
    this.missile = this.settings.missile;
    this.rails = freshRails();
    this.boosts = freshBoosts();
    this.streak = this.bestStreak = this.streakTimer = 0;
    this.damageIndicators = [];
    this.popups = [];
    this.phase = "playing";
    this.message("Neutralize as bases A, B e C", COLORS.teal, true);
  }

  /** Volta ao voo de demonstração atrás do menu. */
  attract(): void {
    this.newGame(0.7);
    this.phase = "attract";
    this.pendingWave = false;
    this.messages = [];
    this.cameraMode = "chase";
  }

  message(text: string, color: string, big = false): void {
    this.messages.push({ text, color, t: this.time, big });
    if (this.messages.length > 4) this.messages.shift();
  }

  private log(text: string, mine: boolean): void {
    this.feed.push({ text, t: this.time, mine });
    if (this.feed.length > 5) this.feed.shift();
  }

  stats(): GameStats {
    return { score: this.score, kills: this.kills, groundKills: this.groundKills, wave: this.wave, time: this.flightTime, bestStreak: this.bestStreak };
  }

  get difficulty() {
    return DIFFICULTIES[this.settings.difficulty];
  }

  boostActive(id: BoostId): boolean {
    return this.boosts[id] > 0;
  }

  private grantBoost(id: BoostId): void {
    const b = BOOSTS[id];
    const was = this.boosts[id] > 0;
    this.boosts[id] = Math.min(b.max, this.boosts[id] + b.duration);
    this.message(`${was ? "Renovado" : "Boost"}: ${b.label}`, b.color);
  }

  private addScore(base: number, label: string): void {
    const pts = Math.round(base * this.difficulty.scoreMult);
    this.score += pts;
    this.popups.push({ text: `+${pts} ${label}`, color: COLORS.amber, t: this.time });
    if (this.popups.length > 4) this.popups.shift();
  }

  /* ---------------- Laço principal ---------------- */

  update(dt: number, inp: InputFrame | null): void {
    this.time += dt;
    const p = this.player;

    if (this.phase === "attract") this.autopilot(dt);
    else if (this.phase === "playing" && p.alive && inp) this.flyPlayer(dt, inp);

    this.updateEnemies(dt);
    this.updateGround(dt);
    for (const a of this.aircraft()) this.updateAircraftSystems(a, dt);

    this.combatants.length = 0;
    if (p.alive) this.combatants.push(p);
    for (const e of this.enemies) if (e.plane.alive) this.combatants.push(e.plane);
    for (const t of this.ground) if (t.alive) this.combatants.push(t);

    this.effects.begin();
    this.effects.update(dt);
    const glow = this.effects.glow.batch;
    this.bullets.update(dt, this.combatants, (pos, c) => glow.push(pos.x, pos.y, pos.z, 2.2, 0, c.r, c.g, c.b, 0.9));
    this.missiles.update(dt, this.combatants);
    this.flares.update(dt, this.effects);
    this.effects.end();

    this.checkTerrain();
    this.updateWrecks(dt);
    if (this.phase !== "attract") {
      this.updateLock(dt);
      this.updateThreat();
      this.updateRules(dt);
    }
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.killMarker = Math.max(0, this.killMarker - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);

    for (const a of this.aircraft()) {
      a.sync(this.time);
      this.updateShadow(a);
    }
    this.updateCamera(dt);
    this.sfx.update(dt, {
      throttle: p.flight.throttle,
      speed: p.flight.speed,
      alive: p.alive && this.phase !== "over",
      lock: this.phase !== "playing" || !this.lock.target ? "none" : this.lock.locked ? "locked" : "seeking",
      threat: !p.alive ? "none" : this.threat.missiles > 0 ? "missile" : this.threat.locking ? "lock" : "none",
      pullUp: this.pullUp,
    });
  }

  render(): void {
    this.world.update(this.camera);
    this.renderer.render(this.scene, this.camera);
    this.hud.draw(this);
  }

  private *aircraft(): Generator<Aircraft> {
    if (!this.player.removed) yield this.player;
    for (const e of this.enemies) if (!e.plane.removed) yield e.plane;
  }

  /* ---------------- Jogador ---------------- */

  private autopilot(dt: number): void {
    const f = this.player.flight;
    const alt = f.pos.y - this.terrain.heightAt(f.pos.x, f.pos.z);
    this.controls.roll = arcadeRoll(f.quat, 0.3);
    this.controls.pitch = clamp((300 - alt) * 0.004 - f.vel.y * 0.03, -0.4, 0.5);
    this.controls.yaw = 0;
    this.controls.throttle = 0.7;
    this.controls.assist = true;
    stepFlight(f, this.controls, dt, PLAYER_JET);
  }

  private flyPlayer(dt: number, inp: InputFrame): void {
    const p = this.player;
    const c = this.controls;
    c.assist = this.settings.arcade;
    c.roll = this.settings.arcade ? arcadeRoll(p.flight.quat, inp.stickX) : inp.stickX;
    c.pitch = inp.stickY;
    c.yaw = inp.yaw;
    c.throttle = inp.throttle;
    // Auto-GCAS (como no F-16 real): se o vetor velocidade cruza o terreno em ~2,5 s, nivela as asas e puxa.
    // O jogador perde o controle só durante a recuperação; evita a morte mais frustrante (bater no chão).
    this.gcas = false;
    if (this.difficulty.autoGcas && p.flight.vel.y < -5) {
      const f = p.flight;
      const t = 2.5;
      _v.copy(f.pos).addScaledVector(f.vel, t);
      const clearance = Math.min(_v.y - this.terrain.heightAt(_v.x, _v.z), f.pos.y - this.terrain.heightAt(f.pos.x, f.pos.z) + f.vel.y * 1.2);
      if (clearance < 35) {
        this.gcas = true;
        c.roll = arcadeRoll(f.quat, 0);
        c.pitch = Math.abs(bankAngle(f.quat)) < 0.6 ? 1 : 0.2;
        c.throttle = 1;
        c.assist = true;
      }
    }

    // Boost de velocidade: parâmetros de voo temporários (teto e empuxo maiores), sem mutar a constante.
    stepFlight(p.flight, c, dt, this.boostActive("speed") ? BOOSTED_JET : p.params);
    this.flightTime += dt;

    if (inp.camera) this.cameraMode = this.cameraMode === "chase" ? "cockpit" : "chase";
    if (inp.switchGun) this.cycleGun();
    if (inp.switchMissile) this.cycleMissile();

    // Metralhadora com superaquecimento: rajadas curtas rendem mais que segurar o gatilho.
    const gun = GUNS[this.gun];
    const dmgMult = this.boostActive("damage") ? BOOST_FX.damage : 1;
    const heatMult = this.boostActive("reload") ? BOOST_FX.heatRate : 1;
    p.gunCooldown -= dt;
    const firing = inp.gun && !p.overheated;
    if (firing) {
      let shots = 0;
      const assist = this.aimAssistDir(gun.speed);
      while (p.gunCooldown <= 0 && shots < 4) {
        this.fireGun(p, gun.damage * dmgMult, gun.spread, gun.color, gun.speed, gun.life, gun.splash, assist, this.difficulty.hitScale);
        p.gunCooldown += gun.interval;
        p.gunHeat += gun.heat * heatMult;
        shots++;
      }
      if (p.gunHeat >= 1) {
        p.overheated = true;
        this.message(`${gun.name} superaquecida`, COLORS.red);
      }
    } else {
      p.gunCooldown = Math.max(p.gunCooldown, 0);
      p.gunHeat = Math.max(0, p.gunHeat - dt * (p.overheated ? 0.45 : 0.32));
      if (p.overheated && p.gunHeat <= 0.3) p.overheated = false;
    }

    if (inp.missile) this.firePlayerMissile();
    if (inp.flare) this.deployFlares(p);

    // Vapor nas pontas das asas em curva forte (pista visual de G alto).
    if (Math.abs(c.pitch) > 0.6 && p.flight.speed > 170) {
      rightOf(p.flight.quat, _right);
      forwardOf(p.flight.quat, _fwd);
      for (const s of [-1, 1]) {
        _v.copy(p.flight.pos).addScaledVector(_right, s * 6.8).addScaledVector(_fwd, -3.4);
        this.effects.smoke.emit(FX.vapor, _v.x, _v.y, _v.z, 0, 0, 0);
      }
    }

    const diff = this.difficulty;
    if (p.lastHitAt < this.time - diff.regenDelay) p.health = Math.min(100, p.health + diff.regenRate * dt);

    // Trilhos de todos os tipos recarregam em paralelo (trocar de míssil não perde recarga).
    const reloadRate = this.boostActive("reload") ? BOOST_FX.reloadRate : 1;
    for (const id of MISSILE_ORDER) {
      const r = this.rails[id];
      for (let k = 0; k < r.length; k++) r[k] = Math.max(0, r[k]! - dt * reloadRate);
    }
    const cur = this.rails[this.missile];
    p.rails[0] = cur[0] ?? 0;
    p.rails[1] = cur[1] ?? cur[0] ?? 0;

    for (const id of BOOST_ORDER) this.boosts[id] = Math.max(0, this.boosts[id] - dt);
    if (this.streak > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) this.streak = 0;
    }

    const f = p.flight;
    _v.copy(f.pos).addScaledVector(f.vel, 3);
    const alt = f.pos.y - this.terrain.heightAt(f.pos.x, f.pos.z);
    const future = _v.y - this.terrain.heightAt(_v.x, _v.z);
    this.pullUp = alt < 140 && (f.vel.y < -25 || future < 25);

    const r = Math.hypot(f.pos.x, f.pos.z);
    if (r > ARENA_RADIUS) {
      this.outTimer += dt;
      if (this.outTimer > OUT_LIMIT) this.killAircraft(p, null);
    } else this.outTimer = 0;
  }

  private cycleGun(): void {
    this.gun = GUN_ORDER[(GUN_ORDER.indexOf(this.gun) + 1) % GUN_ORDER.length]!;
    this.player.gunHeat = Math.max(this.player.gunHeat, 0.25); // troca não é grátis: evita "trocar para esfriar"
    this.message(GUNS[this.gun].name, COLORS.white);
  }

  private cycleMissile(): void {
    this.missile = MISSILE_ORDER[(MISSILE_ORDER.indexOf(this.missile) + 1) % MISSILE_ORDER.length]!;
    this.lock.target = null;
    this.lock.time = 0;
    this.lock.locked = false;
    this.message(MISSILES[this.missile].name, COLORS.white);
  }

  /**
   * Assistência de mira: se o ponto de antecipação de algum inimigo estiver a poucos graus do nariz,
   * devolve a direção que acerta (a rajada é puxada para lá na proporção `aimAssist`). Retorna null fora do cone.
   */
  private aimAssistDir(muzzleSpeed: number): THREE.Vector3 | null {
    const diff = this.difficulty;
    if (diff.aimAssist <= 0) return null;
    const p = this.player.flight;
    forwardOf(p.quat, _fwd);
    let best: THREE.Vector3 | null = null;
    let bestAng = diff.aimAssistCone;
    for (const t of this.combatants) {
      if (t.team === "blue" || !t.isAlive()) continue;
      const d = t.position.distanceTo(p.pos);
      if (d > 1800) continue;
      let tof = d / muzzleSpeed;
      for (let k = 0; k < 2; k++) {
        _assist.copy(t.position).addScaledVector(t.velocity, tof).addScaledVector(p.vel, -tof);
        tof = _assist.distanceTo(p.pos) / muzzleSpeed;
      }
      _assist.y += 0.5 * 4.9 * tof * tof;
      _assist.sub(p.pos).normalize();
      const ang = _fwd.angleTo(_assist);
      if (ang < bestAng) {
        bestAng = ang;
        best = _assistBest.copy(_assist);
      }
    }
    if (!best) return null;
    return best.lerp(_fwd, 1 - diff.aimAssist).normalize();
  }

  private fireGun(a: Aircraft, damage: number, spread: number, color: number, speed = 1100, life = 1.8, splash = 0, aim: THREE.Vector3 | null = null, hitScale = 1): void {
    const q = a.flight.quat;
    forwardOf(q, _fwd);
    rightOf(q, _right);
    upOf(q, _up);
    a.gunSide = -a.gunSide;
    _v.copy(a.flight.pos).addScaledVector(_fwd, 8.5).addScaledVector(_right, a.gunSide * 0.9).addScaledVector(_up, 0.2);
    this.bullets.fire(a, a.team, _v, aim ?? _fwd, speed, a.flight.vel, damage, spread, life, color, false, splash, hitScale);
    this.effects.glow.emit(FX.muzzle, _v.x, _v.y, _v.z, a.flight.vel.x, a.flight.vel.y, a.flight.vel.z);
    this.sfx.gun(a === this.player ? 0 : a.flight.pos.distanceTo(this.camera.position));
  }

  private firePlayerMissile(): void {
    const p = this.player;
    const spec = MISSILES[this.missile];
    const rails = this.rails[this.missile];
    const rail = rails.findIndex((r) => r <= 0);
    if (rail < 0) return;
    rails[rail] = spec.reload;
    const q = p.flight.quat;
    forwardOf(q, _fwd);
    rightOf(q, _right);
    upOf(q, _up);
    const dmg = this.boostActive("damage") ? BOOST_FX.damage : 1;
    if (!spec.guided) {
      // Salva de foguetes: leque pequeno a partir dos dois casulos.
      for (let k = 0; k < spec.salvo; k++) {
        const side = k % 2 ? 1 : -1;
        _v.copy(p.flight.pos).addScaledVector(_right, side * 3.6).addScaledVector(_up, -0.9).addScaledVector(_fwd, k * 1.5);
        _v2.copy(_fwd).addScaledVector(_right, randSigned() * 0.018).addScaledVector(_up, randSigned() * 0.018).normalize();
        this.missiles.launch(p, "blue", _v, _v2, p.flight.speed + 40, null, spec.spec, dmg);
      }
      this.sfx.missile();
      return;
    }
    _v.copy(p.flight.pos).addScaledVector(_right, rail % 2 === 0 ? 3.6 : -3.6).addScaledVector(_up, -0.9);
    const target = this.lock.locked ? this.lock.target : null;
    this.missiles.launch(p, "blue", _v, _fwd, p.flight.speed + 15, target, spec.spec, dmg);
    this.sfx.missile();
  }

  private deployFlares(a: Aircraft): void {
    if (a.flares <= 0 || a.flareQueue > 0) return;
    a.flares--;
    a.flareQueue = 6;
    a.flareTimer = 0;
    if (a === this.player) this.sfx.flare();
  }

  private updateAircraftSystems(a: Aircraft, dt: number): void {
    if (!a.alive) return;
    a.rails[0] = Math.max(0, a.rails[0] - dt);
    a.rails[1] = Math.max(0, a.rails[1] - dt);
    if (a.flares < MAX_FLARES) {
      a.flareRecharge += dt;
      if (a.flareRecharge >= 9) {
        a.flares++;
        a.flareRecharge = 0;
      }
    }
    a.flareTimer -= dt;
    while (a.flareQueue > 0 && a.flareTimer <= 0) {
      const first = a.flareQueue === 6;
      a.flareQueue--;
      a.flareTimer += 0.09;
      rightOf(a.flight.quat, _right);
      upOf(a.flight.quat, _up);
      _v2.copy(a.flight.vel).multiplyScalar(0.6).addScaledVector(_right, (a.flareQueue % 2 ? 1 : -1) * rand(14, 30)).addScaledVector(_up, -12);
      const flare = this.flares.spawn(a.flight.pos, _v2);
      if (first) this.missiles.decoy(a, flare, a === this.player ? 0.85 : 0.6);
    }
    // Avião avariado solta fumaça: feedback de dano sem precisar olhar barra de vida.
    if (a.health < 45 && Math.random() < dt * 30) {
      forwardOf(a.flight.quat, _fwd);
      _v.copy(a.flight.pos).addScaledVector(_fwd, -8);
      this.effects.smoke.emit(FX.wreckSmoke, _v.x, _v.y, _v.z, 0, 0, 0, a.health < 25 ? 1.3 : 0.8);
    }
  }

  /* ---------------- Inimigos ---------------- */

  private spawnWave(): void {
    this.wave++;
    const diff = this.difficulty;
    const count = clamp(1 + this.wave + diff.extraEnemies, 1, 8);
    const skill = clamp(0.3 + this.wave * 0.09 + diff.skillOffset, 0.05, 1);
    const p = this.player.flight.pos;
    // Agilidade e velocidade do inimigo por dificuldade: no Recruta o jogador sempre vence a curva.
    const enemyParams = {
      ...ENEMY_JET,
      pitchRate: ENEMY_JET.pitchRate * diff.enemyAgility,
      rollRate: ENEMY_JET.rollRate * diff.enemyAgility,
      maxSpeed: ENEMY_JET.maxSpeed * diff.enemySpeed,
      maxThrust: ENEMY_JET.maxThrust * diff.enemySpeed * diff.enemySpeed,
    };
    for (let i = 0; i < count; i++) {
      const a = rand(-1.2, 1.2) + Math.atan2(-p.x, -p.z);
      const r = rand(4500, 6000);
      const x = clamp(p.x + Math.sin(a) * r, -ARENA_RADIUS + 1500, ARENA_RADIUS - 1500);
      const z = clamp(p.z + Math.cos(a) * r, -ARENA_RADIUS + 1500, ARENA_RADIUS - 1500);
      const pos = new THREE.Vector3(x, this.terrain.heightAt(x, z) + rand(600, 1300), z);
      const heading = Math.atan2(-(p.x - x), -(p.z - z));
      const name = `${CALLSIGNS[i % CALLSIGNS.length]} ${this.wave}-${i + 1}`;
      const plane = new Aircraft("red", name, enemyParams, pos, heading, 230);
      plane.flares = 2;
      plane.addTo(this.scene);
      this.enemies.push({
        plane,
        pilot: new AIPilot(plane, skill, { gunCone: diff.enemyGunCone, gunRange: diff.enemyGunRange, missileCooldown: diff.enemyMissileCooldown }),
      });
    }
    this.message(`Onda ${this.wave}: ${count} caça${count > 1 ? "s" : ""} inimigo${count > 1 ? "s" : ""}`, COLORS.amber, true);
  }

  private updateEnemies(dt: number): void {
    const target = this.player;
    // Ficha de ataque: só os N inimigos mais próximos engajam; os demais esperam em órbita.
    const alive = this.enemies.filter((e) => e.plane.alive);
    alive.sort((a, b) => a.plane.flight.pos.distanceToSquared(target.position) - b.plane.flight.pos.distanceToSquared(target.position));
    alive.forEach((e, i) => (e.pilot.engage = i < this.difficulty.attackers));
    for (const e of this.enemies) {
      const a = e.plane;
      if (!a.alive) continue;
      const threatened = this.missiles.threatsTo(a).nearest < 1800;
      const out = e.pilot.think(dt, target, this.terrain, threatened);
      stepFlight(a.flight, out.controls, dt, a.params);
      a.gunCooldown -= dt;
      if (out.fireGun && target.alive && this.phase === "playing") {
        while (a.gunCooldown <= 0) {
          this.fireGun(a, (3 + this.wave * 0.35) * this.difficulty.enemyDamage, 0.013 - e.pilot.skill * 0.006, 0xff6a4a);
          a.gunCooldown += 0.09;
        }
      } else a.gunCooldown = Math.max(a.gunCooldown, 0);
      if (out.fireMissile && target.alive && this.phase === "playing") {
        const q = a.flight.quat;
        forwardOf(q, _fwd);
        _v.copy(a.flight.pos).addScaledVector(upOf(q, _up), -1);
        this.missiles.launch(a, "red", _v, _fwd, a.flight.speed + 15, target, ENEMY_MISSILE);
        this.sfx.missile();
        this.message("Míssil inimigo lançado!", COLORS.red);
      }
      if (out.deployFlares) this.deployFlares(a);
    }
  }

  /* ---------------- Alvos terrestres ---------------- */

  private updateGround(dt: number): void {
    const p = this.player;
    for (const t of this.ground) {
      if (!t.alive) {
        if (t.smokeTime > 0) {
          t.smokeTime -= dt;
          if (Math.random() < dt * 5) {
            this.effects.smoke.emit(FX.column, t.position.x + randSigned() * 2, t.position.y + 2, t.position.z + randSigned() * 2, 0, 3, 0, t.type === "fuel" ? 1.3 : 0.8);
          }
        }
        continue;
      }
      if (t.type !== "aa" || !p.alive || this.phase !== "playing") continue;
      const d = t.position.distanceTo(p.flight.pos);
      if (d > 2600) continue;

      const tof = d / 850;
      _v.copy(p.flight.pos).addScaledVector(p.flight.vel, tof);
      _v.y += 0.5 * 4.9 * tof * tof;
      const dx = _v.x - t.position.x;
      const dy = _v.y - t.position.y - 2.5;
      const dz = _v.z - t.position.z;
      const g = t.model.group;
      if (t.model.turret) t.model.turret.rotation.y = Math.atan2(-dx, -dz) - g.rotation.y;
      if (t.model.barrels) t.model.barrels.rotation.x = Math.atan2(dy, Math.hypot(dx, dz));

      t.fireTimer -= dt;
      const pAlt = p.flight.pos.y - this.terrain.heightAt(p.flight.pos.x, p.flight.pos.z);
      if (t.burstLeft === 0 && t.fireTimer <= 0 && pAlt > 15) {
        t.burstLeft = 8 + Math.min(this.wave, 6);
        t.fireTimer = (rand(2.2, 3.6) - Math.min(1, this.wave * 0.1)) * this.difficulty.aaCooldown;
      }
      t.shotTimer -= dt;
      while (t.burstLeft > 0 && t.shotTimer <= 0) {
        t.burstLeft--;
        t.shotTimer += 0.075;
        _v2.copy(t.position).setY(t.position.y + 2.5);
        const dir = _v.clone().sub(_v2).normalize();
        this.bullets.fire(t, "red", _v2, dir, 850, new THREE.Vector3(), 3 * this.difficulty.aaDamage, 0.012, tof + rand(-0.15, 0.3), 0xffa64a, true);
        this.sfx.gun(t.position.distanceTo(this.camera.position) + 400);
      }
      if (t.shotTimer < 0 && t.burstLeft === 0) t.shotTimer = 0;
    }
  }

  /* ---------------- Dano e abates ---------------- */

  private damage(target: Combatant, amount: number, owner: Combatant | null): void {
    if (!target.isAlive() || amount <= 0) return;
    const byPlayer = owner === this.player;
    if (target instanceof Aircraft) {
      if (target === this.player) {
        amount *= this.difficulty.damageTaken * (this.boostActive("shield") ? BOOST_FX.shield : 1);
        if (owner) {
          this.damageIndicators.push({ from: owner.position.clone(), t: this.time });
          if (this.damageIndicators.length > 6) this.damageIndicators.shift();
        }
      }
      target.health -= amount;
      target.lastHitAt = this.time;
      if (target === this.player) {
        this.damageFlash = Math.min(1, this.damageFlash + amount / 35);
        this.shake = Math.min(1.5, this.shake + amount / 25);
        this.sfx.hurt();
      }
      if (byPlayer) {
        this.hitMarker = 0.15;
        this.sfx.hitConfirm();
      }
      if (target.health <= 0) this.killAircraft(target, owner);
      return;
    }
    const t = target as GroundTarget;
    t.health -= amount;
    if (byPlayer) {
      this.hitMarker = 0.15;
      this.sfx.hitConfirm();
    }
    if (t.health <= 0) this.destroyGround(t, owner);
  }

  private killAircraft(a: Aircraft, owner: Combatant | null): void {
    if (!a.alive) return;
    a.alive = false;
    a.health = 0;
    a.wreckSpin = randSigned() * 2.5 || 1;
    a.wreckAge = 0;
    this.effects.explosion(a.flight.pos, 1.3);
    this.sfx.explosion(a.flight.pos.distanceTo(this.camera.position));
    if (this.lock.target === a) this.lock.target = null;

    if (a === this.player) {
      this.phase = "dying";
      this.deathTimer = 4;
      this.deathFocus.copy(a.flight.pos);
      this.message(this.outTimer > OUT_LIMIT ? "Abatido por abandonar a área" : "Você foi abatido", COLORS.red, true);
      this.log(owner instanceof Aircraft ? `${owner.name} abateu você` : "Você caiu", false);
      return;
    }
    if (owner === this.player) {
      this.kills++;
      this.killMarker = 0.5;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.streakTimer = BOOST_FX.streakWindow;
      this.addScore(100 + (this.streak - 1) * 25, "abate");
      this.message(this.streak > 1 ? `Caça abatido · sequência x${this.streak}` : "Caça abatido", COLORS.amber, true);
      this.log(`Você abateu ${a.name}`, true);
      // Recompensas: todo abate dá velocidade e um reparo; sequências liberam recarga e munição perfurante.
      this.grantBoost("speed");
      this.player.health = Math.min(100, this.player.health + 10);
      if (this.streak % 2 === 0) this.grantBoost("reload");
      if (this.streak % 3 === 0) this.grantBoost("damage");
    } else {
      this.log(`${a.name} caiu`, false);
    }
  }

  private destroyGround(t: GroundTarget, owner: Combatant | null): void {
    t.destroy();
    this.effects.groundBlast(t.position, t.type === "fuel" ? 2 : 1.3);
    this.sfx.explosion(t.position.distanceTo(this.camera.position));
    if (this.lock.target === t) this.lock.target = null;
    if (owner === this.player) {
      this.groundKills++;
      this.addScore(t.score, t.label.toLowerCase());
      this.player.health = Math.min(100, this.player.health + 4);
    }
    const base = t.base;
    if (!base.captured && base.remaining === 0) {
      base.captured = true;
      this.addScore(250, `base ${base.id}`);
      this.message(`Base ${base.id} neutralizada`, COLORS.teal, true);
      // Base caída: blindagem, todos os trilhos recarregados e flares cheios.
      this.grantBoost("shield");
      for (const id of MISSILE_ORDER) this.rails[id].fill(0);
      this.player.flares = MAX_FLARES;
      this.log(`Base ${base.id} neutralizada`, true);
      if (this.bases.every((b) => b.captured)) {
        this.rebuildTimer = 35;
        this.message("Todas as bases caíram. Reforços em 35 s", COLORS.teal);
      }
    }
  }

  private checkTerrain(): void {
    for (const a of this.aircraft()) {
      if (!a.alive) continue;
      const f = a.flight;
      if (f.pos.y - this.terrain.heightAt(f.pos.x, f.pos.z) < 2) {
        f.pos.y = this.terrain.heightAt(f.pos.x, f.pos.z) + 2;
        this.killAircraft(a, null);
      }
    }
  }

  private updateWrecks(dt: number): void {
    for (const a of this.aircraft()) {
      if (a.alive) continue;
      const f = a.flight;
      a.wreckAge += dt;
      f.vel.y -= 14 * dt;
      f.vel.multiplyScalar(Math.exp(-0.25 * dt));
      f.pos.addScaledVector(f.vel, dt);
      _v.set(0, 0, 1);
      f.quat.multiply(new THREE.Quaternion().setFromAxisAngle(_v, a.wreckSpin * dt));
      if (Math.random() < dt * 40) {
        this.effects.glow.emit(FX.wreckFire, f.pos.x, f.pos.y, f.pos.z, 0, 0, 0, 1.4);
        this.effects.smoke.emit(FX.wreckSmoke, f.pos.x, f.pos.y, f.pos.z, 0, 0, 0, 1.2);
      }
      if (a === this.player) this.deathFocus.copy(f.pos);
      const h = this.terrain.heightAt(f.pos.x, f.pos.z);
      if (f.pos.y - h < 1.5 || a.wreckAge > 15) {
        _v.set(f.pos.x, h + 2, f.pos.z);
        this.effects.groundBlast(_v, 1.8);
        this.sfx.explosion(_v.distanceTo(this.camera.position));
        a.removed = true;
        a.mesh.group.visible = false;
        a.shadow.visible = false;
      }
    }
    const before = this.enemies.length;
    this.enemies = this.enemies.filter((e) => {
      if (e.plane.removed) e.plane.removeFrom(this.scene);
      return !e.plane.removed;
    });
    if (before !== this.enemies.length) this.updateThreat();
  }

  /* ---------------- Trava de míssil e ameaças ---------------- */

  private updateLock(dt: number): void {
    const p = this.player;
    const l = this.lock;
    if (!p.alive) {
      l.target = null;
      l.locked = false;
      return;
    }
    const spec = MISSILES[this.missile];
    if (!spec.guided) {
      l.target = null;
      l.locked = false;
      return;
    }
    forwardOf(p.flight.quat, _fwd);
    const angleTo = (t: Combatant) => _fwd.angleTo(_v.subVectors(t.position, p.flight.pos));
    // Cada míssil define o que trava, até onde e em que cone (radar: longe e estreito; AGM: só solo).
    const canTarget = (t: Combatant) => spec.targets === "any" || spec.targets === t.kind;
    const range = (t: Combatant) => (t.kind === "ground" ? Math.min(spec.range, 3600) : spec.range);
    const inRange = (t: Combatant, slack: number) => t.position.distanceTo(p.flight.pos) < range(t) * slack;
    // Dois cones: aquisição (onde a trava progride) e rastreio, 2,5× maior, onde o sensor segura o alvo.
    // Antes a trava zerava no primeiro quadro fora de um cone de 17°: contra um caça manobrando, nunca fechava.
    const acquire = spec.cone * 1.5;
    const track = spec.cone * 2.5;

    if (l.target && l.target.isAlive() && canTarget(l.target) && inRange(l.target, 1.15) && angleTo(l.target) < track) {
      l.grace = LOCK_GRACE;
      if (angleTo(l.target) < acquire || l.locked) l.time = Math.min(l.time + dt, this.lockTimeNeeded);
    } else if (l.target && l.grace > 0) {
      // Alvo saiu do sensor: breve tolerância, progresso escorre em vez de zerar.
      l.grace -= dt;
      l.time = Math.max(0, l.time - dt * 1.5);
      if (l.time < this.lockTimeNeeded) l.locked = false;
    } else {
      let best: Combatant | null = null;
      let bestScore = Infinity;
      for (const t of this.combatants) {
        if (t.team === p.team || !t.isAlive() || !canTarget(t) || !inRange(t, 1)) continue;
        const a = angleTo(t);
        if (a > acquire) continue;
        // Ângulo domina; distância desempata (prefere o mais perto quando dois estão alinhados).
        const score = a + (t.position.distanceTo(p.flight.pos) / range(t)) * 0.15;
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (best !== l.target) l.time = 0;
      l.target = best;
      l.grace = LOCK_GRACE;
      l.locked = false;
    }
    if (l.target && l.time >= this.lockTimeNeeded) {
      if (!l.locked) this.sfx.hitConfirm();
      l.locked = true;
    }
  }

  private updateThreat(): void {
    const th = this.missiles.threatsTo(this.player);
    this.threat.missiles = th.count;
    this.threat.nearest = th.nearest;
    this.threat.from = th.from;
    this.threat.locking = this.enemies.some((e) => e.plane.alive && e.pilot.locking);
  }

  /* ---------------- Regras: ondas, bases, fim ---------------- */

  private updateRules(dt: number): void {
    if (this.phase === "playing") {
      const alive = this.enemies.some((e) => e.plane.alive);
      if (!alive && !this.pendingWave) {
        this.pendingWave = true;
        this.waveTimer = 5;
        if (this.wave > 0) {
          this.addScore(200, "onda");
          this.message(`Onda ${this.wave} concluída`, COLORS.teal, true);
        }
      }
      if (this.pendingWave) {
        this.waveTimer -= dt;
        if (this.waveTimer <= 0) {
          this.pendingWave = false;
          this.spawnWave();
        }
      }
      if (this.rebuildTimer > 0) {
        this.rebuildTimer -= dt;
        if (this.rebuildTimer <= 0) {
          for (const b of this.bases) {
            b.captured = false;
            for (const t of b.targets) t.restore();
          }
          this.message("Bases inimigas reocupadas", COLORS.amber, true);
        }
      }
    }
    if (this.phase === "dying") {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.phase = "over";
        this.onGameOver(this.stats());
      }
    }
  }

  /* ---------------- Câmera e sombras ---------------- */

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const p = this.player;
    const f = p.flight;

    if (this.phase === "dying" || this.phase === "over") {
      this.orbit += dt * 0.3;
      _offset.set(Math.cos(this.orbit) * 70, 28, Math.sin(this.orbit) * 70);
      cam.position.copy(this.deathFocus).add(_offset);
      const gy = this.terrain.heightAt(cam.position.x, cam.position.z) + 3;
      if (cam.position.y < gy) cam.position.y = gy;
      cam.lookAt(this.deathFocus);
      p.mesh.group.visible = !p.removed;
      return;
    }

    const cockpit = this.cameraMode === "cockpit" && this.phase === "playing";
    p.mesh.group.visible = !cockpit;
    if (cockpit) {
      upOf(f.quat, _up);
      forwardOf(f.quat, _fwd);
      cam.position.copy(f.pos).addScaledVector(_up, 1.15).addScaledVector(_fwd, -3.2);
      cam.quaternion.copy(f.quat);
      this.camQuat.copy(f.quat);
    } else {
      // Câmera presa à orientação suavizada do avião: o jato "escorrega" no quadro durante manobras.
      this.camQuat.slerp(f.quat, damp(this.phase === "attract" ? 2 : 6, dt));
      if (this.phase === "attract") _offset.set(16, 3, 30);
      else _offset.set(0, 5.2, 24);
      _offset.applyQuaternion(this.camQuat);
      cam.position.copy(f.pos).add(_offset);
      cam.quaternion.copy(this.camQuat).multiply(_tilt);
      if (this.phase === "attract") cam.lookAt(f.pos);
    }
    const gy = this.terrain.heightAt(cam.position.x, cam.position.z) + 2;
    if (cam.position.y < gy) cam.position.y = gy;

    if (this.shake > 0.001) {
      cam.position.x += randSigned() * this.shake * 0.8;
      cam.position.y += randSigned() * this.shake * 0.8;
      cam.position.z += randSigned() * this.shake * 0.8;
      this.shake *= Math.exp(-6 * dt);
    }

    const ab = Math.max(0, (f.throttle - 0.85) / 0.15);
    const fov = 62 + clamp((f.speed - 150) / 160, 0, 1) * 9 + ab * 3 + (this.boostActive("speed") ? 5 : 0);
    if (Math.abs(fov - this.lastFov) > 0.05) {
      cam.fov = this.lastFov = this.lastFov + (fov - this.lastFov) * damp(3, dt);
      cam.updateProjectionMatrix();
    }
  }

  private updateShadow(a: Aircraft): void {
    const f = a.flight;
    const sun = this.world.sunDir;
    const alt = f.pos.y - this.terrain.heightAt(f.pos.x, f.pos.z);
    const s = a.shadow;
    if (alt > 450 || a.removed) {
      s.visible = false;
      return;
    }
    s.visible = true;
    // Projeção na direção do sol (aproximação de chão plano sob o avião).
    const t = alt / sun.y;
    const x = f.pos.x - sun.x * t;
    const z = f.pos.z - sun.z * t;
    s.position.set(x, this.terrain.heightAt(x, z) + 0.4, z);
    forwardOf(f.quat, _fwd);
    s.rotation.y = Math.atan2(-_fwd.x, -_fwd.z);
    s.scale.set(Math.max(0.2, Math.abs(Math.cos(bankAngle(f.quat)))), 1, Math.max(0.3, Math.sqrt(1 - _fwd.y * _fwd.y)));
    s.material.opacity = 0.42 * (1 - alt / 450);
  }
}
