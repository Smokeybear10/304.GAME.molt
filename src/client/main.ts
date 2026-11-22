import "./styles.css";
import { ProgressStore } from "./persistence";
import { GameInput } from "./input";
import { GameAudio } from "./audio";
import { mountGame } from "./game";
import { getHostMode, getPostUrl } from "./platform";
import {
  createCorpseTexture,
  paintCreature,
  paintParasite,
  paintMutationSpecimen,
  paintTitle,
} from "./art";
import {
  DASH_COOLDOWN_MS,
  TICK_MS,
  ENCOUNTER_COUNT,
  MUTATIONS,
  SPECIES,
  computeRunScore,
  getEncounter,
  getDailyRoom,
} from "../shared/content";
import {
  createRun,
  restoreCheckpoint,
  createCheckpoint,
  createResult,
  startEncounter,
  step,
  chooseMutation,
  takeCursedPact,
  skipReward,
  pause,
  resume,
  getPlayer,
} from "../shared/engine";
import type {
  GameEvent,
  InputFrame,
  MutationId,
  Run,
  RunResult,
  Species,
} from "../shared/types";

const element = <T extends HTMLElement = HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing game element: ${id}`);
  return found as T;
};
const overlay = element("overlay");
const headerTitle = element<HTMLCanvasElement>("header-title");
const headerContext = headerTitle.getContext("2d");
if (headerContext)
  paintTitle(headerContext, headerTitle.width, headerTitle.height);
function setText(id: string, text: string) {
  const target = element(id);
  if (target.textContent !== text) target.textContent = text;
}
const audio = new GameAudio();
const clock = (ms: number) =>
  `${Math.floor(ms / 60000)}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
const touchControls = matchMedia("(any-pointer: coarse)").matches;
let store: ProgressStore;
let run: Run;
let input: GameInput | null = null;
let renderer: ReturnType<typeof mountGame> | null = null;
let rendererReady = false;
let graphicsLost = false;
let accumulator = 0;
let lastPhase = "";
let settingsOpen = false;
let pauseReason = "";
let replacement: MutationId | null = null;
let hintTimer: ReturnType<typeof setTimeout> | null = null;
let reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let savedBoundary = "";
let lastHud = "";
let restored = false;
let recoveredResult: RunResult | null = null;
let resultRevealAt = 0;
let healthNotice = "";
let healthNoticeUntil = 0;
let healthNoticeKind = "";
const metrics = {
  frames: 0,
  slowFrames: 0,
  maxFrameMs: 0,
  hops: 0,
  shellDamage: 0,
  coreDamage: 0,
  pauses: 0,
};

try {
  const preferences = JSON.parse(
    localStorage.getItem("bodyhop:preferences") ?? "{}"
  ) as Record<string, unknown>;
  if (typeof preferences.muted === "boolean") audio.setMuted(preferences.muted);
  if (typeof preferences.reducedMotion === "boolean")
    reducedMotion = preferences.reducedMotion;
} catch {
  /* Preferences are optional when storage is unavailable. */
}

function savePreferences() {
  try {
    localStorage.setItem(
      "bodyhop:preferences",
      JSON.stringify({ muted: audio.muted, reducedMotion })
    );
  } catch {
    hint("Preferences will last until this tab closes.");
  }
}

function hint(message: string, duration = 3000) {
  const target = element("live-hint");
  target.textContent = message;
  target.classList.add("visible");
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => target.classList.remove("visible"), duration);
}

function dispatch(events: GameEvent[]) {
  renderer?.scene.receive(events);
  audio.events(events, run.playerId);
  for (const event of events) {
    if (event.type === "blocked") hint(event.reason, 1800);
    if (event.type === "possess") {
      metrics.hops++;
      healthNotice = event.healed > 0 ? `+${event.healed} LIFE · New body` : "LIFE FULL · New body";
      healthNoticeUntil = performance.now() + 1600;
      healthNoticeKind = "heal";
      if (event.healed > 0 && !reducedMotion)
        element("life-group").animate(
          [{ backgroundColor: "#4e6b42", filter: "brightness(1.5)" }, { backgroundColor: "transparent", filter: "brightness(1)" }],
          { duration: 420, easing: "ease-out" }
        );
      hint(
        `${SPECIES[event.species].name}. ${SPECIES[event.species].action}.`,
        1500
      );
    }
    if (event.type === "damage" && event.faction === "player") {
      metrics.shellDamage += event.shellDamage;
      metrics.coreDamage += event.coreDamage;
      healthNotice = `−${healthAmount(event.coreDamage)} LIFE`;
      healthNoticeUntil = performance.now() + 1200;
      healthNoticeKind = "damage";
      if (!reducedMotion)
        element("life-group").animate(
          [
            { backgroundColor: "#ab3d5c", filter: "brightness(1.7)" },
            { backgroundColor: "transparent", filter: "brightness(1)" },
          ],
          { duration: 420, easing: "ease-out" }
        );
    }
    if (event.type === "impact" && event.kind === "graze") {
      healthNotice = "GRAZE · Dash refunded + instant shot!";
      healthNoticeKind = "heal";
      healthNoticeUntil = performance.now() + 1400;
    }
    if (event.type === "encounterClear") {
      healthNotice = `Chamber cleared · ${healthAmount(run.core)}/${run.maxCore} life.`;
      healthNoticeKind = "heal";
      healthNoticeUntil = performance.now() + 2600;
      hint(
        event.completedEncounters === ENCOUNTER_COUNT
          ? "The way is open. Escape above."
          : "Chamber cleared! Head through the opening above for an upgrade.",
        6000
      );
    }
    if (event.type === "checkpoint") saveBoundary();
    if (event.type === "result") {
      resultRevealAt =
        performance.now() + (event.result.outcome === "dead" ? 550 : 350);
      store.finish(run.runId, event.result);
    }
  }
}

