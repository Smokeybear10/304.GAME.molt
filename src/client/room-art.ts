import { WORLD_WIDTH, WORLD_HEIGHT } from "../shared/content";
import type { Rect } from "../shared/types";

const DISHES = [
  { glaze: "#4d5b5c", rim: "#a8ad99", edge: "#354e53", stain: "#776846", ash: "#303e3c" },
  { glaze: "#535b4b", rim: "#b1aa83", edge: "#4b5140", stain: "#81743f", ash: "#3d4332" },
  { glaze: "#50545d", rim: "#aaa6a3", edge: "#454954", stain: "#767071", ash: "#323642" },
  { glaze: "#465954", rim: "#93a38d", edge: "#354a43", stain: "#8b9762", ash: "#2c423a" },
  { glaze: "#594b43", rim: "#a28d73", edge: "#514039", stain: "#94714a", ash: "#302c2a" },
  { glaze: "#534852", rim: "#a69b8c", edge: "#493b47", stain: "#976b72", ash: "#382b37" },
] as const;

function fill(
  ctx: CanvasRenderingContext2D,
  outline: string,
  color: string,
  stroke?: string,
  width = 1
) {
  const shape = new Path2D(outline);
  ctx.fillStyle = color;
  ctx.fill(shape);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke(shape);
  }
}

function line(
  ctx: CanvasRenderingContext2D,
  outline: string,
  color: string,
  width = 1
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(new Path2D(outline));
}

function bread(ctx: CanvasRenderingContext2D, wall: Rect, scorched: boolean) {
  const { x, y, width: w, height: h } = wall;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#44372c";
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.rect(1, 1, w - 2, h - 2);
  ctx.clip();
  ctx.fillStyle = "#936136";
  ctx.fillRect(0, 0, w, h);
  const crust = Math.min(18, h * 0.22);
  fill(
    ctx,
    `M 2 4 L ${w * 0.19} 6 L ${w * 0.36} 2 L ${w * 0.64} 5 L ${w - 3} 3
     L ${w - 2} ${h * 0.55} L ${w - 5} ${h - crust - 1} L ${w * 0.78} ${
      h - crust + 4
    }
     L ${w * 0.61} ${h - crust} L ${w * 0.4} ${h - crust + 3} L 3 ${
      h - crust - 2
    } Z`,
    "#bda475"
  );
  fill(
    ctx,
    `M 2 4 L ${w * 0.36} 2 L ${w * 0.62} 5 L ${w * 0.53} 11 L ${
      w * 0.25
    } 9 L 4 17 Z`,
    "#d1b787"
  );
  fill(
    ctx,
    `M ${w * 0.68} 7 L ${w - 3} 3 L ${w - 2} ${h * 0.55} L ${w - 11} ${
      h - crust
    }
    L ${w * 0.88} ${h * 0.43} L ${w * 0.72} ${h * 0.32} Z`,
    "#a48455"
  );
  fill(
    ctx,
    `M 3 ${h - crust} L ${w * 0.4} ${h - crust + 5} L ${w * 0.61} ${
      h - crust + 2
    }
    L ${w * 0.78} ${h - crust + 7} L ${w - 4} ${h - crust + 1} L ${w - 3} ${
      h - 3
    }
    L ${w * 0.8} ${h - 5} L ${w * 0.53} ${h - 2} L 2 ${h - 4} Z`,
    "#704928"
  );
  line(
    ctx,
    `M 5 ${h - crust + 2} L ${w * 0.4} ${h - crust + 7} L ${w * 0.61} ${
      h - crust + 4
    }
    L ${w * 0.78} ${h - crust + 9} L ${w - 5} ${h - crust + 3}`,
    "#d2a263",
    2
  );
  if (scorched) {
    const face = h - crust;
    fill(
      ctx,
      `M 8 ${face * 0.2} C ${w * 0.28} ${face * 0.12} ${w * 0.52} ${face * 0.25} ${w * 0.72} ${face * 0.4}
       L ${w * 0.61} ${face * 0.43} C ${w * 0.43} ${face * 0.31} ${w * 0.22} ${face * 0.29} 9 ${face * 0.3} Z`,
      "#3b302bb0"
    );
    fill(
      ctx,
      `M 12 ${face * 0.46} C ${w * 0.34} ${face * 0.39} ${w * 0.61} ${face * 0.59} ${w - 12} ${face * 0.73}
       L ${w * 0.8} ${face * 0.76} C ${w * 0.56} ${face * 0.65} ${w * 0.31} ${face * 0.56} 13 ${face * 0.55} Z`,
      "#322c28b8"
    );
    fill(
      ctx,
      `M ${w * 0.56} ${h - crust + 10} L ${w * 0.7} ${h - crust + 12} L ${w * 0.85} ${h - crust + 9}
       L ${w - 9} ${h - 6} L ${w * 0.74} ${h - 5} L ${w * 0.61} ${h - 7} Z`,
      "#302923b8"
    );
  }
  let seed = (x * 317 + y * 97 + w) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const count = Math.floor((w * h) / 480);
  for (let index = 0; index < count; index++) {
    const px = 7 + random() * Math.max(1, w - 17);
    const py = 12 + random() * Math.max(1, h - crust - 20);
    const radius = 1.6 + random() * Math.min(7, h * 0.07);
    fill(
      ctx,
      `M ${px - radius} ${py} Q ${px - radius * 0.4} ${py - radius} ${
        px + radius * 0.6
      } ${py - radius * 0.35}
      L ${px + radius * 1.2} ${py + radius * 0.3} Q ${px} ${
        py + radius * 0.9
      } ${px - radius} ${py} Z`,
      index % 4 ? "#877047" : "#5f4e34"
    );
    if (index % 3 === 0) {
      line(
        ctx,
        `M ${px - radius * 0.6} ${py + radius * 0.5} L ${px + radius * 0.6} ${
          py + radius * 0.65
        }`,
        "#e1c997",
        1.4
      );
    }
  }
  for (let index = 1; index < 5; index++) {
    const px = (w * index) / 5;
    line(ctx, `M ${px} ${h - crust + 8} l -3 4 l 5 3`, "#4e3527", 1.4);
  }
  ctx.restore();
}

