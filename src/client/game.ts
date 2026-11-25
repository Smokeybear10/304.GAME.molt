import Phaser from "phaser";
import {
  createCreatureTexture,
  createCorpseTexture,
  createKeeperTexture,
  drawMutationGrafts,
  drawParasiteHead,
  creatureAnchor,
  projectCreaturePoint,
  INK,
} from "./art";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  EXIT_RADIUS,
  LEAP_RADIUS,
  PLAYER_BULLET_RADIUS,
  SPECIES,
} from "../shared/content";
import { getPlayer, previewSpecial } from "../shared/engine";
import type { Actor, GameEvent, Run, Species, Vec2 } from "../shared/types";
import type { GameInput } from "./input";
import { createFeastFloor } from "./room-art";

type SimulationPose = {
  x: number;
  y: number;
  action: {
    kind: NonNullable<Actor["action"]>["kind"];
    stage: NonNullable<Actor["action"]>["stage"];
    timeMs: number;
  } | null;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  max: number;
  color: number;
};
type Ring = {
  x: number;
  y: number;
  radius: number;
  life: number;
  max: number;
  color: number;
  groundContact?: boolean;
};
type Contact = {
  x: number;
  y: number;
  angle: number;
  life: number;
  max: number;
  shell: boolean;
  broken: boolean;
  radial: boolean;
};
type Aftermath = {
  x: number;
  y: number;
  angle: number;
  size: number;
  kind: "scar" | "shell" | "remains" | "splat" | "crumbs" | "scrape";
};
type Transfer = {
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  life: number;
  max: number;
  toId: number;
  abandonedCorpseId: number;
  departure: Phaser.GameObjects.Image | null;
  departureWidth: number;
  departureHeight: number;
  departureAngle: number;
};
type DeathPose = {
  image: Phaser.GameObjects.Image;
  texture: string;
  frame: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  at: number;
};
type SceneHooks = {
  getRun: () => Run;
  getInput: () => GameInput | null;
  tick: (dt: number) => void;
  getInterpolationAlpha: () => number;
  ready: (canvas: HTMLCanvasElement) => void;
  reducedMotion: () => boolean;
};
const hex = (value: string) => Number.parseInt(value.slice(1), 16);
const PAPER = hex(INK.paper),
  BLACK = hex(INK.black),
  RED = hex(INK.red),
  LIGHT = hex(INK.light),
  DANGER = 0xf17958;

