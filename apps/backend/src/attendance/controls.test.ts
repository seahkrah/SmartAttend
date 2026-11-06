import { describe, expect, it } from 'vitest'
import { geofence, inNetworks, metresBetween, normaliseIp, validCidr } from './controls.js'

// Monrovia, City Hall area, and points around it.
const SITE = { id: 's1', name: 'Head office', latitude: 6.3005, longitude: -10.7969, radius_m: 100 }
// One degree of latitude is about 111.2 km, so 0.001 degrees is about 111 m.
const north = (metres: number) => ({ latitude: SITE.latitude + metres / 111195, longitude: SITE.longitude })

describe('metresBetween', () => {
  it('is zero for the same point and about 111 km for a degree of latitude', () => {
    expect(metresBetween(6, -10, 6, -10)).toBe(0)
    expect(metresBetween(6, -10, 7, -10)).toBeGreaterThan(111000)
    expect(metresBetween(6, -10, 7, -10)).toBeLessThan(111400)
  })
})

describe('geofence', () => {
  it('places someone at the site inside it', () => {
    const g = geofence({ ...north(50), accuracyMetres: 10 }, [SITE], 100)
    expect(g.ok).toBe(true)
    expect(g.code).toBe('inside')
    expect(g.detail.distanceMetres).toBe(50)
  })

  it('gives the benefit of the phone\'s error at the edge', () => {
    // 130 m out, radius 100, accurate to 40: the person may be 90 m out.
    expect(geofence({ ...north(130), accuracyMetres: 40 }, [SITE], 100).ok).toBe(true)
    // Accurate to 20: at least 110 m out.
    expect(geofence({ ...north(130), accuracyMetres: 20 }, [SITE], 100)).toMatchObject({ ok: false, code: 'outside_geofence' })
  })

  it('places nobody with a position too imprecise, however close it claims', () => {
    expect(geofence({ ...north(0), accuracyMetres: 500 }, [SITE], 100)).toMatchObject({ ok: false, code: 'location_imprecise' })
    expect(geofence({ ...north(0), accuracyMetres: null }, [SITE], 100)).toMatchObject({ ok: false, code: 'location_imprecise' })
    expect(geofence({ ...north(0), accuracyMetres: -1 }, [SITE], 100)).toMatchObject({ ok: false, code: 'location_imprecise' })
  })

  it('needs a position', () => {
    expect(geofence({ latitude: null, longitude: null, accuracyMetres: 5 }, [SITE], 100).code).toBe('no_location')
    expect(geofence({ latitude: 95, longitude: 0, accuracyMetres: 5 }, [SITE], 100).code).toBe('no_location')
  })

  it('measures against the nearest site, by its edge', () => {
    const far = { id: 's2', name: 'Depot', latitude: SITE.latitude + 0.01, longitude: SITE.longitude, radius_m: 2000 }
    // 900 m north of head office: outside its 100 m, inside the depot's 2 km.
    const g = geofence({ ...north(900), accuracyMetres: 10 }, [SITE, far], 100)
    expect(g).toMatchObject({ ok: true, code: 'inside' })
    expect(g.detail.site).toBe('Depot')
  })
})

describe('networks', () => {
  it('matches IPv4 ranges and single hosts', () => {
    expect(inNetworks('203.0.113.7', ['203.0.113.0/24'])).toBe(true)
    expect(inNetworks('203.0.114.7', ['203.0.113.0/24'])).toBe(false)
    expect(inNetworks('198.51.100.9', ['198.51.100.9'])).toBe(true)
  })

  it('treats an IPv4-mapped IPv6 address as the IPv4 it is', () => {
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(inNetworks('::ffff:203.0.113.7', ['203.0.113.0/24'])).toBe(true)
  })

  it('matches IPv6', () => {
    expect(inNetworks('2001:db8::1', ['2001:db8::/32'])).toBe(true)
    expect(inNetworks('2001:db9::1', ['2001:db8::/32'])).toBe(false)
  })

  it('refuses what is not an address, and skips bad entries', () => {
    expect(inNetworks(null, ['0.0.0.0/0'])).toBe(false)
    expect(inNetworks('unknown', ['0.0.0.0/0'])).toBe(false)
    expect(inNetworks('10.0.0.1', ['nonsense', '10.0.0.0/33', '10.0.0.0/8'])).toBe(true)
  })

  it('validates what an administrator enters', () => {
    expect(validCidr('10.0.0.0/8')).toBe(true)
    expect(validCidr('2001:db8::/32')).toBe(true)
    expect(validCidr('10.0.0.1')).toBe(true)
    expect(validCidr('10.0.0.0/33')).toBe(false)
    expect(validCidr('10.0.0.0/x')).toBe(false)
    expect(validCidr('example.com')).toBe(false)
  })
})
