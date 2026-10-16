import * as THREE from "three";
import { Aircraft } from "./aircraft";
import { GroundTarget } from "./ground";
import { bankAngle, forwardOf, pitchAngle } from "./flight";
import { COLORS, type Game } from "./game";
import { BOOSTS, BOOST_ORDER, GUNS, MISSILES } from "./loadout";
import { PHASES } from "./campaign";
import { DRONE_SHOTS, WARHEADS } from "./drone";
import { RING_INFO } from "./rings";
import { clamp, formatDistance } from "./math";
import { ctx2d } from "./textures";
import { ARENA_RADIUS } from "./terrain";

const FONT = '"Chakra Petch", ui-monospace, "SFMono-Regular", Menlo, monospace';
const RADAR_RANGE = 4500;
const TEAL_DIM = "rgba(95,227,207,0.85)";
const TEAL_FAINT = "rgba(95,227,207,0.35)";
const PANEL = "rgba(8,20,24,0.5)";
const TAU = Math.PI * 2;

interface Screen {
  x: number;
  y: number;
  front: boolean;
  onScreen: boolean;
}

const _cam = new THREE.Vector3();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _acc = new THREE.Vector3();

/** Ângulo de proa (0 = norte = -Z, sentido horário) de um vetor no plano XZ. */
const headingOf = (x: number, z: number): number => {
  const h = Math.atan2(x, -z);
  return h < 0 ? h + TAU : h;
};
/** Diferença angular em (-π, π]. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * HUD num canvas 2D sobreposto (não DOM): dezenas de marcadores por quadro sem custo de layout/reflow.
 * Desenhado em pixels CSS com transform de DPR para ficar nítido em telas retina.
 */
export class Hud {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  touchLayout = false;

  // Carga G estimada pela variação do vetor velocidade entre quadros (suavizada).
  private readonly prevVel = new THREE.Vector3();
  private prevTime = -1;
  private gLoad = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = ctx2d(canvas);
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  private project(p: THREE.Vector3, cam: THREE.Camera): Screen {
    _cam.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const front = _cam.z < 0;
    const cx = _cam.x;
    const cy = _cam.y;
    _cam.applyMatrix4((cam as THREE.PerspectiveCamera).projectionMatrix);
    const x = ((_cam.x + 1) / 2) * this.w;
    const y = ((1 - _cam.y) / 2) * this.h;
    if (!front) {
      // Atrás da câmera a projeção inverte; usa a direção no espaço da câmera para a seta de borda.
      return { x: this.w / 2 + cx * 1e4, y: this.h / 2 - cy * 1e4, front, onScreen: false };
    }
    return { x, y, front, onScreen: x > 0 && x < this.w && y > 0 && y < this.h };
  }

  draw(g: Game): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (g.phase === "attract") {
      this.prevTime = -1;
      return;
    }
    const cam = g.camera;
    cam.updateMatrixWorld();
    const p = g.player;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.textBaseline = "middle";
    this.measureG(g);

    if (g.drone.active && p.alive) {
      this.droneView(g, cam);
      this.messages(g);
      return;
    }
    this.vignette(g);
    if (!p.alive) {
      this.messages(g);
      return;
    }

