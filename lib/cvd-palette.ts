/**
 * The colour-blind-safe palette behind Settings > Accessibility >
 * "Colour-blind-safe colours" (colorBlindPalette).
 *
 * Tags, folders and calendars keep the colours the user picked; this only
 * changes how they are drawn. Every colour is moved to the nearest of the
 * Okabe-Ito colours by hue: eight colours chosen to stay apart for
 * protanopia, deuteranopia and tritanopia (Okabe & Ito, "Color Universal
 * Design", 2008). Two picked colours of a similar hue (blue and indigo) can
 * land on the same one; the names next to them still tell them apart.
 */

export const CVD_COLORS = {
  vermillion: "#D55E00",
  orange: "#E69F00",
  yellow: "#F0E442",
  bluishGreen: "#009E73",
  skyBlue: "#56B4E9",
  blue: "#0072B2",
  reddishPurple: "#CC79A7",
  grey: "#999999",
} as const;

export type CvdHue = keyof typeof CVD_COLORS;

/** The hues of the tag palette (stores/settings-store KEYWORD_PALETTE), as Tailwind's 500 shades. */
const PALETTE_HUES: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  indigo: "#6366f1",
  purple: "#a855f7",
  pink: "#ec4899",
  gray: "#6b7280",
};

/** Hue (0-360) and saturation (0-1) of a colour, or null when it can't be read. */
function hueAndSaturation(color: string): { hue: number; saturation: number } | null {
  let r: number, g: number, b: number;
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = digits.slice(0, 3).split("").map((d) => d + d).join("");
    if (digits.length !== 6 && digits.length !== 8) return null;
    r = parseInt(digits.slice(0, 2), 16);
    g = parseInt(digits.slice(2, 4), 16);
    b = parseInt(digits.slice(4, 6), 16);
  } else {
    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value);
    const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(value);
    if (rgb) {
      [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    } else if (hsl) {
      return { hue: Number(hsl[1]) % 360, saturation: Number(hsl[2]) / 100 };
    } else {
      return null;
    }
  }
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, saturation };
}

/**
 * The palette colour for `color`: a CSS colour (#hex, rgb(), hsl()) or a
 * tag palette name ("red", "teal-light"). Null when it can't be read.
 */
export function cvdHue(color: string | null | undefined): CvdHue | null {
  if (!color) return null;
  const paletteName = color.replace(/-(light|dark)$/, "");
  const parsed = hueAndSaturation(PALETTE_HUES[paletteName] ?? color);
  if (!parsed) return null;
  const { hue, saturation } = parsed;
  if (saturation < 0.15) return "grey";
  if (hue < 18 || hue >= 345) return "vermillion";
  if (hue < 44) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "bluishGreen";
  if (hue < 200) return "skyBlue";
  if (hue < 255) return "blue";
  return "reddishPurple";
}

/**
 * The colour to draw `color` in: itself, or its colour-blind-safe
 * replacement when `enabled`. A colour it can't read is drawn as it is.
 */
export function cvdColor(color: string, enabled: boolean): string {
  if (!enabled) return color;
  const hue = cvdHue(color);
  return hue ? CVD_COLORS[hue] : color;
}

/**
 * Tailwind classes for each palette colour, written out so Tailwind
 * generates them (it only finds classes that appear verbatim). Used where
 * a colour is drawn through classes (tag lozenges, folder icons) instead of
 * an inline style. Text stays in the text colour: several of these colours
 * are too light to read as text.
 */
export const CVD_CLASSES: Record<CvdHue, { dot: string; icon: string; fill: string; border: string; text: string; rowTint: string }> = {
  vermillion: { dot: "bg-[#D55E00]", icon: "text-[#D55E00]", fill: "bg-[#D55E00]/15", border: "border-[#D55E00]", text: "text-foreground", rowTint: "bg-[#D55E00]/10" },
  orange: { dot: "bg-[#E69F00]", icon: "text-[#E69F00]", fill: "bg-[#E69F00]/15", border: "border-[#E69F00]", text: "text-foreground", rowTint: "bg-[#E69F00]/10" },
  yellow: { dot: "bg-[#F0E442]", icon: "text-[#F0E442]", fill: "bg-[#F0E442]/20", border: "border-[#F0E442]", text: "text-foreground", rowTint: "bg-[#F0E442]/15" },
  bluishGreen: { dot: "bg-[#009E73]", icon: "text-[#009E73]", fill: "bg-[#009E73]/15", border: "border-[#009E73]", text: "text-foreground", rowTint: "bg-[#009E73]/10" },
  skyBlue: { dot: "bg-[#56B4E9]", icon: "text-[#56B4E9]", fill: "bg-[#56B4E9]/15", border: "border-[#56B4E9]", text: "text-foreground", rowTint: "bg-[#56B4E9]/10" },
  blue: { dot: "bg-[#0072B2]", icon: "text-[#0072B2]", fill: "bg-[#0072B2]/15", border: "border-[#0072B2]", text: "text-foreground", rowTint: "bg-[#0072B2]/10" },
  reddishPurple: { dot: "bg-[#CC79A7]", icon: "text-[#CC79A7]", fill: "bg-[#CC79A7]/15", border: "border-[#CC79A7]", text: "text-foreground", rowTint: "bg-[#CC79A7]/10" },
  grey: { dot: "bg-[#999999]", icon: "text-[#999999]", fill: "bg-[#999999]/15", border: "border-[#999999]", text: "text-foreground", rowTint: "bg-[#999999]/10" },
};
