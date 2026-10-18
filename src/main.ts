import "@fontsource/chakra-petch/latin-500.css";
import "@fontsource/chakra-petch/latin-700.css";
import "./jet.css";
import { Sfx } from "./audio";
import { Game, type GameStats, type Settings } from "./game";
import { Hud } from "./hud";
import { Input, type TouchUI } from "./input";
import { FIGHTERS, FIGHTER_ORDER } from "./fighters";
import { DIFFICULTIES, GUNS, GUN_ORDER, MISSILES, MISSILE_ORDER, type Difficulty } from "./loadout";
import { ACHIEVEMENTS, ACHIEVEMENT_ORDER, parseAchievements, type AchievementId } from "./achievements";
import { Hangar } from "./hangar";
import { fighterRows, gunRows, missileRows, missileTargets, type StatRow } from "./stats";

type UiState = "menu" | "playing" | "paused" | "over";

const SETTINGS_KEY = "ceu-de-aco.settings";
const BEST_KEY = "ceu-de-aco.best";
const ACH_KEY = "ceu-de-aco.achievements";
const START_THROTTLE = 0.75;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} ausente`);
  return el as T;
};

// localStorage pode lançar (aba privada, armazenamento bloqueado): o jogo funciona sem ele.
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem persistência */
  }
}

const coarse = window.matchMedia("(pointer: coarse)").matches;
const settings: Settings = load<Settings>(SETTINGS_KEY, {
  arcade: true,
  invertY: false,
  quality: coarse ? "low" : "high",
  sound: true,
  difficulty: "piloto",
  mode: "campanha",
  fighter: "falcao",
  gun: "cal50",
  missile: "ir",
});
// Valores salvos por versões antigas (ou editados à mão) não podem quebrar as tabelas de armamento.
if (!(settings.difficulty in DIFFICULTIES)) settings.difficulty = "piloto";
if (!(settings.gun in GUNS)) settings.gun = "cal50";
if (!(settings.fighter in FIGHTERS)) settings.fighter = "falcao";
if (settings.mode !== "campanha" && settings.mode !== "sobrevivencia") settings.mode = "campanha";
if (!(settings.missile in MISSILES)) settings.missile = "ir";
let best = load<{ v: number }>(BEST_KEY, { v: 0 }).v;
const unlocked = parseAchievements(load<{ ids: unknown }>(ACH_KEY, { ids: [] }).ids);

const ui = {
  loading: $("loading"),
  menu: $("menu"),
  pause: $("pause"),
  over: $("over"),
  touch: $("touch"),
  best: $("best"),
};

const touchUi: TouchUI = {
  zone: $("stick-zone"),
  base: $("stick-base"),
  knob: $("stick-knob"),
  throttle: $("throttle"),
  throttleFill: $("throttle-fill"),
  gun: $("btn-gun"),
  missile: $("btn-missile"),
  flare: $("btn-flare"),
  camera: $("btn-camera"),
  pause: $("btn-pause"),
  gunSwitch: $("btn-gun-switch"),
  missileSwitch: $("btn-missile-switch"),
  drone: $("btn-drone"),
  naval: $("btn-naval"),
};

let state: UiState = "menu";
const droneBtn = $("btn-drone");
const navalBtn = $("btn-naval");
const sfx = new Sfx();
const hud = new Hud($<HTMLCanvasElement>("hud"));
const input = new Input(touchUi, () => syncTouch());
input.invertY = settings.invertY;
input.touchMode = coarse;
hud.touchLayout = coarse;

let game: Game | null = null;

/* ---------- Hangar (prévia 3D) e fichas comparativas ---------- */

// WebGL do hangar é opcional: se o navegador recusar um segundo contexto, o menu segue só com as fichas.
let hangar: Hangar | null = null;
try {
  hangar = new Hangar($<HTMLCanvasElement>("hangar-canvas"), { jet: $("hg-jet-view"), missile: $("hg-missile-view"), gun: $("hg-gun-view") });
} catch {
  hangar = null;
}

function renderStats(id: string, rows: readonly StatRow[]): void {
  const ul = $(id);
  ul.replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement("li");
      li.className = "stat";
      const label = document.createElement("span");
      label.textContent = r.label;
      const bar = document.createElement("span");
      bar.className = "stat__bar";
      bar.style.setProperty("--v", r.value.toFixed(3));
      const value = document.createElement("span");
      value.className = "stat__value";
      value.textContent = r.text;
      li.append(label, bar, value);
      return li;
    }),
  );
}

function syncHangar(): void {
  const f = FIGHTERS[settings.fighter];
  $("hg-jet-role").textContent = f.role;
  $("hg-jet-name").textContent = f.name;
  renderStats("hg-jet-stats", fighterRows(settings.fighter));
  const m = MISSILES[settings.missile];
  $("hg-missile-name").textContent = m.name;
  $("hg-missile-tag").textContent = missileTargets(settings.missile);
  renderStats("hg-missile-stats", missileRows(settings.missile));
  const g = GUNS[settings.gun];
  $("hg-gun-name").textContent = g.name;
  $("hg-gun-tag").textContent = g.desc.split(" · ")[0] ?? "";
  renderStats("hg-gun-stats", gunRows(settings.gun));
}

function renderAchievements(): void {
  $("ach-list").replaceChildren(
    ...ACHIEVEMENT_ORDER.map((id) => {
      const a = ACHIEVEMENTS[id];
      const done = unlocked.has(id);
      const li = document.createElement("li");
      li.className = `ach${done ? " is-done" : ""}`;
      const icon = document.createElement("span");
      icon.className = "ach__icon";
      icon.textContent = a.icon;
      icon.setAttribute("aria-hidden", "true");
      const title = document.createElement("span");
      title.className = "ach__title";
      title.textContent = `${a.title}${done ? " ✓" : ""}`;
      const desc = document.createElement("span");
      desc.textContent = done ? a.reward : a.desc;
      li.append(icon, title, desc);
      return li;
    }),
  );
}

/** O jogo já marcou a conquista no mesmo Set; aqui só persiste e atualiza a lista do menu. */
function onAchievement(id: AchievementId): void {
  unlocked.add(id);
  save(ACH_KEY, { ids: [...unlocked] });
  renderAchievements();
}

function syncTouch(): void {
  hud.touchLayout = input.touchMode;
  ui.touch.hidden = !(input.touchMode && state === "playing");
}

function show(next: UiState): void {
  state = next;
  ui.menu.hidden = next !== "menu";
  ui.pause.hidden = next !== "paused";
  ui.over.hidden = next !== "over";
  syncTouch();
  if (next === "menu") ui.best.textContent = best.toLocaleString("pt-BR");
}

function bindSetting(id: string, get: () => boolean, set: (v: boolean) => void): void {
  const el = $<HTMLInputElement>(id);
  el.checked = get();
  el.addEventListener("change", () => {
    set(el.checked);
    save(SETTINGS_KEY, settings);
  });
}

/** Grupo de chips (radio) gerado a partir das tabelas do loadout: nova arma = nova linha na tabela, sem HTML. */
function bindPicker<K extends string>(id: string, order: readonly K[], label: (k: K) => string, desc: (k: K) => string, get: () => K, set: (k: K) => void): void {
  const root = $(id);
  const chips = root.querySelector<HTMLElement>(".chips")!;
  const descEl = root.querySelector<HTMLElement>(".picker__desc")!;
  const buttons = order.map((k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "radio");
    b.textContent = label(k);
    b.addEventListener("click", () => {
      set(k);
      save(SETTINGS_KEY, settings);
      sync();
    });
    chips.appendChild(b);
    return b;
  });
  const sync = () => {
    buttons.forEach((b, i) => b.setAttribute("aria-checked", String(order[i] === get())));
    descEl.textContent = desc(get());
  };
  sync();
}

const DIFF_ORDER = Object.keys(DIFFICULTIES) as Difficulty[];
bindPicker("pick-difficulty", DIFF_ORDER, (k) => DIFFICULTIES[k].label, (k) => DIFFICULTIES[k].desc, () => settings.difficulty, (k) => (settings.difficulty = k));
bindPicker(
  "pick-mode",
  ["campanha", "sobrevivencia"] as const,
  (k) => (k === "campanha" ? "Campanha" : "Sobrevivência"),
  (k) => (k === "campanha" ? "5 fases com objetivos, termina com o Ás inimigo" : "Ondas infinitas; as bases são reocupadas"),
  () => settings.mode,
  (k) => (settings.mode = k),
);
bindPicker(
  "pick-fighter",
  FIGHTER_ORDER,
  (k) => FIGHTERS[k].name,
  (k) => {
    const f = FIGHTERS[k];
    const bar = (n: number) => "▮".repeat(n) + "▯".repeat(5 - n);
    const [spd, agi, arm, gnd] = f.stats;
    return `${f.role} · ${f.desc}\nVEL ${bar(spd)}  AGI ${bar(agi)}  BLD ${bar(arm)}  SOLO ${bar(gnd)}`;
  },
  () => settings.fighter,
  (k) => {
    settings.fighter = k;
    hangar?.setFighter(k);
    syncHangar();
    // O voo de demonstração atrás do menu já mostra o caça escolhido.
    if (state === "menu") game?.attract();
  },
);
bindPicker("pick-gun", GUN_ORDER, (k) => GUNS[k].short, (k) => `${GUNS[k].name} · ${GUNS[k].desc}`, () => settings.gun, (k) => {
  settings.gun = k;
  hangar?.setGun(k);
  syncHangar();
});
bindPicker("pick-missile", MISSILE_ORDER, (k) => MISSILES[k].short, (k) => `${MISSILES[k].name} · ${MISSILES[k].desc}`, () => settings.missile, (k) => {
  settings.missile = k;
  hangar?.setMissile(k);
  syncHangar();
  if (state === "menu") game?.attract();
});
hangar?.setMissile(settings.missile);
hangar?.setGun(settings.gun);
hangar?.setFighter(settings.fighter);
syncHangar();
renderAchievements();

bindSetting("opt-arcade", () => settings.arcade, (v) => (settings.arcade = v));
bindSetting("opt-invert", () => settings.invertY, (v) => (input.invertY = settings.invertY = v));
bindSetting("opt-sound", () => settings.sound, (v) => {
  settings.sound = v;
  sfx.setMuted(!v);
});
bindSetting("opt-quality", () => settings.quality === "low", (v) => {
  settings.quality = v ? "low" : "high";
  game?.applyQuality();
  resize();
});

function start(): void {
  if (!game) return;
  sfx.start();
  sfx.setMuted(!settings.sound);
  if (input.touchMode) {
    // Tela cheia e paisagem são opcionais: navegadores/app views podem recusar.
    // iOS Safari < 16.4 não tem screen.orientation; navegadores antigos retornam void em vez de Promise.
    // try + Promise.resolve cobre exceção síncrona e rejeição assíncrona sem bloquear a decolagem.
    try {
      void Promise.resolve(document.documentElement.requestFullscreen?.()).catch(() => undefined);
      const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
      void Promise.resolve(orientation?.lock?.("landscape")).catch(() => undefined);
    } catch {
      /* opcional */
    }
  }
  input.reset(START_THROTTLE);
  game.newGame(START_THROTTLE);
  show("playing");
}

function pause(): void {
  if (state !== "playing") return;
  sfx.suspend();
  show("paused");
}

function resume(): void {
  sfx.resume();
  input.reset(input.throttle);
  show("playing");
}

function toMenu(): void {
  game?.attract();
  sfx.resume();
  show("menu");
}

function gameOver(s: GameStats): void {
  const record = s.score > best;
  if (record) {
    best = s.score;
    save(BEST_KEY, { v: best });
  }
  $("st-score").textContent = s.score.toLocaleString("pt-BR");
  $("st-kills").textContent = String(s.kills);
  $("st-ground").textContent = String(s.groundKills);
  $("st-wave-label").textContent = settings.mode === "campanha" ? "Fase" : "Onda";
  $("st-wave").textContent = String(settings.mode === "campanha" ? s.phaseReached : s.wave);
  $("st-streak").textContent = String(s.bestStreak);
  $("over-title").textContent = s.victory ? "Missão cumprida" : "Abatido";
  $("over-eyebrow").textContent = s.victory ? "Campanha concluída" : settings.mode === "campanha" ? `Fase ${s.phaseReached} de 5` : "Fim de missão";
  $("over-eyebrow").classList.toggle("eyebrow--red", !s.victory);
  $("st-diff").textContent = DIFFICULTIES[settings.difficulty].label;
  const sec = Math.floor(s.time);
  $("st-time").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  $("st-record").hidden = !record;
  show("over");
  $("again").focus();
}

$("start").addEventListener("click", start);
$("again").addEventListener("click", start);
$("resume").addEventListener("click", resume);
$("restart").addEventListener("click", start);
$("to-menu").addEventListener("click", toMenu);
$("over-menu").addEventListener("click", toMenu);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("keydown", (e) => {
  if (state === "paused" && (e.code === "Escape" || e.code === "KeyP")) resume();
});

function resize(): void {
  game?.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);

let last = performance.now();
function frame(now: number): void {
  // Agenda o próximo quadro antes de tudo: uma exceção isolada não congela o jogo inteiro.
  requestAnimationFrame(frame);
  // dt limitado a 50 ms: uma aba que volta do segundo plano não "teleporta" aviões através do chão.
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) {
    if (state === "playing") {
      const inp = input.sample(dt);
      if (inp.pause) pause();
      else game.update(dt, inp);
    } else if (state !== "paused") {
      game.update(dt, null);
    }
    game.render();
    droneBtn.classList.toggle("is-ready", game.droneCharge >= 1 || game.drone.active);
    navalBtn.classList.toggle("is-ready", game.navalUnlocked && game.navalCharges > 0);
    navalBtn.classList.toggle("is-locked", !game.navalUnlocked);
  }
  if (state === "menu") hangar?.render(dt);
}

async function boot(): Promise<void> {
  // Deixa o texto "Gerando terreno" pintar antes do trabalho síncrono pesado (textura de 2048² + malha).
  await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    game = new Game($<HTMLCanvasElement>("scene"), sfx, settings, hud);
  } catch (err) {
    ui.loading.querySelector(".loading")!.textContent = "Não foi possível iniciar o WebGL neste navegador.";
    throw err;
  }
  game.onGameOver = gameOver;
  game.unlocked = unlocked;
  game.onAchievement = onAchievement;
  // Gancho de depuração só no servidor de desenvolvimento; removido do build pela eliminação de código morto.
  if (import.meta.env.DEV) Object.assign(window, { __game: game });
  resize();
  ui.loading.hidden = true;
  show("menu");
  $("start").focus();
  requestAnimationFrame(frame);
}

void boot();