    const compact = this.w < 700 || (this.touchLayout && this.h < 500);
    this.bases(g, cam);
    this.rings(g, cam);
    this.ground(g, cam);
    this.enemies(g, cam);
    this.pitchLadder(g, compact);
    this.reticle(g, cam);
    this.lock(g, cam);
    this.damageArcs(g);
    this.tapes(g, compact);
    this.headingTape(g, compact);
    this.health(g, compact);
    this.weapons(g, compact);
    this.radar(g, compact);
    this.targetPanel(g, compact);
    const below = this.scoreboard(g, compact);
    this.objectives(g, below + 22);
    this.droneBar(g, compact);
    this.warnings(g);
    this.popups(g);
    this.messages(g);
    this.feed(g, compact);
  }

  /* ---------- primitivas ---------- */

  private text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", weight = 600): void {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    c.textAlign = align;
    c.lineWidth = 3;
    c.strokeStyle = "rgba(6,14,16,0.55)";
    c.strokeText(s, x, y);
    c.fillStyle = color;
    c.fillText(s, x, y);
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: string, bg = PANEL): void {
    const c = this.ctx;
    c.fillStyle = bg;
    c.fillRect(x, y, w, h);
    c.fillStyle = color;
    c.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    const k = 6;
    c.beginPath();
    c.moveTo(x + k, y);
    c.lineTo(x + w, y);
    c.lineTo(x + w, y + h - k);
    c.lineTo(x + w - k, y + h);
    c.lineTo(x, y + h);
    c.lineTo(x, y + k);
    c.closePath();
    c.fillStyle = PANEL;
    c.fill();
    c.strokeStyle = TEAL_FAINT;
    c.lineWidth = 1;
    c.stroke();
  }

  private edgeArrow(s: Screen, color: string): void {
    const c = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const ang = Math.atan2(s.y - cy, s.x - cx);
    const x = cx + Math.cos(ang) * this.w * 0.44;
    const y = cy + Math.sin(ang) * this.h * 0.4;
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.beginPath();
    c.moveTo(10, 0);
    c.lineTo(-6, -7);
    c.lineTo(-3, 0);
    c.lineTo(-6, 7);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    c.restore();
  }

  private measureG(g: Game): void {
    const f = g.player.flight;
    if (this.prevTime >= 0 && g.time > this.prevTime) {
      const dt = g.time - this.prevTime;
      _acc.subVectors(f.vel, this.prevVel).divideScalar(dt);
      _acc.y += 9.81; // força específica = aceleração − gravidade
      const inst = _acc.length() / 9.81;
      this.gLoad += (clamp(inst, 0, 12) - this.gLoad) * Math.min(1, dt * 6);
    }
    this.prevVel.copy(f.vel);
    this.prevTime = g.time;
  }

  /* ---------- camadas ---------- */

  private vignette(g: Game): void {
    const lowHp = g.player.alive ? clamp((45 - g.player.health) / 45, 0, 1) * (0.55 + 0.25 * Math.sin(g.time * 6)) : 0;
    const a = Math.max(g.damageFlash, lowHp * 0.6);
    const c = this.ctx;
    const r = Math.hypot(this.w, this.h) / 2;
    if (a > 0.01) {
      const grad = c.createRadialGradient(this.w / 2, this.h / 2, r * 0.45, this.w / 2, this.h / 2, r);
      grad.addColorStop(0, "rgba(180,20,10,0)");
      grad.addColorStop(1, `rgba(180,20,10,${(a * 0.6).toFixed(3)})`);
      c.fillStyle = grad;
      c.fillRect(0, 0, this.w, this.h);
    }
    // Boost de velocidade: linhas de borda azuladas (sensação de impulso).
    if (g.boostActive("speed")) {
      const k = Math.min(1, g.boosts.speed / 2) * 0.25;
      const grad = c.createRadialGradient(this.w / 2, this.h / 2, r * 0.55, this.w / 2, this.h / 2, r);
      grad.addColorStop(0, "rgba(109,180,255,0)");
      grad.addColorStop(1, `rgba(109,180,255,${k.toFixed(3)})`);
      c.fillStyle = grad;
      c.fillRect(0, 0, this.w, this.h);
    }
  }

  private bases(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    for (const b of g.bases) {
      _v.copy(b.center).setY(b.center.y + 30);
      const s = this.project(_v, cam);
      if (!s.onScreen) continue;
      const color = b.captured ? COLORS.blue : COLORS.amber;
      const r = 13;
      c.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + Math.PI / 6;
        const x = s.x + Math.cos(a) * r;
        const y = s.y + Math.sin(a) * r;
        if (k) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.closePath();
      c.fillStyle = b.captured ? "rgba(40,90,160,0.55)" : "rgba(150,70,10,0.55)";
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = color;
      c.stroke();
      this.text(b.id, s.x, s.y + 1, 14, COLORS.white, "center", 700);
      const d = g.player.flight.pos.distanceTo(b.center);
      const left = b.captured ? "OK" : `${b.remaining} alvos`;
      this.text(`${formatDistance(d)} · ${left}`, s.x, s.y + 24, 11, color);
    }
  }

  private rings(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    const pp = g.player.flight.pos;
    for (const r of g.rings.rings) {
      if (!r.active) continue;
      const d = pp.distanceTo(r.center);
      if (d > 4000) continue;
      const s = this.project(r.center, cam);
      if (!s.onScreen) continue;
      const color = RING_INFO[r.kind].color;
      c.strokeStyle = color;
      c.lineWidth = 1.5;
      c.setLineDash([4, 4]);
      c.beginPath();
      c.arc(s.x, s.y, 11, 0, TAU);
      c.stroke();
      c.setLineDash([]);
      this.text(formatDistance(d), s.x, s.y + 20, 10, color);
    }
  }

  /** Objetivos da fase (campanha) logo abaixo do placar; cartão central no início da fase. */
  private objectives(g: Game, startY: number): void {
    if (!g.campaign) return;
    const ph = g.currentPhase;
    const list = g.objectives();
    const x = 16;
    let y = startY;
    this.text(`FASE ${g.phaseIndex + 1}/${PHASES.length} · ${ph.title.toUpperCase()}`, x, y, 11, COLORS.teal, "left", 700);
    for (const o of list) {
      y += 16;
      const color = o.done ? COLORS.teal : COLORS.white;
      this.text(`${o.done ? "✓" : "○"} ${o.label}  ${o.current}/${o.need}`, x, y, 11, color, "left", o.done ? 700 : 500);
    }
    if (g.phaseBanner > 0) {
      const a = clamp(g.phaseBanner, 0, 1);
      this.ctx.globalAlpha = a;
      this.text(`FASE ${g.phaseIndex + 1}`, this.w / 2, this.h * 0.36, 28, COLORS.white, "center", 700);
      this.text(ph.title.toUpperCase(), this.w / 2, this.h * 0.36 + 28, 15, COLORS.teal, "center", 700);
      this.ctx.globalAlpha = 1;
    }
  }

  /** Barra roxa do drone, logo acima do painel de armas. */
  private droneBar(g: Game, compact: boolean): void {
    const w = compact ? 230 : 300;
    const top = this.touchLayout && this.w < 640;
    const x = this.w / 2 - w / 2;
    const y = top ? 134 : this.h - 52 - (this.touchLayout ? 8 : 16) - 22;
    const full = g.droneCharge >= 1;
    const color = "#c08cff";
    this.bar(x, y, w, 4, g.droneCharge, color);
    const blink = full && Math.floor(g.time * 3) % 2 === 0;
    this.text(full ? `DRONE PRONTO${this.touchLayout ? "" : " · B"}` : `DRONE ${Math.floor(g.droneCharge * 100)}%`, x + w, y - 7, 9, blink ? COLORS.white : color, "right", 700);
  }

  /** Tela do drone: retículo de sensor, alvos quentes marcados, tempo, munição e ogiva. */
  private droneView(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    const d = g.drone;
    const W = this.w;
    const H = this.h;
    const green = "rgba(220,255,220,0.9)";
    // Alvos quentes
    for (const t of g.ground) {
      if (!t.alive) continue;
      const s = this.project(t.position, cam);
      if (!s.onScreen) continue;
      c.strokeStyle = d.snapped === t ? COLORS.red : green;
      c.lineWidth = d.snapped === t ? 2.4 : 1.2;
      c.strokeRect(s.x - 9, s.y - 9, 18, 18);
      if (t.type === "aa") this.text("AA", s.x, s.y - 16, 9, green);
    }
    for (const e of g.enemies) {
      if (!e.plane.alive) continue;
      const s = this.project(e.plane.flight.pos, cam);
      if (!s.onScreen) continue;
      c.strokeStyle = d.snapped === e.plane ? COLORS.red : green;
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(s.x, s.y - 10);
      c.lineTo(s.x + 10, s.y);
      c.lineTo(s.x, s.y + 10);
      c.lineTo(s.x - 10, s.y);
      c.closePath();
      c.stroke();
    }
    // Retículo central
    const cx = W / 2;
    const cy = H / 2;
    c.strokeStyle = green;
    c.lineWidth = 1.5;
    c.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      c.moveTo(cx + dx * 14, cy + dy * 14);
      c.lineTo(cx + dx * 60, cy + dy * 60);
    }
    c.stroke();
    const k = 28;
    c.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      c.moveTo(cx + sx * k, cy + sy * (k - 10));
      c.lineTo(cx + sx * k, cy + sy * k);
      c.lineTo(cx + sx * (k - 10), cy + sy * k);
    }
    c.stroke();
    // Moldura do sensor
    const m = 18;
    c.strokeStyle = "rgba(220,255,220,0.5)";
    c.beginPath();
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [W - m, H - m, -1, -1], [m, H - m, 1, -1]] as const) {
      c.moveTo(x, y + dy * 40);
      c.lineTo(x, y);
      c.lineTo(x + dx * 40, y);
    }
    c.stroke();

    const wh = WARHEADS[d.warhead];
    this.text("MQ-9 · FLIR BRANCO-QUENTE · ZOOM 3×", 30, 34, 11, green, "left", 700);
    this.text(`LASER ${d.snapped ? "TRAVADO NO ALVO" : "NO SOLO"}`, 30, 52, 11, d.snapped ? COLORS.red : green, "left", 700);
    const dist = d.position.distanceTo(d.spot.position);
    this.text(`DIST ${formatDistance(dist)}  ·  ALT ${Math.round(d.position.y)} m`, 30, 70, 10, green, "left", 500);
    this.text(`${wh.short}  ${d.shots}/${DRONE_SHOTS}`, W - 30, 34, 13, COLORS.white, "right", 700);
    this.text(d.cooldown > 0 ? "CARREGANDO" : "PRONTO", W - 30, 52, 10, d.cooldown > 0 ? COLORS.amber : green, "right", 700);
    this.text(this.touchLayout ? "MÍSSIL/CANHÃO dispara · MSL⇄ ogiva · DRONE sai" : "Espaço/Enter dispara · T troca ogiva · B sai", W / 2, H - 30, 11, green, "center", 500);
    // Tempo restante
    const bw = Math.min(320, W * 0.5);
    this.bar(W / 2 - bw / 2, 24, bw, 5, d.remainingFrac, d.timeLeft < 5 ? COLORS.red : "#c08cff");
    this.text(`${Math.ceil(d.timeLeft)} s`, W / 2, 40, 10, green, "center", 700);
  }

  private ground(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    const pp = g.player.flight.pos;
    for (const t of g.ground) {
      if (!t.alive) continue;
      const d = pp.distanceTo(t.position);
      if (d > 3600) continue;
      const s = this.project(t.position, cam);
      if (!s.onScreen) continue;
      const size = t.type === "aa" ? 6 : 4.5;
      c.lineWidth = 1.6;
      c.strokeStyle = t.type === "aa" ? COLORS.red : COLORS.amber;
      c.strokeRect(s.x - size, s.y - size, size * 2, size * 2);
      if (t.type === "aa" && d < 2600) this.text("AA", s.x, s.y - size - 8, 10, COLORS.red);
    }
  }

  private enemies(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    const p = g.player;
    const gun = GUNS[g.gun];
    for (const e of g.enemies) {
      const a = e.plane;
      if (!a.alive) continue;
      const s = this.project(a.flight.pos, cam);
      if (!s.onScreen) {
        this.edgeArrow(s, COLORS.red);
        continue;
      }
      const d = p.flight.pos.distanceTo(a.flight.pos);
      const r = 8;
      c.beginPath();
      c.moveTo(s.x, s.y - r);
      c.lineTo(s.x + r, s.y);
      c.lineTo(s.x, s.y + r);
      c.lineTo(s.x - r, s.y);
      c.closePath();
      c.lineWidth = 2;
      c.strokeStyle = COLORS.red;
      c.stroke();
      if (d < 3000) this.bar(s.x - 14, s.y + 12, 28, 3, a.health / a.maxHealth, COLORS.red, "rgba(60,10,8,0.6)");
      this.text(formatDistance(d), s.x, s.y + 23, 11, COLORS.red);
      if (d < 2500) this.text(a.name, s.x, s.y - 17, 10, "rgba(255,170,160,0.9)", "center", 500);

      // Indicador de tiro antecipado da metralhadora selecionada (velocidade de boca e queda dela).
      const maxRange = gun.speed * gun.life;
      if (d < maxRange && s.front) {
        let t = d / gun.speed;
        for (let k = 0; k < 2; k++) {
          _v.copy(a.flight.pos).addScaledVector(a.flight.vel, t).addScaledVector(p.flight.vel, -t);
          t = _v.distanceTo(p.flight.pos) / gun.speed;
        }
        _v.y += 0.5 * 4.9 * t * t;
        const l = this.project(_v, cam);
        if (l.onScreen) {
          c.beginPath();
          c.arc(l.x, l.y, 6, 0, TAU);
          c.lineWidth = 1.6;
          c.strokeStyle = COLORS.amber;
          c.stroke();
          c.beginPath();
          c.moveTo(s.x, s.y);
          c.lineTo(l.x, l.y);
          c.strokeStyle = "rgba(255,160,67,0.35)";
          c.stroke();
        }
      }
    }
  }

  /** Escada de arfagem leve (linhas a cada 10°) e marcador de inclinação; nítida no cockpit, sutil em 3ª pessoa. */
  private pitchLadder(g: Game, compact: boolean): void {
    const c = this.ctx;
    const q = g.player.flight.quat;
    const bank = bankAngle(q);
    const pitch = pitchAngle(q);
    const cockpit = g.cameraMode === "cockpit";
    const pxPerRad = this.h / ((g.camera.fov * Math.PI) / 180);
    const alpha = cockpit ? 0.6 : 0.22;
    c.save();
    c.translate(this.w / 2, this.h / 2);
    c.rotate(-bank);
    c.strokeStyle = `rgba(95,227,207,${alpha})`;
    c.lineWidth = 1.3;
    for (let deg = -80; deg <= 80; deg += 10) {
      const y = (pitch - (deg * Math.PI) / 180) * pxPerRad;
      if (Math.abs(y) > this.h * 0.36) continue;
      const half = deg === 0 ? (compact ? 120 : 170) : compact ? 38 : 52;
      c.setLineDash(deg < 0 ? [6, 5] : []);
      c.beginPath();
      c.moveTo(-half, y);
      c.lineTo(-34, y);
      c.moveTo(34, y);
      c.lineTo(half, y);
      if (deg !== 0) {
        const tick = deg > 0 ? 6 : -6;
        c.moveTo(-half, y);
        c.lineTo(-half, y + tick);
        c.moveTo(half, y);
        c.lineTo(half, y + tick);
      }
      c.stroke();
      if (deg !== 0 && cockpit) {
        c.setLineDash([]);
        this.text(String(Math.abs(deg)), -half - 14, y, 10, TEAL_DIM);
      }
    }
    c.restore();
    c.setLineDash([]);

    // Arco de inclinação acima da retícula (escala ±60°).
    const R = compact ? 92 : 120;
    const cx = this.w / 2;
    const cy = this.h / 2;
    c.strokeStyle = TEAL_FAINT;
    c.lineWidth = 1.2;
    c.beginPath();
    c.arc(cx, cy, R, -Math.PI / 2 - 1.05, -Math.PI / 2 + 1.05);
    c.stroke();
    for (const deg of [-60, -45, -30, -15, 0, 15, 30, 45, 60]) {
      const a = -Math.PI / 2 + (deg * Math.PI) / 180;
      const len = deg % 30 === 0 ? 8 : 4;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      c.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len));
      c.stroke();
    }
    const ba = -Math.PI / 2 + clamp(bank, -1.1, 1.1);
    c.fillStyle = COLORS.teal;
    c.beginPath();
    c.moveTo(cx + Math.cos(ba) * (R - 2), cy + Math.sin(ba) * (R - 2));
    c.lineTo(cx + Math.cos(ba - 0.05) * (R - 12), cy + Math.sin(ba - 0.05) * (R - 12));
    c.lineTo(cx + Math.cos(ba + 0.05) * (R - 12), cy + Math.sin(ba + 0.05) * (R - 12));
    c.closePath();
    c.fill();
  }

  private reticle(g: Game, cam: THREE.Camera): void {
    const c = this.ctx;
    const f = g.player.flight;
    forwardOf(f.quat, _fwd);
    _v.copy(f.pos).addScaledVector(_fwd, 700);
    const s = this.project(_v, cam);
    if (!s.front) return;
    const p = g.player;
    c.lineWidth = 1.8;
    c.strokeStyle = p.overheated ? COLORS.red : COLORS.teal;
    c.beginPath();
    c.arc(s.x, s.y, 16, 0, TAU);
    c.stroke();
    // Anel externo mostra o calor da metralhadora (fecha no sentido horário).
    if (p.gunHeat > 0.02) {
      c.strokeStyle = p.overheated ? COLORS.red : p.gunHeat > 0.7 ? COLORS.amber : "rgba(238,246,245,0.7)";
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(s.x, s.y, 21, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p.gunHeat, 0, 1));
      c.stroke();
    }
    c.strokeStyle = COLORS.teal;
    c.lineWidth = 1.8;
    c.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1]] as const) {
      c.moveTo(s.x + dx * 25, s.y + dy * 25);
      c.lineTo(s.x + dx * 32, s.y + dy * 32);
    }
    c.stroke();
    c.fillStyle = COLORS.teal;
    c.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);

    if (g.hitMarker > 0 || g.killMarker > 0) {
      const k = g.killMarker > 0;
      c.strokeStyle = k ? COLORS.red : COLORS.white;
      c.lineWidth = k ? 3 : 2;
      c.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        c.moveTo(s.x + dx * 7, s.y + dy * 7);
        c.lineTo(s.x + dx * 14, s.y + dy * 14);
      }
      c.stroke();
    }

    // Marcador do vetor velocidade (para onde o avião realmente vai).
    _v.copy(f.pos).addScaledVector(f.vel, 3);
    const m = this.project(_v, cam);
    if (m.onScreen && f.vel.lengthSq() > 100) {
      c.strokeStyle = "rgba(95,227,207,0.7)";
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(m.x, m.y, 5, 0, TAU);
      c.moveTo(m.x - 13, m.y);
      c.lineTo(m.x - 5, m.y);
      c.moveTo(m.x + 5, m.y);
      c.lineTo(m.x + 13, m.y);
      c.moveTo(m.x, m.y - 5);
      c.lineTo(m.x, m.y - 10);
      c.stroke();
    }
  }

  private lock(g: Game, cam: THREE.Camera): void {
    const l = g.lock;
    if (!l.target) return;
    const s = this.project(l.target.position, cam);
    if (!s.onScreen) return;
    const c = this.ctx;
    const prog = clamp(l.time / g.lockTimeNeeded, 0, 1);
    const size = l.locked ? 22 : 54 - prog * 30;
    c.lineWidth = l.locked ? 2.6 : 1.8;
    c.strokeStyle = l.locked ? COLORS.red : COLORS.amber;
    const k = size * 0.4;
    c.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const x = s.x + sx * size;
      const y = s.y + sy * size;
      c.moveTo(x - sx * k, y);
      c.lineTo(x, y);
      c.lineTo(x, y - sy * k);
    }
    c.stroke();
    if (l.locked) this.text("TRAVADO", s.x, s.y + size + 13, 12, COLORS.red, "center", 700);
    else this.text(`${Math.round(prog * 100)}%`, s.x, s.y + size + 12, 10, COLORS.amber);
  }

  /** Arcos vermelhos em volta do centro apontando de onde veio o dano (direção relativa à câmera). */
  private damageArcs(g: Game): void {
    const c = this.ctx;
    const cam = g.camera;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.28;
    for (const d of g.damageIndicators) {
      const age = g.time - d.t;
      if (age > 1.4) continue;
      _cam.copy(d.from).applyMatrix4(cam.matrixWorldInverse);
      // Plano da tela: x direita, "para frente" (−z) vira para cima.
      const ang = Math.atan2(_cam.z, _cam.x);
      c.strokeStyle = `rgba(255,70,55,${(0.85 * (1 - age / 1.4)).toFixed(3)})`;
      c.lineWidth = 6;
      c.beginPath();
      c.arc(cx, cy, R, ang - 0.28, ang + 0.28);
      c.stroke();
    }
  }

  /** Fitas verticais de velocidade (km/h) e altitude (m acima do solo), com escala rolante. */
  private tapes(g: Game, compact: boolean): void {
    const f = g.player.flight;
    const kmh = f.speed * 3.6;
    const agl = f.pos.y - g.terrain.heightAt(f.pos.x, f.pos.z);
    // Toque: fitas mais perto do centro para não colidir com a potência e os botões à direita.
    const gap = this.touchLayout ? Math.min(this.w * 0.15, 170) : compact ? this.w * 0.2 : 190;
    const th = compact ? 120 : 170;
    this.tape(this.w / 2 - gap, this.h / 2, th, kmh, 50, 100, "VEL km/h", "left", g.boostActive("speed") ? COLORS.blue : COLORS.white);
    this.tape(this.w / 2 + gap, this.h / 2, th, Math.max(0, agl), 50, 100, "ALT m", "right", agl < 120 ? COLORS.red : COLORS.white);

    const lx = this.w / 2 - gap - 4;
    const by = this.h / 2 + th / 2 + 14;
    const ab = f.throttle > 0.85;
    this.text(`POT ${Math.round(f.throttle * 100)}%${ab ? " PC" : ""}`, lx, by, 10, ab ? COLORS.amber : TEAL_DIM, "right");
    this.text(`M ${(f.speed / 340).toFixed(2).replace(".", ",")}`, lx, by + 14, 10, TEAL_DIM, "right");
    this.text(`G ${this.gLoad.toFixed(1).replace(".", ",")}`, lx, by + 28, 10, this.gLoad > 7 ? COLORS.amber : TEAL_DIM, "right");

    const rx = this.w / 2 + gap + 4;
    const vs = f.vel.y;
    this.text(`${vs >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(vs))} m/s`, rx, by, 10, vs < -40 && agl < 300 ? COLORS.red : TEAL_DIM, "left");
    this.text(`MSL ${Math.round(f.pos.y)} m`, rx, by + 14, 10, TEAL_DIM, "left");
  }

  private tape(x: number, cy: number, height: number, value: number, minor: number, major: number, label: string, side: "left" | "right", valueColor: string): void {
    const c = this.ctx;
    const pxPer = height / (major * 4); // 4 divisões maiores visíveis
    const dir = side === "left" ? -1 : 1;
    c.save();
    c.beginPath();
    c.rect(side === "left" ? x - 60 : x, cy - height / 2, 60, height);
    c.clip();
    c.strokeStyle = TEAL_DIM;
    c.lineWidth = 1;
    const start = Math.floor((value - (height / 2) / pxPer) / minor) * minor;
    for (let v = start; v <= value + height / 2 / pxPer + minor; v += minor) {
      if (v < 0) continue;
      const y = cy - (v - value) * pxPer;
      const isMajor = v % major === 0;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + dir * (isMajor ? 10 : 5), y);
      c.stroke();
      // Rótulos atrás da caixa do valor atual são omitidos (ficariam ilegíveis).
      if (isMajor && Math.abs(y - cy) > 16) this.text(String(v), x + dir * 14, y, 9, TEAL_DIM, side === "left" ? "right" : "left", 500);
    }
    c.restore();
    c.strokeStyle = TEAL_FAINT;
    c.beginPath();
    c.moveTo(x, cy - height / 2);
    c.lineTo(x, cy + height / 2);
    c.stroke();
    // Caixa do valor atual
    const bw = 62;
    const bx = side === "left" ? x - bw - 4 : x + 4;
    this.panel(bx, cy - 13, bw, 26);
    this.text(String(Math.round(value)), side === "left" ? bx + bw - 6 : bx + 6, cy + 1, 15, valueColor, side === "left" ? "right" : "left", 700);
    this.text(label, side === "left" ? bx + bw : bx, cy - height / 2 - 10, 9, TEAL_DIM, side === "left" ? "right" : "left");
  }

  /** Fita de proa no topo com bússola e marcadores de bases, inimigos e alvo travado. */
  private headingTape(g: Game, compact: boolean): void {
    const c = this.ctx;
    const f = g.player.flight;
    forwardOf(f.quat, _fwd);
    const hdg = headingOf(_fwd.x, _fwd.z);
    const w = compact ? Math.min(260, this.w * 0.5) : 380;
    const x0 = this.w / 2 - w / 2;
    const y = 14;
    const span = compact ? 70 : 90; // graus visíveis
    const pxPerDeg = w / span;
    c.save();
    c.beginPath();
    c.rect(x0 - 6, y - 4, w + 12, 46);
    c.clip();
    c.strokeStyle = TEAL_DIM;
    c.lineWidth = 1;
    const hdgDeg = (hdg * 180) / Math.PI;
    const first = Math.floor((hdgDeg - span / 2) / 5) * 5;
    const CARD: Record<number, string> = { 0: "N", 45: "NE", 90: "L", 135: "SE", 180: "S", 225: "SO", 270: "O", 315: "NO" };
    for (let d = first; d <= hdgDeg + span / 2 + 5; d += 5) {
      const x = this.w / 2 + (d - hdgDeg) * pxPerDeg;
      const n = ((d % 360) + 360) % 360;
      const big = n % 15 === 0;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x, y + (big ? 8 : 4));
      c.stroke();
      if (big) {
        const card = CARD[n];
        this.text(card ?? String(n / 10).padStart(2, "0"), x, y + 17, card ? 11 : 9, card ? COLORS.white : TEAL_DIM, "center", card ? 700 : 500);
      }
    }
    const mark = (wx: number, wz: number, color: string, label: string | null) => {
      const b = headingOf(wx - f.pos.x, wz - f.pos.z);
      const dd = (wrap(b - hdg) * 180) / Math.PI;
      const clamped = clamp(dd, -span / 2 + 2, span / 2 - 2);
      const x = this.w / 2 + clamped * pxPerDeg;
      c.fillStyle = color;
      c.beginPath();
      // Marcadores numa faixa própria abaixo da numeração (não se sobrepõem aos graus).
      c.moveTo(x, y + 25);
      c.lineTo(x - 4, y + 31);
      c.lineTo(x + 4, y + 31);
      c.closePath();
      c.fill();
      if (label) this.text(label, x, y + 38, 9, color, "center", 700);
    };
    for (const b of g.bases) mark(b.center.x, b.center.z, b.captured ? COLORS.blue : COLORS.amber, b.id);
    for (const e of g.enemies) if (e.plane.alive) mark(e.plane.flight.pos.x, e.plane.flight.pos.z, COLORS.red, null);
    c.restore();
    // Cursor central + leitura numérica
    c.fillStyle = COLORS.teal;
    c.beginPath();
    c.moveTo(this.w / 2, y + 1);
    c.lineTo(this.w / 2 - 5, y - 5);
    c.lineTo(this.w / 2 + 5, y - 5);
    c.closePath();
    c.fill();
    this.text(`${String(Math.round(hdgDeg) % 360).padStart(3, "0")}°`, this.w / 2 + w / 2 + 26, y + 6, 11, COLORS.white, "center", 700);
  }

  private health(g: Game, compact: boolean): void {
    const p = g.player;
    const w = compact ? 150 : 220;
    const x = this.w / 2 - w / 2;
    const y = 62;
    const hp = clamp(p.health / p.maxHealth, 0, 1);
    const color = g.boostActive("shield") ? BOOSTS.shield.color : hp > 0.45 ? COLORS.teal : hp > 0.25 ? COLORS.amber : COLORS.red;
    this.bar(x, y, w, 6, hp, color);
    this.text(`${Math.ceil(p.health)}`, x - 6, y + 3, 11, COLORS.white, "right", 700);
    if (g.boostActive("shield")) this.text("BLINDAGEM", x + w + 6, y + 3, 9, BOOSTS.shield.color, "left", 700);
  }

  /** Painel de armas: metralhadora (calor), míssil selecionado (trilhos e recarga) e flares. */
  private weapons(g: Game, compact: boolean): void {
    const p = g.player;
    const gun = GUNS[g.gun];
    const msl = MISSILES[g.missile];
    const rails = g.rails[g.missile];
    const w = compact ? 230 : 300;
    const h = 52;
    // Toque em retrato: painel no topo (rodapé é dos controles). Demais: rodapé central.
    const top = this.touchLayout && this.w < 640;
    const x = this.w / 2 - w / 2;
    const y = top ? 76 : this.h - h - (this.touchLayout ? 8 : 16);
    this.panel(x, y, w, h);
    const keys = !this.touchLayout;

    // Linha 1: metralhadora
    this.text(gun.short, x + 10, y + 13, 13, COLORS.white, "left", 700);
    this.text(keys ? "G" : "", x + 52, y + 13, 9, TEAL_FAINT, "left");
    const heatColor = p.overheated ? COLORS.red : p.gunHeat > 0.7 ? COLORS.amber : "rgba(238,246,245,0.8)";
    this.bar(x + 66, y + 10, w - 76 - 54, 6, p.gunHeat, heatColor);
    this.text(p.overheated ? "QUENTE" : "CALOR", x + w - 10, y + 13, 9, p.overheated ? COLORS.red : TEAL_DIM, "right");

    // Linha 2: míssil + flares
    const ry = y + 36;
    this.text(msl.short, x + 10, ry, 13, COLORS.white, "left", 700);
    this.text(keys ? "T" : "", x + 52, ry, 9, TEAL_FAINT, "left");
    const c = this.ctx;
    rails.forEach((r, k) => {
      const ix = x + 66 + k * 34;
      const ready = r <= 0;
      c.fillStyle = ready ? COLORS.white : "rgba(238,246,245,0.22)";
      if (msl.salvo > 1) {
        for (let j = 0; j < 4; j++) c.fillRect(ix + j * 6, ry - 4, 4, 8);
      } else {
        c.fillRect(ix, ry - 2, 22, 4);
        c.beginPath();
        c.moveTo(ix + 22, ry - 2);
        c.lineTo(ix + 27, ry);
        c.lineTo(ix + 22, ry + 2);
        c.fill();
      }
      if (!ready) this.bar(ix, ry + 6, 26, 2, 1 - r / msl.reload, COLORS.teal, "rgba(0,0,0,0)");
    });
    for (let k = 0; k < p.maxFlares; k++) {
      c.beginPath();
      c.arc(x + w - 12 - k * 13, ry, 4, 0, TAU);
      c.fillStyle = k < p.flares ? COLORS.amber : "rgba(255,160,67,0.2)";
      c.fill();
    }
    this.text("FLR", x + w - 14 - p.maxFlares * 13, ry, 9, "rgba(255,160,67,0.85)", "right");
    this.text(msl.name.toUpperCase(), x + w / 2, y - 8, 9, TEAL_DIM, "center", 600);
  }

  private radar(g: Game, compact: boolean): void {
    const c = this.ctx;
    const r = compact ? 46 : 62;
    const cx = this.w - r - 14;
    const cy = r + (this.touchLayout ? 64 : 14);
    const p = g.player.flight;
    forwardOf(p.quat, _fwd);
    const heading = Math.atan2(_fwd.x, -_fwd.z);
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.fillStyle = PANEL;
    c.fill();
    c.strokeStyle = "rgba(95,227,207,0.55)";
    c.lineWidth = 1;
    c.stroke();
    c.beginPath();
    c.arc(cx, cy, r / 2, 0, TAU);
    c.strokeStyle = "rgba(95,227,207,0.18)";
    c.stroke();
    // Varredura girando (pura ambientação, 1 volta / 2,5 s)
    const sweep = (g.time / 2.5) * TAU;
    const grad = c.createConicGradient?.(sweep - 0.6, cx, cy);
    if (grad) {
      grad.addColorStop(0, "rgba(95,227,207,0)");
      grad.addColorStop(0.09, "rgba(95,227,207,0.16)");
      grad.addColorStop(0.1, "rgba(95,227,207,0)");
      c.fillStyle = grad;
      c.fill();
    }
    c.clip();

    // Radar orientado pela proa: frente do avião sempre para cima.
    const cs = Math.cos(-heading);
    const sn = Math.sin(-heading);
    const toRadar = (x: number, z: number): [number, number] => {
      const dx = x - p.pos.x;
      const dz = z - p.pos.z;
      return [cx + ((dx * cs - dz * sn) / RADAR_RANGE) * r, cy + ((dx * sn + dz * cs) / RADAR_RANGE) * r];
    };
    // Contatos fora do alcance ficam presos na borda: o jogador sempre sabe a direção do inimigo.
    const clampRim = ([x, y]: [number, number]): [number, number] => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const max = r - 4;
      return d > max ? [cx + (dx / d) * max, cy + (dy / d) * max] : [x, y];
    };
    c.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * TAU;
      const [x, y] = toRadar(Math.cos(a) * ARENA_RADIUS, Math.sin(a) * ARENA_RADIUS);
      if (k) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.strokeStyle = "rgba(255,81,70,0.5)";
    c.stroke();

    for (const b of g.bases) {
      const [x, y] = clampRim(toRadar(b.center.x, b.center.z));
      this.text(b.id, x, y, 10, b.captured ? COLORS.blue : COLORS.amber, "center", 700);
    }
    for (const r of g.rings.rings) {
      if (!r.active) continue;
      const [x, y] = toRadar(r.center.x, r.center.z);
      c.strokeStyle = RING_INFO[r.kind].color;
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(x, y, 3, 0, TAU);
      c.stroke();
    }
    for (const e of g.enemies) {
      if (!e.plane.alive) continue;
      const [x, y] = clampRim(toRadar(e.plane.flight.pos.x, e.plane.flight.pos.z));
      c.fillStyle = g.lock.target === e.plane ? COLORS.amber : COLORS.red;
      c.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    if (Math.floor(g.time * 6) % 2 === 0) {
      for (const m of g.missiles.active) {
        if (m.target !== g.player) continue;
        const [x, y] = toRadar(m.pos.x, m.pos.z);
        c.fillStyle = COLORS.white;
        c.beginPath();
        c.arc(x, y, 2.5, 0, TAU);
        c.fill();
      }
    }
    c.restore();
    c.fillStyle = COLORS.teal;
    c.beginPath();
    c.moveTo(cx, cy - 5);
    c.lineTo(cx + 4, cy + 4);
    c.lineTo(cx - 4, cy + 4);
    c.closePath();
    c.fill();
    this.text(`${(RADAR_RANGE / 1000).toFixed(1).replace(".", ",")} km`, cx, cy + r + 9, 9, TEAL_DIM);
  }

  /** Ficha do alvo em trava: identificação, distância, aproximação e integridade. */
  private targetPanel(g: Game, compact: boolean): void {
    const t = g.lock.target;
    if (!t) return;
    const p = g.player.flight;
    const w = compact ? 140 : 170;
    const h = 64;
    const r = compact ? 46 : 62;
    const x = this.w - w - 14;
    const y = r * 2 + (this.touchLayout ? 64 : 14) + 22;
    if (this.touchLayout && y + h > this.h - 200) return; // não cobre os botões de toque
    this.panel(x, y, w, h);
    const name = t instanceof Aircraft ? t.name : t instanceof GroundTarget ? t.label : "Alvo";
    const hp = t instanceof Aircraft ? t.health / t.maxHealth : t instanceof GroundTarget ? t.health / t.maxHealth : 1;
    const d = t.position.distanceTo(p.pos);
    _v.subVectors(t.position, p.pos).normalize();
    const closure = -_v.dot(_acc.subVectors(t.velocity, p.vel)) * 3.6;
    this.text(name, x + 8, y + 12, 11, COLORS.red, "left", 700);
    this.text(formatDistance(d), x + w - 8, y + 12, 11, COLORS.white, "right", 700);
    this.text(`APROX ${Math.round(closure)} km/h`, x + 8, y + 30, 9, TEAL_DIM, "left");
    const prog = clamp(g.lock.time / g.lockTimeNeeded, 0, 1);
    this.text(g.lock.locked ? "TRAVADO" : `TRAVA ${Math.round(prog * 100)}%`, x + w - 8, y + 30, 9, g.lock.locked ? COLORS.red : COLORS.amber, "right", 700);
    this.bar(x + 8, y + 46, w - 16, 5, hp, COLORS.red, "rgba(60,10,8,0.6)");
  }

  /** Retorna o y da última linha desenhada (os objetivos seguem logo abaixo). */
  private scoreboard(g: Game, compact: boolean): number {
    const x = 16;
    // Toque em retrato: o painel de armas ocupa o topo central; o placar desce para não sobrepor.
    let y = this.touchLayout && this.w < 640 ? 150 : 22;
    this.text(g.score.toLocaleString("pt-BR"), x, y, 22, COLORS.white, "left", 700);
    y += 20;
    const alive = g.enemies.filter((e) => e.plane.alive).length;
    const stage = g.campaign ? `FASE ${g.phaseIndex + 1}` : `ONDA ${Math.max(1, g.wave)}`;
    this.text(`${g.fighter.name.toUpperCase()} · ${g.difficulty.label.toUpperCase()} · ${stage} · ${alive} hostil${alive === 1 ? "" : "s"}`, x, y, 11, TEAL_DIM, "left");
    y += 16;
    const bases = g.bases.map((b) => `${b.id}${b.captured ? "✓" : ""}`).join("  ");
    this.text(`BASES  ${bases}`, x, y, 11, COLORS.amber, "left");
    if (g.streak > 1) {
      y += 18;
      this.text(`SEQUÊNCIA x${g.streak}`, x, y, 13, COLORS.amber, "left", 700);
    }
    // Boosts ativos com barra de tempo restante.
    for (const id of BOOST_ORDER) {
      const left = g.boosts[id];
      if (left <= 0) continue;
      const b = BOOSTS[id];
      y += 18;
      const blink = left < 2.5 && Math.floor(g.time * 6) % 2 === 0;
      this.text(b.short, x, y, 11, blink ? COLORS.white : b.color, "left", 700);
      this.bar(x + 34, y - 3, compact ? 70 : 96, 5, left / b.max, b.color);
      this.text(`${Math.ceil(left)}s`, x + 40 + (compact ? 70 : 96), y, 9, b.color, "left");
    }
    return y;
  }

  private warnings(g: Game): void {
    const blink = Math.floor(g.time * 5) % 2 === 0;
    const y = this.h * 0.3;
    if (g.threat.missiles > 0) {
      if (blink) this.text(`MÍSSIL ${formatDistance(g.threat.nearest)}  ·  SOLTE FLARES`, this.w / 2, y, 16, COLORS.red, "center", 700);
      if (g.threat.from) {
        const s = this.project(g.threat.from, g.camera);
        if (!s.onScreen) this.edgeArrow(s, COLORS.white);
      }
    } else if (g.threat.locking) {
      this.text("INIMIGO TRAVANDO EM VOCÊ", this.w / 2, y, 14, COLORS.amber, "center", 700);
    }
    if (g.gcas) this.text("AUTO-GCAS · RECUPERANDO", this.w / 2, y + 24, 16, COLORS.amber, "center", 700);
    else if (g.pullUp && blink) this.text("PUXE PARA CIMA", this.w / 2, y + 24, 16, COLORS.red, "center", 700);
    if (g.outTimer > 0) {
      this.text(`VOLTE À ÁREA DE COMBATE  ${Math.ceil(10 - g.outTimer)}`, this.w / 2, y + 48, 15, COLORS.red, "center", 700);
    }
  }

  /** Pontos sobem a partir da retícula e somem em 1,2 s. */
  private popups(g: Game): void {
    let k = 0;
    for (const pop of g.popups) {
      const age = g.time - pop.t;
      if (age > 1.2) continue;
      this.ctx.globalAlpha = clamp(1.2 - age, 0, 1);
      this.text(pop.text, this.w / 2 + 46, this.h / 2 - 30 - age * 40 - k * 16, 13, pop.color, "left", 700);
      this.ctx.globalAlpha = 1;
      k++;
    }
  }

  private messages(g: Game): void {
    let y = this.h * 0.2 + 10;
    for (let i = g.messages.length - 1; i >= 0; i--) {
      const m = g.messages[i]!;
      const age = g.time - m.t;
      if (age > 3.2) continue;
      this.ctx.globalAlpha = clamp(3.2 - age, 0, 1);
      this.text(m.text, this.w / 2, y, m.big ? 18 : 13, m.color, "center", 700);
      this.ctx.globalAlpha = 1;
      y += m.big ? 24 : 18;
    }
  }

  private feed(g: Game, compact: boolean): void {
    // Toque: coluna à esquerda, abaixo do placar. Desktop: canto inferior direito.
    const touch = this.touchLayout;
    if (touch && compact && this.h < 420) return;
    const x = touch ? 16 : this.w - 16;
    let y = touch ? this.h * 0.55 : this.h - 22;
    for (let i = g.feed.length - 1; i >= 0; i--) {
      const f = g.feed[i]!;
      const age = g.time - f.t;
      if (age > 7) continue;
      this.ctx.globalAlpha = clamp(7 - age, 0, 1);
      this.text(f.text, x, y, 11, f.mine ? COLORS.teal : "rgba(238,246,245,0.8)", touch ? "left" : "right", 500);
      this.ctx.globalAlpha = 1;
      y += touch ? 16 : -16;
    }
  }
}
