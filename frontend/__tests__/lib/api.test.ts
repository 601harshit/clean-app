/**
 * lib/api.ts smoke tests.
 *
 * Proves the test infra works (jest + next/jest + jsdom + ts-node)
 * AND that the typed wrappers call the right URLs with the right
 * methods, headers, and query params.
 */
import {
  clearHistory,
  getCategories,
  getFoodByBarcode,
  getHistory,
  getProfile,
  searchFoods,
  updateProfile,
} from '@/lib/api'

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  } as Response)
})

function urlOf(call: number): string {
  return mockFetch.mock.calls[call][0] as string
}

function initOf(call: number): RequestInit {
  return mockFetch.mock.calls[call][1] as RequestInit
}

describe('searchFoods', () => {
  it('calls /api/food/search with no query when params empty', async () => {
    await searchFoods({})
    expect(urlOf(0)).toBe('http://localhost:8000/api/food/search')
  })

  it('encodes q, category, page', async () => {
    await searchFoods({ q: 'nutella', category: 'snacks', page: 2 })
    const url = new URL(urlOf(0))
    expect(url.pathname).toBe('/api/food/search')
    expect(url.searchParams.get('q')).toBe('nutella')
    expect(url.searchParams.get('category')).toBe('snacks')
    expect(url.searchParams.get('page')).toBe('2')
  })

  it('appends multi-value filters as repeated keys', async () => {
    await searchFoods({
      safe_for: ['diabetes', 'hypertension'],
      nutri_score: ['A', 'B'],
      nova_group: [1, 2],
    })
    const url = new URL(urlOf(0))
    expect(url.searchParams.getAll('safe_for')).toEqual(['diabetes', 'hypertension'])
    expect(url.searchParams.getAll('nutri_score')).toEqual(['A', 'B'])
    expect(url.searchParams.getAll('nova_group')).toEqual(['1', '2'])
  })

  it('sends min_score=0 (not omitted as falsy)', async () => {
    await searchFoods({ min_score: 0 })
    const url = new URL(urlOf(0))
    expect(url.searchParams.get('min_score')).toBe('0')
  })
})

describe('getFoodByBarcode', () => {
  it('encodes barcode in path', async () => {
    await getFoodByBarcode('3017620422003')
    expect(urlOf(0)).toBe('http://localhost:8000/api/food/barcode/3017620422003')
  })

  it('passes Authorization header when token provided', async () => {
    await getFoodByBarcode('x', { token: 'jwt-abc' })
    const headers = initOf(0).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer jwt-abc')
  })

  it('omits Authorization header when no token', async () => {
    await getFoodByBarcode('x')
    const headers = initOf(0).headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })
})

describe('getCategories', () => {
  it('unwraps the categories array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        categories: [{ slug: 'snacks', label: 'Snacks', icon: '🍿' }],
      }),
    } as Response)
    const result = await getCategories()
    expect(result).toEqual([{ slug: 'snacks', label: 'Snacks', icon: '🍿' }])
  })
})

describe('getProfile / updateProfile', () => {
  it('GETs /api/profile', async () => {
    await getProfile({ token: 't' })
    expect(urlOf(0)).toBe('http://localhost:8000/api/profile')
    const init = initOf(0)
    // request() sets default Content-Type but no method = GET
    expect(init.method).toBeUndefined()
  })

  it('PUTs /api/profile with health_conditions body', async () => {
    await updateProfile(['diabetes'], { token: 't' })
    const init = initOf(0)
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(JSON.stringify({ health_conditions: ['diabetes'] }))
  })
})

describe('getHistory / clearHistory', () => {
  it('unwraps the items array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    } as Response)
    const result = await getHistory({ token: 't' })
    expect(result).toEqual([])
  })

  it('DELETEs /api/history and tolerates 204', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => undefined,
    } as Response)
    await clearHistory({ token: 't' })
    const init = initOf(0)
    expect(init.method).toBe('DELETE')
  })
})

describe('error handling', () => {
  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)
    await expect(getProfile({ token: 't' })).rejects.toThrow('API 500 on /api/profile')
  })
})
