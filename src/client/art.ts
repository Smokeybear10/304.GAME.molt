import type { MutationId, Species } from "../shared/types";

type Ink = {
  skin: string;
  light: string;
  dark: string;
  edge: string;
  flesh: string;
};
type CreatureOptions = {
  frame?: number;
  possessed?: boolean;
  mutations?: readonly MutationId[];
  spent?: boolean;
  scale?: number;
  pose?: "rest" | "brace" | "strike";
  direction?: number;
};
type Pose = NonNullable<CreatureOptions["pose"]>;
export const INK = {
  paper: "#e7ddc5",
  light: "#fff0cb",
  black: "#211e20",
  red: "#c64232",
  core: "#f0c969",
  blue: "#536b79",
  shell: "#b7b19a",
};
export const PARASITE_ANCHOR: Record<Species, { x: number; y: number }> = {
  spitter: { x: 19, y: -14 },
  beetle: { x: 7, y: -21 },
  hopper: { x: 9, y: -17 },
};
const palettes: Record<Species, Ink> = {
  spitter: {
    skin: "#d6b6a0",
    light: "#f1dac0",
    dark: "#a7756e",
    edge: "#211c1c",
    flesh: "#c9817a",
  },
  beetle: {
    skin: "#82909c",
    light: "#bdc8ca",
    dark: "#505c6c",
    edge: "#211c1c",
    flesh: "#bda299",
  },
  hopper: {
    skin: "#c1b86e",
    light: "#e2d88f",
    dark: "#87834c",
    edge: "#211c1c",
    flesh: "#b57c68",
  },
};

function path(
  ctx: CanvasRenderingContext2D,
  svg: string,
  fill: string,
  stroke?: string,
  width = 1.8
) {
  const shape = new Path2D(svg);
  ctx.fillStyle = fill;
  ctx.fill(shape);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.stroke(shape);
  }
  return shape;
}
function line(
  ctx: CanvasRenderingContext2D,
  points: number[],
  color: string,
  width: number
) {
  ctx.beginPath();
  ctx.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2)
    ctx.lineTo(points[i]!, points[i + 1]!);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}
function oval(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  rotation = 0
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
}
function jointLeg(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kx: number,
  ky: number,
  fx: number,
  fy: number,
  ink: Ink,
  thickness = 5
) {
  line(ctx, [x, y, kx, ky, fx, fy], ink.edge, thickness + 3.5);
  line(ctx, [x, y, kx, ky, fx, fy], ink.skin, thickness);
  line(ctx, [fx - 2, fy, fx + 4, fy - Math.sign(fy) * 2], ink.edge, 2.8);
}
type BodyPoint = readonly [number, number, number];
type CreatureView = {
  c: number;
  s: number;
  point: (p: BodyPoint) => { x: number; y: number };
  depth: (p: BodyPoint) => number;
};

function creatureView(direction: number): CreatureView {
  const angle = ((((Math.round(direction) % 8) + 8) % 8) * Math.PI) / 4;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    c,
    s,
    point: ([x, y, z]) => ({
      x: c * x - s * y,
      y: (s * x + c * y) * 0.56 + 15 - z,
    }),
    depth: ([x, y]) => s * x + c * y,
  };
}

export function projectCreaturePoint(x: number, y: number, direction: number) {
  return creatureView(direction).point([x, y, 24]);
}

const parasitePoints: Record<Species, BodyPoint> = {
  spitter: [19, 0, 29],
  beetle: [7, 0, 36],
  hopper: [9, 0, 32],
};

export function creatureAnchor(species: Species, direction: number) {
  return creatureView(direction).point(parasitePoints[species]);
}

function bodyLine(
  ctx: CanvasRenderingContext2D,
  view: CreatureView,
  points: readonly BodyPoint[],
  color: string,
  width: number
) {
  line(
    ctx,
    points.flatMap((p) => {
      const q = view.point(p);
      return [q.x, q.y];
    }),
    color,
    width
  );
}

