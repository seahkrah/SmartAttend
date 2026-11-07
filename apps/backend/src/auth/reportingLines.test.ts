import { describe, expect, it } from 'vitest'
import { actsFor, isPeopleAdmin, listFilter } from './reportingLines.js'

const hr = { all: true, self: 'h', reports: [] }
const manager = { all: false, self: 'm', reports: ['a', 'b'] }
const employee = { all: false, self: 'e', reports: [] }

describe('reporting scope', () => {
  it('HR acts for everyone, themselves included (their own decisions are refused elsewhere)', () => {
    expect(actsFor(hr, 'anyone')).toBe(true)
    expect(listFilter(hr)).toBeNull()
  })
  it('a manager acts for their reports, not themselves, not others', () => {
    expect(actsFor(manager, 'a')).toBe(true)
    expect(actsFor(manager, 'm')).toBe(false)
    expect(actsFor(manager, 'z')).toBe(false)
    expect(listFilter(manager)).toEqual(['a', 'b'])
    expect(listFilter(manager, true)).toEqual(['a', 'b', 'm'])
  })
  it('anyone else acts for nobody', () => {
    expect(actsFor(employee, 'e')).toBe(false)
    expect(listFilter(employee)).toEqual([])
    expect(actsFor(employee, null)).toBe(false)
  })
  it('knows who administers people', () => {
    for (const r of ['hr', 'hr_director', 'admin']) expect(isPeopleAdmin({ tenantId: 't', userId: 'u', roleName: r })).toBe(true)
    for (const r of ['manager', 'employee']) expect(isPeopleAdmin({ tenantId: 't', userId: 'u', roleName: r })).toBe(false)
    expect(isPeopleAdmin({ tenantId: 't', userId: 'u', roleName: 'employee', isSuperadmin: true })).toBe(true)
  })
})
