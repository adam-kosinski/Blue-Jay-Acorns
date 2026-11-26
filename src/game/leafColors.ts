import { OAK_TONES } from './constants'

/** A color as hue (degrees), saturation and lightness (0-1). */
type Hsl = { h: number; s: number; l: number }

/**
 * Reads a `#rrggbb` or `rgb(r,g,b)` color as three numbers 0-255.
 *
 * @param color - The color.
 */
export function parseRgb(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
  }
  const parts = color.replace(/[^\d.,]/g, '').split(',').map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/**
 * Converts `#rrggbb` or `rgb(r,g,b)` to hue, saturation and lightness.
 *
 * @param hex - Color.
 */
function hexToHsl(hex: string): Hsl {
  const [r8, g8, b8] = parseRgb(hex)
  const r = r8 / 255
  const g = g8 / 255
  const b = b8 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) {
    return { h: 0, s: 0, l }
  }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) {
    h = ((g - b) / d) % 6
  } else if (max === g) {
    h = (b - r) / d + 2
  } else {
    h = (r - g) / d + 4
  }
  return { h: (h * 60 + 360) % 360, s, l }
}

/**
 * Converts hue (degrees), saturation and lightness to `#rrggbb`.
 *
 * @param h - Hue in degrees.
 * @param s - Saturation 0-1.
 * @param l - Lightness 0-1.
 */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb: [number, number, number] = [0, 0, 0]
  if (hp < 1) {
    rgb = [c, x, 0]
  } else if (hp < 2) {
    rgb = [x, c, 0]
  } else if (hp < 3) {
    rgb = [0, c, x]
  } else if (hp < 4) {
    rgb = [0, x, c]
  } else if (hp < 5) {
    rgb = [x, 0, c]
  } else {
    rgb = [c, 0, x]
  }
  const m = l - c / 2
  const part = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, v + m)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`
}

/**
 * Blends two `#rrggbb` colors.
 *
 * @param a - First color.
 * @param b - Second color.
 * @param amount - Share of the second (0-1).
 */
export function mixHex(a: string, b: string, amount: number): string {
  const ch = (color: string, i: number): number => parseRgb(color)[i] ?? 0
  const part = (i: number): string =>
    Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${part(0)}${part(1)}${part(2)}`
}

/** How much lighter or darker (lightness) each of the green leaf tones is than their average. */
const SHADE_OFFSETS: number[] = (() => {
  const lights = OAK_TONES.map((tone) => hexToHsl(tone).l)
  const mean = lights.reduce((sum, l) => sum + l, 0) / lights.length
  return lights.map((l) => l - mean)
})()

/** How strongly the green tones' shading carries over to the fall colors. */
const SHADE_STRENGTH = 1.3

/** Saturation and lightness of the base fall color (hue decides red, orange or yellow). */
const FALL_SATURATION_MAX = 0.615
const FALL_SATURATION_MIN = 0.41
const FALL_LIGHTNESS = 0.5

/**
 * Four leaf tones, dark to light, of a tree's fall color: the base color of that hue, offset by the same
 * lighter and darker shades the green tones have, and shifted a little in hue (a different shift for
 * each leaf lobe gives a tree a small variation of hue).
 *
 * @param hue - The tree's fall hue in degrees (0 red to about 55 yellow).
 * @param hueShift - Hue shift in degrees for this lobe.
 * @param haze - Blend toward this color by this amount (distant trees), or null.
 * @param saturation - The tree's own saturation (see `newLeafSeason`).
 */
export function fallTones(hue: number, hueShift: number, haze: { color: string; amount: number } | null, saturation = FALL_SATURATION_MAX): string[] {
  return SHADE_OFFSETS.map((offset) => {
    const tone = hslToHex(hue + hueShift, saturation, FALL_LIGHTNESS + offset * SHADE_STRENGTH)
    return haze ? mixHex(tone, haze.color, haze.amount) : tone
  })
}

/** The new leaves of spring, dark to light: a light yellow-green (lime), well apart from the summer greens. */
const SPRING_TONES = ['#6fa52c', '#86bb34', '#9ecf3e', '#b7e04e']

/**
 * The four tones of the spring leaves.
 *
 * @param haze - Blend toward this color by this amount (distant trees), or null.
 */
export function springTones(haze: { color: string; amount: number } | null): string[] {
  return haze ? SPRING_TONES.map((tone) => mixHex(tone, haze.color, haze.amount)) : SPRING_TONES
}

/** How much darker (lightness share) and less saturated (saturation share) greens are in winter. */
const WINTER_DARKEN = 0.14
const WINTER_DESATURATE = 0.22

/**
 * A green as it looks in winter: a little darker and a little less saturated. At 0 the color is unchanged.
 *
 * @param hex - The summer color (`#rrggbb`).
 * @param amount - How far into winter, 0-1.
 */
export function winterGreen(hex: string, amount: number): string {
  if (amount <= 0) {
    return hex
  }
  const { h, s, l } = hexToHsl(hex)
  return hslToHex(h, s * (1 - WINTER_DESATURATE * amount), l * (1 - WINTER_DARKEN * amount))
}

/**
 * A new tree's or bush's seasonal traits: a hue from red (0) to yellow (55 degrees), a saturation
 * between half the original (0.41) and the present maximum (0.615), and a random start within early fall.
 */
export function newLeafSeason(): { hue: number; sat: number; start: number } {
  return {
    hue: Math.random() * 55,
    sat: FALL_SATURATION_MIN + Math.random() * (FALL_SATURATION_MAX - FALL_SATURATION_MIN),
    start: Math.random(),
  }
}