function ribs(ctx: CanvasRenderingContext2D, wall: Rect) {
  ctx.save();
  ctx.translate(wall.x, wall.y);
  ctx.scale(wall.width / 90, wall.height / 220);
  ctx.fillStyle = "#453a34";
  ctx.fillRect(0, 0, 90, 220);
  ctx.beginPath();
  ctx.rect(1, 1, 88, 218);
  ctx.clip();
  if (wall.x > WORLD_WIDTH / 2) {
    ctx.translate(90, 0);
    ctx.scale(-1, 1);
  }
  fill(ctx, "M2 4 L29 7 L54 3 L86 7 L88 51 L84 105 L88 158 L86 215 L59 211 L32 216 L3 211 Z", "#795e54");
  fill(ctx, "M69 6 L87 7 L88 54 L82 103 L88 155 L86 213 L73 210 L78 155 L72 99 L76 51 Z", "#604941");
  fill(ctx, "M3 198 L27 204 L47 201 L70 207 L86 203 L86 217 L57 214 L31 218 L3 213 Z", "#514139");
  fill(ctx, "M9 11 L19 8 L25 25 L20 62 L25 83 L20 117 L25 139 L20 172 L25 195 L17 210 L9 207 L12 170 L8 140 L12 112 L8 81 L12 54 Z", "#928a73", "#574a3e", 1.5);
  for (const [y, bend] of [[35, -3], [91, 3], [147, -1]] as const) {
    fill(ctx,
      `M16 ${y + 4} C35 ${y - 18} 63 ${y - 8 + bend} 78 ${y + 13}
       Q83 ${y + 21} 75 ${y + 28} C59 ${y + 9 + bend} 39 ${y + 5} 19 ${y + 17} Z`,
      "#513e35"
    );
    fill(ctx,
      `M15 ${y} C34 ${y - 20} 62 ${y - 11 + bend} 77 ${y + 10}
       Q81 ${y + 17} 74 ${y + 23} C59 ${y + 5 + bend} 38 ${y + 1} 18 ${y + 13} Z`,
      "#aaa087", "#655a49", 1.5
    );
    line(ctx, `M20 ${y + 1} C38 ${y - 12} 58 ${y - 7 + bend} 72 ${y + 10}`, "#bab198", 2.5);
    fill(ctx, `M14 ${y - 3} Q23 ${y - 6} 24 ${y + 3} L21 ${y + 13} L13 ${y + 15} Z`, "#a1977e");
    line(ctx, `M31 ${y + 25} C47 ${y + 18} 65 ${y + 29} 74 ${y + 42}`, "#947b68", 3);
  }
  line(ctx, "M5 8 L27 11 L46 7 L67 10 L83 8", "#a18d73", 2.5);
  ctx.restore();
}