function saveBoundary() {
  if (recoveredResult) return;
  if (
    run.phase !== "ready" &&
    run.phase !== "reward" &&
    run.phase !== "cleared"
  )
    return;
  const checkpoint = createCheckpoint(run);
  const key = JSON.stringify(checkpoint);
  if (key === savedBoundary) return;
  savedBoundary = key;
  store.save(run.runId, checkpoint);
}

function tick(dt: number) {
  metrics.frames++;
  if (dt > 32) metrics.slowFrames++;
  metrics.maxFrameMs = Math.max(metrics.maxFrameMs, dt);
  if (run.phase !== "playing" && run.phase !== "cleared") {
    accumulator = 0;
    updateUi();
    return;
  }
  if (dt > 350) {
    pauseGame("The game paused while this tab was interrupted.");
    return;
  }
  accumulator += Math.min(dt, 100);
  let frame: InputFrame | null = null;
  while (
    accumulator >= TICK_MS &&
    (run.phase === "playing" || run.phase === "cleared")
  ) {
    frame ??= input?.read() ?? null;
    if (!frame) break;
    renderer?.scene.captureSimulationState(run);
    dispatch(step(run, frame, TICK_MS));
    frame = {
      ...frame,
      abilityPressed: false,
      hopCommitId: null,
      hopCancelled: false,
    };
    accumulator -= TICK_MS;
  }
  updateUi();
}

function begin() {
  if (!rendererReady || graphicsLost || recoveredResult) return;
  if (store.status === "conflict") {
    pauseGame();
    return;
  }
  void audio
    .unlock()
    .catch(() => hint("Sound could not start. You can still play."));
  input?.clear();
  if (hintTimer) clearTimeout(hintTimer);
  element("live-hint").classList.remove("visible");
  accumulator = 0;
  if (run.phase === "ready") dispatch(startEncounter(run));
  else if (run.phase === "paused") resume(run);
  settingsOpen = false;
  pauseReason = "";
  updateUi(true);
  renderer?.game.canvas.focus({ preventScroll: true });
}

function pauseGame(message?: string) {
  if (!run || recoveredResult || run.phase === "dead" || run.phase === "escaped") return;
  if (run.phase !== "paused") {
    pauseReason = message ?? "";
    pause(run);
    metrics.pauses++;
  } else if (message) pauseReason = message;
  input?.clear();
  accumulator = 0;
  updateUi(true);
}

function newAttempt() {
  recoveredResult = null;
  resultRevealAt = 0;
  run = createRun(store.bootstrap.challenge, "shared", crypto.randomUUID());
  replacement = null;
  settingsOpen = false;
  pauseReason = "";
  restored = false;
  savedBoundary = "";
  lastPhase = "";
  healthNotice = "";
  healthNoticeUntil = 0;
  healthNoticeKind = "";
  input?.clear();
  updateUi(true);
}

function updateSaveStatus() {
  const labels = {
    saved: "Saved",
    saving: "Saving…",
    local: "Saved on this device",
    offline: "On device · sync pending",
    conflict: "Newer save in another tab",
    unavailable: "Save unavailable",
  };
  const target = element("save-status");
  target.textContent =
    store.status === "saved" &&
    run &&
    (recoveredResult || run.phase === "dead" || run.phase === "escaped")
      ? "Run saved"
      : labels[store.status];
  target.title =
    store.error ??
    "Progress saves between chambers. Leaving during a fight restarts that chamber.";
  target.dataset.status = store.status;
  const retry = document.getElementById("retry-button");
  if (retry && store.status === "conflict") retry.textContent = "Reload saved run";
  if (
    store.status === "conflict" &&
    run &&
    !["dead", "escaped", "paused"].includes(run.phase)
  )
    pauseGame(
      "Another tab has a newer checkpoint. Reload to continue that run."
    );
}

function dailyPreviewMarkup() {
  const chamber = getDailyRoom(run.challenge);
  if (run.encounterIndex + 1 !== chamber.encounterIndex) return "";
  return `<aside class="daily-preview" aria-label="Next: today’s chamber">
    <strong>Next · ${chamber.name}</strong><span>${chamber.description}</span>
  </aside>`;
}

