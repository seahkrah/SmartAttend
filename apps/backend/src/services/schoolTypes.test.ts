import { describe, it, expect } from 'vitest'
import {
  SCHOOL_TYPE_CATALOGUE, SCHOOL_TYPES, SchoolStructureError, gradesFor, resolveSchoolType, validateStructure,
} from './schoolTypes.js'

function refusal(fn: () => unknown): SchoolStructureError {
  try {
    fn()
  } catch (e) {
    if (e instanceof SchoolStructureError) return e
    throw e
  }
  throw new Error('expected a SchoolStructureError')
}

describe('school type catalogue', () => {
  it('describes every type, each with at least one stage', () => {
    for (const t of SCHOOL_TYPES) {
      expect(SCHOOL_TYPE_CATALOGUE[t].key).toBe(t)
      expect(SCHOOL_TYPE_CATALOGUE[t].stages.length).toBeGreaterThan(0)
    }
  })

  it('gives a grade school grades and no programmes, and a university the reverse', () => {
    expect(SCHOOL_TYPE_CATALOGUE.grade_school.features).toMatchObject({ gradeLevels: true, programmes: false })
    expect(SCHOOL_TYPE_CATALOGUE.university.features).toMatchObject({ gradeLevels: false, programmes: true })
  })

  it('treats a school with no type recorded as a university', () => {
    expect(resolveSchoolType(null)).toBe('university')
    expect(resolveSchoolType('nonsense')).toBe('university')
    expect(resolveSchoolType('grade_school')).toBe('grade_school')
  })
})

describe('validateStructure', () => {
  it('returns the stages in catalogue order without duplicates', () => {
    expect(validateStructure('grade_school', ['junior_high', 'elementary', 'elementary']))
      .toEqual({ type: 'grade_school', stages: ['elementary', 'junior_high'] })
  })

  it('refuses an unknown type', () => {
    expect(refusal(() => validateStructure('kindergarten', ['elementary'])).code).toBe('INVALID_SCHOOL_TYPE')
  })

  it('refuses no stages', () => {
    expect(refusal(() => validateStructure('college', [])).code).toBe('STAGES_REQUIRED')
    expect(refusal(() => validateStructure('college', undefined)).code).toBe('STAGES_REQUIRED')
  })

  it("refuses a stage that belongs to another type", () => {
    const e = refusal(() => validateStructure('grade_school', ['elementary', 'masters']))
    expect(e.code).toBe('INVALID_STAGE')
    expect(e.status).toBe(400)
  })
})

describe('gradesFor', () => {
  it('generates the grades of the stages offered, in order', () => {
    const g = gradesFor('grade_school', ['early_childhood', 'elementary'])
    expect(g.map((x) => x.code)).toEqual(['N', 'K1', 'K2', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'])
  })

  it('keeps each grade in its place on the whole ladder when stages are skipped', () => {
    const elementaryOnly = gradesFor('grade_school', ['elementary'])
    const withNursery = gradesFor('grade_school', ['early_childhood', 'elementary'])
    const g1 = (list: typeof elementaryOnly) => list.find((x) => x.code === 'G1')!.sortOrder
    expect(g1(elementaryOnly)).toBe(g1(withNursery))
  })

  it('adding junior high to an elementary school only adds grades 7 to 9', () => {
    const before = gradesFor('grade_school', ['elementary']).map((x) => x.code)
    const after = gradesFor('grade_school', ['elementary', 'junior_high']).map((x) => x.code)
    expect(after.filter((c) => !before.includes(c))).toEqual(['G7', 'G8', 'G9'])
  })

  it('generates no grades for a type without them', () => {
    expect(gradesFor('university', ['undergraduate'])).toEqual([])
  })
})