function chamberWear(ctx: CanvasRenderingContext2D, chamber: number) {
  const dish = DISHES[chamber]!;
  ctx.save();
  if (chamber === 1) {
    for (const [x, y, flip] of [[44, 320, 1], [676, 700, -1]]) {
      ctx.save();
      ctx.translate(x!, y!);
      ctx.scale(flip!, 1);
      fill(ctx, "M-32-118 C42-132 121-83 135-12 C142 42 102 106 35 122 L-35 119 Z", `${dish.stain}24`);
      for (const inset of [0, 9, 17])
        line(ctx, `M-12 ${-107 + inset} C${112 - inset} -124 ${164 - inset} 56 8 ${111 - inset}`, `${dish.stain}42`, 2.5);
      ctx.restore();
    }
  } else if (chamber === 2) {
    for (const outline of [
      "M28 270 L74 302 L65 335 L111 365 L119 417 M65 335 L35 373 M111 365 L165 347",
      "M692 650 L651 612 L660 567 L607 530 L603 483 M660 567 L684 531 M607 530 L562 548",
      "M28 830 L77 793 L109 807 L137 768 M77 793 L65 752",
    ]) {
      line(ctx, outline, `${dish.ash}88`, 2);
      ctx.save();
      ctx.translate(2, 1);
      line(ctx, outline, "#c8c4b32c", 1);
      ctx.restore();
    }
  } else if (chamber === 3) {
    for (const [x, y, flip] of [[31, 225, 1], [689, 605, -1], [30, 860, 1]]) {
      ctx.save();
      ctx.translate(x!, y!);
      ctx.scale(flip!, 1);
      fill(ctx, "M-12-62 C22-76 45-58 47-43 C76-57 105-23 86-7 C112 14 78 44 55 36 C56 63 22 73-9 57 Z", "#87925a35");
      fill(ctx, "M-7-40 C17-57 39-28 32-17 C60-31 81-6 64 10 C74 30 39 48 28 31 C12 49-5 32-13 21 Z", "#b6b17b1c");
      for (const [px, py] of [[22, -29], [47, -3], [31, 22], [9, 8]]) {
        line(ctx, `M${px} ${py} l7 -4 l4 5 m-4 -5 l-2 -7`, "#b4b68b42", 1.4);
      }
      ctx.restore();
    }
  } else if (chamber === 4) {
    for (const [x, y, angle] of [[35, 350, -0.22], [685, 720, Math.PI - 0.2]]) {
      ctx.save();
      ctx.translate(x!, y!);
      ctx.rotate(angle!);
      fill(ctx, "M-24-94 C65-99 146-27 126 21 C115 57 67 91-28 85 Z", "#29282a42");
      for (let index = 0; index < 5; index++) {
        const y = index * 21 - 58;
        line(ctx, `M-18 ${y} C34 ${y - 20} 83 ${y + 13} ${117 - index * 9} ${y + 35}`, "#25282b55", 7 - index * 0.6);
        line(ctx, `M-8 ${y + 5} C29 ${y - 10} 61 ${y + 12} 75 ${y + 23}`, "#a2886233", 1.5);
      }
      ctx.restore();
    }
  } else if (chamber === 5) {
    fill(ctx, "M28 172 C84 139 141 178 124 237 C104 287 52 267 28 302 Z", "#7d404b42");
    fill(ctx, "M692 730 C628 683 547 717 576 785 C603 843 659 825 692 864 Z", "#7d404b42");
    for (const y of [210, 229, 248])
      line(ctx, `M31 ${y} C65 ${y - 9} 98 ${y + 7} 115 ${y - 2}`, "#b38b8523", 2);
    line(ctx, "M625 780 C594 777 586 749 613 733 C638 717 665 738 660 756 C657 769 636 773 629 759", "#b38b8533", 3);
  }
  ctx.restore();
}