function healthAmount(value: number) {
  return String(Number(Math.max(0, value).toFixed(1)));
}

function healthPips(value: number, maximum: number) {
  const path = "M10 17.5C7.3 15.5 1 10.9 1 5.7C1 1.1 6.9-.5 10 3.7C13.1-.5 19 1.1 19 5.7C19 10.9 12.7 15.5 10 17.5Z";
  return Array.from({ length: maximum }, (_, index) => {
    const empty = (1 - Math.max(0, Math.min(1, value - index))) * 100;
    return `<svg class="life-pip" viewBox="0 0 20 19" aria-hidden="true"><path class="pip-empty" d="${path}"/><path class="pip-fill" d="${path}" style="clip-path:inset(0 ${empty}% 0 0)"/></svg>`;
  }).join("");
}

function healthExplanation() {
  return "Clear a chamber to recover 1 heart, up to 3. Dash with Space or Click to pass through bullets. At 0 hearts, the run ends.";
}

function updateHud() {
  const player = getPlayer(run);
  const lowLife = run.core > 0 && run.core <= 1;
  const key = `${run.maxCore}:${run.core}:${player.species}:${
    run.encounterIndex
  }:${run.mutations.join(",")}:${player.lastSpecial?.dirX}:${
    player.lastSpecial?.dirY
  }`;
  if (key !== lastHud) {
    lastHud = key;
    element("life-pips").innerHTML = healthPips(run.core, run.maxCore);
    element("core-value").textContent = `${healthAmount(run.core)}/${run.maxCore}`;
    element("life-group").setAttribute("aria-label", `Life: ${healthAmount(run.core)} of ${run.maxCore}.${lowLife ? " Low life." : ""} At zero, the run ends.`);
    element("life-group").classList.toggle("low-life", lowLife);
    element("life-warning").hidden = !lowLife;
    element("hud").dataset.lowLife = String(lowLife);
    element("host-name").textContent = `${run.mutations.length} / 6`;
    element("health-note").title = healthExplanation();
    element("chamber-value").textContent = `${String(
      run.encounterIndex + 1
    ).padStart(2, "0")} / 06`;
    element("mutation-strip").dataset.empty = String(
      run.mutations.length === 0
    );
    element("mutation-strip").innerHTML = run.mutations.length
      ? run.mutations
          .map(
            (id) =>
              `<span title="${MUTATIONS[id].description}">${MUTATIONS[id].name}</span>`
          )
          .join("")
      : "";
    if (touchControls)
      element("control-tip").innerHTML =
        "Auto-fires at nearest foe.<br>Tap Dash to dodge bullets.";
  }
  const dashReady =
    player.stunMs <= 0 &&
    player.basicCooldownMs <= 0 &&
    (!player.action || player.action.stage === "windup");
  setText("ability-name", "DASH");
  setText(
    "health-note",
    run.core <= 0
      ? "No life left. This run is over."
      : performance.now() < healthNoticeUntil
      ? healthNotice
      : lowLife
      ? "1 LIFE · Clear the room to heal +1."
      : "Space / Click to dash through bullets."
  );
  element("health-note").dataset.notice =
    performance.now() < healthNoticeUntil ? healthNoticeKind : "";
  setText(
    "ability-state",
    player.stunMs > 0
      ? "STUNNED"
      : player.action?.kind === "dash"
      ? "DASHING"
      : player.basicCooldownMs > 0
      ? `${(player.basicCooldownMs / 1000).toFixed(1)}s`
      : "READY"
  );
  element("ability-button").classList.toggle("cooling", !dashReady);
  element("ability-button").style.setProperty(
    "--charge",
    String(Math.max(0, 1 - player.basicCooldownMs / DASH_COOLDOWN_MS))
  );
  element("ability-button").title = touchControls
    ? "Tap to dash through enemy bullets"
    : "Dash through bullets · Click or Space";
  element("sound-button").dataset.muted = String(audio.muted);
  element("sound-button").title = audio.muted ? "Unmute sound" : "Mute sound";
  element("sound-button").setAttribute(
    "aria-label",
    audio.muted ? "Unmute sound" : "Mute sound"
  );
  element("pause-button").dataset.paused = String(run.phase === "paused");
  element("pause-button").title =
    run.phase === "paused" ? "Resume · Esc" : "Pause · Esc";
  element("pause-button").setAttribute(
    "aria-label",
    run.phase === "paused" ? "Resume game" : "Pause game"
  );
  element<HTMLButtonElement>("pause-button").disabled =
    graphicsLost || Boolean(recoveredResult) || run.phase === "dead" || run.phase === "escaped";
}

