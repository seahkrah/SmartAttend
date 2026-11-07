import { describe, expect, it } from 'vitest'
import { csvCell, isoDate, toCsv } from './schoolAttendance.js'

describe('isoDate', () => {
  it('takes a real date', () => {
    expect(isoDate('2025-09-01', 'date')).toBe('2025-09-01')
    expect(isoDate('2024-02-29', 'date')).toBe('2024-02-29')
  })
  it('refuses a date that does not exist, which Date would roll over', () => {
    expect(() => isoDate('2025-02-30', 'date')).toThrow(/YYYY-MM-DD/)
    expect(() => isoDate('2025-02-29', 'date')).toThrow()
    expect(() => isoDate('2025-13-01', 'date')).toThrow()
  })
  it('refuses anything else', () => {
    for (const v of ['', 'today', '2025-9-1', '2025-09-01T00:00', null, undefined]) expect(() => isoDate(v, 'date')).toThrow()
  })
})

describe('csvCell', () => {
  it('leaves plain values and numbers alone, negative numbers included', () => {
    expect(csvCell('Ada')).toBe('Ada')
    expect(csvCell(66.7)).toBe('66.7')
    expect(csvCell('-5')).toBe('-5')
    expect(csvCell(null)).toBe('')
    expect(csvCell(false)).toBe('false')
  })
  it('writes what a spreadsheet would run as a formula as text', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+1-2')).toBe("'+1-2")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@here')).toBe("'@here")
    expect(csvCell('\tx')).toBe("'\tx")
  })
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Dee, Jr')).toBe('"Dee, Jr"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
  })
  it('joins rows with CRLF, header first', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n')
  })
})