export function createFeastFloor(
  obstacles: Rect[] = [],
  chamber = 0
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WORLD_WIDTH;
  canvas.height = WORLD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable");
  chamber = Math.max(0, Math.min(DISHES.length - 1, chamber));
  const palette = DISHES[chamber]!;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "#282b29";
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  const dish = new Path2D(
    "M 38 7 L 680 7 Q 711 9 713 38 L 713 922 Q 712 950 679 953 L 39 953 Q 8 952 7 923 L 7 39 Q 8 9 38 7 Z"
  );
  ctx.fillStyle = palette.rim;
  ctx.fill(dish);
  ctx.strokeStyle = "#171f20";
  ctx.lineWidth = 4;
  ctx.stroke(dish);
  line(
    ctx,
    "M 18 105 L 18 47 Q 18 18 45 18 L 263 18 M 455 18 L 674 18 Q 701 18 701 47 L 701 114 M 701 774 L 701 913 Q 701 941 674 941 L 589 941 M 455 941 L 206 941 M 18 620 L 18 519",
    palette.edge,
    4
  );
  line(
    ctx,
    "M 12 121 L 12 45 Q 13 12 42 12 L 267 12 M 451 12 L 678 12 Q 708 13 708 43 L 708 117 M 708 781 L 708 914 Q 707 948 675 948 L 593 948",
    "#d4cbb074",
    1.5
  );

  const well = new Path2D(
    "M 45 27 L 675 27 Q 693 28 693 47 L 693 911 Q 691 932 674 933 L 46 933 Q 27 931 27 911 L 27 47 Q 28 28 45 27 Z"
  );
  ctx.fillStyle = palette.glaze;
  ctx.fill(well);
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 3;
  ctx.stroke(well);

  ctx.save();
  ctx.clip(well);
  ctx.save();
  if (chamber % 2) {
    ctx.translate(WORLD_WIDTH, WORLD_HEIGHT);
    ctx.rotate(Math.PI);
  }
  // Wiped glaze and grease are flat marks, never silhouettes of solid cover.
  fill(
    ctx,
    "M 28 711 C 61 707 70 715 85 730 C 94 720 117 733 119 747 C 135 745 154 756 155 767 C 174 767 196 783 211 797 C 186 795 168 783 150 788 C 130 786 122 778 116 780 C 88 782 79 768 63 770 C 45 773 42 765 28 771 Z",
    "#6a503b66"
  );
  line(ctx, "M 52 770 C 92 773 147 792 187 814", "#c1b16c20", 3);
  fill(
    ctx,
    "M 27 745 C 54 741 73 761 92 763 C 122 770 147 792 177 803 Q 188 811 185 815 C 170 809 165 812 158 809 C 113 786 77 783 28 779 Z",
    "#ab8a5654"
  );
  fill(
    ctx,
    "M 28 813 C 59 806 86 802 110 811 Q 119 815 113 820 C 134 817 139 827 146 828 Q 154 826 162 833 C 171 841 182 840 187 846 C 160 847 151 839 128 841 C 117 839 109 846 93 841 Q 76 850 65 837 C 54 841 40 840 28 836 Z",
    "#92714e5c"
  );
  fill(
    ctx,
    "M 28 875 C 54 852 67 845 108 853 L 130 869 L 110 866 L 119 880 L 101 875 C 80 883 54 877 29 897 Z",
    "#343e3370"
  );
  fill(
    ctx,
    "M 548 153 C 579 140 609 143 628 151 C 650 148 674 162 694 171 L 694 207 Q 678 201 664 201 C 638 185 620 195 604 183 C 595 182 579 181 581 174 C 565 172 555 163 548 153 Z",
    "#a68d5e3b"
  );
  line(ctx, "M 66 833 C 107 850 169 851 216 872", "#b3ad7b23", 2);
  for (const offset of [0, 9, 18, 27]) {
    line(
      ctx,
      `M 88 ${838 + offset} C 121 ${829 + offset} 168 ${850 + offset} 221 ${
        864 + offset
      }`,
      palette.glaze,
      3
    );
  }
  for (const offset of [0, 11, 22, 33]) {
    line(
      ctx,
      `M 61 ${733 + offset} C 92 ${735 + offset} 137 ${754 + offset} 185 ${
        783 + offset
      }`,
      palette.glaze,
      4
    );
  }
  line(
    ctx,
    "M 53 284 L 65 309 L 61 326 L 73 343 L 72 367 M 62 326 L 83 329 L 96 341 M 676 762 L 660 783 L 663 807 L 650 819",
    "#263c3226",
    1.4
  );
  for (const [x, y, length, tilt] of [
    [107, 782, 45, -7],
    [113, 789, 38, -6],
    [121, 795, 35, -6],
    [583, 449, 38, -4],
    [589, 457, 30, -3],
  ]) {
    line(ctx, `M ${x} ${y} l ${length} ${tilt}`, "#8990841a", 1.2);
  }
  ctx.restore();
  chamberWear(ctx, chamber);

  let seed = 7621 + chamber * 53;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < 35; index++) {
    const left = index % 2 === 0;
    const x = left ? 41 + random() * 65 : 620 + random() * 58;
    const y = 143 + random() * 727;
    ctx.fillStyle = index % 4 ? "#9d93754a" : "#222d2a66";
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      0.8 + random() * 2.5,
      0.7 + random() * 1.4,
      random() * 3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();

  // The cropped table setting stays within the physical edge of the dish.
  const edgeOnly = new Path2D();
  edgeOnly.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  edgeOnly.addPath(well);
  ctx.save();
  ctx.clip(edgeOnly, "evenodd");

  fill(
    ctx,
    "M -28 661 L 29 709 L 25 914 L 188 982 L -24 984 Z",
    "#686d66",
    "#272f2d",
    3
  );
  line(ctx, "M -12 703 L 16 724 L 12 927 L 121 969", "#374e50", 6);
  line(ctx, "M -10 718 L 7 732 L 4 935 L 88 971", "#9a9b85", 2);
  line(ctx, "M -11 681 L 22 713 L 18 920 L 150 975", "#858a7b", 2);
  for (let y = 744; y < 922; y += 14) {
    line(ctx, `M 0 ${y} l 26 5`, "#c1b9a119", 1);
  }

  fill(
    ctx,
    "M 735 129 C 702 219 695 333 698 477 L 708 722 L 735 769 Z",
    "#353e3d",
    "#192523",
    3
  );
  fill(
    ctx,
    "M 732 165 C 710 260 705 365 707 492 L 716 690 L 733 707 Z",
    "#89938b"
  );
  line(ctx, "M 715 232 C 705 364 709 491 716 624", "#c2c4aa", 2);

  fill(
    ctx,
    "M 1 212 Q 12 223 24 211 L 21 236 Q 18 246 18 263 L 21 407 L 8 407 L 10 264 Q 10 246 5 235 Z",
    "#829085",
    "#283a33",
    2
  );
  line(ctx, "M 13 255 L 15 388", "#bdc4a8", 2);
  for (const x of [-2, 7, 16, 25]) {
    fill(
      ctx,
      `M ${x} 217 L ${x - 1} 151 Q ${x + 1} 137 ${x + 3} 151 L ${x + 5} 216 Z`,
      "#8f998e",
      "#26352f",
      1.2
    );
    line(ctx, `M ${x + 2} 158 L ${x + 2} 205`, "#c0c6ab", 1);
  }

  fill(
    ctx,
    "M 549 981 C 573 942 629 931 685 941 C 714 945 738 960 753 988 Z",
    "#795233",
    "#302d25",
    3
  );
  fill(ctx, "M 574 976 C 604 951 656 947 699 961 L 712 988 Z", "#b19561");
  line(ctx, "M 597 964 C 631 953 666 956 692 964", "#d5b37c", 2);
  ctx.restore();

  fill(
    ctx,
    "M 17 421 L 21 413 L 24 423 L 29 425 L 24 434 L 28 449 L 22 457 L 17 453 L 20 439 L 17 433 Z",
    "#c9bea0"
  );
  line(ctx, "M 25 416 L 22 426 L 25 436 L 22 451", "#72735e", 1.5);
  fill(
    ctx,
    "M 531 933 L 539 929 L 546 932 L 553 928 L 560 933 L 575 935 L 569 942 L 543 942 Z",
    "#c9bea0"
  );
  line(ctx, "M 538 934 L 548 935 L 555 932 L 566 937", "#72735e", 1.5);

  for (const [outline, fracture] of [
    ["M 24 102 L 17 107 L 22 116 L 28 118 L 28 101 Z", "M 21 109 L 25 114"],
    ["M 19 467 L 25 461 L 30 470 L 25 482 L 18 479 Z", "M 24 468 L 25 477"],
    [
      "M 695 598 L 702 603 L 699 612 L 691 619 L 691 602 Z",
      "M 695 606 L 693 612",
    ],
    [
      "M 474 932 L 481 926 L 491 934 L 489 941 L 477 940 Z",
      "M 480 934 L 487 936",
    ],
    ["M 644 26 L 650 19 L 659 23 L 663 29 L 650 30 Z", "M 650 24 L 657 27"],
  ]) {
    fill(ctx, outline!, "#c9bea0", "#39453c", 1.5);
    line(ctx, fracture!, "#847c64", 1.2);
  }
  for (const obstacle of obstacles) {
    if (chamber === 3) ribs(ctx, obstacle);
    else bread(ctx, obstacle, chamber === 4);
  }
  return canvas;
}