function bodyPolygon(
  ctx: CanvasRenderingContext2D,
  view: CreatureView,
  points: readonly BodyPoint[],
  fill: string,
  stroke = INK.black,
  width = 2.8
) {
  const projected = points.map(view.point);
  ctx.beginPath();
  ctx.moveTo(projected[0]!.x, projected[0]!.y);
  projected.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (width > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineJoin = "round";
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function bodyMass(
  ctx: CanvasRenderingContext2D,
  view: CreatureView,
  center: BodyPoint,
  radii: BodyPoint,
  ink: Ink,
  fill = ink.skin,
  highlight = true
) {
  const p = view.point(center);
  const [length, breadth, height] = radii;
  const xx = view.c ** 2 * length ** 2 + view.s ** 2 * breadth ** 2;
  const yy =
    0.56 ** 2 * (view.s ** 2 * length ** 2 + view.c ** 2 * breadth ** 2) +
    height ** 2;
  const xy = 0.56 * view.c * view.s * (length ** 2 - breadth ** 2);
  const d = Math.hypot(xx - yy, 2 * xy);
  const rx = Math.sqrt((xx + yy + d) / 2),
    ry = Math.sqrt((xx + yy - d) / 2);
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, angle, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  ctx.clip();
  oval(ctx, p.x + 4, p.y + ry * 0.85, rx * 1.1, ry * 0.52, ink.dark, angle);
  if (highlight)
    oval(
      ctx,
      p.x - rx * 0.22,
      p.y - ry * 0.44,
      rx * 0.67,
      ry * 0.26,
      ink.light,
      angle * 0.3
    );
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, angle, 0, Math.PI * 2);
  ctx.strokeStyle = ink.edge;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function insectLeg(
  ctx: CanvasRenderingContext2D,
  view: CreatureView,
  points: readonly BodyPoint[],
  ink: Ink,
  width: number
) {
  bodyLine(ctx, view, points, ink.edge, width + 3.2);
  bodyLine(ctx, view, points, ink.dark, width);
  const foot = points[points.length - 1]!;
  bodyLine(ctx, view, [foot, [foot[0] + 5, foot[1], foot[2]]], ink.edge, 2.4);
}

function insectFace(
  ctx: CanvasRenderingContext2D,
  view: CreatureView,
  center: BodyPoint,
  width: number,
  ink: Ink,
  owned: boolean,
  pose: Pose,
  species: Species
) {
  const [x, y, z] = center;
  const sides = [-1, 1].sort((a, b) => view.c * a - view.c * b);
  for (const side of sides) {
    const visibility = view.s * 0.6 + view.c * side;
    if (visibility < -0.6) continue;
    const p = view.point([x + 1, y + side * width, z + 5]);
    const size =
      (visibility < 0 ? 3.4 : species === "spitter" ? 5.8 : 4.8) *
      (side === -1 ? 0.88 : 1);
    oval(ctx, p.x, p.y, size + 1.5, size * 1.13 + 1.5, ink.edge);
    oval(ctx, p.x, p.y - 0.5, size, size * 1.13, owned ? "#f5d8a0" : "#eee0ba");
    const pupilX = p.x + view.c * size * 0.3;
    const pupilY = p.y + view.s * size * 0.22;
    oval(
      ctx,
      pupilX,
      pupilY,
      owned ? 1.6 : 2.2,
      owned ? size * 0.82 : size * 0.56,
      ink.edge
    );
    if (pose === "brace")
      line(
        ctx,
        [p.x - size, p.y - size * 0.6, p.x + size, p.y - size * 0.3],
        ink.edge,
        2.5
      );
  }
  if (species !== "spitter" && view.s > -0.55) {
    const p = view.point([x + 7, y, z - 3]);
    const gape = pose === "strike" ? 5 : 2.5;
    oval(
      ctx,
      p.x,
      p.y,
      Math.max(2.5, 5.5 * (1 - Math.abs(view.c) * 0.45)),
      gape,
      ink.edge
    );
    if (pose === "strike") oval(ctx, p.x, p.y + 2, 2.6, 1.5, ink.flesh);
  }
}

function antennae(
  ctx: CanvasRenderingContext2D,
  view: CreatureView,
  center: BodyPoint,
  ink: Ink,
  frame: number,
  long = false
) {
  const [x, y, z] = center;
  for (const side of [-1, 1]) {
    const lift = Math.sin(frame + side) * 1.2;
    bodyLine(
      ctx,
      view,
      [
        [x, y + side * 5, z],
        [x + 5, y + side * 9, z + (long ? 12 : 8) + lift],
        [x + 11, y + side * 10, z + (long ? 13 : 6) + lift],
      ],
      ink.edge,
      2.2
    );
  }
}

function embeddedParasite(
  ctx: CanvasRenderingContext2D,
  view: CreatureView,
  species: Species
) {
  const anchor = parasitePoints[species];
  const start: BodyPoint =
    species === "beetle"
      ? [-12, 0, 35]
      : species === "hopper"
      ? [-9, 0, 27]
      : [0, 0, 27];
  const middle: BodyPoint = [
    (start[0] + anchor[0]) / 2,
    -1,
    Math.max(start[2], anchor[2]) + 1,
  ];
  bodyLine(ctx, view, [start, middle, anchor], "#542c29", 6.5);
  bodyLine(ctx, view, [start, middle, anchor], INK.red, 3.8);
  const p = view.point(anchor);
  const heading = Math.atan2(view.s * 0.56, view.c);
  paintParasiteHead(ctx, p.x, p.y, heading, 0.48);
  const a = view.point([anchor[0] + 3, anchor[1], anchor[2] - 1]);
  const b = view.point([anchor[0] + 5, anchor[1] + 4, anchor[2] - 4]);
  line(ctx, [a.x, a.y, b.x, b.y], palettes[species].skin, 3);
}

type BodyPart = { depth: number; paint: () => void };

function paintInsect(
  ctx: CanvasRenderingContext2D,
  species: Species,
  frame: number,
  pose: Pose,
  owned: boolean,
  direction: number,
  keeperStage?: 0 | 1 | 2
) {
  const view = creatureView(direction);
  const ink =
    keeperStage === undefined
      ? palettes[species]
      : {
          skin: "#b1a48b",
          light: "#dfcc9e",
          dark: "#6c6055",
          edge: INK.black,
          flesh: "#9c6e58",
        };
  const parts: BodyPart[] = [];
  const add = (center: BodyPoint, paint: () => void, order = 0) =>
    parts.push({ depth: view.depth(center) + order, paint });
  const breathe = Math.sin(frame) * 0.7;
  const brace = pose === "brace",
    strike = pose === "strike";
  const gait = (side: number, index = 0) =>
    Math.sin(frame + (side * Math.PI) / 2 + index * Math.PI) *
    (brace ? 0.4 : 2);

  if (species === "spitter") {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = -19 + i * 13,
          step = gait(side, i);
        add(
          [x, side * 16, 0],
          () =>
            insectLeg(
              ctx,
              view,
              [
                [x, side * 10, 10],
                [x - 4, side * 20, 4],
                [x + step, side * 23, 0],
              ],
              ink,
              3.5
            ),
          view.c * side > 0 ? 7 : -7
        );
      }
    }
    const bellyZ = (owned ? 14 : 18) + breathe + (brace ? 2 : 0);
    add([-13, 0, bellyZ], () => {
      bodyMass(
        ctx,
        view,
        [-15, 0, bellyZ],
        [owned ? 17 : 21, owned ? 17 : 20, owned ? 13 : 18],
        ink
      );
      const crease = (x: number) =>
        bodyLine(
          ctx,
          view,
          [
            [x, -12, bellyZ + 8],
            [x - 2, 0, bellyZ + (owned ? 13 : 18)],
            [x, 12, bellyZ + 8],
          ],
          ink.dark,
          2.4
        );
      crease(-21);
      crease(-11);
    });
    const neck = owned ? 17 : 10;
    add([neck, 0, 19], () => {
      bodyMass(
        ctx,
        view,
        [neck, 0, 20 + (brace ? 2 : 0)],
        [
          owned ? 17 + (strike ? 3 : 0) : 12,
          10 + (brace ? 3 : 0),
          owned ? 10 : 13,
        ],
        ink,
        ink.flesh
      );
      bodyLine(
        ctx,
        view,
        [
          [neck - 3, -8, 18],
          [neck, -1, 12],
          [neck - 1, 7, 16],
        ],
        ink.dark,
        2.4
      );
      const mouth = view.point([owned ? 35 + (strike ? 3 : 0) : 22, 0, 18]);
      if (view.s > -0.7) {
        oval(
          ctx,
          mouth.x,
          mouth.y,
          Math.max(3.5, 6.5 * (1 - Math.abs(view.c) * 0.4)),
          strike ? 8 : brace ? 5 : 4,
          ink.edge
        );
        if (strike) oval(ctx, mouth.x - view.c, mouth.y + 3, 2.5, 2, ink.flesh);
      }
      antennae(ctx, view, [9, 0, 29], ink, frame);
      insectFace(ctx, view, [10, 0, 24], 8, ink, owned, pose, species);
    });
  } else if (species === "beetle") {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = -19 + i * 15,
          step = gait(side, i),
          spread = brace ? 3 : 0;
        add(
          [x, side * 19, 0],
          () =>
            insectLeg(
              ctx,
              view,
              [
                [x, side * 12, 15],
                [x - 5, side * (25 + spread), 8],
                [x + step + (strike ? 4 : 0), side * (29 + spread), 0],
              ],
              ink,
              4.5
            ),
          view.c * side > 0 ? 7 : -7
        );
      }
    }
    add(
      [-6, 0, 15],
      () =>
        bodyMass(ctx, view, [-6, 0, 16], [25, 21, 14], ink, ink.dark, false),
      -1
    );
    for (const side of [-1, 1]) {
      if (owned && side === 1) continue;
      add([-8, side * 10, 25], () => {
        bodyMass(
          ctx,
          view,
          [-8, side * 10, 25],
          [23, 10.5, 13],
          ink,
          side === -1 ? ink.skin : ink.dark
        );
        bodyLine(
          ctx,
          view,
          [
            [-24, side * 8, 33],
            [-8, side * 9, 38],
            [9, side * 7, 31],
          ],
          ink.light,
          2.3
        );
        if (keeperStage && side === -1)
          bodyLine(
            ctx,
            view,
            [
              [-17, -9, 35],
              [-10, -8, 29],
              [-8, -14, 25],
              [-1, -9, 22],
            ],
            ink.edge,
            keeperStage === 2 ? 5 : 2.8
          );
      });
    }
    add([20, 0, 17], () => {
      const thrust = strike ? 3 : brace ? -2 : 0;
      bodyMass(ctx, view, [21 + thrust, 0, 19], [11, 13, 11], ink, ink.dark);
      for (const side of [-1, 1])
        bodyPolygon(
          ctx,
          view,
          [
            [27 + thrust, side * 6, 17],
            [36 + thrust, side * 12, 15],
            [36 + thrust, side * 6, 22],
            [31 + thrust, side * 4, 21],
          ],
          ink.light,
          ink.edge,
          2.4
        );
      antennae(ctx, view, [20, 0, 27], ink, frame);
      insectFace(
        ctx,
        view,
        [23 + thrust, 0, 23],
        10,
        ink,
        owned,
        pose,
        species
      );
    });
    if (owned) {
      add(
        [22, 13, 24],
        () => {
          const forward = 5 + (strike ? 4 : brace ? -2 : 0);
          const shield: BodyPoint[] = [
            [13 + forward, 3, 35],
            [23 + forward, 8, 41],
            [26 + forward, 19, 31],
            [25 + forward, 24, 18],
            [19 + forward, 21, 8],
            [13 + forward, 8, 15],
          ];
          bodyPolygon(ctx, view, shield, ink.skin, ink.edge, 3.3);
          bodyPolygon(
            ctx,
            view,
            [
              [15 + forward, 6, 34],
              [22 + forward, 9, 37],
              [24 + forward, 18, 29],
              [20 + forward, 17, 27],
            ],
            ink.light,
            ink.edge,
            0
          );
          bodyLine(
            ctx,
            view,
            [
              [16 + forward, 8, 18],
              [22 + forward, 16, 20],
              [24 + forward, 20, 27],
            ],
            ink.dark,
            3
          );
        },
        4
      );
    }
    if (keeperStage !== undefined) {
      add(
        [-6, 0, 35],
        () => {
          for (let i = 0; i < 3 - keeperStage; i++)
            bodyPolygon(
              ctx,
              view,
              [
                [-20 + i * 13, -3, 34],
                [-17 + i * 13, 0, 47 - i * 2],
                [-12 + i * 13, 4, 35],
              ],
              ink.light,
              ink.edge,
              2.5
            );
        },
        2
      );
    }
  } else {
    for (const side of [-1, 1]) {
      const stride = gait(side),
        extended = strike ? 9 : 0;
      const hip: BodyPoint = [-12, side * 13, 14];
      const knee: BodyPoint = [-24 - extended, side * 23, brace ? 14 : 18];
      const foot: BodyPoint = [strike ? -41 : -7 + stride, side * 28, 0];
      add(
        [-15, side * 21, 14],
        () => {
          insectLeg(ctx, view, [hip, knee, foot], ink, 4.5);
          bodyMass(
            ctx,
            view,
            [-17 - extended * 0.4, side * 20, brace ? 12 : 17],
            [owned ? 16 : 14, 10, owned ? 14 : 12],
            ink
          );
          bodyLine(
            ctx,
            view,
            [
              [-26 - extended * 0.4, side * 20, brace ? 16 : 22],
              [-13, side * 21, brace ? 20 : 26],
              [-7, side * 19, 18],
            ],
            ink.dark,
            2.7
          );
        },
        view.c * side > 0 ? 8 : -8
      );
      add(
        [16, side * 13, 0],
        () =>
          insectLeg(
            ctx,
            view,
            [
              [12, side * 7, 18],
              [23, side * 17, 7],
              [29 + stride, side * 19, 1],
            ],
            ink,
            2.8
          ),
        view.c * side > 0 ? 5 : -5
      );
    }
    const thoraxZ = (owned ? 25 : 18) + (brace ? -3 : strike ? 2 : breathe);
    add([-1, 0, thoraxZ], () => {
      bodyMass(
        ctx,
        view,
        [-3, 0, thoraxZ],
        [owned ? 21 : 18, owned ? 8 : 12, owned ? 8 : 11],
        ink,
        owned ? ink.light : ink.skin
      );
      bodyLine(
        ctx,
        view,
        [
          [-18, 0, thoraxZ + 4],
          [-4, 0, thoraxZ + 8],
          [10, 0, thoraxZ + 5],
        ],
        ink.dark,
        2.3
      );
    });
    add([20, 0, thoraxZ], () => {
      bodyMass(ctx, view, [21, 0, thoraxZ], [11, 11, 12], ink);
      antennae(ctx, view, [21, 0, thoraxZ + 7], ink, frame, true);
      insectFace(ctx, view, [24, 0, thoraxZ + 4], 9, ink, owned, pose, species);
      for (const side of [-1, 1])
        bodyLine(
          ctx,
          view,
          [
            [27, side * 4, thoraxZ - 5],
            [32, side * 5, thoraxZ - 2],
          ],
          ink.edge,
          2
        );
    });
  }
  parts.sort((a, b) => a.depth - b.depth).forEach((part) => part.paint());
  if (owned) embeddedParasite(ctx, view, species);
}