function showScreen(markup: string) {
  overlay.innerHTML = `<div class="screen">${markup}</div>`;
  overlay.classList.remove("hidden");
  overlay.scrollTop = 0;
  const heading = overlay.querySelector<HTMLElement>("h1, h2");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function bind(id: string, callback: () => void) {
  element(id).addEventListener("click", callback);
}
function drawPortrait(species: Species, showParasite = false) {
  const canvas = document.getElementById("portrait");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext("2d");
  if (ctx && showParasite) {
    paintParasite(
      ctx,
      [
        { x: 28, y: 119 },
        { x: 37, y: 130 },
        { x: 54, y: 132 },
        { x: 67, y: 119 },
        { x: 68, y: 103 },
        { x: 84, y: 88 },
      ],
      4
    );
    paintCreature(ctx, species, 133, 75, -0.35, {
      possessed: true,
      scale: 1.42,
    });
    return;
  }
  if (ctx)
    paintCreature(ctx, species, 120, 75, -0.25, {
      possessed: true,
      mutations: run.mutations,
      scale: 1.65,
    });
}

function updateUi(force = false) {
  if (!rendererReady) return;
  updateHud();
  const phase = recoveredResult?.outcome ?? run.phase;
  const phaseKey = `${recoveredResult?.runId ?? run.runId}:${phase}:${run.encounterIndex}:${settingsOpen}:${replacement}`;
  if (phaseKey === lastPhase && !force && !resultRevealAt) return;
  if (renderer && !renderer.game.loop.running) {
    queueMicrotask(() => {
      const loop = renderer?.game.loop;
      if (loop?.started && !loop.running) {
        loop.resetDelta();
        loop.wake();
      }
    });
  }
  lastPhase = phaseKey;
  document.body.dataset.phase = phase;
  document.body.dataset.recoveredResult = String(Boolean(recoveredResult));
  if (phase !== "dead" && phase !== "escaped")
    delete document.body.dataset.result;
  if (run.phase !== "playing" && run.phase !== "cleared") input?.clear();
  saveBoundary();
  if (settingsOpen) {
    renderSettings();
    return;
  }
  if (recoveredResult) {
    renderResult(recoveredResult);
    return;
  }
  if (run.phase === "playing" || run.phase === "cleared") {
    overlay.classList.add("hidden");
    return;
  }
  if (run.phase === "ready") {
    renderReady();
    return;
  }
  if (run.phase === "reward") {
    renderReward();
    return;
  }
  if (run.phase === "paused") {
    renderPause();
    return;
  }
  const result = createResult(run);
  if (result) {
    if (performance.now() < resultRevealAt) {
      overlay.classList.add("hidden");
      return;
    }
    resultRevealAt = 0;
    renderResult(result);
  }
}

function renderReady() {
  const first = run.encounterIndex === 0;
  const chamber = getEncounter(run.challenge, run.encounterIndex);
  showScreen(`<span class="eyebrow">${
    first
      ? "A PARASITE ESCAPE"
      : run.encounterIndex === getDailyRoom(run.challenge).encounterIndex
      ? "TODAY’S CHAMBER · 3 OF 6"
      : `CHAMBER ${run.encounterIndex + 1} OF 6`
  }</span>
    ${
      first
        ? '<canvas id="title-art" class="title-art" width="1020" height="216" role="img" aria-label="MOLT"></canvas>'
        : `<h1>${chamber.name}</h1>`
    }
    <canvas id="portrait" class="intro-creature" width="240" height="150" aria-hidden="true"></canvas>
    <p>${first ? "Dodge the swarm.<br>Stack wild upgrades." : chamber.description}</p>
    ${
      first
        ? `<p class="intro-rule">Auto-fires where you aim.<br>Dash through bullets with Click or Space.</p><p class="health-rule" title="${healthExplanation()}"><strong>3 hearts. At 0, the run ends.</strong><br>Clear a chamber to heal 1 heart and pick an upgrade.</p>`
        : `<p class="small-copy">${healthAmount(run.core)}/${run.maxCore} life · ${
            run.mutations.length
          } ${run.mutations.length === 1 ? "upgrade" : "upgrades"}</p>`
    }
    <button id="begin-button" class="primary-button" type="button">${
      restored
        ? "Resume from checkpoint"
        : first
        ? "Start escape"
        : "Enter chamber"
    }</button>
    ${
      restored || !first
        ? '<button id="restart-run-button" class="text-button" type="button">Restart from Chamber 1</button>'
        : ""
    }
    <p class="fine-print">${
      first
        ? touchControls
          ? "Left thumb moves · auto-fires at foes · tap Dash to dodge"
          : "WASD moves · mouse aims (auto-fires) · Click / Space to Dash"
        : "Progress saved. You can leave and return here."
    }</p>`);
  drawPortrait(getPlayer(run).species, first);
  const titleCanvas = document.getElementById("title-art");
  if (titleCanvas instanceof HTMLCanvasElement) {
    const ctx = titleCanvas.getContext("2d");
    if (ctx) paintTitle(ctx, titleCanvas.width, titleCanvas.height, true);
  }
  bind("begin-button", begin);
  if (restored || !first)
    bind("restart-run-button", () => {
      newAttempt();
      saveBoundary();
      begin();
    });
}

function mutationSpecimen(id: MutationId, className = "mutation-specimen") {
  return `<canvas class="${className}" data-specimen="${id}" width="168" height="168" aria-hidden="true"></canvas>`;
}

function mutationChoice(id: MutationId, buttonId: string, shed = false) {
  const mutation = MUTATIONS[id];
  return `<button class="mutation-option" type="button" id="${buttonId}" aria-labelledby="${buttonId}-name" aria-describedby="${buttonId}-effect">
    ${mutationSpecimen(id)}
    <span class="mutation-copy"><strong id="${buttonId}-name">${
    shed ? '<span class="shed-label">Shed </span>' : ""
  }${mutation.name}</strong><small id="${buttonId}-effect">${
    mutation.description
  }</small></span>
  </button>`;
}

function paintRewardSpecimens() {
  for (const canvas of overlay.querySelectorAll<HTMLCanvasElement>(
    "canvas[data-specimen]"
  )) {
    const ctx = canvas.getContext("2d");
    if (ctx)
      paintMutationSpecimen(
        ctx,
        canvas.dataset.specimen as MutationId,
        canvas.width,
        canvas.height
      );
  }
}

function enterNextChamber() {
  restored = false;
  saveBoundary();
  begin();
  if (run.phase === "playing")
    hint(
      `${getEncounter(run.challenge, run.encounterIndex).name} · ${
        run.encounterIndex + 1
      } / ${ENCOUNTER_COUNT}`,
      1800
    );
}

function renderReward() {
  if (replacement) {
    const mutation = MUTATIONS[replacement];
    showScreen(`<section class="mutation-reward mutation-replacement" aria-labelledby="reward-title">
      <span class="eyebrow">ONLY ROOM FOR TWO</span><h2 id="reward-title">Choose one to shed.</h2>
      ${dailyPreviewMarkup()}
      <div class="incoming-mutation">${mutationSpecimen(
        replacement
      )}<span><small>TO GROW</small><strong>${mutation.name}</strong><p>${
      mutation.description
    }</p></span></div>
      <div class="mutation-options">${run.mutations
        .map((id, slot) => mutationChoice(id, `replace-${slot}`, true))
        .join("")}</div>
      <button id="back-rewards" class="text-button" type="button">Keep looking</button>
    </section>`);
    paintRewardSpecimens();
    run.mutations.forEach((_id, slot) =>
      bind(`replace-${slot}`, () => {
        if (!replacement || (slot !== 0 && slot !== 1)) return;
        dispatch(chooseMutation(run, replacement, slot));
        replacement = null;
        enterNextChamber();
      })
    );
    bind("back-rewards", () => {
      replacement = null;
      updateUi(true);
    });
    return;
  }
  showScreen(`<section class="mutation-reward" aria-labelledby="reward-title">
    <span class="eyebrow">CHAMBER ${run.encounterIndex + 1} CLEARED · +1 HEART</span>
    <h2 id="reward-title">Choose an upgrade.</h2><p class="reward-rule">Upgrades stack across all six chambers.</p>
    ${dailyPreviewMarkup()}
    <div class="mutation-options">${run.rewardOffers
      .map((id, index) => mutationChoice(id, `reward-${index}`))
      .join("")}</div>
    ${
      run.mutations.length
        ? `<div class="carried-mutations"><span>STACKED</span>${run.mutations
            .map(
              (id) =>
                `<span class="carried-mutation">${mutationSpecimen(
                  id,
                  "carried-specimen"
                )}${MUTATIONS[id].name}</span>`
            )
            .join("")}</div>`
        : ""
    }
    ${
      run.encounterIndex === 2 && run.core > 1 && run.rewardOffers.length > 0 && run.mutations.length < 6
        ? `<button id="cursed-pact" class="text-button" type="button">Cursed Pact (-1 heart): also claim ${MUTATIONS[run.rewardOffers[0]!].name}</button>`
        : ""
    }
    <button id="skip-reward" class="text-button" type="button">${
      run.mutations.length
        ? "Keep my current upgrades"
        : "Continue without an upgrade"
    }</button>
  </section>`);
  paintRewardSpecimens();
  run.rewardOffers.forEach((id, index) =>
    bind(`reward-${index}`, () => {
      if (run.mutations.length >= 6) {
        replacement = id;
        updateUi(true);
        return;
      }
      dispatch(chooseMutation(run, id));
      enterNextChamber();
    })
  );
  if (run.encounterIndex === 2 && run.core > 1 && run.rewardOffers.length > 0 && run.mutations.length < 6) {
    bind("cursed-pact", () => {
      const offer = run.rewardOffers[0];
      if (!offer) return;
      dispatch(takeCursedPact(run, offer));
      updateUi(true);
    });
  }
  bind("skip-reward", () => {
    dispatch(skipReward(run));
    enterNextChamber();
  });
}

function renderPause() {
  const conflict = store.status === "conflict";
  const reason = !graphicsLost && !conflict ? pauseReason : "";
  const checkpointNote =
    run.resumePhase === "cleared"
      ? "Your cleared chamber and upgrades are saved here."
      : run.resumePhase === "reward"
      ? "Your upgrade choices are saved. You can leave and return here."
      : "Leaving during combat restarts this chamber from its entrance.";
  showScreen(`<span class="eyebrow">PAUSED</span><h2>${
    graphicsLost
      ? "Graphics interrupted."
      : conflict
      ? "A newer run<br>is saved."
      : "Take a breath."
  }</h2>
    ${reason ? '<p id="pause-reason" role="status"></p>' : ""}
    <p>${
      graphicsLost
        ? "The fight is paused while the picture recovers. You can also reload from your last checkpoint."
        : conflict
        ? "Another tab changed your checkpoint. Reload to continue from that save."
        : `<strong>${healthAmount(run.core)}/${run.maxCore} life</strong><br>${healthExplanation()}`
    }</p>
    <button id="resume-button" class="primary-button" type="button" ${
      graphicsLost ? "disabled" : ""
    }>${
    graphicsLost
      ? "Waiting for graphics…"
      : conflict
      ? "Reload saved run"
      : "Resume"
  }</button>
    ${
      graphicsLost
        ? '<button id="reload-graphics" class="text-button" type="button">Reload from checkpoint</button>'
        : ""
    }
    <button id="pause-restart" class="text-button" type="button">Restart from Chamber 1</button>
    <button id="pause-settings" class="text-button" type="button">Controls & settings</button>
    ${
      run.mutations.length
        ? `<details class="pause-build"><summary>Your mutations</summary><dl>${run.mutations
            .map(
              (id) =>
                `<dt>${MUTATIONS[id].name}</dt><dd>${MUTATIONS[id].description}</dd>`
            )
            .join("")}</dl></details>`
        : ""
    }
    <p class="fine-print">${checkpointNote}</p>`);
  if (reason) element("pause-reason").textContent = reason;
  bind("resume-button", () => {
    if (conflict) location.reload();
    else begin();
  });
  if (graphicsLost) bind("reload-graphics", () => location.reload());
  bind("pause-restart", () => {
    newAttempt();
    saveBoundary();
    begin();
  });
  bind("pause-settings", () => {
    settingsOpen = true;
    updateUi(true);
  });
}

function renderSettings() {
  showScreen(`<span class="eyebrow">MAKE YOURSELF COMFORTABLE</span><h2>Small adjustments.</h2>
    <label class="setting-row"><span>Sound</span><input id="setting-sound" type="checkbox" ${
      audio.muted ? "" : "checked"
    }></label>
    <label class="setting-row"><span>Reduce flashes & shaking</span><input id="setting-motion" type="checkbox" ${
      reducedMotion ? "checked" : ""
    }></label>
    <p class="small-copy">${
      touchControls
        ? "Drag the left pad to move. You fire automatically at the nearest enemy. Tap Dash to dodge through bullets. Clear a chamber to heal 1 heart and pick an upgrade."
        : "WASD / arrows: move. Mouse: aim (auto-fires toward your cursor). Left-click / Space / Shift: Dash through bullets. Clear a chamber to heal 1 heart and stack upgrades. Escape: pause."
    }</p>
    <p class="fine-print">Clear all waves, then leave through the opening above to claim your next upgrade.</p>
    <p class="health-rule"><strong>Red hearts = life.</strong> ${healthExplanation()}<br>Dodge with the small ring at your center.</p>
    <button id="close-settings" class="primary-button" type="button">${recoveredResult ? "Back to run record" : "Back to game"}</button>`);
  element<HTMLInputElement>("setting-sound").addEventListener(
    "change",
    (event) => {
      audio.setMuted(!(event.target as HTMLInputElement).checked);
      savePreferences();
      updateHud();
      if (!audio.muted)
        void audio.unlock().catch(() => hint("Sound could not start."));
    }
  );
  element<HTMLInputElement>("setting-motion").addEventListener(
    "change",
    (event) => {
      reducedMotion = (event.target as HTMLInputElement).checked;
      savePreferences();
    }
  );
  bind("close-settings", () => {
    settingsOpen = false;
    updateUi(true);
  });
}

function renderResult(result: RunResult) {
  const escaped = result.outcome === "escaped";
  const last = result.lineage.at(-1)!;
  const mutations = result.mutations
    .map((id) => MUTATIONS[id].name)
    .join(" + ");
  const daily = getDailyRoom(run.challenge);
  const dailyRecord = result.encounterRecords.find(
    (room) => room.encounterIndex === daily.encounterIndex
  );
  const score = computeRunScore(result);
  document.body.dataset.result = "true";
  showScreen(`<span class="eyebrow">${
    escaped
      ? "ESCAPED · 6 OF 6 CHAMBERS"
      : `RUN ENDED · CHAMBER ${result.completedEncounters + 1} OF 6`
  }</span>
    <h1 id="result-heading" tabindex="-1">${
      escaped ? "You escaped." : "You fell."
    }</h1>
    <p id="result-cause" class="result-cause"></p>
    <figure class="last-body">
      <canvas id="result-portrait" width="560" height="200" aria-hidden="true"></canvas>
      <figcaption><span>SCORE</span><strong>${score.toLocaleString()}</strong><small>${
    result.counters.kills
  } ${result.counters.kills === 1 ? "kill" : "kills"} · ${clock(
    result.activeTimeMs
  )} · ${result.mutations.length} ${
    result.mutations.length === 1 ? "upgrade" : "upgrades"
  }</small></figcaption>
    </figure>
    <p class="result-summary">${result.completedEncounters}/${ENCOUNTER_COUNT} chambers cleared${
    store.bestProgress > result.completedEncounters
      ? `<br>Best: ${store.bestProgress}/${ENCOUNTER_COUNT} chambers cleared`
      : ""
  }</p>
    <p class="result-build">${mutations || "No upgrades"}</p>
    <section id="daily-leaderboard" class="daily-leaderboard" hidden></section>
    <div class="result-actions">
      <button id="retry-button" class="primary-button" type="button">${store.status === "conflict" ? "Reload saved run" : "Retry this escape"}</button>
      <button id="copy-result" class="text-button" type="button">Copy run record</button>
    </div>
    <div id="manual-copy" hidden><label for="result-copy-text">Select and copy your record</label><textarea id="result-copy-text" readonly rows="5"></textarea><button id="close-copy" class="text-button" type="button">Close</button></div>`);
  overlay.firstElementChild?.classList.add("result-screen");
  element("result-cause").textContent = escaped
    ? "Six chambers cleared. The Keeper is down."
    : result.cause || "You ran out of life.";
  void loadLeaderboard(result.challengeId);
  const canvas = element<HTMLCanvasElement>("result-portrait");
  const ctx = canvas.getContext("2d");
  if (ctx) {
    if (escaped) {
      paintCreature(ctx, last.species, 280, 97, -0.18, {
        possessed: true,
        mutations: result.mutations,
        scale: 2.3,
      });
    } else {
      ctx.save();
      ctx.translate(260, 100);
      ctx.rotate(-0.18);
      ctx.drawImage(createCorpseTexture(last.species, false, 256), -128, -128);
      ctx.restore();
      paintParasite(
        ctx,
        [
          { x: 302, y: 123 },
          { x: 316, y: 138 },
          { x: 338, y: 139 },
          { x: 352, y: 130 },
          { x: 370, y: 138 },
        ],
        7
      );
    }
  }
  element("result-heading").focus({ preventScroll: true });
  bind("retry-button", () => {
    if (store.status === "conflict") {
      location.reload();
      return;
    }
    newAttempt();
    begin();
  });
  const postUrl = getPostUrl();
  const record = `MOLT · ${run.challenge.date} · Score ${score.toLocaleString()}\n${
    escaped
      ? "Escaped all 6 chambers"
      : `Fell in chamber ${result.completedEncounters + 1}`
  } · ${clock(result.activeTimeMs)} · ${result.counters.kills} kills\nBuild: ${
    mutations || "none"
  }\n${postUrl ?? result.contentVersion}`;
  bind("copy-result", () => void copyResult(record));
  bind("close-copy", () => {
    element("manual-copy").hidden = true;
    element("copy-result").focus();
  });
}

async function loadLeaderboard(challengeId: string) {
  const dateParam = import.meta.env.DEV
    ? new URL(location.href).searchParams.get("date")
    : null;
  const url = dateParam
    ? `/api/leaderboard?date=${encodeURIComponent(dateParam)}`
    : "/api/leaderboard";
  try {
    await new Promise((r) => setTimeout(r, 250));
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as {
      entries: { userId: string; username: string; score: number; chambers: number; escaped: boolean }[];
      totalPlayers: number;
      playerRank: number | null;
      playerBestScore: number | null;
    };
    const container = document.getElementById("daily-leaderboard");
    if (!container || run.challenge.id !== challengeId || !data.entries.length) return;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const currentId = store.bootstrap.user?.id ?? null;
    const rows = data.entries
      .map(
        (entry, i) =>
          `<li class="${entry.userId === currentId ? "lb-self" : ""}"><span>#${i + 1} ${esc(entry.username)}</span><span>${entry.score.toLocaleString()}</span></li>`
      )
      .join("");
    const rankLine =
      data.playerRank !== null
        ? `<p class="lb-rank">Your rank: #${data.playerRank} of ${data.totalPlayers}${data.playerBestScore !== null ? ` · Best ${data.playerBestScore.toLocaleString()}` : ""}</p>`
        : "";
    container.innerHTML = `<h2>TODAY’S LEADERBOARD</h2><ol>${rows}</ol>${rankLine}`;
    container.hidden = false;
  } catch {
    // ignore offline leaderboard errors
  }
}

async function copyResult(record: string) {
  const button = element("copy-result");
  const manual = element("manual-copy");
  const text = element<HTMLTextAreaElement>("result-copy-text");
  try {
    if (!navigator.clipboard) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(record);
    if (button.isConnected) button.textContent = "Copied";
  } catch {
    if (!manual.isConnected) return;
    manual.hidden = false;
    text.value = record;
    text.focus();
    text.select();
  }
}

async function launch() {
  const date = import.meta.env.DEV
    ? new URL(location.href).searchParams.get("date") ?? undefined
    : undefined;
  try {
    store = await ProgressStore.open({ date });
  } catch (error) {
    showScreen(
      '<span class="eyebrow">THE DOOR IS STUCK</span><h2>Could not load<br>your run.</h2><p id="load-error"></p><button id="reload-button" class="primary-button" type="button">Try again</button>'
    );
    element("load-error").textContent =
      error instanceof Error
        ? error.message
        : "Check your connection and try again.";
    bind("reload-button", () => location.reload());
    return;
  }
  store.onChange = updateSaveStatus;
  if (store.active) {
    const loaded = restoreCheckpoint(
      store.active.checkpoint,
      store.bootstrap.challenge
    );
    if (!loaded) {
      showScreen(
        '<span class="eyebrow">SAVED BODY NOT RECOGNIZED</span><h2>This checkpoint<br>cannot be resumed.</h2><p>The game changed since this run was saved. Start a new attempt with today’s conditions.</p><button id="restart-invalid" class="primary-button" type="button">Start fresh</button>'
      );
      bind("restart-invalid", () => {
        newAttempt();
        connectGame();
      });
      return;
    }
    run = loaded;
    restored = true;
  } else {
    newAttempt();
    recoveredResult = store.latestResult;
  }
  connectGame();
}

function connectGame() {
  if (!headerContext) {
    showScreen(
      "<h2>The game cannot draw in this browser.</h2><p>Try opening this post in another browser or the Reddit app.</p>"
    );
    return;
  }
  overlay.innerHTML =
    '<div class="loading"><span class="little-worm"></span><p>Finding a body…</p><p class="loading-recovery">Taking a while? <a href="">Reload this game</a>.</p></div>';
  overlay.classList.remove("hidden");
  element("control-tip").innerHTML = touchControls
    ? "Auto-fires at nearest foe.<br>Tap Dash to dodge bullets."
    : "<span><kbd>WASD</kbd> move · mouse aims</span><span>Click / <kbd>Space</kbd> dash</span>";
  element(
    "challenge-label"
  ).textContent = `DAILY ESCAPE · ${store.bootstrap.challenge.date
    .slice(5)
    .replace("-", "/")}`;
  element("challenge-label").title = "A new challenge begins at midnight UTC.";
  updateSaveStatus();
  renderer = mountGame({
    getRun: () => run,
    getInput: () => input,
    getInterpolationAlpha: () =>
      run.phase === "playing" || run.phase === "cleared"
        ? Math.max(0, Math.min(1, accumulator / TICK_MS))
        : 1,
    tick,
    reducedMotion: () => reducedMotion,
    ready: (canvas) => {
      rendererReady = true;
      delete document.body.dataset.loading;
      canvas.tabIndex = 0;
      canvas.setAttribute("aria-label", "Combat arena");
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        graphicsLost = true;
        pauseGame("Graphics were interrupted. Your current fight is paused.");
      });
      canvas.addEventListener("webglcontextrestored", () => {
        graphicsLost = false;
        if (run.phase === "paused")
          pauseReason = "Graphics restored. Resume when you are ready.";
        updateUi(true);
      });
      input = new GameInput(
        canvas,
        () => run,
        () => {
          if (settingsOpen) {
            settingsOpen = false;
            updateUi(true);
          } else if (run.phase === "paused") begin();
          else pauseGame();
        }
      );
      updateUi(true);
    },
  });
  bind("pause-button", () => {
    if (run.phase === "paused") begin();
    else pauseGame();
  });
  bind("settings-button", () => {
    pauseGame();
    settingsOpen = true;
    updateUi(true);
  });
  element("sound-button").addEventListener("click", (event) => {
    audio.setMuted(!audio.muted);
    savePreferences();
    updateHud();
    if (!audio.muted)
      void audio.unlock().catch(() => hint("Sound could not start."));
    if (event.detail > 0 && (run.phase === "playing" || run.phase === "cleared"))
      renderer?.game.canvas.focus({ preventScroll: true });
  });
  window.addEventListener("blur", () => pauseGame());
  window.addEventListener("focus", () => {
    if (getHostMode() === "inline") {
      pauseGame();
      audio.suspend();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseGame();
      audio.suspend();
    }
  });
  window.addEventListener("pagehide", () => {
    pauseGame();
    void store.flush();
  });
  window.addEventListener("online", () => {
    void store.flush();
  });
  if (import.meta.env.DEV)
    Object.defineProperty(window, "__BODY_HOP__", {
      get: () => ({
        run: structuredClone(run),
        metrics: { ...metrics },
        save: { status: store.status, error: store.error },
        controls: { aim: input?.aimDirection, aimDistance: input?.aimDistance },
      }),
    });
}

void launch();
