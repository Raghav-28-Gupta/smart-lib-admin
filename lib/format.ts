// Display formatting for the Dashboard and shell. Pure, so every rule is tested.

const MINUS = '−' // U+2212, as in the spec's copy

function signed(n: number): string {
  return `${n > 0 ? '+' : MINUS}${Math.abs(n)}`
}

/** "+6 pts vs last week", "−3 pts vs last week", or "no change vs last week". */
export function pointsDelta(current: number, previous: number): string {
  const d = current - previous
  return d === 0 ? 'no change vs last week' : `${signed(d)} pts vs last week`
}

/** "+2 since yesterday", "−1 since yesterday", or "no change since yesterday". */
export function countDelta(current: number, previous: number): string {
  const d = current - previous
  return d === 0 ? 'no change since yesterday' : `${signed(d)} since yesterday`
}

/** "2:00 PM" becomes "2–3 PM"; "11:00 AM" becomes "11 AM–12 PM". */
export function slotRange(label: string): string {
  const match = /^(\d{1,2}):\d{2} (AM|PM)$/.exec(label)
  if (!match) return label
  const start = (Number(match[1]) % 12) + (match[2] === 'PM' ? 12 : 0)
  const end = start + 1
  const twelve = (h: number) => (h % 12 === 0 ? 12 : h % 12)
  const meridiem = (h: number) => (h % 24 < 12 ? 'AM' : 'PM')
  return meridiem(start) === meridiem(end)
    ? `${twelve(start)}–${twelve(end)} ${meridiem(end)}`
    : `${twelve(start)} ${meridiem(start)}–${twelve(end)} ${meridiem(end)}`
}

/** "Thursday, Oct 15, 2026" for `now` in the library's time zone. */
export function todayLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone,
  }).format(now)
}

/** "Thu" for '2026-10-15'. */
export function weekdayShort(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "RG" for "Raghav Gupta". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** The library's time zone, for every date and time the console shows. */
export const LIBRARY_TIMEZONE = process.env.NEXT_PUBLIC_LIBRARY_TIMEZONE ?? 'Asia/Kolkata'

/** "less than a minute", "12 min", "3 h", "2 d": how long something has waited, or has left. */
export function waitingLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'less than a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

function clockParts(iso: string, timeZone: string): { hour: number; minute: number; meridiem: 'AM' | 'PM' } {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { hour: Number(part('hour')), minute: Number(part('minute')), meridiem: part('dayPeriod').toUpperCase() === 'AM' ? 'AM' : 'PM' }
}

/** "2:15 PM" in the library's time zone. */
export function clockTime(iso: string, timeZone: string): string {
  const { hour, minute, meridiem } = clockParts(iso, timeZone)
  return `${hour}:${String(minute).padStart(2, '0')} ${meridiem}`
}

/** "2–3 PM", "11 AM–12 PM", "2:30–3:30 PM": a slot in the library's time zone. */
export function timeSpan(startIso: string, endIso: string, timeZone: string): string {
  const start = clockParts(startIso, timeZone)
  const end = clockParts(endIso, timeZone)
  const short = (p: { hour: number; minute: number }) =>
    p.minute === 0 ? String(p.hour) : `${p.hour}:${String(p.minute).padStart(2, '0')}`
  return start.meridiem === end.meridiem
    ? `${short(start)}–${short(end)} ${end.meridiem}`
    : `${short(start)} ${start.meridiem}–${short(end)} ${end.meridiem}`
}

/** "Thu, Oct 22" in the library's time zone. */
export function shortDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(new Date(iso))
}