export type GraftPainter = {
  fillPoints(
    points: { x: number; y: number }[],
    closeShape?: boolean
  ): GraftPainter;
  strokePoints(
    points: { x: number; y: number }[],
    closeShape?: boolean
  ): GraftPainter;
  fillStyle(color: number, alpha?: number): GraftPainter;
  lineStyle(width: number, color: number, alpha?: number): GraftPainter;
  fillCircle(x: number, y: number, radius: number): GraftPainter;
  fillTriangle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number
  ): GraftPainter;
  fillEllipse(
    x: number,
    y: number,
    width: number,
    height: number
  ): GraftPainter;
  strokeEllipse(
    x: number,
    y: number,
    width: number,
    height: number
  ): GraftPainter;
  lineBetween(x1: number, y1: number, x2: number, y2: number): GraftPainter;
};

export function drawMutationGrafts(
  g: GraftPainter,
  mutations: readonly MutationId[],
  point: (x: number, y: number) => { x: number; y: number },
  scale: number,
  pulses: ReadonlyMap<string, number> = new Map(),
  elapsed = 0
) {
  const BLACK = Number.parseInt(INK.black.slice(1), 16),
    LIGHT = Number.parseInt(INK.light.slice(1), 16),
    RED = Number.parseInt(INK.red.slice(1), 16);
  for (const id of mutations) {
    const pulse = Math.sin(((pulses.get(id) ?? 0) / 500) * Math.PI);
    if (id === "venom-sacs")
      for (const side of [-1, 1]) {
        const p = point(-17, side * 20),
          swell = 1 + Math.sin(((pulses.get(id) ?? 0) / 500) * Math.PI) * 0.5;
        g.fillStyle(BLACK, 1).fillCircle(p.x, p.y, 8 * scale * swell);
        g.fillStyle(0xa7ad55, 1).fillCircle(p.x, p.y, 6.4 * scale * swell);
        g.fillStyle(LIGHT, 0.8).fillCircle(p.x - 2, p.y - 2, 1.5);
      }
    if (id === "split-glands")
      for (const side of [-1, 1]) {
        const a = point(13, side * 18),
          b = point(36 - pulse * 7, side * (33 - pulse * 4)),
          c = point(24, side * 16);
        g.fillStyle(BLACK, 1).fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
        const d = point(20, side * 21),
          e = point(32, side * 29);
        g.lineStyle(2, LIGHT, 0.8).lineBetween(d.x, d.y, e.x, e.y);
      }
    if (id === "echo-tissue") {
      const p = point(-18, 0);
      g.fillStyle(BLACK, 1).fillCircle(p.x, p.y, (7 + pulse * 3) * scale);
      g.fillStyle(LIGHT, 1).fillCircle(p.x, p.y, (5 + pulse * 3) * scale);
      g.fillStyle(RED, 1).fillCircle(p.x + 1, p.y, (2.8 + pulse) * scale);
    }
    if (id === "shock-molt")
      for (let i = 0; i < 5; i++) {
        const a = point(-18 + i * 8, -12),
          b = point(-16 + i * 8, -19 - pulse * 9),
          c = point(-11 + i * 8, -11);
        g.fillStyle(0xcabf98, 1).fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
        g.lineStyle(1.5, BLACK, 0.8).lineBetween(a.x, a.y, b.x, b.y);
      }
    if (id === "grave-bloom")
      for (let i = 0; i < 3; i++) {
        const p = point(-12 + i * 7, 6 + (i % 2) * 5);
        g.lineStyle(2, BLACK, 1).lineBetween(p.x, p.y, p.x, p.y - 9 * scale);
        g.fillStyle(0xa86a52, 1).fillEllipse(
          p.x,
          p.y - 10 * scale,
          (9 + pulse * 4) * scale,
          (5 + pulse * 2) * scale
        );
        g.lineStyle(1, BLACK, 1).strokeEllipse(
          p.x,
          p.y - 10 * scale,
          (9 + pulse * 4) * scale,
          (5 + pulse * 2) * scale
        );
      }
    if (id === "silk-trail") {
      const p = point(-24, 0),
        q = point(-44, Math.sin(elapsed * 0.006) * 6);
      g.lineStyle(4, BLACK, 0.8).lineBetween(p.x, p.y, q.x, q.y);
      g.lineStyle(2, LIGHT, 1).lineBetween(p.x, p.y, q.x, q.y);
    }
  }
}

