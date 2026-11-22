import { getHostMode, isReddit, openGame } from "./platform.ts";
import { paintCreature, paintTitle } from "./art.ts";

const button = document.querySelector<HTMLButtonElement>("#play")!;
const status = document.querySelector<HTMLElement>("#status")!;
let launchTimer: ReturnType<typeof setTimeout> | null = null;
const title = document.querySelector<HTMLCanvasElement>("#splash-title")!;
const titleContext = title.getContext("2d");
if (titleContext) paintTitle(titleContext, title.width, title.height, true);
const cast = document.querySelector<HTMLCanvasElement>("#splash-cast")!;
const castContext = cast.getContext("2d");
if (castContext) {
  paintCreature(castContext, "spitter", 115, 105, 0.35, { scale: 1.55 });
  paintCreature(castContext, "beetle", 320, 105, -0.15, {
    scale: 1.85,
    possessed: true,
  });
  paintCreature(castContext, "hopper", 530, 102, -0.4, { scale: 1.65 });
}

button.addEventListener("click", (event) => {
  if (launchTimer) clearTimeout(launchTimer);
  try {
    openGame(event);
    if (!isReddit) return;
    status.textContent = "Opening the escape…";
    launchTimer = setTimeout(() => {
      if (!document.hidden && getHostMode() === "inline")
        status.textContent = "The game did not open. Tap Play to try again.";
    }, 5000);
  } catch {
    status.textContent =
      "The game could not open. Try again in the Reddit app or on reddit.com.";
  }
});

window.addEventListener("focus", () => {
  if (launchTimer) clearTimeout(launchTimer);
  status.textContent =
    "Your run saves between chambers. Retry as often as you like.";
});
