import { describe, expect, it } from 'vitest'
import { assessPad, clampPadThreshold, minimumCaptureMs } from './pad.js'

const sharp = { brightness: 0.5, contrast: 0.2, sharpness: 0.8 }
const base = { frameTimes: [0, 600, 1200], elapsedMs: 3000, steps: 3, quality: [sharp, sharp, sharp], duplicateFrames: false }

describe('assessPad', () => {
  it('passes a plausible capture with a full score', () => {
    const r = assessPad(base, 0.7)
    expect(r).toMatchObject({ pass: true, score: 1, hard: null })
  })
  it('refuses the same image sent for every pose, whatever the score', () => {
    expect(assessPad({ ...base, duplicateFrames: true }, 0.5)).toMatchObject({ pass: false, hard: 'duplicate_frames', score: 0 })
  })
  it('refuses frame times that a person could not produce', () => {
    for (const frameTimes of [[0, 0, 0], [0, 50, 100], [500, 400, 900], [0, 600], [0, 150, 300]]) {
      expect(assessPad({ ...base, frameTimes }, 0.5).hard, String(frameTimes)).toBe('implausible_timing')
    }
  })
  it('lowers the score without frame times or when answered too quickly', () => {
    const r = assessPad({ ...base, frameTimes: null, elapsedMs: 10 }, 0.7)
    expect(r.reasons).toEqual(['no_frame_times', 'answered_too_quickly'])
    expect(r.score).toBe(0.7)
    expect(r.pass).toBe(true)
    expect(assessPad({ ...base, frameTimes: null, elapsedMs: 10 }, 0.9).pass).toBe(false)
  })
  it('lowers the score for soft, flat or glaring frames', () => {
    const r = assessPad({ ...base, quality: [sharp, { brightness: 0.97, contrast: 0.03, sharpness: 0.01 }, sharp] }, 0.5)
    expect(r.reasons).toEqual(['soft_image', 'flat_image', 'glare_or_dark'])
    expect(r.score).toBe(0.4)
    expect(r.pass).toBe(false)
  })
  it('clamps the tenant threshold so the check cannot be turned off', () => {
    expect(clampPadThreshold(0)).toBe(0.5)
    expect(clampPadThreshold(2)).toBe(0.9)
    expect(clampPadThreshold('x')).toBe(0.7)
    expect(minimumCaptureMs(3)).toBe(600)
  })
})