function canvasGraftPainter(ctx: CanvasRenderingContext2D): GraftPainter {
  const baseAlpha = ctx.globalAlpha;
  let fillAlpha = 1,
    strokeAlpha = 1;
  const color = (value: number) => `#${value.toString(16).padStart(6, "0")}`;
  const fill = () => {
    ctx.globalAlpha = baseAlpha * fillAlpha;
    ctx.fill();
  };
  const stroke = () => {
    ctx.globalAlpha = baseAlpha * strokeAlpha;
    ctx.stroke();
  };
  const ellipse = (x: number, y: number, width: number, height: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
  };
  const tracePoints = (
    points: { x: number; y: number }[],
    closeShape: boolean
  ) => {
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    if (closeShape) ctx.closePath();
  };
  const painter: GraftPainter = {
    fillPoints(points, closeShape = true) {
      tracePoints(points, closeShape);
      fill();
      return painter;
    },
    strokePoints(points, closeShape = true) {
      tracePoints(points, closeShape);
      stroke();
      return painter;
    },
    fillStyle(value, alpha = 1) {
      ctx.fillStyle = color(value);
      fillAlpha = alpha;
      return painter;
    },
    lineStyle(width, value, alpha = 1) {
      ctx.lineWidth = width;
      ctx.strokeStyle = color(value);
      strokeAlpha = alpha;
      return painter;
    },
    fillCircle(x, y, radius) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      fill();
      return painter;
    },
    fillTriangle(x1, y1, x2, y2, x3, y3) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
      fill();
      return painter;
    },
    fillEllipse(x, y, width, height) {
      ellipse(x, y, width, height);
      fill();
      return painter;
    },
    strokeEllipse(x, y, width, height) {
      ellipse(x, y, width, height);
      stroke();
      return painter;
    },
    lineBetween(x1, y1, x2, y2) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      stroke();
      return painter;
    },
  };
  return painter;
}

