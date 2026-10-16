import { clamp } from "./math";

export interface InputFrame {
  stickX: number; // -1 esquerda … +1 direita
  stickY: number; // +1 = puxar (nariz para cima), já com inversão aplicada
  yaw: number;
  throttle: number; // 0..1, valor absoluto mantido pelo Input
  gun: boolean;
  missile: boolean; // borda (dispara uma vez por toque)
  flare: boolean;
  camera: boolean;
  pause: boolean;
  switchGun: boolean;
  switchMissile: boolean;
  drone: boolean;
}

const DEADZONE = 0.12;
const dz = (v: number): number => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
const pick = (...vals: number[]): number => vals.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);

/**
 * Agrega teclado, mouse, toque e gamepad num único quadro de entrada. O jogo nunca sabe de onde veio o
 * comando — trocar de dispositivo no meio da partida funciona sem configuração.
 */
export class Input {
  invertY = false;
  throttle = 0.7;
  /** Último dispositivo usado: decide se os controles de toque aparecem. */
  touchMode = false;

  private readonly keys = new Set<string>();
  private readonly edges = new Set<string>();
  private mouseGun = false;
  private touchGun = false;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private throttleTouch = -1;
  private readonly padPrev: boolean[] = [];
  private readonly stickRadius = 64;
  private throttleFill: HTMLElement | null = null;
  private gamepadAllowed = true;

