import { context, getWebViewMode, requestExpandedMode } from "@devvit/web/client";

export const isReddit = Boolean(context?.postId);

export function getHostMode(): "inline" | "expanded" {
  return isReddit ? getWebViewMode() : "expanded";
}

export function getPostUrl(): string | null {
  const id = /^t3_([a-z0-9]+)$/.exec(context?.postId ?? "")?.[1];
  return isReddit && id ? `https://www.reddit.com/comments/${id}/` : null;
}

export function openGame(event: MouseEvent): void {
  if (isReddit) {
    requestExpandedMode(event, "game", { title: "MOLT" });
    return;
  }
  const target = new URL("game.html", window.location.href);
  const date = new URLSearchParams(window.location.search).get("date");
  if (date) target.searchParams.set("date", date);
  window.location.assign(target.href);
}