export function paintMutationSpecimen(
  ctx: CanvasRenderingContext2D,
  id: MutationId,
  width: number,
  height: number
) {
  const bounds: Record<MutationId, readonly [number, number, number, number]> =
    {
      "echo-tissue": [-48, -18, 36, 38],
      "silk-trail": [-65, -18, 48, 39],
      "shock-molt": [-28, -36, 55, 36],
      "venom-sacs": [-32, -33, 35, 67],
      "split-glands": [4, -39, 38, 78],
      "grave-bloom": [-36, 3, 38, 40],
    };
  const [x, y, w, h] = bounds[id];
  const scale = Math.min((width - 14) / w, (height - 14) / h);
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-x - w / 2, -y - h / 2);
  const flesh = "#bc9375",
    pale = "#d8bf96",
    edge = INK.black;
  const tissue = (shape: string, fill = flesh) => {
    path(ctx, shape, fill, edge, 2.2);
  };
  if (id === "echo-tissue") {
    tissue(
      "M-45-2C-46-15-31-18-22-11L-14-4-20 1-15 10-25 15C-40 20-45 9-45-2Z"
    );
    path(
      ctx,
      "M-41-7Q-35-15-26-10M-42 4Q-38 13-27 12M-23-8L-19-5M-23 8L-20 9",
      "transparent",
      edge,
      0.7
    );
    path(ctx, "M-41-1Q-32-13-22-1Q-32 11-41-1Z", pale, edge, 0.8);
  }
  if (id === "silk-trail") {
    tissue("M-23-13C-16-6-18 8-28 13L-38 9-42 0-35-11Z", pale);
    path(
      ctx,
      "M-34-9Q-39-1-34 8M-28-11Q-32-1-28 10M-22-7Q-27-1-22 5",
      "transparent",
      "#796852",
      0.8
    );
    path(
      ctx,
      "M-42-2C-57-9-66-5-57 5S-37 14-49 17C-56 19-62 14-59 11",
      "transparent",
      edge,
      2.3
    );
    path(
      ctx,
      "M-42-2C-57-9-66-5-57 5S-37 14-49 17C-56 19-62 14-59 11",
      "transparent",
      INK.light,
      1.1
    );
  }
  if (id === "shock-molt") {
    tissue("M-25-23Q-15-27-5-22L17-24 24-15 18-7 9-11-1-5-11-10-21-7Z");
    path(
      ctx,
      "M-20-18L-18-10M-13-20L-11-13M-5-19L-3-10M4-20L6-13M12-19L15-12",
      "transparent",
      edge,
      0.7
    );
    path(ctx, "M-23-15Q-8-11 1-14T20-15", "transparent", pale, 1.5);
  }
  if (id === "venom-sacs") {
    tissue("M-22-29Q-3-28-7-15L-12-6-9 8Q1 27-13 31L-25 26-28 13-23 1-29-15Z");
    path(
      ctx,
      "M-16-11Q-6-1-18 11M-22-9Q-16 0-23 8M-8-22L-3-24M-9 23L-3 25",
      "transparent",
      edge,
      0.8
    );
  }
  if (id === "split-glands") {
    tissue("M13-32L23-29 27-16 21-5 24 7 27 20 20 32 10 28 6 15 11 0 7-15Z");
    path(
      ctx,
      "M15-24L21-19M13-17L20-12M14 12L21 17M12 21L19 26",
      "transparent",
      edge,
      0.8
    );
    path(ctx, "M15-6Q20 0 15 7", "transparent", pale, 2);
  }
  if (id === "grave-bloom") {
    tissue("M-31 27L-26 24-21 29-16 26-10 29-8 35-15 38-22 34-30 37-33 33Z");
    path(
      ctx,
      "M-28 31L-26 34M-21 30L-19 33M-14 31L-12 34",
      "transparent",
      edge,
      0.8
    );
  }
  const specimenPoint = (x: number, y: number) => {
    if (id === "echo-tissue") return { x: x - 13, y };
    if (id === "silk-trail") return { x: x * 0.85 - 14.6, y };
    if (id === "shock-molt") return { x, y: y - 11 };
    if (id === "grave-bloom") return { x: x - 13, y: y + 19 };
    return { x, y };
  };
  drawMutationGrafts(canvasGraftPainter(ctx), [id], specimenPoint, 1);
  ctx.restore();
}