  constructor(ui: TouchUI | null, onDeviceChange: (touch: boolean) => void) {
    const setTouch = (t: boolean) => {
      if (t !== this.touchMode) {
        this.touchMode = t;
        onDeviceChange(t);
      }
    };
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) ) e.preventDefault();
      this.keys.add(e.code);
      this.edges.add(e.code);
      setTouch(false);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseGun = false;
    });
    window.addEventListener("pointerdown", (e) => setTouch(e.pointerType === "touch"), { capture: true });
    window.addEventListener("contextmenu", (e) => e.preventDefault());

    const scene = document.getElementById("scene");
    scene?.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouseGun = true;
      if (e.button === 2) this.edges.add("Mouse2");
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseGun = false;
    });

    if (ui) this.bindTouch(ui);
  }

  private bindTouch(ui: TouchUI): void {
    const { zone, base, knob, throttle, throttleFill, gun, missile, flare, camera, pause, gunSwitch, missileSwitch, drone } = ui;
    zone.addEventListener("pointerdown", (e) => {
      if (this.stick.id !== -1) return;
      zone.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      knob.style.transform = "translate(0px, 0px)";
      base.hidden = false;
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const len = Math.hypot(dx, dy);
      const r = this.stickRadius;
      if (len > r) {
        dx = (dx / len) * r;
        dy = (dy / len) * r;
      }
      this.stick.x = dx / r;
      this.stick.y = dy / r;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
      base.hidden = true;
    };
    zone.addEventListener("pointerup", endStick);
    zone.addEventListener("pointercancel", endStick);

    const setThrottle = (e: PointerEvent) => {
      const r = throttle.getBoundingClientRect();
      this.throttle = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    };
    throttle.addEventListener("pointerdown", (e) => {
      throttle.setPointerCapture(e.pointerId);
      this.throttleTouch = e.pointerId;
      setThrottle(e);
    });
    throttle.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.throttleTouch) setThrottle(e);
    });
    const endThrottle = (e: PointerEvent) => {
      if (e.pointerId === this.throttleTouch) this.throttleTouch = -1;
    };
    throttle.addEventListener("pointerup", endThrottle);
    throttle.addEventListener("pointercancel", endThrottle);
    this.throttleFill = throttleFill;

    const hold = (el: HTMLElement, set: (v: boolean) => void) => {
      el.addEventListener("pointerdown", (e) => {
        el.setPointerCapture(e.pointerId);
        el.classList.add("is-down");
        set(true);
      });
      const up = () => {
        el.classList.remove("is-down");
        set(false);
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    };
    const tap = (el: HTMLElement, code: string) =>
      hold(el, (v) => {
        if (v) this.edges.add(code);
      });
    hold(gun, (v) => (this.touchGun = v));
    tap(missile, "Touch:missile");
    tap(flare, "Touch:flare");
    tap(camera, "Touch:camera");
    tap(pause, "Touch:pause");
    tap(gunSwitch, "Touch:gunSwitch");
    tap(missileSwitch, "Touch:missileSwitch");
    tap(drone, "Touch:drone");
  }

  private edge(...codes: string[]): boolean {
    return codes.some((c) => this.edges.has(c));
  }

  private key(...codes: string[]): number {
    return codes.some((c) => this.keys.has(c)) ? 1 : 0;
  }

  sample(dt: number): InputFrame {
    let padX = 0;
    let padY = 0;
    let padYaw = 0;
    let padGun = false;
    const padEdge: boolean[] = [];
    const pad = this.readGamepad();
    if (pad) {
      padX = dz(pad.axes[0] ?? 0);
      padY = dz(pad.axes[1] ?? 0);
      padYaw = dz(pad.axes[2] ?? 0);
      padGun = (pad.buttons[7]?.value ?? 0) > 0.3;
      pad.buttons.forEach((b, i) => {
        padEdge[i] = b.pressed && !this.padPrev[i];
        this.padPrev[i] = b.pressed;
      });
      if (pad.buttons[5]?.pressed) this.throttle += 0.6 * dt;
      if (pad.buttons[4]?.pressed) this.throttle -= 0.6 * dt;
    }

    if (this.key("KeyR", "ShiftLeft", "ShiftRight")) this.throttle += 0.6 * dt;
    if (this.key("KeyF")) this.throttle -= 0.6 * dt;
    this.throttle = clamp(this.throttle, 0, 1);
    if (this.throttleFill) this.throttleFill.style.transform = `scaleY(${this.throttle})`;

    const kx = this.key("KeyD", "ArrowRight") - this.key("KeyA", "ArrowLeft");
    const ky = this.key("KeyS", "ArrowDown") - this.key("KeyW", "ArrowUp");
    const kyaw = this.key("KeyE") - this.key("KeyQ");
    const stickY = pick(ky, this.stick.y, padY);

    const frame: InputFrame = {
      stickX: pick(kx, this.stick.x, padX),
      stickY: this.invertY ? -stickY : stickY,
      yaw: pick(kyaw, padYaw),
      throttle: this.throttle,
      gun: this.key("Space", "KeyJ") > 0 || this.mouseGun || this.touchGun || padGun,
      missile: this.edge("Enter", "KeyM", "KeyK", "Mouse2", "Touch:missile") || !!padEdge[0],
      flare: this.edge("KeyX", "KeyL", "Touch:flare") || !!padEdge[1],
      camera: this.edge("KeyC", "Touch:camera") || !!padEdge[3],
      pause: this.edge("Escape", "KeyP", "Touch:pause") || !!padEdge[9],
      switchGun: this.edge("KeyG", "Touch:gunSwitch") || !!padEdge[12],
      switchMissile: this.edge("KeyT", "Tab", "Touch:missileSwitch") || !!padEdge[2],
      drone: this.edge("KeyB", "Touch:drone") || !!padEdge[13],
    };
    this.edges.clear();
    return frame;
  }

  /**
   * Em iframes com Permissions-Policy `gamepad=()` (ex.: visualizadores embutidos), getGamepads() lança
   * NotAllowedError. Após a primeira recusa o polling é desligado: sem custo de exceção a cada quadro.
   */
  private readGamepad(): Gamepad | null {
    if (!this.gamepadAllowed) return null;
    try {
      return navigator.getGamepads?.().find((p) => p?.connected) ?? null;
    } catch {
      this.gamepadAllowed = false;
      return null;
    }
  }

  reset(throttle: number): void {
    this.throttle = throttle;
    this.keys.clear();
    this.edges.clear();
    this.mouseGun = this.touchGun = false;
  }
}

export interface TouchUI {
  zone: HTMLElement;
  base: HTMLElement;
  knob: HTMLElement;
  throttle: HTMLElement;
  throttleFill: HTMLElement;
  gun: HTMLElement;
  missile: HTMLElement;
  flare: HTMLElement;
  camera: HTMLElement;
  pause: HTMLElement;
  gunSwitch: HTMLElement;
  missileSwitch: HTMLElement;
  drone: HTMLElement;
}
