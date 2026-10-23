import { describe, expect, it } from 'vitest'
import { clockTime, countDelta, initials, pointsDelta, shortDay, slotRange, timeSpan, todayLabel, waitingLabel, weekdayShort } from '@/lib/format'

describe('pointsDelta', () => {
  it('reports the change in percentage points against last week', () => {
    expect(pointsDelta(74, 68)).toBe('+6 pts vs last week')
    expect(pointsDelta(60, 63)).toBe('−3 pts vs last week')
    expect(pointsDelta(50, 50)).toBe('no change vs last week')
  })
})

describe('countDelta', () => {
  it('reports the change against yesterday', () => {
    expect(countDelta(9, 7)).toBe('+2 since yesterday')
    expect(countDelta(4, 5)).toBe('−1 since yesterday')
    expect(countDelta(3, 3)).toBe('no change since yesterday')
  })
})

describe('slotRange', () => {
  it("turns a slot label into the hour it covers", () => {
    expect(slotRange('2:00 PM')).toBe('2–3 PM')
    expect(slotRange('9:00 AM')).toBe('9–10 AM')
    expect(slotRange('11:00 AM')).toBe('11 AM–12 PM')
    expect(slotRange('12:00 PM')).toBe('12–1 PM')
    expect(slotRange('7:00 PM')).toBe('7–8 PM')
  })

  it('leaves an unexpected label as it is', () => {
    expect(slotRange('noon')).toBe('noon')
  })
})

describe('todayLabel', () => {
  it("names the library's day, not the browser's", () => {
    // 20:00 UTC on 14 Oct is already 15 Oct in India.
    expect(todayLabel(new Date('2026-10-14T20:00:00Z'), 'Asia/Kolkata')).toBe('Thursday, Oct 15, 2026')
  })
})

describe('weekdayShort', () => {
  it('names the weekday of a calendar date', () => {
    expect(weekdayShort('2026-10-15')).toBe('Thu')
    expect(weekdayShort('2026-10-11')).toBe('Sun')
  })
})

describe('initials', () => {
  it('takes up to two initials', () => {
    expect(initials('Raghav Gupta')).toBe('RG')
    expect(initials('mary jane watson')).toBe('MJ')
    expect(initials('  Aditi  ')).toBe('A')
  })
})

describe('waitingLabel', () => {
  it('rounds a wait down to minutes, hours or days', () => {
    expect(waitingLabel(30_000)).toBe('less than a minute')
    expect(waitingLabel(-5_000)).toBe('less than a minute')
    expect(waitingLabel(12 * 60_000 + 59_000)).toBe('12 min')
    expect(waitingLabel(3 * 3_600_000 + 59 * 60_000)).toBe('3 h')
    expect(waitingLabel(2 * 86_400_000 + 3_600_000)).toBe('2 d')
  })
})

describe('library times', () => {
  const TZ = 'Asia/Kolkata'

  it('shows a slot in the library time zone', () => {
    expect(timeSpan('2026-10-22T08:30:00.000Z', '2026-10-22T09:30:00.000Z', TZ)).toBe('2–3 PM')
    expect(timeSpan('2026-10-22T05:30:00.000Z', '2026-10-22T06:30:00.000Z', TZ)).toBe('11 AM–12 PM')
    expect(timeSpan('2026-10-22T09:00:00.000Z', '2026-10-22T10:00:00.000Z', TZ)).toBe('2:30–3:30 PM')
  })

  it('shows a clock time and a short day', () => {
    expect(clockTime('2026-10-22T08:45:00.000Z', TZ)).toBe('2:15 PM')
    expect(shortDay('2026-10-22T08:30:00.000Z', TZ)).toBe('Thu, Oct 22')
  })
})