export function paintCreature(
  ctx: CanvasRenderingContext2D,
  species: Species,
  x: number,
  y: number,
  angle: number,
  options: CreatureOptions = {}
) {
  const direction = options.direction ?? Math.round(angle / (Math.PI / 4));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(options.scale ?? 1, options.scale ?? 1);
  if (options.spent) {
    ctx.globalAlpha *= 0.6;
    ctx.scale(1, 0.67);
  }
  paintInsect(
    ctx,
    species,
    options.frame ?? 0,
    options.pose ?? "rest",
    options.possessed ?? false,
    direction
  );
  if (options.mutations?.length)
    drawMutationGrafts(
      canvasGraftPainter(ctx),
      options.mutations,
      (x, y) => projectCreaturePoint(x, y, direction),
      1
    );
  ctx.restore();
}

export function createCreatureTexture(
  species: Species,
  frame: number,
  possessed: boolean,
  size = 256,
  pose: Pose = "rest",
  direction = 0
) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable");
  paintCreature(ctx, species, size / 2, size / 2, 0, {
    frame,
    possessed,
    pose,
    direction,
    scale: size / 112,
  });
  return canvas;
}

export function createKeeperTexture(
  phase: number,
  damageStage: 0 | 1 | 2,
  size = 128,
  pose: "walk" | "brace" | "strike" = "walk",
  direction = 0
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable");
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 112, size / 112);
  paintInsect(
    ctx,
    "beetle",
    phase,
    pose === "walk" ? "rest" : pose,
    false,
    direction,
    damageStage
  );
  return canvas;
}

