import {
  EMPTY_INPUT,
  getPlayer,
  hasLineOfSight,
  previewCharge,
} from "../shared/engine";
import {
  ENEMY_WALK_SPEED_SCALE,
  LEAP_DISTANCE,
  PLAYER_SPIT_SPEED,
  PLAYER_SPIT_WINDUP_MS,
  SPECIES,
  TICK_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../shared/content";
import type { Actor, Corpse, InputFrame, Run, Vec2 } from "../shared/types";

type Drag = {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

export class GameInput {
  private keys = new Set<string>();
  private moveDrag: Drag | null = null;
  private aim: Vec2 = { x: 0, y: -1 };
  private targetDistance = LEAP_DISTANCE;
  private mouseClient: Vec2 | null = null;
  private targetSample: { id: number; x: number; y: number; timeMs: number; vx: number; vy: number } | null = null;
  private dashQueuedUntil = 0;
  private bounds = { left: 0, top: 0, width: 1, height: 1 };
  private observer: ResizeObserver;
  private controller = new AbortController();
  actionAiming = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private getRun: () => Run,
    private onPause: () => void,
    private mapViewToWorld?: (viewX: number, viewY: number) => Vec2
  ) {
    const options = { signal: this.controller.signal };
    const updateBounds = () => {
      const r = canvas.getBoundingClientRect();
      this.bounds = {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      };
    };
    updateBounds();
    this.observer = new ResizeObserver(updateBounds);
    this.observer.observe(canvas);
    window.addEventListener("resize", updateBounds, options);
    window.addEventListener("scroll", updateBounds, options);
    window.addEventListener("blur", () => this.clear(), options);

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.code === "Escape") {
          if (event.repeat) return;
          event.preventDefault();
          this.clear();
          this.onPause();
          return;
        }
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          /INPUT|TEXTAREA|SELECT/.test(target.tagName)
        )
          return;
        if (
          target instanceof HTMLButtonElement &&
          ["Space", "Enter"].includes(event.code)
        )
          return;
        if (!["playing", "cleared"].includes(this.getRun().phase)) return;
        if (
          [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Space",
          ].includes(event.code)
        )
          event.preventDefault();
        if (event.code === "Space" && event.repeat) return;
        this.keys.add(event.code);
        if (event.code === "Space" || event.code === "ShiftLeft" || event.code === "ShiftRight")
          this.queueDash();
      },
      options
    );
    window.addEventListener(
      "keyup",
      (event) => {
        this.keys.delete(event.code);
      },
      options
    );

    canvas.addEventListener(
      "contextmenu",
      (event) => event.preventDefault(),
      options
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerType !== "mouse") return;
        this.mouseClient = { x: event.clientX, y: event.clientY };
      },
      options
    );
    canvas.addEventListener(
      "pointerleave",
      () => {
        this.mouseClient = null;
      },
      options
    );
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (!["playing", "cleared"].includes(this.getRun().phase)) return;
        if (event.pointerType === "mouse") {
          if (event.button !== 0) return;
          this.mouseClient = { x: event.clientX, y: event.clientY };
          this.queueDash();
        }
      },
      options
    );
    canvas.addEventListener("pointercancel", () => this.clear(), options);

    this.bindMovePad();
    this.bindDashButton();
  }

  private toWorld(x: number, y: number): Vec2 {
    const viewX = ((x - this.bounds.left) / this.bounds.width) * WORLD_WIDTH;
    const viewY = ((y - this.bounds.top) / this.bounds.height) * WORLD_HEIGHT;
    return this.mapViewToWorld ? this.mapViewToWorld(viewX, viewY) : { x: viewX, y: viewY };
  }

  private queueDash() {
    this.dashQueuedUntil = performance.now() + 160;
  }

  private bindMovePad() {
    const element = document.getElementById("move-pad");
    if (!element) throw new Error("Missing game control move-pad");
    const options = { signal: this.controller.signal };
    element.addEventListener(
      "pointerdown",
      (event) => {
        if (!["playing", "cleared"].includes(this.getRun().phase)) return;
        if (this.moveDrag) return;
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        this.moveDrag = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
        };
        element.classList.add("held");
      },
      options
    );
    element.addEventListener(
      "pointermove",
      (event) => {
        if (!this.moveDrag || this.moveDrag.id !== event.pointerId) return;
        this.moveDrag.x = event.clientX;
        this.moveDrag.y = event.clientY;
        const dx = this.moveDrag.x - this.moveDrag.startX;
        const dy = this.moveDrag.y - this.moveDrag.startY;
        const len = Math.hypot(dx, dy);
        element.style.setProperty("--stick-x", `${dx / Math.max(1, len / 26)}px`);
        element.style.setProperty("--stick-y", `${dy / Math.max(1, len / 26)}px`);
      },
      options
    );
    const release = (event: PointerEvent) => {
      if (!this.moveDrag || this.moveDrag.id !== event.pointerId) return;
      this.moveDrag = null;
      element.style.setProperty("--stick-x", "0px");
      element.style.setProperty("--stick-y", "0px");
      element.classList.remove("held");
    };
    element.addEventListener("pointerup", release, options);
    element.addEventListener("pointercancel", release, options);
    element.addEventListener("lostpointercapture", release, options);
  }

  private bindDashButton() {
    const element = document.getElementById("ability-button");
    if (!element) throw new Error("Missing game control ability-button");
    const options = { signal: this.controller.signal };
    element.addEventListener(
      "pointerdown",
      (event) => {
        if (!["playing", "cleared"].includes(this.getRun().phase)) return;
        event.preventDefault();
        element.classList.add("held");
        this.queueDash();
      },
      options
    );
    const release = () => element.classList.remove("held");
    element.addEventListener("pointerup", release, options);
    element.addEventListener("pointercancel", release, options);
    element.addEventListener("pointerleave", release, options);
    element.addEventListener(
      "click",
      (event) => {
        if (event.detail !== 0 || !["playing", "cleared"].includes(this.getRun().phase)) return;
        this.queueDash();
      },
      options
    );
  }

  private assistedTarget(run: Run, enemy: Actor): Vec2 {
    const player = getPlayer(run);
    const previous = this.targetSample;
    const elapsed = previous ? (run.activeTimeMs - previous.timeMs) / 1000 : 0;
    let vx = 0;
    let vy = 0;
    if (previous?.id === enemy.id && elapsed === 0) {
      vx = previous.vx;
      vy = previous.vy;
    } else if (previous?.id === enemy.id && elapsed > 0 && elapsed <= 0.1) {
      vx = (enemy.x - previous.x) / elapsed;
      vy = (enemy.y - previous.y) / elapsed;
    }
    this.targetSample = { id: enemy.id, x: enemy.x, y: enemy.y, timeMs: run.activeTimeMs, vx, vy };
    const speed = Math.hypot(vx, vy);
    if (
      enemy.action ||
      enemy.stunMs > 0 ||
      speed === 0 ||
      speed > SPECIES[enemy.species].speed * ENEMY_WALK_SPEED_SCALE + 1
    )
      return enemy;

    const movement = this.movement();
    const windup = PLAYER_SPIT_WINDUP_MS / 1000;
    const origin = previewCharge(
      run,
      player,
      movement.x,
      movement.y,
      Math.min(1, Math.hypot(movement.x, movement.y)) * SPECIES[player.species].speed * windup
    );
    const muzzle = player.radius + 7;
    let flight = Math.max(0, (Math.hypot(enemy.x - origin.x, enemy.y - origin.y) - muzzle) / PLAYER_SPIT_SPEED);
    for (let index = 0; index < 3; index++) {
      flight = Math.max(
        0,
        (Math.hypot(enemy.x + vx * (windup + flight) - origin.x, enemy.y + vy * (windup + flight) - origin.y) - muzzle) /
          PLAYER_SPIT_SPEED
      );
    }
    const forecast = previewCharge(run, enemy, vx, vy, Math.min(120, speed * Math.min(1, windup + flight)));
    if (!hasLineOfSight(run, origin, forecast, 8)) return enemy;
    return { x: forecast.x + player.x - origin.x, y: forecast.y + player.y - origin.y };
  }

  private pickAutoEnemy(run: Run): Actor | null {
    if (run.phase !== "playing") return null;
    const player = getPlayer(run);
    const enemies = run.actors.filter(
      (a) =>
        a.faction === "enemy" &&
        a.hp > 0 &&
        !(a.action?.kind === "leap" && a.action.stage === "active") &&
        hasLineOfSight(run, player, a)
    );
    return enemies.sort(
      (a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y)
    )[0] ?? null;
  }

  private movement(): Vec2 {
    if (this.moveDrag) {
      const dx = this.moveDrag.x - this.moveDrag.startX;
      const dy = this.moveDrag.y - this.moveDrag.startY;
      const distance = Math.hypot(dx, dy);
      const strength = Math.min(1, Math.max(0, (distance - 4) / 24));
      return distance > 0 ? { x: (dx / distance) * strength, y: (dy / distance) * strength } : { x: 0, y: 0 };
    }
    const x =
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const y =
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) -
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    const length = Math.max(1, Math.hypot(x, y));
    return { x: x / length, y: y / length };
  }

  read(): InputFrame {
    const now = performance.now();
    const run = this.getRun();
    const player = getPlayer(run);
    const movement = this.movement();

    const cursorWorld = this.mouseClient ? this.toWorld(this.mouseClient.x, this.mouseClient.y) : null;
    const enemy = cursorWorld ? null : this.pickAutoEnemy(run);
    if (cursorWorld) {
      this.targetSample = null;
      const dx = cursorWorld.x - player.x;
      const dy = cursorWorld.y - player.y;
      const len = Math.hypot(dx, dy);
      this.targetDistance = len;
      if (len > 1) this.aim = { x: dx / len, y: dy / len };
    } else if (enemy) {
      const target = this.assistedTarget(run, enemy);
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const len = Math.hypot(dx, dy);
      this.targetDistance = len;
      if (len > 1) this.aim = { x: dx / len, y: dy / len };
    } else {
      this.targetSample = null;
      const length = Math.hypot(movement.x, movement.y);
      if (length > 0) this.aim = { x: movement.x / length, y: movement.y / length };
      this.targetDistance = LEAP_DISTANCE;
    }

    const canDash =
      now <= this.dashQueuedUntil &&
      player.stunMs <= TICK_MS &&
      player.basicCooldownMs <= TICK_MS &&
      (!player.action || player.action.stage === "windup");
    if (canDash) this.dashQueuedUntil = 0;

    const shouldAutoShoot = run.phase === "playing" && (cursorWorld !== null || enemy !== null);
    const abilityPressed =
      !canDash &&
      shouldAutoShoot &&
      !player.action &&
      player.stunMs <= TICK_MS &&
      player.specialCooldownMs <= TICK_MS;

    return {
      ...EMPTY_INPUT,
      moveX: movement.x,
      moveY: movement.y,
      aimX: this.aim.x,
      aimY: this.aim.y,
      aimDistance: this.targetDistance,
      attackHeld: false,
      abilityPressed,
      assistedBasic: false,
      hopHeld: false,
      hopCommitId: null,
      dashPressed: canDash,
    };
  }

  get switchTarget(): Corpse | null {
    return null;
  }

  get approachingBody(): Corpse | null {
    return null;
  }

  get cooldownFeedback(): { cooldownMs: number; expiresInMs: number } | null {
    return null;
  }

  get aimDirection() {
    return this.aim;
  }

  get aimDistance() {
    return this.targetDistance;
  }

  get hasExplicitAim() {
    return true;
  }

  clear() {
    this.keys.clear();
    this.moveDrag = null;
    this.dashQueuedUntil = 0;
    this.targetDistance = LEAP_DISTANCE;
    this.mouseClient = null;
    this.targetSample = null;
    this.actionAiming = false;
    document.querySelectorAll(".held").forEach((el) => el.classList.remove("held"));
    const pad = document.getElementById("move-pad");
    pad?.style.setProperty("--stick-x", "0px");
    pad?.style.setProperty("--stick-y", "0px");
  }

  destroy() {
    this.clear();
    this.observer.disconnect();
    this.controller.abort();
  }
}
