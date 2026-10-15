import { describe, expect, it } from 'vitest'
import { countDelta, initials, pointsDelta, slotRange, todayLabel, weekdayShort } from '@/lib/format'

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