export function createCorpseTexture(
  species: Species,
  spent: boolean,
  size = 128
) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable");
  const ink = palettes[species];
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 112, size / 112);
  if (spent && species === "spitter") {
    for (const side of [-1, 1]) {
      jointLeg(ctx, -19, side * 9, -30, side * 18, -13, side * 16, ink, 3);
      jointLeg(ctx, 9, side * 8, 17, side * 19, 23, side * 11, ink, 2);
    }
    path(
      ctx,
      "M-34 0 Q-37 -18 -13 -17 L3 -8 17 -14 23 -4 15 2 24 10 10 16 -5 11 -21 17 Q-37 13 -34 0 Z",
      ink.dark,
      ink.edge,
      2
    );
    path(
      ctx,
      "M-30 -1 Q-23 -11 -14 -9 L-1 -3 12 -8 8 -1 17 6 5 9 -6 5 -17 10 Q-28 8 -30 -1 Z",
      ink.skin,
      ink.edge,
      1.3
    );
    path(ctx, "M-26 2 Q-16 -5 -5 2 L9 1 -1 8 -15 5 Z", ink.edge);
    path(
      ctx,
      "M13 -3 Q25 -6 26 3 L35 8 38 6 39 10 Q32 17 24 10 L17 8 Z",
      ink.skin,
      ink.edge,
      1.8
    );
    line(ctx, [-23, -11, -13, -13, -2, -6], ink.light, 1);
    line(ctx, [-24, 13, -12, 8, -4, 10], ink.light, 1);
    oval(ctx, 36, 10, 3.2, 1.5, ink.edge, -0.3);
  } else if (spent && species === "hopper") {
    for (const side of [-1, 1]) {
      jointLeg(ctx, -14, side * 5, -35, side * 23, -9, side * 30, ink, 6);
      path(
        ctx,
        `M-20 ${side * 10} L-34 ${side * 18} -37 ${side * 25} -30 ${
          side * 27
        } -12 ${side * 13} Z`,
        ink.dark,
        ink.edge,
        1.6
      );
      line(ctx, [-31, side * 22, -18, side * 13], ink.light, 1.2);
      jointLeg(ctx, 15, side * 5, 24, side * 17, 29, side * 10, ink, 2);
    }
    path(
      ctx,
      "M-28 -2 Q-30 -14 -15 -17 L7 -9 18 -4 27 -10 34 -2 29 7 18 6 3 14 -16 18 Q-29 12 -28 -2 Z",
      ink.dark,
      ink.edge,
      2
    );
    path(
      ctx,
      "M-25 -5 Q-18 -13 -11 -11 L9 -5 7 0 -12 -5 -23 2 Z",
      ink.skin,
      ink.edge,
      1.2
    );
    path(ctx, "M-25 6 -13 9 7 3 12 6 1 12 -14 15 Z", ink.skin, ink.edge, 1.2);
    path(ctx, "M-20 0 -8 -3 10 1 -5 7 -19 5 Z", ink.edge);
    for (let i = 0; i < 4; i++) {
      line(ctx, [-22 + i * 8, -10, -17 + i * 8, -5], ink.light, 1.1);
      line(ctx, [-21 + i * 8, 12, -15 + i * 8, 8], ink.edge, 1);
    }
    line(ctx, [25, -8, 24, -22, 35, -20], ink.edge, 1.3);
    line(ctx, [28, 7, 38, 15, 41, 9], ink.edge, 1.3);
  } else if (spent) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(-3, side * 10);
      ctx.rotate(side * -0.18);
      path(
        ctx,
        `M -29 0 C -31 ${side * 14} -7 ${side * 23} 17 ${side * 11} L 23 1 12 ${
          side * 4
        } 4 0 -7 ${side * 4} -18 0 Z`,
        ink.dark,
        ink.edge,
        1.6
      );
      line(
        ctx,
        [-23, side * 3, -13, side * 10, -3, side * 12, 12, side * 7],
        ink.light,
        1
      );
      for (let i = 0; i < 3; i++)
        line(
          ctx,
          [
            -18 + i * 14,
            side * 9,
            -22 + i * 14,
            side * 18,
            -13 + i * 14,
            side * 17,
          ],
          ink.edge,
          1.6
        );
      ctx.restore();
    }
    line(ctx, [26, -4, 32, -11, 35, -6], ink.edge, 2);
    line(ctx, [24, 4, 29, 12, 34, 9], ink.edge, 1.5);
  } else {
    const wide = species === "beetle" ? 26 : species === "spitter" ? 28 : 19;
    for (const side of [-1, 1]) {
      for (let i = 0; i < (species === "beetle" ? 3 : 2); i++) {
        const x = -17 + i * 20;
        jointLeg(
          ctx,
          x,
          side * 12,
          x - 9,
          side * (species === "hopper" && i === 0 ? 35 : wide + 2),
          x + 9,
          side * (species === "hopper" && i === 0 ? 28 : 12),
          ink,
          species === "hopper" && i === 0 ? 6 : 3
        );
      }
    }
    path(
      ctx,
      species === "spitter"
        ? "M-33 1 C-35-24-13-29 3-23 L15-15 12-5 22 1 17 7 24 17 12 24 C-9 31-32 24-33 1Z"
        : `M -33 1 C -35 -${wide} -5 -${wide + 6} 19 -${
            wide - 8
          } L 30 -5 29 10 17 ${wide - 7} C -9 ${wide + 3} -32 ${wide} -33 1 Z`,
      ink.skin,
      ink.edge,
      2.3
    );
    path(
      ctx,
      species === "spitter"
        ? "M-29 6 Q-10 27 10 20 L17 13 Q3 18-29 6Z"
        : `M -29 6 Q -9 ${wide + 2} 18 ${wide - 10} L 24 4 Q 3 13 -29 6 Z`,
      ink.dark
    );
    if (species === "beetle") {
      line(ctx, [-30, 0, -14, -2, -6, 3, 4, -2, 19, 0], ink.edge, 2.2);
      for (let i = 0; i < 4; i++)
        line(ctx, [-24 + i * 9, -16, -27 + i * 9, -7], ink.light, 1.2);
      path(
        ctx,
        "M25-7 38-10 34-2 29-3M25 7 36 13 34 5 29 3",
        ink.flesh,
        ink.edge,
        2
      );
    } else if (species === "spitter") {
      path(
        ctx,
        "M8-13Q-1 4 14 15L19 8 13 5 18 0 12-4 17-9Z",
        ink.flesh,
        ink.dark,
        1.2
      );
      path(
        ctx,
        "M18 8 Q27 5 30 15 L34 25 30 29 24 19 17 15Z",
        ink.skin,
        ink.edge,
        1.8
      );
    } else {
      for (let i = 0; i < 4; i++)
        path(
          ctx,
          `M${-24 + i * 8}-13Q${-18 + i * 8} 0 ${-23 + i * 8} 15`,
          "transparent",
          ink.edge,
          1
        );
      line(ctx, [25, -7, 29, -18, 37, -15], ink.edge, 1.4);
    }
    line(
      ctx,
      species === "spitter" ? [10, -17, 15, -13] : [23, -8, 28, -6],
      ink.edge,
      2
    );
    line(
      ctx,
      species === "spitter" ? [18, 15, 22, 18] : [23, 8, 28, 6],
      ink.edge,
      2
    );
    path(
      ctx,
      "M-25 -3 Q-25 -12 -15 -14 L-7 -10 1 -12 -2 -4 3 2 -4 5 -7 12 -17 10 -24 4 Z",
      ink.edge
    );
    line(ctx, [-24, -4, -21, -10, -15, -12, -7, -8], "#d9c794", 3);
    line(ctx, [-21, 5, -16, 8, -9, 7], ink.flesh, 1.8);
  }
  return canvas;
}

