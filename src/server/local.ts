import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { z } from "zod";
import { createChallenge } from "../shared/content.ts";
import { handleError, HttpError, routeApi } from "./http.ts";
import { decodeState, type StateStore } from "./state.ts";

const directory = resolve(".local/runs");
let pending: Promise<unknown> = Promise.resolve();
const fileFor = (key: string) => resolve(directory, `${createHash("sha256").update(key).digest("hex")}.json`);

async function readState(key: string) {
  try {
    return decodeState(await readFile(fileFor(key), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return decodeState(undefined);
    throw error;
  }
}

const store: StateStore = {
  async read(key) {
    await pending;
    return readState(key);
  },
  update(key, change) {
    const operation = pending.then(async () => {
      const current = await readState(key);
      const result = change(current);
      if (result.ok && result.state !== current) {
        await mkdir(directory, { recursive: true });
        const path = fileFor(key);
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(result.state));
        await rename(temporary, path);
      }
      return result;
    });
    pending = operation.catch(() => undefined);
    return operation;
  },
};

const server = createServer(async (request, response) => {
  try {
    const origin = request.headers.origin;
    if (origin && !["http://localhost:2537", "http://127.0.0.1:2537"].includes(origin))
      throw new HttpError(403, "Open the local game on port 2537.");
    const url = new URL(request.url ?? "/", "http://localhost");
    const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    if (!z.iso.date().safeParse(date).success) throw new HttpError(400, "Choose a valid challenge date.");
    const challenge = createChallenge(date);
    const cookie = /(?:^|;\s*)bodyhop_local=([a-f0-9-]{36})(?:;|$)/.exec(request.headers.cookie ?? "");
    const userId = cookie?.[1] ?? randomUUID();
    if (!cookie) response.setHeader("Set-Cookie", `bodyhop_local=${userId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
    await routeApi(request, response, {
      mode: "local",
      challenge,
      user: { id: userId, username: "Local player" },
    }, store);
  } catch (error) {
    handleError(error, response);
  }
});

server.on("error", (error) => console.error(error.message));
server.listen(8787, "127.0.0.1", () => console.log("MOLT local API: http://127.0.0.1:8787"));