export class BodyHopScene extends Phaser.Scene {
  private floor!: Phaser.GameObjects.Image;
  private ground!: Phaser.GameObjects.Graphics;
  private marks!: Phaser.GameObjects.Graphics;
  private foreground!: Phaser.GameObjects.Graphics;
  private grafts!: Phaser.GameObjects.Graphics;
  private keeperLabel!: Phaser.GameObjects.Text;
  private cooldownLabel!: Phaser.GameObjects.Text;
  private keeperArrivalMs = 0;
  private canvasRendering = false;
  private simulationPoses = new Map<number, SimulationPose>();
  private actorImages = new Map<number, Phaser.GameObjects.Image>();
  private corpseImages = new Map<number, Phaser.GameObjects.Image>();
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private contacts: Contact[] = [];
  private aftermath: Aftermath[] = [];
  private corpseBirths = new Map<number, { angle: number; at: number }>();
  private deathPoses = new Map<number, DeathPose>();
  private arrivals = new Map<number, number>();
  private transfers: Transfer[] = [];
  private flashes = new Map<number, number>();
  private recoil = new Map<number, number>();
  private hitReactions = new Map<
    number,
    {
      angle: number;
      directional: boolean;
      strength: number;
      life: number;
      max: number;
    }
  >();
  private lastAction = new Map<number, string>();
  private mutationPulse = new Map<string, number>();
  private bodyPoints = new Map<number, { x: number; y: number }>();
  private gait = new Map<
    number,
    {
      x: number;
      y: number;
      phase: number;
      settledFrom: number;
      lastMovedAt: number;
      angle: number;
    }
  >();
  private previousEncounter = -1;
  private previousRun = "";
  private elapsed = 0;
  private phaseStartedAt = 0;
  private visualPhase = "";
  private exitOpen: boolean | null = null;
  private exitOpeningMs = 0;
  private lastFrameTime: number | null = null;
  private hitstopMs = 0;
  private callouts: { text: Phaser.GameObjects.Text; life: number; max: number; vy: number }[] = [];
  private arcs: { fromX: number; fromY: number; toX: number; toY: number; life: number; max: number }[] = [];
  private camFocus = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, zoom: 1 };
  private motes = Array.from({ length: 24 }, (_, i) => ({
    x: ((i * 197 + 63) % (WORLD_WIDTH - 80)) + 40,
    y: ((i * 269 + 91) % (WORLD_HEIGHT - 100)) + 50,
    vx: ((i % 5) - 2) * 5.5,
    vy: -8 - (i % 4) * 4.5,
    size: 1.4 + (i % 3) * 0.9,
    phase: i * 0.9,
  }));
  constructor(private hooks: SceneHooks) {
    super("body-hop");
  }
  create() {
    this.canvasRendering = this.game.renderer.type === Phaser.CANVAS;
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    const speciesList: Species[] = ["spitter", "beetle", "hopper"];
    const tile = 96,
      columns = 20;
    for (let page = 0; page < 2; page++) {
      const atlas = document.createElement("canvas");
      atlas.width = columns * tile;
      const frameCount = 4 * (speciesList.length * 2 + 1) * 10 + (page === 0 ? speciesList.length * 2 : 0);
      atlas.height = Math.ceil(frameCount / columns) * tile;
      const ctx = atlas.getContext("2d");
      if (!ctx) throw new Error("Canvas rendering is unavailable");
      const names: string[] = [];
      const add = (name: string, canvas: HTMLCanvasElement) => {
        const slot = names.length;
        names.push(name);
        ctx.drawImage(
          canvas,
          (slot % columns) * tile,
          Math.floor(slot / columns) * tile,
          tile,
          tile
        );
      };
      for (let direction = page * 4; direction < (page + 1) * 4; direction++) {
        for (const species of speciesList)
          for (const owned of [false, true])
            for (let frame = 0; frame < 10; frame++) {
              const pose =
                frame === 8 ? "brace" : frame === 9 ? "strike" : "walk";
              add(
                `${species}-${frame < 8 ? frame : pose}-${
                  owned ? "player" : "wild"
                }-${direction}`,
                createCreatureTexture(
                  species,
                  (frame / 8) * Math.PI * 2,
                  owned,
                  tile,
                  pose === "walk" ? "rest" : pose,
                  direction
                )
              );
            }
        for (let frame = 0; frame < 10; frame++) {
          const pose =
            frame === 8 ? "brace" : frame === 9 ? "strike" : "walk";
          add(
            `keeper-0-${frame < 8 ? frame : pose}-${direction}`,
            createKeeperTexture(
              (frame / 8) * Math.PI * 2,
              0,
              tile,
              pose,
              direction
            )
          );
        }
      }
      if (page === 0)
        for (const species of speciesList)
          for (const spent of [false, true])
            add(
              `${species}-${spent ? "spent" : "corpse"}`,
              createCorpseTexture(species, spent)
            );
      const register = (key: string, source: HTMLCanvasElement) => {
        const texture = this.textures.addCanvas(key, source);
        if (!texture) throw new Error("Creature textures could not load");
        names.forEach((name, slot) =>
          texture.add(
            name,
            0,
            (slot % columns) * tile,
            Math.floor(slot / columns) * tile,
            tile,
            tile
          )
        );
      };
      register(page ? "creatures-back" : "creatures", atlas);
      if (this.canvasRendering) {
        const flashAtlas = document.createElement("canvas");
        flashAtlas.width = atlas.width;
        flashAtlas.height = atlas.height;
        const flashContext = flashAtlas.getContext("2d");
        if (!flashContext) throw new Error("Canvas rendering is unavailable");
        flashContext.drawImage(atlas, 0, 0);
        flashContext.globalCompositeOperation = "source-in";
        flashContext.fillStyle = "#fff0ce";
        flashContext.fillRect(0, 0, atlas.width, atlas.height);
        register(page ? "creature-flash-back" : "creature-flash", flashAtlas);
      }
    }
    this.textures.addCanvas("floor", createFeastFloor());
    this.floor = this.add.image(0, 0, "floor").setOrigin(0).setDepth(0);
    this.ground = this.add.graphics().setDepth(1);
    this.marks = this.add.graphics().setDepth(4);
    this.foreground = this.add.graphics().setDepth(2000);
    this.grafts = this.add.graphics().setDepth(1000);
    this.keeperLabel = this.add
      .text(0, 0, "THE KEEPER", {
        fontFamily: "Georgia",
        fontSize: "20px",
        color: INK.light,
        backgroundColor: INK.black,
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5, 1)
      .setDepth(3)
      .setVisible(false);
    this.cooldownLabel = this.add
      .text(0, 0, "", {
        fontFamily: "Courier New",
        fontStyle: "bold",
        fontSize: "18px",
        color: INK.paper,
        stroke: INK.black,
        strokeThickness: 4,
        padding: { x: 2, y: 1 },
      })
      .setOrigin(0, 0.5)
      .setDepth(2101)
      .setVisible(false);
    const redraw = () => this.game.loop.wake();
    this.scale.on(Phaser.Scale.Events.RESIZE, redraw);
    const parent = this.game.canvas.parentElement;
    const observer = new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
      this.scale.getParentBounds();
      this.scale.refresh();
    });
    if (parent) observer.observe(parent);
    const cleanup = () => {
      observer.disconnect();
      this.scale.off(Phaser.Scale.Events.RESIZE, redraw);
      this.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      this.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.hooks.ready(this.game.canvas);
  }
  captureSimulationState(run: Run) {
    this.simulationPoses.clear();
    for (const actor of run.actors)
      this.simulationPoses.set(actor.id, {
        x: actor.x,
        y: actor.y,
        action: actor.action
          ? {
              kind: actor.action.kind,
              stage: actor.action.stage,
              timeMs: actor.action.timeMs,
            }
          : null,
      });
  }
  private renderActor(actor: Actor, alpha: number): Actor {
    const previous = this.simulationPoses.get(actor.id);
    if (
      !previous ||
      actor.hp <= 0 ||
      Math.hypot(actor.x - previous.x, actor.y - previous.y) > 32
    )
      return actor;
    const action = actor.action;
    const sameAction =
      action &&
      previous.action &&
      action.kind === previous.action.kind &&
      action.stage === previous.action.stage &&
      action.timeMs >= previous.action.timeMs;
    return {
      ...actor,
      x: previous.x + (actor.x - previous.x) * alpha,
      y: previous.y + (actor.y - previous.y) * alpha,
      action: sameAction
        ? {
            ...action,
            timeMs:
              previous.action!.timeMs +
              (action.timeMs - previous.action!.timeMs) * alpha,
          }
        : action,
    };
  }
  update(time: number, frameDelta: number) {
    const dt =
      this.lastFrameTime === null
        ? Math.min(frameDelta, 1000 / 60)
        : Math.max(0, time - this.lastFrameTime);
    this.lastFrameTime = time;
    const delta = Math.min(50, dt);
    this.elapsed += delta;
    if (this.hitstopMs > 0 && !this.hooks.reducedMotion()) {
      this.hitstopMs = Math.max(0, this.hitstopMs - delta);
    } else {
      this.hooks.tick(dt);
    }
    this.updateCallouts(delta);
    const run = this.hooks.getRun();
    if (this.visualPhase !== run.phase) {
      this.visualPhase = run.phase;
      this.simulationPoses.clear();
      this.phaseStartedAt = this.elapsed;
    }
    this.syncEncounter(run);
    this.updateCamera(run, delta);
    this.draw(run, delta);
    const settled =
      run.phase === "ready" ||
      run.phase === "reward" ||
      run.phase === "paused" ||
      ((run.phase === "dead" || run.phase === "escaped") &&
        this.elapsed - this.phaseStartedAt > 700);
    if (settled) {
      this.lastFrameTime = null;
      this.game.loop.sleep();
    }
  }
  private syncEncounter(run: Run) {
    if (
      this.previousEncounter !== run.encounterIndex ||
      this.previousRun !== run.runId
    ) {
      this.resetVisuals();
      const floorTexture = this.textures.get(
        "floor"
      ) as Phaser.Textures.CanvasTexture;
      floorTexture.context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      floorTexture.context.drawImage(
        createFeastFloor(run.obstacles, run.encounterIndex),
        0,
        0
      );
      floorTexture.refresh();
      this.previousEncounter = run.encounterIndex;
      this.previousRun = run.runId;
    }
  }
  private resetVisuals() {
    this.simulationPoses.clear();
    this.actorImages.forEach((image) => image.destroy());
    this.actorImages.clear();
    this.corpseImages.forEach((image) => image.destroy());
    this.corpseImages.clear();
    this.particles = [];
    this.rings = [];
    this.contacts = [];
    this.aftermath = [];
    this.corpseBirths.clear();
    this.deathPoses.forEach((pose) => pose.image.destroy());
    this.deathPoses.clear();
    this.arrivals.clear();
    this.transfers.forEach((transfer) => transfer.departure?.destroy());
    this.transfers = [];
    this.keeperArrivalMs = 0;
    this.keeperLabel.setVisible(false);
    this.flashes.clear();
    this.recoil.clear();
    this.hitReactions.clear();
    this.lastAction.clear();
    this.mutationPulse.clear();
    this.bodyPoints.clear();
    this.gait.clear();
    this.exitOpen = null;
    this.exitOpeningMs = 0;
  }
  receive(events: GameEvent[]) {
    this.syncEncounter(this.hooks.getRun());
    const departed = new Map<number, Vec2>();
    for (const event of events)
      if (event.type === "possess")
        departed.set(event.fromId, { x: event.fromX, y: event.fromY });
    let fallen: {
      x: number;
      y: number;
      angle: number;
      pose: Omit<DeathPose, "image"> | null;
    } | null = null;
    for (const event of events) {
      if (event.type === "spawn") {
        for (const id of event.ids) this.arrivals.set(id, this.elapsed);
        if (event.ids.some((id) =>
          this.hooks.getRun().actors.some((actor) => actor.id === id && actor.elite)
        )) this.keeperArrivalMs = 2400;
      }
      if (event.type === "mutation")
        this.mutationPulse.set(event.mutationId, 500);
      if (event.type === "attack" && event.phase === "release") {
        if (event.kind === "basic" || event.species === "spitter")
          this.recoil.set(event.sourceId, 130);
        if (event.pattern?.kind === "ring") {
          this.recoil.set(event.sourceId, 150);
          this.rings.push({ x: event.x, y: event.y, radius: 44,
            life: 180, max: 180, color: DANGER });
        } else if (event.species === "spitter") {
          this.burst(
            event.x + event.dirX * 32,
            event.y + event.dirY * 32,
            3,
            0xaaa36b,
            75
          );
        } else {
          for (const side of [-1, 1])
            this.burst(
              event.x - event.dirX * 16 - event.dirY * side * 20,
              event.y - event.dirY * 16 + event.dirX * side * 20 + 12,
              2,
              0xc2b69a,
              event.species === "hopper" ? 55 : 35
            );
        }
      }
      if (event.type === "surface") {
        const angle = Math.atan2(event.dirY, event.dirX);
        const heavy = event.kind === "charge";
        const color = event.material === "bread" ? 0xc7a369 : 0xc5c4ab;
        this.leaveMark(
          event.x - event.dirX * 3,
          event.y - event.dirY * 3,
          angle,
          heavy ? 17 : 9,
          event.kind === "spit"
            ? "splat"
            : event.material === "bread"
            ? "crumbs"
            : "scrape"
        );
        const count = this.hooks.reducedMotion() ? 2 : heavy ? 7 : 3;
        for (let i = 0; i < count; i++) {
          const spread = angle + Math.PI + (Math.random() - 0.5) * 1.8;
          const speed = this.hooks.reducedMotion()
            ? 0
            : (heavy ? 95 : 35) * (0.4 + Math.random() * 0.6);
          const life = heavy ? 300 : 180;
          this.particles.push({
            x: event.x - event.dirX * 3,
            y: event.y - event.dirY * 3,
            vx: Math.cos(spread) * speed,
            vy: Math.sin(spread) * speed,
            size: heavy ? 2 + Math.random() * 3 : 1.5,
            life,
            max: life,
            color: event.kind === "spit" ? 0x9c9a61 : color,
          });
        }
        if (this.particles.length > 160)
          this.particles.splice(0, this.particles.length - 160);
        if (heavy)
          this.hitReactions.set(event.sourceId, {
            angle: angle + Math.PI,
            directional: true,
            strength: 5,
            life: 120,
            max: 120,
          });
      }
      if (event.type === "damage") {
        this.flashes.set(event.targetId, 65);
        const source =
          this.hooks
            .getRun()
            .actors.find((actor) => actor.id === event.sourceId) ??
          departed.get(event.sourceId);
        const angle = source
          ? Math.atan2(event.y - source.y, event.x - source.x)
          : 0;
        const reactionMs = event.shellBroken ? 190 : 140;
        this.hitReactions.set(event.targetId, {
          angle,
          directional: Boolean(source),
          strength: event.shellBroken ? 7 : event.amount >= 3 ? 5 : 3,
          life: reactionMs,
          max: reactionMs,
        });
        this.contacts.push({
          x: event.x,
          y: event.y,
          angle,
          life: 170,
          max: 170,
          shell: event.shellDamage > 0,
          broken: event.shellBroken,
          radial: !source,
        });
        if (this.contacts.length > 32) this.contacts.shift();
        if (event.shellBroken)
          this.leaveMark(event.x, event.y, angle, 26, "shell");
        this.burst(
          event.x,
          event.y,
          event.shellBroken ? 7 : 4,
          event.faction === "player" ? RED : 0x796757,
          160
        );
        if (event.faction === "player" && !this.hooks.reducedMotion())
          this.cameras.main.shake(80, event.coreDamage > 0 ? 0.003 : 0.0015, true);
      }
      if (event.type === "death") {
        const image = this.actorImages.get(event.id);
        const reaction = this.hitReactions.get(event.id);
        const texture = image?.texture.key.endsWith("-back") ? "creatures-back" : "creatures";
        const frame = image ? String(image.frame.name) : "";
        const pose = !event.player && image && !this.hooks.reducedMotion()
          ? {
              texture,
              frame,
              x: image.x,
              y: image.y,
              width: image.displayWidth,
              height: image.displayHeight,
              angle: reaction?.angle ?? 0,
              at: this.elapsed,
            }
          : null;
        this.hitReactions.delete(event.id);
        fallen = {
          x: event.x,
          y: event.y,
          angle: this.gait.get(event.id)?.angle ?? 0,
          pose,
        };
        this.leaveMark(
          event.x,
          event.y,
          fallen.angle,
          SPECIES[event.species].radius * 0.9,
          "remains"
        );
        this.burst(event.x, event.y, 9, 0x8e6050, 130);
      }
      if (event.type === "corpse") {
        const matching = fallen && Math.hypot(event.x - fallen.x, event.y - fallen.y) < 2
          ? fallen : null;
        const angle = matching?.angle ?? 0;
        if (matching?.pose) {
          const pose = matching.pose;
          this.deathPoses.set(event.id, {
            ...pose,
            image: this.add.image(pose.x, pose.y, pose.texture, pose.frame)
              .setDisplaySize(pose.width, pose.height)
              .setDepth(10 + event.y),
          });
        }
        this.corpseBirths.set(event.id, { angle, at: this.elapsed });
        fallen = null;
      }
      if (event.type === "possess") {
        this.deathPoses.get(event.corpseId)?.image.destroy();
        this.deathPoses.delete(event.corpseId);
        this.corpseBirths.set(event.abandonedCorpseId, {
          angle: this.gait.get(event.fromId)?.angle ?? 0,
          at: this.elapsed,
        });
        if (event.healed > 0) {
          this.rings.push({ x: event.x, y: event.y, radius: 42,
            life: 420, max: 420, color: 0xf0788e });
          this.burst(event.x, event.y - 16, 5, 0xf3a7b4, 45);
        }
        const departure = this.bodyPoints.get(event.fromId);
        const oldImage = this.actorImages.get(event.fromId);
        const shell = oldImage
          ? this.add
              .image(
                oldImage.x,
                oldImage.y,
                oldImage.texture.key.endsWith("-back")
                  ? "creatures-back"
                  : "creatures",
                String(oldImage.frame.name).replace("-player", "-wild")
              )
              .setRotation(oldImage.rotation)
              .setDisplaySize(oldImage.displayWidth, oldImage.displayHeight)
              .setDepth(10 + event.fromY)
          : null;
        this.transfers.push({
          fromX: departure?.x ?? event.fromX,
          fromY: departure?.y ?? event.fromY,
          x: event.x,
          y: event.y,
          life: 320,
          max: 320,
          toId: event.toId,
          abandonedCorpseId: event.abandonedCorpseId,
          departure: shell,
          departureWidth: oldImage?.displayWidth ?? 100,
          departureHeight: oldImage?.displayHeight ?? 100,
          departureAngle: oldImage?.rotation ?? 0,
        });
      }
      if (event.type === "arc") {
        this.arcs.push({ fromX: event.fromX, fromY: event.fromY, toX: event.toX, toY: event.toY, life: 170, max: 170 });
      }
      if (event.type === "impact") {
        if (event.kind === "spore") {
          this.rings.push(
            { x: event.x, y: event.y, radius: event.radius, life: 360, max: 360, color: 0xffb74d },
            { x: event.x, y: event.y, radius: event.radius * 0.62, life: 240, max: 240, color: 0xff5a36 }
          );
          this.spawnCallout(event.x, event.y - 18, "BOOM!", "#ffd275");
          if (!this.hooks.reducedMotion()) {
            this.hitstopMs = Math.max(this.hitstopMs, 28);
            this.cameras.main.shake(110, 0.004, true);
          }
          continue;
        }
        if (event.kind === "graze") {
          this.rings.push({ x: event.x, y: event.y, radius: event.radius, life: 240, max: 240, color: 0x8ef0b0 });
          this.spawnCallout(event.x, event.y - 26, "GRAZE!", "#9ff7c0");
          continue;
        }
        if (event.kind === "orbit") {
          this.rings.push({ x: event.x, y: event.y, radius: 24, life: 180, max: 180, color: 0x8ef0b0 });
          continue;
        }
        if (event.kind === "heart") {
          this.rings.push({ x: event.x, y: event.y, radius: 36, life: 260, max: 260, color: 0xe04f6b });
          this.spawnCallout(event.x, event.y - 24, "+1 HEART", "#ff8fa3");
          continue;
        }
        const solidHit = event.faction === "player" && event.hitCount > 0;
        const enemy = event.faction === "enemy";
        const echo = event.faction === "echo";
        const life = solidHit ? 300 : echo ? 130 : 160;
        this.rings.push({
          x: event.x,
          y: event.y,
          radius: solidHit ? event.radius : Math.min(event.radius, echo ? 16 : 20),
          life,
          max: life,
          color: solidHit ? LIGHT : enemy ? 0xb88169 : echo ? 0x85858a : 0xb6b19a,
          groundContact: !solidHit,
        });
        if (!solidHit) continue;
        const angle = Math.atan2(event.dirY ?? 0, event.dirX ?? 1);
        if (event.kind !== "shock") {
          this.leaveMark(
            event.x,
            event.y,
            angle,
            event.radius * 0.85,
            event.kind === "charge" ? "scar" : "remains"
          );
          this.contacts.push({
            x: event.x,
            y: event.y,
            angle,
            life: 230,
            max: 230,
            shell: true,
            broken: true,
            radial: event.kind !== "charge",
          });
          if (this.contacts.length > 32) this.contacts.shift();
        }
        this.burst(event.x, event.y, 7, 0xd7c89a, 150);
        if (!this.hooks.reducedMotion()) this.cameras.main.shake(75, 0.0015);
      }
    }
  }
  private leaveMark(
    x: number,
    y: number,
    angle: number,
    size: number,
    kind: Aftermath["kind"]
  ) {
    this.aftermath.push({ x, y, angle, size, kind });
    if (this.aftermath.length > 32) this.aftermath.shift();
  }
  private burst(
    x: number,
    y: number,
    count: number,
    color: number,
    speed: number
  ) {
    if (this.hooks.reducedMotion()) count = Math.ceil(count * 0.4);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2,
        velocity = speed * (0.2 + Math.random() * 0.8),
        life = 180 + Math.random() * 250;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        size: 1 + Math.random() * 4,
        life,
        max: life,
        color,
      });
    }
    if (this.particles.length > 160)
      this.particles.splice(0, this.particles.length - 160);
  }
  private drawAftermath() {
    const g = this.ground;
    for (const mark of this.aftermath) {
      const point = (along: number, across: number) => ({
        x:
          mark.x + Math.cos(mark.angle) * along - Math.sin(mark.angle) * across,
        y:
          mark.y + Math.sin(mark.angle) * along + Math.cos(mark.angle) * across,
      });
      if (mark.kind === "splat") {
        const a = point(-mark.size * 0.45, -mark.size * 0.55),
          b = point(1, mark.size * 0.65),
          c = point(-mark.size * 0.9, mark.size * 0.2);
        g.fillStyle(0x353f31, 0.5).fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
        g.lineStyle(3, 0x8f9162, 0.48).lineBetween(a.x, a.y, b.x, b.y);
        for (let i = 0; i < 3; i++) {
          const dot = point(-3 - i * 3, (i - 1) * mark.size * 0.7);
          g.fillStyle(0x919469, 0.4).fillCircle(dot.x, dot.y, 1.7 - i * 0.3);
        }
      } else if (mark.kind === "crumbs") {
        for (let i = 0; i < 5; i++) {
          const p = point(-4 - (i % 3) * 5, (i - 2) * 5);
          g.fillStyle(i % 2 ? 0xb7955e : 0x796044, 0.72).fillTriangle(
            p.x - 2,
            p.y - 2,
            p.x + 3,
            p.y - 1,
            p.x,
            p.y + 3
          );
        }
      } else if (mark.kind === "scrape") {
        for (const side of [-1, 1]) {
          const a = point(-mark.size, side * 4),
            b = point(1, side * 6);
          g.lineStyle(2.5, 0x2c3c37, 0.65).lineBetween(a.x, a.y, b.x, b.y);
          g.lineStyle(1, 0xb4b8a1, 0.65).lineBetween(
            a.x,
            a.y + 2,
            b.x,
            b.y + 2
          );
        }
      } else if (mark.kind === "remains") {
        g.fillStyle(0x46372c, 0.26).fillEllipse(
          mark.x,
          mark.y,
          mark.size * 2.5,
          mark.size * 1.55
        );
        for (let i = 0; i < 4; i++) {
          const a = point(
            -mark.size * 0.55 + i * 7,
            (i % 2 ? 1 : -1) * mark.size * 0.55
          );
          const b = point(
            -mark.size * 0.1 + i * 6,
            (i % 2 ? 1 : -1) * mark.size * 0.85
          );
          g.lineStyle(2, 0x3a352a, 0.35).lineBetween(a.x, a.y, b.x, b.y);
        }
      } else if (mark.kind === "shell") {
        for (let i = 0; i < 5; i++) {
          const angle = i * 2.4;
          const center = point(
            Math.cos(angle) * mark.size,
            Math.sin(angle) * mark.size * 0.7
          );
          g.fillStyle(i % 2 ? 0xc7bd96 : 0x8b7664, 0.65).fillTriangle(
            center.x - 3,
            center.y - 4,
            center.x + 6,
            center.y - 1,
            center.x - 1,
            center.y + 3
          );
        }
      } else {
        for (let i = -1; i <= 1; i++) {
          const a = point(-mark.size, i * 8),
            b = point(mark.size * 0.4, i * 8 + 2);
          g.lineStyle(3.5, 0x302127, 0.45).lineBetween(a.x, a.y, b.x, b.y);
          g.lineStyle(1, 0xa38a70, 0.35).lineBetween(
            a.x,
            a.y + 2,
            b.x,
            b.y + 2
          );
        }
      }
    }
  }
  private drawDeathPoses(run: Run) {
    for (const [id, pose] of this.deathPoses) {
      const age = this.elapsed - pose.at;
      const corpse = run.corpses.find((body) => body.id === id);
      if (age >= 120 || !corpse || corpse.spent || this.hooks.reducedMotion()) {
        pose.image.destroy();
        this.deathPoses.delete(id);
        continue;
      }
      const progress = age / 120;
      const settling = Phaser.Math.Clamp((age - 36) / 84, 0, 1);
      const recoil = Math.sin(progress * Math.PI) * 5;
      pose.image
        .setPosition(
          pose.x + (corpse.x - pose.x) * settling + Math.cos(pose.angle) * recoil,
          pose.y + (corpse.y - pose.y) * settling + Math.sin(pose.angle) * recoil
        )
        .setDisplaySize(
          pose.width * (1 + Math.sin(progress * Math.PI) * 0.12),
          pose.height * (1 - progress * 0.24)
        )
        .setAlpha(1 - settling);
      if (age < 36) {
        if (this.canvasRendering)
          pose.image.setTexture(
            pose.texture.endsWith("-back") ? "creature-flash-back" : "creature-flash",
            pose.frame
          );
        else pose.image.setTint(0xfff0ce).setTintMode(Phaser.TintModes.FILL);
      } else {
        pose.image.setTexture(pose.texture, pose.frame).clearTint();
      }
    }
  }
  screenToWorld(viewX: number, viewY: number): Vec2 {
    const cam = this.cameras?.main;
    if (!cam) return { x: viewX, y: viewY };
    const view = cam.worldView;
    if (!view || view.width <= 0 || view.height <= 0) return { x: viewX, y: viewY };
    return {
      x: view.x + (viewX / WORLD_WIDTH) * view.width,
      y: view.y + (viewY / WORLD_HEIGHT) * view.height,
    };
  }
  private updateCamera(run: Run, dt: number) {
    const cam = this.cameras?.main;
    if (!cam) return;
    const active = run.phase === "playing" || run.phase === "cleared";
    const reduced = this.hooks.reducedMotion();
    const targetZoom = active && !reduced ? 1.24 : 1;
    const player = run.actors.find((actor) => actor.id === run.playerId);
    const input = this.hooks.getInput();
    const aim = input?.aimDirection ?? { x: 0, y: 0 };
    const targetX = active && player && !reduced ? player.x + aim.x * 36 : WORLD_WIDTH / 2;
    const targetY = active && player && !reduced ? player.y + aim.y * 36 : WORLD_HEIGHT / 2;
    const t = 1 - Math.exp(-dt / 140);
    this.camFocus.zoom += (targetZoom - this.camFocus.zoom) * t;
    this.camFocus.x += (targetX - this.camFocus.x) * t;
    this.camFocus.y += (targetY - this.camFocus.y) * t;
    cam.setZoom(this.camFocus.zoom);
    cam.centerOn(this.camFocus.x, this.camFocus.y);
  }
  private spawnCallout(x: number, y: number, label: string, color: string) {
    const text = this.add
      .text(x, y, label, {
        fontFamily: '"Courier New", monospace',
        fontSize: "16px",
        fontStyle: "bold",
        color,
        stroke: "#1c191a",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(15);
    this.callouts.push({ text, life: 640, max: 640, vy: -34 });
  }
  private updateCallouts(dt: number) {
    for (let i = this.callouts.length - 1; i >= 0; i--) {
      const c = this.callouts[i]!;
      c.life -= dt;
      if (c.life <= 0) {
        c.text.destroy();
        this.callouts.splice(i, 1);
        continue;
      }
      c.text.y += (c.vy * dt) / 1000;
      c.text.setAlpha(Math.min(1, (c.life / c.max) * 1.4));
    }
  }
  private screenSize(worldSize: number, minimumPixels: number): number {
    const { displaySize, gameSize } = this.scale;
    const ratio = Math.min(displaySize.width / gameSize.width, displaySize.height / gameSize.height);
    return Math.max(worldSize, minimumPixels / (ratio || 1));
  }
  private draw(run: Run, dt: number) {
    const ground = this.ground,
      marks = this.marks,
      front = this.foreground;
    const alpha = this.hooks.getInterpolationAlpha();
    const actors = run.actors.map((actor) => this.renderActor(actor, alpha));
    ground.clear();
    marks.clear();
    front.clear();
    this.grafts.clear();
    this.cooldownLabel.setVisible(false);
    this.drawDeathPoses(run);
    this.drawAftermath();
    this.keeperArrivalMs = Math.max(0, this.keeperArrivalMs - dt);
    const keeper = actors.find((actor) => actor.elite && actor.hp > 0);
    this.keeperLabel.setVisible(Boolean(keeper && this.keeperArrivalMs > 0));
    if (keeper) {
      const fontSize = Math.ceil(this.screenSize(20, 11));
      if (this.keeperLabel.style.fontSize !== `${fontSize}px`)
        this.keeperLabel.setFontSize(fontSize);
      this.keeperLabel
        .setPosition(keeper.x, Math.max(55, keeper.y - keeper.radius - 28))
        .setAlpha(Math.min(1, this.keeperArrivalMs / 350));
    }
    for (const [id, remaining] of this.mutationPulse)
      this.mutationPulse.set(id, Math.max(0, remaining - dt));
    if (run.exit) {
      const { x, y } = run.exit,
        open =
          run.phase === "cleared" ||
          run.phase === "escaped" ||
          (run.phase === "paused" && run.resumePhase === "cleared");
      if (this.exitOpen !== open) {
        this.exitOpeningMs = this.exitOpen === false && open ? 240 : 0;
        this.exitOpen = open;
      } else if (run.phase !== "paused") {
        this.exitOpeningMs = Math.max(0, this.exitOpeningMs - dt);
      }
      if (this.hooks.reducedMotion()) this.exitOpeningMs = 0;
      const gap = open ? 21 * (1 - (this.exitOpeningMs / 240) ** 3) : 0;
      ground.fillStyle(0x151c1c, 1).fillEllipse(x, y - 9, 110, 74);
      ground
        .fillStyle(open ? 0x0f1215 : 0x303a35, 1)
        .fillEllipse(x, y - 3, 68 + gap, 57);
      for (const side of [-1, 1]) {
        const point = (px: number, py: number) =>
          new Phaser.Math.Vector2(
            x + side * (px + gap),
            y + py + (side === 1 ? -3 : 0)
          );
        const shard = [
          [side === 1 ? 9 : 4, -28],
          [35, side === 1 ? -38 : -35],
          [side === 1 ? 53 : 57, -22],
          [58, side === 1 ? 15 : 10],
          [side === 1 ? 30 : 36, 27],
          [9, 19],
          [side === 1 ? 20 : 16, 5],
          [5, -3],
          [17, -13],
        ].map(([px, py]) => point(px!, py!));
        ground
          .fillStyle(0x87958a, 1)
          .lineStyle(2.8, 0x232d2b, 1)
          .fillPoints(shard, true)
          .strokePoints(shard, true);
        const face = [
          [13, -23],
          [34, -28],
          [49, -18],
          [48, 6],
          [35, 18],
          [21, 13],
          [26, 3],
          [17, -5],
          [26, -13],
        ].map(([px, py]) => point(px!, py!));
        ground.fillStyle(0xd2c7a4, 1).fillPoints(face, true);
        const chip = [point(8, 17), point(23, 24), point(20, 12)];
        ground.fillStyle(0x6d786a, 1).fillPoints(chip, true);
        const a = point(34, -22),
          b = point(41, -12),
          c = point(32, -5);
        ground
          .lineStyle(1.5, 0x788777, 0.85)
          .lineBetween(a.x, a.y, b.x, b.y)
          .lineBetween(b.x, b.y, c.x, c.y);
      }
      if (open) {
        const pulse = this.hooks.reducedMotion()
          ? 0
          : Math.sin(this.elapsed * 0.004) * 3;
        marks
          .lineStyle(4, RED, 0.9)
          .lineBetween(x, y + 67 + pulse, x, y + 36 + pulse);
        marks
          .lineStyle(4, RED, 0.9)
          .lineBetween(x, y + 36 + pulse, x - 9, y + 47 + pulse);
        marks
          .lineStyle(4, RED, 0.9)
          .lineBetween(x, y + 36 + pulse, x + 9, y + 47 + pulse);
      }
    }
    for (const area of run.areas) {
      if (area.kind === "acid") {
        ground
          .fillStyle(0x7b7f48, 0.27)
          .fillEllipse(area.x, area.y, area.radius * 2, area.radius * 1.7);
        ground
          .lineStyle(1.5, 0x64703d, 0.65)
          .strokeEllipse(area.x, area.y, area.radius * 2, area.radius * 1.7);
        for (let i = 0; i < 5; i++)
          ground
            .fillStyle(0xd5c968, 0.7)
            .fillCircle(
              area.x + Math.sin(i * 2.3) * area.radius * 0.6,
              area.y + Math.cos(i * 3.1) * area.radius * 0.5,
              3 + Math.sin(this.elapsed * 0.005 + i)
            );
      } else {
        const presence = Math.min(1, area.remainingMs / 500);
        ground
          .lineStyle(6, BLACK, 0.65 * presence)
          .lineBetween(area.x, area.y, area.toX, area.toY);
        ground
          .lineStyle(3, LIGHT, 0.95 * presence)
          .lineBetween(area.x, area.y, area.toX, area.toY);
      }
    }
    for (const spore of run.spores) {
      if (!spore.alive) continue;
      const pulse = this.hooks.reducedMotion() ? 0 : Math.sin(this.elapsed * 0.008 + spore.id) * 2.5;
      ground.fillStyle(BLACK, 0.22).fillEllipse(spore.x + 2, spore.y + spore.radius * 0.55, spore.radius * 2.1, spore.radius * 1.1);
      ground.lineStyle(1.5, 0xe87b35, 0.35).strokeCircle(spore.x, spore.y, spore.radius + 7 + pulse);
      marks.fillStyle(0x6e231c, 1).fillCircle(spore.x, spore.y, spore.radius + 1);
      marks.fillStyle(0xd95b2b, 1).fillCircle(spore.x, spore.y, spore.radius - 2);
      marks.fillStyle(0xffc86b, 0.92).fillCircle(spore.x - 4, spore.y - 4, spore.radius * 0.42 + pulse * 0.3);
      marks.lineStyle(2, BLACK, 0.9).strokeCircle(spore.x, spore.y, spore.radius);
    }
    for (const pickup of run.pickups) {
      if (pickup.remainingMs < 2000 && Math.floor(pickup.remainingMs / 140) % 2 === 0) continue;
      const bob = this.hooks.reducedMotion() ? 0 : Math.sin(this.elapsed * 0.009 + pickup.id) * 2.5;
      const py = pickup.y + bob;
      ground.fillStyle(BLACK, 0.2).fillEllipse(pickup.x, pickup.y + 11, 22, 10);
      marks.fillStyle(0xe04f6b, 0.28).fillCircle(pickup.x, py, 16);
      marks.fillStyle(0xc93654, 1).fillCircle(pickup.x - 4.5, py - 2.5, 6);
      marks.fillStyle(0xc93654, 1).fillCircle(pickup.x + 4.5, py - 2.5, 6);
      marks.fillTriangle(pickup.x - 10, py - 0.5, pickup.x + 10, py - 0.5, pickup.x, py + 11);
      marks.fillStyle(0xffb3c1, 0.85).fillCircle(pickup.x - 4.5, py - 4, 2.2);
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i]!;
      arc.life -= dt;
      if (arc.life <= 0) {
        this.arcs.splice(i, 1);
        continue;
      }
      const alpha = arc.life / arc.max;
      const midX = (arc.fromX + arc.toX) / 2 + (Math.random() - 0.5) * 18;
      const midY = (arc.fromY + arc.toY) / 2 + (Math.random() - 0.5) * 18;
      marks.lineStyle(4, 0xffe066, alpha * 0.65);
      marks.lineBetween(arc.fromX, arc.fromY, midX, midY);
      marks.lineBetween(midX, midY, arc.toX, arc.toY);
      marks.lineStyle(1.8, 0xffffff, alpha);
      marks.lineBetween(arc.fromX, arc.fromY, midX, midY);
      marks.lineBetween(midX, midY, arc.toX, arc.toY);
    }
    const cam = this.cameras?.main;
    const parallaxX = cam ? (cam.scrollX + cam.width / 2 - WORLD_WIDTH / 2) * 0.16 : 0;
    const parallaxY = cam ? (cam.scrollY + cam.height / 2 - WORLD_HEIGHT / 2) * 0.16 : 0;
    const moteColor = run.encounterIndex === 4 ? 0xff9a4d : run.encounterIndex === 5 ? 0xff6b82 : 0xe9e2c8;
    for (const mote of this.motes) {
      if (!this.hooks.reducedMotion()) {
        mote.x = (mote.x + (mote.vx * dt) / 1000 + WORLD_WIDTH) % WORLD_WIDTH;
        mote.y = (mote.y + (mote.vy * dt) / 1000 + WORLD_HEIGHT) % WORLD_HEIGHT;
      }
      const shimmer = 0.22 + 0.18 * Math.sin(this.elapsed * 0.003 + mote.phase);
      const mx = mote.x - parallaxX;
      const my = mote.y - parallaxY;
      marks.fillStyle(moteColor, shimmer).fillCircle(mx, my, mote.size);
    }
    const input = this.hooks.getInput(),
      player = actors.find((actor) => actor.id === run.playerId)!;
    const aliveCorpses = new Set<number>();
    for (const corpse of run.corpses) {
      if (corpse.consumed) continue;
      aliveCorpses.add(corpse.id);
      let image = this.corpseImages.get(corpse.id);
      if (!image) {
        image = this.add
          .image(corpse.x, corpse.y, "creatures", `${corpse.species}-corpse`)
          .setDepth(2);
        this.corpseImages.set(corpse.id, image);
      }
      const size = corpse.radius * 3.35;
      if (!corpse.spent) {
        ground.lineStyle(1.5, LIGHT, 0.22)
          .strokeEllipse(corpse.x, corpse.y + corpse.radius * 0.35,
            corpse.radius * 2.2, corpse.radius * 1.1);
      }
      const birth = this.corpseBirths.get(corpse.id);
      const deathPose = this.deathPoses.get(corpse.id);
      const corpsePresence = deathPose
        ? Phaser.Math.Clamp((this.elapsed - deathPose.at - 36) / 84, 0, 1)
        : 1;
      if (!corpse.spent && birth && this.hooks.reducedMotion() && this.elapsed - birth.at < 120) {
        marks.lineStyle(2, PAPER, 0.55)
          .strokeEllipse(corpse.x, corpse.y, corpse.radius * 2, corpse.radius * 1.1);
      }
      const settling =
        birth && !this.hooks.reducedMotion()
          ? Math.max(0, 1 - (this.elapsed - birth.at) / 240)
          : 0;
      const leaving = this.transfers.find(
        (transfer) => transfer.abandonedCorpseId === corpse.id
      );
      image
        .setFrame(`${corpse.species}-${corpse.spent ? "spent" : "corpse"}`)
        .setPosition(corpse.x, corpse.y)
        .setDisplaySize(
          size * (1 - settling * 0.1),
          size * (1 + settling * 0.13)
        )
        .setRotation(birth?.angle ?? corpse.id * 0.7)
        .setAlpha(
          corpse.spent
            ? (0.26 +
                0.32 *
                  Math.max(
                    0,
                    1 - (this.elapsed - (birth?.at ?? -Infinity)) / 1400
                  )) *
                (leaving ? 1 - leaving.life / leaving.max : 1)
            : 0.82 * corpsePresence
        );
    }
    this.corpseImages.forEach((image, id) => {
      if (!aliveCorpses.has(id)) {
        image.destroy();
        this.corpseImages.delete(id);
      }
    });
    for (const actor of actors)
      if (
        actor.hp > 0 &&
        actor.faction === "enemy" &&
        (actor.action?.stage === "windup" || actor.action?.kind === "leap" ||
          actor.action?.kind === "charge")
      )
        this.drawTelegraph(actor);
    if (
      input &&
      player.hp > 0 &&
      player.action?.kind !== "dash" &&
      (run.phase === "playing" || run.phase === "cleared")
    )
      this.drawAim(run, player, input.aimDirection, input.aimDistance);
    const aliveActors = new Set<number>();
    for (const actor of actors) {
      if (actor.hp <= 0) {
        if (actor.faction !== "player") continue;
        aliveActors.add(actor.id);
        let fallen = this.actorImages.get(actor.id);
        if (!fallen) {
          fallen = this.add.image(
            actor.x,
            actor.y,
            "creatures",
            `${actor.species}-corpse`
          );
          this.actorImages.set(actor.id, fallen);
        }
        const settling = Math.min(
          1,
          (this.elapsed - this.phaseStartedAt) / 300
        );
        fallen
          .setTexture("creatures", `${actor.species}-corpse`)
          .setPosition(actor.x, actor.y)
          .setDisplaySize(
            actor.radius * 3.35,
            actor.radius * 3.35 * (1 - settling * 0.2)
          )
          .setRotation(
            Math.atan2(actor.facingY, actor.facingX) + settling * 0.3
          )
          .setAlpha(0.9)
          .clearTint();
        front
          .lineStyle(7, BLACK, 1)
          .lineBetween(actor.x - 10, actor.y - 6, actor.x + 9, actor.y + 8);
        front
          .lineStyle(4, LIGHT, 1)
          .lineBetween(actor.x - 10, actor.y - 6, actor.x + 9, actor.y + 8);
        front.fillStyle(RED, 1).fillCircle(actor.x + 9, actor.y + 8, 5);
        continue;
      }
      aliveActors.add(actor.id);
      let image = this.actorImages.get(actor.id);
      const owned = actor.faction === "player",
        echo = actor.faction === "echo";
      const aimAngle = Math.atan2(actor.facingY, actor.facingX);
      const gait = this.gait.get(actor.id) ?? {
        x: actor.x,
        y: actor.y,
        phase: 0,
        settledFrom: 0,
        lastMovedAt: -Infinity,
        angle: aimAngle,
      };
      const distance = Math.hypot(actor.x - gait.x, actor.y - gait.y);
      const active = run.phase === "playing" || run.phase === "cleared";
      if (active && !actor.stunMs && distance > 0.05) {
        gait.phase += distance / (actor.species === "hopper" ? 8 : 11);
        gait.settledFrom = gait.phase;
        gait.lastMovedAt = this.elapsed;
      }
      const idleMs = this.elapsed - gait.lastMovedAt;
      const moving = active && !actor.stunMs && idleMs <= 34;
      if (active && idleMs > 34) {
        const settle = Math.min(1, (idleMs - 34) / 100);
        gait.phase =
          gait.settledFrom +
          (Math.round(gait.settledFrom / 8) * 8 - gait.settledFrom) *
            (1 - (1 - settle) ** 2);
      }
      gait.x = actor.x;
      gait.y = actor.y;
      gait.angle =
        this.hooks.reducedMotion() || actor.action
          ? aimAngle
          : gait.angle +
            Phaser.Math.Angle.Wrap(aimAngle - gait.angle) *
              (1 - Math.exp(-dt / 22));
      this.gait.set(actor.id, gait);
      const frame = Math.round(gait.phase) % 8;
      const direction = ((Math.round(gait.angle / (Math.PI / 4)) % 8) + 8) % 8;
      const texture = direction >= 4 ? "creatures-back" : "creatures";
      const previousAction = this.lastAction.get(actor.id);
      if (previousAction === "spit" && !actor.action)
        this.recoil.set(actor.id, 140);
      this.lastAction.set(actor.id, actor.action?.kind ?? "");
      const recoiling = this.recoil.get(actor.id) ?? 0;
      if (recoiling > 0) this.recoil.set(actor.id, recoiling - dt);
      const pose =
        actor.action?.stage === "windup"
          ? "brace"
          : actor.action?.stage === "active" || recoiling > 0
          ? "strike"
          : frame;
      const transfer = this.transfers.find((t) => t.toId === actor.id);
      const arrival = transfer
        ? Math.min(1, 1 - (transfer.life - dt) / transfer.max)
        : 1;
      const entering = transfer && !this.hooks.reducedMotion() && !actor.action;
      const key = actor.elite
        ? `keeper-0-${pose}-${direction}`
        : entering && arrival < 100 / transfer.max
        ? `${actor.species}-brace-wild-${direction}`
        : `${actor.species}-${entering && arrival < 0.65 ? "strike" : pose}-${
            owned ? "player" : "wild"
          }-${direction}`;
      if (!image) {
        image = this.add.image(actor.x, actor.y, texture, key);
        this.actorImages.set(actor.id, image);
      } else image.setTexture(texture, key);
      let lift = 0,
        squashX = 1,
        squashY = 1;
      const appearedAt = this.arrivals.get(actor.id);
      if (appearedAt !== undefined) {
        const progress = Math.min(1, (this.elapsed - appearedAt) / 480);
        if (progress >= 1) this.arrivals.delete(actor.id);
        else {
          const remaining = 1 - progress;
          const radius = actor.radius + 9 + (this.hooks.reducedMotion() ? 0 : progress * 18);
          ground.fillStyle(BLACK, remaining * 0.45)
            .fillEllipse(actor.x, actor.y + actor.radius * 0.4, radius * 2, radius);
          marks.lineStyle(3, actor.faction === "enemy" ? DANGER : PAPER, remaining * 0.7)
            .strokeEllipse(actor.x, actor.y + actor.radius * 0.4, radius * 2, radius);
          if (!this.hooks.reducedMotion() && !actor.action) {
            squashX *= 1 + remaining * 0.18;
            squashY *= 1 - remaining * 0.24;
          }
        }
      }
      if (actor.action) {
        const progress =
          actor.action.timeMs / Math.max(1, actor.action.durationMs);
        if (actor.action.stage === "windup") {
          squashX = 1 - progress * 0.14;
          squashY = 1 + progress * 0.12;
        } else if (actor.action.kind === "leap") {
          lift = Math.sin(progress * Math.PI) * 55;
          squashX = 1.04;
          squashY = 0.92;
        } else if (actor.action.kind === "charge") {
          squashX = 1.15;
          squashY = 0.88;
        }
      }
      if (!this.hooks.reducedMotion() && !actor.action) {
        const breath = Math.sin(this.elapsed * 0.003 + actor.id * 1.7) * 0.018;
        squashX *= 1 + breath;
        squashY *= 1 - breath;
        if (moving) {
          const stride = Math.sin((gait.phase * Math.PI) / 4);
          lift += Math.abs(stride) * (actor.species === "hopper" ? 3 : 1.4);
          squashY *= 1 + stride * 0.025;
        }
        if (recoiling > 0) {
          squashX *= 1 - (recoiling / 140) * 0.14;
          squashY *= 1 + (recoiling / 140) * 0.1;
        }
      }
      const forwardX = Math.cos(gait.angle) ** 2;
      const forwardScale = squashX,
        sideScale = squashY;
      squashX = forwardScale * forwardX + sideScale * (1 - forwardX);
      squashY = forwardScale * (1 - forwardX) + sideScale * forwardX;
      const size = actor.radius * 3.35;
      if (entering) {
        const opening = Math.sin(
          Math.min(1, Math.max(0, (arrival * transfer.max - 100) / 180)) *
            Math.PI
        );
        squashX *= 1 - opening * 0.16;
        squashY *= 1 + opening * 0.16;
      }
      const hit = this.hitReactions.get(actor.id);
      const impact =
        hit && !this.hooks.reducedMotion()
          ? (Math.max(0, hit.life) / hit.max) ** 2
          : 0;
      const visual = {
        x:
          actor.x +
          (hit?.directional ? Math.cos(hit.angle) * hit.strength * impact : 0),
        y:
          actor.y +
          (hit?.directional ? Math.sin(hit.angle) * hit.strength * impact : 0),
      };
      if (hit) {
        const along = hit.directional ? Math.cos(hit.angle) ** 2 : 0.5;
        const compression = hit.strength * 0.018 * impact;
        squashX *= 1 + compression * (0.5 - along * 1.5);
        squashY *= 1 + compression * (along * 1.5 - 1);
        hit.life -= dt;
        if (hit.life <= 0) this.hitReactions.delete(actor.id);
      }
      const escaping =
        actor.faction === "player" && run.phase === "escaped"
          ? Math.min(1, (this.elapsed - this.phaseStartedAt) / 350)
          : 0;
      const presence = 1 - escaping;
      if (escaping > 0 && !this.hooks.reducedMotion()) {
        const enteringExit = 1 - (1 - escaping) ** 2;
        visual.x += (run.exit.x - visual.x) * enteringExit;
        visual.y += (run.exit.y - 3 - visual.y) * enteringExit;
        lift *= 1 - enteringExit;
        squashX *= 1 - enteringExit * 0.45;
        squashY *= 1 - enteringExit * 0.45;
      }
      const anchor = creatureAnchor(actor.species, direction),
        unit = size / 112;
      this.bodyPoints.set(actor.id, {
        x: visual.x + anchor.x * squashX * unit,
        y: visual.y - lift + anchor.y * squashY * unit,
      });
      if (actor.faction === "player" && actor.hp > 0) {
        ground.lineStyle(2.5, 0x8ef0b0, 0.72).strokeEllipse(visual.x, visual.y + actor.radius * 0.45, actor.radius * 2.25, actor.radius * 1.2);
        const muts = run.mutations;
        if (muts.includes("venom-sacs")) {
          marks.lineStyle(1.8, 0xc38cff, 0.55).strokeCircle(visual.x, visual.y, actor.radius + 5);
        }
        if (muts.includes("shock-molt")) {
          marks.lineStyle(1.8, 0xb8e6ff, 0.6).strokeCircle(visual.x, visual.y, actor.radius + 2);
        }
        if (muts.includes("split-glands")) {
          const perpX = -actor.facingY, perpY = actor.facingX;
          marks.fillStyle(0xffd275, 0.9);
          marks.fillCircle(visual.x + perpX * (actor.radius + 3), visual.y + perpY * (actor.radius + 3), 3.5);
          marks.fillCircle(visual.x - perpX * (actor.radius + 3), visual.y - perpY * (actor.radius + 3), 3.5);
        }
        if (muts.includes("orbital-shell")) {
          const orbitRadius = actor.radius + 28;
          for (let i = 0; i < 2; i++) {
            const angle = run.activeTimeMs * 0.0042 + i * Math.PI;
            const ox = visual.x + Math.cos(angle) * orbitRadius;
            const oy = visual.y + Math.sin(angle) * orbitRadius;
            marks.fillStyle(0x8ef0b0, 0.88).fillCircle(ox, oy, 8);
            marks.lineStyle(2, BLACK, 0.9).strokeCircle(ox, oy, 8);
          }
        }
      }
      if (actor.faction === "enemy" && actor.hp > 0) {
        if (actor.variant === "splitter") {
          marks.lineStyle(2, 0xffb74d, 0.72).strokeCircle(visual.x, visual.y, actor.radius + 5);
        } else if (actor.variant === "sniper") {
          marks.lineStyle(2, 0xe04f6b, 0.72).strokeCircle(visual.x, visual.y, actor.radius + 4);
        }
      }
      if (actor.faction === "player" && actor.action?.kind === "dash") {
        const dash = actor.action;
        for (let step = 1; step <= 3; step++) {
          const lag = step * 14;
          const alpha = 0.45 - step * 0.11;
          marks
            .lineStyle(2.5, 0xc5e5c8, alpha)
            .strokeCircle(visual.x - dash.dirX * lag, visual.y - dash.dirY * lag, actor.radius * (1 - step * 0.12));
        }
        marks
          .lineStyle(3, 0xc5e5c8, 0.9)
          .strokeCircle(visual.x, visual.y, actor.radius + 7);
      }
      if (actor.faction === "enemy" && actor.maxHp > 1 && (actor.elite || actor.hp < actor.maxHp)) {
        if (actor.elite && actor.hp <= Math.ceil(actor.maxHp / 2)) {
          const pulse = this.hooks.reducedMotion() ? 0 : Math.sin(this.elapsed * 0.014) * 3;
          marks.lineStyle(2.5, RED, 0.65).strokeCircle(visual.x, visual.y, actor.radius + 9 + pulse);
        }
        const barW = actor.elite ? 74 : 38;
        const barH = actor.elite ? 7 : 5;
        const barX = visual.x - barW / 2;
        const barY = visual.y - actor.radius - (actor.elite ? 22 : 14);
        marks.fillStyle(BLACK, 0.78).fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
        marks.fillStyle(0x453534, 1).fillRect(barX, barY, barW, barH);
        marks.fillStyle(RED, 1).fillRect(barX, barY, barW * Math.max(0, actor.hp / actor.maxHp), barH);
      }
      ground
        .fillStyle(BLACK, (echo ? 0.05 : 0.16) * presence)
        .fillEllipse(
          (escaping > 0 ? visual.x : actor.x) + 4,
          (escaping > 0 ? visual.y : actor.y) + actor.radius * 0.7,
          actor.radius * 2.3 - lift * 0.25,
          actor.radius * 0.75 - lift * 0.06
        );
      image
        .setPosition(visual.x, visual.y - lift)
        .setRotation(0)
        .setDisplaySize(size * squashX, size * squashY)
        .setDepth(10 + actor.y)
        .setAlpha(
          escaping > 0
            ? presence
            : echo
            ? 0.45
            : actor.invulnerableMs > 0 && !transfer
            ? this.hooks.reducedMotion()
              ? 0.85
              : 0.925 + Math.sin(this.elapsed * 0.025) * 0.075
            : 1
        );
      const flash = this.flashes.get(actor.id) ?? 0;
      if (flash > 0) {
        if (this.canvasRendering)
          image.setTexture(
            direction >= 4 ? "creature-flash-back" : "creature-flash",
            key
          );
        else image.setTint(0xfff0ce).setTintMode(Phaser.TintModes.FILL);
        this.flashes.set(actor.id, flash - dt);
      } else {
        if (image.texture.key !== texture) image.setTexture(texture, key);
        image.clearTint();
      }
      if (actor.poisonMs > 0) {
        marks
          .lineStyle(2, 0x727f32, 0.8 * presence)
          .strokeCircle(actor.x, actor.y, actor.radius + 3);
      }
      if (owned) {
        if (run.phase !== "escaped") {
          this.drawAbilityMeter(actor, visual, lift, presence);
          marks
            .lineStyle(this.screenSize(2.4, 2.1), BLACK, 0.7 * presence)
            .strokeEllipse(
              actor.x,
              actor.y + actor.radius * 0.6,
              actor.radius * 2.65 + 3,
              actor.radius * 0.9 + 3
            );
          marks
            .lineStyle(this.screenSize(1.2, 1.1), LIGHT, presence)
            .strokeEllipse(
              actor.x,
              actor.y + actor.radius * 0.6,
              actor.radius * 2.65 + 3,
              actor.radius * 0.9 + 3
            );
        }
        this.grafts.setDepth(10 + actor.y + 0.5).setAlpha(presence);
        if (!entering || arrival >= 100 / transfer.max)
          this.drawMorphology(
            run,
            actor,
            visual,
            direction,
            lift,
            squashX,
            squashY
          );
        if (!actor.action && run.phase === "playing") {
          const reach = actor.radius + 23,
            dx = actor.facingX,
            dy = actor.facingY,
            x = actor.x + dx * reach,
            y = actor.y - lift + dy * reach,
            ready = actor.specialCooldownMs <= 0;
          for (const [width, color] of [
            [5, BLACK],
            [2.2, LIGHT],
          ] as const) {
            front.lineStyle(width, color, (ready ? 1 : 0.45) * presence);
            front.lineBetween(x - dx * 7 - dy * 5, y - dy * 7 + dx * 5, x, y);
            front.lineBetween(x - dx * 7 + dy * 5, y - dy * 7 - dx * 5, x, y);
          }
        }
      } else if (actor.hp < actor.maxHp && !echo) {
        front
          .fillStyle(BLACK, 0.65)
          .fillRoundedRect(
            actor.x - 22,
            actor.y - actor.radius - 13 - lift,
            44,
            4,
            2
          );
        front
          .fillStyle(RED, 1)
          .fillRoundedRect(
            actor.x - 22,
            actor.y - actor.radius - 13 - lift,
            44 * Math.max(0, actor.hp / actor.maxHp),
            4,
            2
          );
      }
    }
    this.actorImages.forEach((image, id) => {
      if (!aliveActors.has(id)) {
        image.destroy();
        this.actorImages.delete(id);
        this.hitReactions.delete(id);
        this.gait.delete(id);
        this.arrivals.delete(id);
      }
    });
    this.drawEffects(dt);
    const projectiles = [
      ...run.projectiles.filter(shot => shot.faction === "player"),
      ...run.projectiles.filter(shot => shot.faction === "enemy"),
    ];
    for (const current of projectiles) {
      const projectile = {
        ...current,
        x: current.prevX + (current.x - current.prevX) * alpha,
        y: current.prevY + (current.y - current.prevY) * alpha,
        prevX: current.prevX - (current.x - current.prevX) * (1 - alpha),
        prevY: current.prevY - (current.y - current.prevY) * (1 - alpha),
      };
      const color =
        projectile.faction === "enemy"
          ? DANGER
          : projectile.poison
          ? 0xd9e58a
          : LIGHT;
      front
        .lineStyle(projectile.radius * 1.7, color, 0.25)
        .lineBetween(
          projectile.prevX,
          projectile.prevY,
          projectile.x,
          projectile.y
        );
      if (projectile.faction === "enemy") {
        front
          .fillStyle(BLACK, 1)
          .fillCircle(projectile.x, projectile.y, projectile.radius + 2.5);
        front
          .fillStyle(0xff805f, 1)
          .fillCircle(projectile.x, projectile.y, projectile.radius + 0.5);
        front
          .fillStyle(0xffedc2, 1)
          .fillCircle(projectile.x, projectile.y, projectile.radius * 0.43);
      } else if (projectile.kind === "barb") {
        const angle = Math.atan2(projectile.vy, projectile.vx),
          dx = Math.cos(angle),
          dy = Math.sin(angle);
        front
          .fillStyle(color, 1)
          .fillTriangle(
            projectile.x + dx * 9,
            projectile.y + dy * 9,
            projectile.x - dx * 5 - dy * 3,
            projectile.y - dy * 5 + dx * 3,
            projectile.x - dx * 5 + dy * 3,
            projectile.y - dy * 5 - dx * 3
          );
      } else {
        front
          .fillStyle(BLACK, 0.8)
          .fillCircle(projectile.x, projectile.y, projectile.radius + 1.5);
        front
          .fillStyle(color, 1)
          .fillCircle(projectile.x, projectile.y, projectile.radius);
        front
          .fillStyle(PAPER, 0.8)
          .fillCircle(projectile.x - 1, projectile.y - 2, 1.4);
      }
    }
    if (player.hp > 0 && run.phase === "playing" &&
      !(player.action?.kind === "leap" && player.action.stage === "active")) {
      const protectedBody = player.invulnerableMs > 0;
      front.lineStyle(4, BLACK, 0.95).strokeCircle(player.x, player.y, PLAYER_BULLET_RADIUS);
      front.lineStyle(1.5, protectedBody ? 0x98d8ce : LIGHT, 1)
        .strokeCircle(player.x, player.y, PLAYER_BULLET_RADIUS);
      front.fillStyle(BLACK, 1).fillCircle(player.x, player.y, 4);
      front.fillStyle(LIGHT, 1).fillCircle(player.x, player.y, 2);
    }
  }
  private drawAbilityMeter(
    actor: Actor,
    position: Vec2,
    lift: number,
    presence: number
  ) {
    const g = this.foreground,
      x = position.x,
      y = Math.max(22, position.y - lift - actor.radius * 1.45 - 24),
      radius = 14,
      progress = Phaser.Math.Clamp(
        1 - actor.specialCooldownMs / SPECIES[actor.species].specialMs,
        0,
        1
      ),
      ready =
        actor.specialCooldownMs <= 0 && !actor.action && actor.stunMs <= 0,
      color = ready ? LIGHT : hex(INK.core);
    g.fillStyle(BLACK, 0.94 * presence).fillCircle(x, y, radius + 4);
    g.lineStyle(2.5, PAPER, 0.23 * presence).strokeCircle(x, y, radius);
    if (progress > 0) {
      const start = -Math.PI / 2,
        end = start + progress * Math.PI * 2;
      g.lineStyle(3, color, presence).beginPath();
      g.arc(x, y, radius, start, end);
      g.strokePath();
      g.fillStyle(color, presence).fillCircle(
        x + Math.cos(end) * radius,
        y + Math.sin(end) * radius,
        1.5
      );
    }
    if (ready) {
      g.fillStyle(LIGHT, presence).fillTriangle(x, y - 5, x + 4, y, x - 4, y);
      g.fillTriangle(x - 4, y, x + 4, y, x, y + 5);
    } else {
      g.fillStyle(color, (actor.action ? 0.9 : 0.4) * presence).fillCircle(
        x,
        y,
        actor.action ? 3 : 2
      );
    }
    const feedback = this.hooks.getInput()?.cooldownFeedback;
    if (feedback) {
      const label = this.cooldownLabel;
      const fontSize = Math.ceil(this.screenSize(18, 12));
      if (label.style.fontSize !== `${fontSize}px`) label.setFontSize(fontSize);
      label.setText(`${(Math.ceil(feedback.cooldownMs / 100) / 10).toFixed(1)}s`);
      const gap = this.screenSize(7, 4), margin = this.screenSize(8, 4);
      const right = x + radius + gap;
      const labelX = right + label.width <= WORLD_WIDTH - margin
        ? right : x - radius - gap - label.width;
      label
        .setPosition(
          Phaser.Math.Clamp(labelX, margin, WORLD_WIDTH - label.width - margin),
          Phaser.Math.Clamp(y, label.height / 2 + margin, WORLD_HEIGHT - label.height / 2 - margin)
        )
        .setAlpha(presence * (this.hooks.reducedMotion() ? 1 : Math.min(1, feedback.expiresInMs / 100)))
        .setVisible(true);
    }
  }
  private dashedCircle(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    segments: number
  ) {
    for (let i = 0; i < segments; i++) {
      const start = (i / segments) * Math.PI * 2,
        end = start + Math.PI / segments;
      g.beginPath();
      g.arc(x, y, radius, start, end);
      g.strokePath();
    }
  }
  private strokeTelegraph(enemy: boolean, opacity: number, trace: () => void, width = 2) {
    if (enemy) {
      this.marks.lineStyle(this.screenSize(width + 2, 2.5), BLACK, 0.7);
      trace();
      this.marks.strokePath();
    }
    this.marks.lineStyle(enemy ? this.screenSize(width, 1.25) : width,
      enemy ? DANGER : LIGHT, opacity);
    // WebGL stores widths with path points, so each stroke needs its own trace.
    trace();
    this.marks.strokePath();
  }
  private drawTelegraph(actor: Actor) {
    const action = actor.action;
    if (!action) return;
    const g = this.marks,
      enemy = actor.faction === "enemy",
      color = enemy ? DANGER : LIGHT;
    const progress =
      action.stage === "active"
        ? 1
        : action.timeMs / Math.max(1, action.durationMs);
    if (action.pattern) {
      const pattern = action.pattern;
      const reach = pattern.kind === "ring" ? 118 : 230;
      const start = pattern.kind === "ring"
        ? pattern.angle + pattern.gap / 2
        : pattern.angle - pattern.spread / 2;
      const sweep = pattern.kind === "ring"
        ? Math.PI * 2 - pattern.gap
        : pattern.spread;
      this.strokeTelegraph(enemy, 0.4 + progress * 0.5,
        () => g.beginPath().arc(actor.x, actor.y, reach, start, start + sweep));
      for (let index = 0; index < pattern.count; index++) {
        const angle = pattern.kind === "ring"
          ? pattern.angle + Math.PI * 2 * index / pattern.count
          : start + sweep * index / Math.max(1, pattern.count - 1);
        const difference = Math.abs(Math.atan2(
          Math.sin(angle - pattern.angle), Math.cos(angle - pattern.angle)
        ));
        if (pattern.kind === "ring" && difference < pattern.gap / 2) continue;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const from = actor.radius + 14;
        g.lineStyle(enemy ? this.screenSize(1.4, 0.75) : 1.4, color, 0.14 + progress * 0.28)
          .lineBetween(actor.x + dx * from, actor.y + dy * from,
            actor.x + dx * reach, actor.y + dy * reach);
        const tip = from + (reach - from) * progress;
        g.fillStyle(color, 0.55 + progress * 0.4)
          .fillCircle(actor.x + dx * tip, actor.y + dy * tip, 2.5);
      }
    } else if (action.kind === "leap") {
      const radius =
        actor.faction === "enemy" ? LEAP_RADIUS.enemy : LEAP_RADIUS.player;
      g.fillStyle(color, 0.07 + progress * 0.08).fillCircle(
        action.targetX,
        action.targetY,
        radius
      );
      this.strokeTelegraph(enemy, 0.6 + progress * 0.4,
        () => g.beginPath().arc(action.targetX, action.targetY, radius, 0, Math.PI * 2));
      g.lineStyle(1, color, 0.3).lineBetween(
        actor.x,
        actor.y,
        action.targetX,
        action.targetY
      );
    } else if (action.kind === "swipe") {
      const angle = Math.atan2(action.dirY, action.dirX),
        reach = actor.species === "beetle" ? 100 : 84;
      g.fillStyle(color, 0.06 + progress * 0.13);
      const trace = () => g.beginPath().moveTo(actor.x, actor.y)
        .arc(actor.x, actor.y, reach, angle - 1.3, angle + 1.3).closePath();
      trace();
      g.fillPath();
      this.strokeTelegraph(enemy, 0.5 + progress * 0.4, trace);
      g.lineStyle(3, color, 0.8).lineBetween(
        actor.x + action.dirX * (actor.radius + 8),
        actor.y + action.dirY * (actor.radius + 8),
        actor.x + action.dirX * reach * progress,
        actor.y + action.dirY * reach * progress
      );
    } else if (action.kind === "charge") {
      const px = -action.dirY * actor.radius,
        py = action.dirX * actor.radius,
        angle = Math.atan2(action.dirY, action.dirX);
      g.fillStyle(color, 0.07 + progress * 0.1);
      const trace = () => g.beginPath().moveTo(actor.x + px, actor.y + py)
        .lineTo(action.targetX + px, action.targetY + py)
        .arc(action.targetX, action.targetY, actor.radius, angle + Math.PI / 2, angle - Math.PI / 2, true)
        .lineTo(actor.x - px, actor.y - py)
        .arc(actor.x, actor.y, actor.radius, angle - Math.PI / 2, angle + Math.PI / 2, true)
        .closePath();
      trace();
      g.fillPath();
      this.strokeTelegraph(enemy, 0.5 + progress * 0.35, trace);
      const x = actor.x + (action.targetX - actor.x) * progress,
        y = actor.y + (action.targetY - actor.y) * progress;
      g.lineStyle(3, color, 0.8).lineBetween(actor.x, actor.y, x, y);
    } else {
      const length = 230,
        width = actor.faction === "enemy" && !action.basic ? 44 : 8;
      const x = actor.x + action.dirX * length,
        y = actor.y + action.dirY * length,
        px = -action.dirY * width,
        py = action.dirX * width;
      g.fillStyle(color, 0.07 + progress * 0.08).fillTriangle(
        actor.x,
        actor.y,
        x + px,
        y + py,
        x - px,
        y - py
      );
      this.strokeTelegraph(enemy, 0.6,
        () => g.beginPath().moveTo(actor.x, actor.y).lineTo(x, y), 1.7);
    }
  }
  private drawAim(run: Run, actor: Actor, aim: Vec2, aimDistance?: number) {
    const g = this.marks;
    const target = previewSpecial(
      run,
      getPlayer(run),
      aim.x,
      aim.y,
      aimDistance
    );
    if (actor.species === "hopper") {
      g.fillStyle(LIGHT, 0.035).fillCircle(
        target.x,
        target.y,
        LEAP_RADIUS.player
      );
      g.lineStyle(2.5, LIGHT, 0.65);
      this.dashedCircle(g, target.x, target.y, LEAP_RADIUS.player, 16);
      g.lineStyle(1.5, LIGHT, 0.25).lineBetween(
        actor.x,
        actor.y,
        target.x,
        target.y
      );
      g.lineStyle(2, LIGHT, 0.65).lineBetween(
        target.x - 7,
        target.y,
        target.x + 7,
        target.y
      );
      g.lineBetween(target.x, target.y - 7, target.x, target.y + 7);
    } else if (actor.species === "beetle") {
      const px = -aim.y * actor.radius,
        py = aim.x * actor.radius;
      g.fillStyle(LIGHT, 0.035).lineStyle(1.8, LIGHT, 0.5);
      g.beginPath();
      g.moveTo(actor.x + px, actor.y + py);
      g.lineTo(target.x + px, target.y + py);
      g.lineTo(target.x - px, target.y - py);
      g.lineTo(actor.x - px, actor.y - py);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.lineStyle(2, LIGHT, 0.5).strokeCircle(target.x, target.y, actor.radius);
    } else {
      const length = Math.max(80, Math.min(260, aimDistance ?? 230));
      const baseAngle = Math.atan2(aim.y, aim.x);
      const angles = run.mutations.includes("split-glands")
        ? [baseAngle - 0.2, baseAngle, baseAngle + 0.2]
        : [baseAngle];
      for (const angle of angles) {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const isCenter = angle === baseAngle;
        const startX = actor.x + dx * (actor.radius + 10);
        const startY = actor.y + dy * (actor.radius + 10);
        const endX = actor.x + dx * (isCenter ? length : length * 0.78);
        const endY = actor.y + dy * (isCenter ? length : length * 0.78);
        g.lineStyle(isCenter ? 2 : 1.3, LIGHT, isCenter ? 0.45 : 0.22).lineBetween(
          startX,
          startY,
          endX,
          endY
        );
        if (isCenter) g.lineStyle(1.5, LIGHT, 0.65).strokeCircle(endX, endY, 5);
      }
    }
  }
  private drawMorphology(
    run: Run,
    actor: Actor,
    position: Vec2,
    direction: number,
    lift: number,
    squashX: number,
    squashY: number
  ) {
    const g = this.grafts,
      scale = (actor.radius * 3.35) / 112;
    const point = (x: number, y: number) => {
      const projected = projectCreaturePoint(x, y, direction);
      return {
        x: position.x + projected.x * squashX * scale,
        y: position.y - lift + projected.y * squashY * scale,
      };
    };
    drawMutationGrafts(
      g,
      run.mutations.filter((id) => id !== "silk-trail"),
      point,
      scale,
      this.mutationPulse,
      this.hooks.reducedMotion() ? 0 : this.elapsed
    );
    if (run.silkTrail) {
      const presence = Math.min(1, run.silkTrail.remainingMs / 300);
      const sway = this.hooks.reducedMotion() ? 0 : Math.sin(this.elapsed * 0.006) * 6;
      const root = point(-24, 0), tip = point(-44, sway);
      g.lineStyle(4, BLACK, 0.8 * presence)
        .lineBetween(root.x, root.y, tip.x, tip.y);
      g.lineStyle(2, LIGHT, presence)
        .lineBetween(root.x, root.y, tip.x, tip.y);
    }
    if (run.healthModel === "shell-core" && actor.shell < actor.maxShell) {
      const damage = 1 - actor.shell / actor.maxShell;
      const cuts = [
        [-22, -14, -12, -7, -18, 1],
        [-6, 11, 4, 16, 10, 9],
        [-17, 6, -8, 1, -5, -8],
      ];
      for (const cut of cuts.slice(0, Math.ceil(damage * 3))) {
        const a = point(cut[0]!, cut[1]!),
          b = point(cut[2]!, cut[3]!),
          c = point(cut[4]!, cut[5]!);
        g.lineStyle(3.4 * scale, BLACK, 0.9)
          .beginPath()
          .moveTo(a.x, a.y)
          .lineTo(b.x, b.y)
          .lineTo(c.x, c.y)
          .strokePath();
        g.lineStyle(1.2 * scale, LIGHT, 0.8).lineBetween(
          a.x,
          a.y - scale,
          b.x,
          b.y - scale
        );
      }
      if (actor.shell === 0) {
        const a = point(-18, 4),
          b = point(-4, -4),
          c = point(-7, 11);
        g.fillStyle(RED, 0.85).fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
        g.lineStyle(1.3 * scale, BLACK, 1).lineBetween(a.x, a.y, c.x, c.y);
      }
    }
  }
  private drawEffects(dt: number) {
    const g = this.foreground;
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      p.life -= dt;
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      const drag = Math.pow(0.94, dt / (1000 / 60));
      p.vx *= drag;
      p.vy *= drag;
      g.fillStyle(p.color, Math.max(0, p.life / p.max)).fillRect(
        p.x,
        p.y,
        p.size,
        p.size * 0.6
      );
    }
    this.contacts = this.contacts.filter((contact) => contact.life > 0);
    for (const contact of this.contacts) {
      contact.life -= dt;
      const progress = 1 - Math.max(0, contact.life) / contact.max;
      const travel = this.hooks.reducedMotion()
        ? 0
        : Math.sqrt(progress) * (contact.broken ? 23 : 13);
      for (let i = -1; i <= 1; i++) {
        const angle = contact.radial ? (i * Math.PI * 2) / 3 : contact.angle;
        const point = (along: number, across: number) => ({
          x: contact.x + Math.cos(angle) * along - Math.sin(angle) * across,
          y: contact.y + Math.sin(angle) * along + Math.cos(angle) * across,
        });
        const a = point(3 + travel, i * (7 + travel * 0.4));
        const b = point(
          (contact.broken ? 29 : 18) + travel,
          i * (11 + travel * 0.7)
        );
        const c = point(9 + travel, i * (9 + travel * 0.6) + 3);
        g.fillStyle(
          contact.shell ? LIGHT : DANGER,
          (1 - progress) * 0.9
        ).fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      }
      if (progress < 0.3) {
        g.lineStyle(2.5, LIGHT, 1 - progress).lineBetween(
          contact.x - 5,
          contact.y - 5,
          contact.x + 5,
          contact.y + 5
        );
        g.lineBetween(
          contact.x - 5,
          contact.y + 5,
          contact.x + 5,
          contact.y - 5
        );
      }
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const ring of this.rings) {
      ring.life -= dt;
      const progress = 1 - Math.max(0, ring.life) / ring.max;
      const spread = ring.groundContact
        ? this.hooks.reducedMotion() ? 1 : 0.7 + progress * 0.3
        : progress;
      g.lineStyle(
        (ring.groundContact ? 1.6 : 2.6) * (1 - progress),
        ring.color,
        Math.max(0, 1 - progress) * (ring.groundContact ? 0.65 : 1)
      ).strokeEllipse(
        ring.x,
        ring.y,
        ring.radius * 2 * spread,
        ring.radius * (ring.groundContact ? 0.65 : 1.6) * spread
      );
    }
    this.transfers.forEach((transfer) => {
      if (transfer.life <= 0) transfer.departure?.destroy();
    });
    this.transfers = this.transfers.filter((t) => t.life > 0);
    for (const transfer of this.transfers) {
      transfer.life -= dt;
      const destination = this.bodyPoints.get(transfer.toId);
      if (destination) {
        transfer.x = destination.x;
        transfer.y = destination.y;
      }
      const progress = Math.min(1, 1 - transfer.life / transfer.max),
        travel = Math.min(1, (progress * transfer.max) / 100),
        start = Math.max(0, (progress - 0.25) / 0.75),
        dx = transfer.x - transfer.fromX,
        dy = transfer.y - transfer.fromY,
        len = Math.hypot(dx, dy) || 1;
      const points: Vec2[] = [];
      const collapse = this.hooks.reducedMotion() ? 0 : progress;
      transfer.departure
        ?.setDisplaySize(
          transfer.departureWidth * (1 + collapse * 0.12),
          transfer.departureHeight * (1 - collapse * 0.35)
        )
        .setRotation(transfer.departureAngle + collapse * 0.15)
        .setAlpha(Math.max(0, 1 - progress * 1.25));
      for (let i = 0; i < 16; i++) {
        const t = start + ((travel - start) * i) / 15,
          wave =
            Math.sin(t * Math.PI) *
            Math.sin(i * 0.65 + this.elapsed * 0.025) *
            (this.hooks.reducedMotion() ? 0 : 7);
        points.push({
          x: transfer.fromX + dx * t - (dy / len) * wave,
          y: transfer.fromY + dy * t + (dx / len) * wave,
        });
      }
      for (const [width, color] of [
        [9, BLACK],
        [6, RED],
      ] as const) {
        g.lineStyle(width, color, 1);
        g.beginPath();
        g.moveTo(points[0]!.x, points[0]!.y);
        points.slice(1).forEach((p) => g.lineTo(p.x, p.y));
        g.strokePath();
      }
      const head = points[points.length - 1]!;
      if (travel < 1) {
        const neck = points[points.length - 2]!;
        drawParasiteHead(
          g,
          head.x,
          head.y,
          Math.atan2(head.y - neck.y, head.x - neck.x)
        );
      }
    }
  }
}

export function mountGame(hooks: SceneHooks) {
  const scene = new BodyHopScene(hooks);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "world",
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: INK.paper,
    transparent: false,
    antialias: true,
    powerPreference: "high-performance",
    scene: [scene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
    },
    render: { antialias: true, roundPixels: false },
    fps: { target: 60, smoothStep: false },
    audio: { noAudio: true },
    input: { activePointers: 3 },
  });
  return { game, scene };
}