export function paintTitle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dark = false
) {
  const letters = [
    "M5 5 22 3 34 29 47 4 63 5 61 74 44 73 45 35 34 54 22 36 21 74 4 72Z",
    "M20 3 43 5 58 21 55 58 41 74 18 72 4 54 6 19Z M24 19 20 26 20 54 27 59 38 57 42 49 41 26 36 19Z",
    "M6 4 25 3 23 55 57 54 55 74 4 72Z",
    "M3 5 60 3 59 21 40 20 38 74 21 73 22 21 4 22Z",
  ];
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  const scale = Math.min(width / 282, height / 108);
  ctx.translate((width - 282 * scale) / 2, (height - 100 * scale) / 2);
  ctx.scale(scale, scale);
  for (const [index, letter] of letters.entries()) {
    ctx.save();
    ctx.translate(
      10 + index * 67,
      12 + Math.sin(index * 2.5) * 3
    );
    ctx.rotate((index % 2 ? 1 : -1) * 0.025);
    const glyph = new Path2D(letter);
    ctx.fillStyle = dark ? INK.black : INK.paper;
    ctx.fill(glyph, "evenodd");
    ctx.strokeStyle = dark ? INK.paper : INK.black;
    ctx.lineWidth = 1.3;
    ctx.lineJoin = "bevel";
    ctx.stroke(glyph);
    ctx.save();
    ctx.clip(glyph, "evenodd");
    ctx.strokeStyle = dark ? INK.paper : INK.black;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(index % 2 ? 2 : 30, 46);
    ctx.lineTo(index % 2 ? 16 : 42, 36);
    ctx.lineTo(index % 2 ? 29 : 61, 40);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  paintParasite(
    ctx,
    [
      { x: 103, y: 72 },
      { x: 95, y: 65 },
      { x: 99, y: 53 },
      { x: 114, y: 48 },
      { x: 128, y: 53 },
      { x: 131, y: 65 },
      { x: 144, y: 77 },
      { x: 159, y: 76 },
    ],
    3.5
  );
  ctx.restore();
}

const PARASITE_HEAD = [
  [-8.0, -4.0],
  [-6.984, -5.686],
  [-5.5, -6.984],
  [-3.641, -7.885],
  [-1.5, -8.375],
  [0.828, -8.443],
  [3.25, -8.078],
  [5.672, -7.268],
  [8.0, -6.0],
  [12.0, -1.0],
  [9.0, 3.0],
  [8.194, 4.528],
  [7.111, 5.778],
  [5.75, 6.75],
  [4.111, 7.444],
  [2.194, 7.861],
  [0.0, 8.0],
  [-2.148, 7.443],
  [-4.062, 6.547],
  [-5.695, 5.346],
  [-7.0, 3.875],
  [-7.93, 2.17],
  [-8.438, 0.266],
  [-8.477, -1.803],
] as const;
const parasiteEye = (x: number, y: number, rx: number, ry: number) =>
  Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const px = Math.cos(a) * rx,
      py = Math.sin(a) * ry;
    return [
      x + px * Math.cos(-0.12) - py * Math.sin(-0.12),
      y + px * Math.sin(-0.12) + py * Math.cos(-0.12),
    ] as const;
  });
const PARASITE_EYE = parasiteEye(4.5, -1.6, 3.6, 4.2);
const PARASITE_PUPIL = parasiteEye(5.7, -1.6, 1.4, 3.1);

export function drawParasiteHead(
  g: GraftPainter,
  x: number,
  y: number,
  angle = 0,
  scale = 1
) {
  const point = (px: number, py: number) => ({
    x: x + (px * Math.cos(angle) - py * Math.sin(angle)) * scale,
    y: y + (px * Math.sin(angle) + py * Math.cos(angle)) * scale,
  });
  const polygon = (
    shape: readonly (readonly [number, number])[],
    color: number,
    outline = false
  ) => {
    const points = shape.map(([px, py]) => point(px, py));
    g.fillStyle(color, 1).fillPoints(points, true);
    if (outline)
      g.lineStyle(1.8 * scale, 0x211e20, 1).strokePoints(points, true);
  };
  polygon(PARASITE_HEAD, 0xc64232, true);
  polygon(PARASITE_EYE, 0xfff0cb);
  polygon(PARASITE_PUPIL, 0x211e20);
  const mouth = point(7, 4.4),
    tip = point(9, 3.7);
  g.lineStyle(1.2 * scale, 0x211e20, 1).lineBetween(
    mouth.x,
    mouth.y,
    tip.x,
    tip.y
  );
}

export function paintParasiteHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle = 0,
  scale = 1
) {
  ctx.save();
  drawParasiteHead(canvasGraftPainter(ctx), x, y, angle, scale);
  ctx.restore();
}

export function paintParasite(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  radius = 6
) {
  if (points.length < 2) return;
  const coords = points.flatMap((p) => [p.x, p.y]);
  line(ctx, coords, INK.black, radius * 2 + 2);
  line(ctx, coords, INK.red, radius * 2);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!,
      next = points[i + 1]!,
      dx = next.x - p.x,
      dy = next.y - p.y,
      len = Math.hypot(dx, dy) || 1;
    line(
      ctx,
      [
        p.x - (dy / len) * radius * 0.6,
        p.y + (dx / len) * radius * 0.6,
        p.x + (dy / len) * radius * 0.6,
        p.y - (dx / len) * radius * 0.6,
      ],
      INK.black,
      1
    );
  }
  const head = points[points.length - 1]!;
  const neck = points[points.length - 2]!;
  paintParasiteHead(
    ctx,
    head.x,
    head.y,
    Math.atan2(head.y - neck.y, head.x - neck.x),
    radius / 4
  );
}
