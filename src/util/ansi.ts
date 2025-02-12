const ESC = '\u001b'

export function wrap(s: string, start: number, end: number) {
  return `${ESC}[${start.toString()}m${s}${ESC}[${end.toString()}m`
}

export function wrapColor(s: string, num: number) {
  return wrap(s, num, 39)
}

export const color = {
  red: (s: string) => wrapColor(s, 31),
  green: (s: string) => wrapColor(s, 32),
  yellow: (s: string) => wrapColor(s, 33),
  blue: (s: string) => wrapColor(s, 34),
  magenta: (s: string) => wrapColor(s, 35),
  cyan: (s: string) => wrapColor(s, 36),
  white: (s: string) => wrapColor(s, 37),
  gray: (s: string) => wrapColor(s, 90),
  redBright: (s: string) => wrapColor(s, 91),
  greenBright: (s: string) => wrapColor(s, 92),
  yellowBright: (s: string) => wrapColor(s, 93),
  blueBright: (s: string) => wrapColor(s, 94),
  magentaBright: (s: string) => wrapColor(s, 95),
  cyanBright: (s: string) => wrapColor(s, 96),
  whiteBright: (s: string) => wrapColor(s, 97),
}
