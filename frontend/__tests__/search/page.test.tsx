/**
 * /search page tests (TDD).
 *
 * The page reads filters/query from the URL via useSearchParams, fetches
 * results via the (mocked) lib/api.searchFoods, and renders results +
 * filter chips + filter panel + pagination.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import SearchPage from '@/app/search/page'
import type { ProductSummary, SearchResponse } from '@/lib/api'

// ---- next/navigation mocks ----
const mockPush = jest.fn()
let currentParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
  usePathname: () => '/search',
  useSearchParams: () => ({
    get: (k: string) => currentParams.get(k),
    getAll: (k: string) => currentParams.getAll(k),
    has: (k: string) => currentParams.has(k),
    toString: () => currentParams.toString(),
    entries: () => currentParams.entries(),
    forEach: (cb: (v: string, k: string) => void) => currentParams.forEach(cb),
    keys: () => currentParams.keys(),
    values: () => currentParams.values(),
    [Symbol.iterator]: () => currentParams[Symbol.iterator](),
  }),
}))

// ---- lib/api mock ----
jest.mock('@/lib/api', () => ({
  __esModule: true,
  searchFoods: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require('@/lib/api')

function makeProduct(i: number): ProductSummary {
  return {
    barcode: `barcode-${i}`,
    name: `Product ${i}`,
    brand: `Brand ${i}`,
    image_url: `https://img/${i}.jpg`,
    nutri_score: 'B',
    nova_group: 2,
    score: 70 + i,
  }
}

function mockSearchResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    products: [makeProduct(1), makeProduct(2), makeProduct(3)],
    total: 3,
    page: 1,
    ...overrides,
  }
}

beforeEach(() => {
  mockPush.mockReset()
  currentParams = new URLSearchParams()
  api.searchFoods.mockReset()
  api.searchFoods.mockResolvedValue(mockSearchResponse())
})

describe('/search page — initial render', () => {
  it('shows the search bar at the top', async () => {
    await act(async () => {
      render(<SearchPage />)
    })
    expect(screen.getByRole('search')).toBeInTheDocument()
  })

  it('fetches with the query param from the URL', async () => {
    currentParams = new URLSearchParams('q=nutella')
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(api.searchFoods).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'nutella', page: 1 }),
        expect.anything(),
      ),
    )
  })

  it('renders all returned products', async () => {
    currentParams = new URLSearchParams('q=p')
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument()
      expect(screen.getByText('Product 2')).toBeInTheDocument()
      expect(screen.getByText('Product 3')).toBeInTheDocument()
    })
  })

  it('shows the result count', async () => {
    currentParams = new URLSearchParams('q=p')
    api.searchFoods.mockResolvedValue(mockSearchResponse({ total: 142 }))
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() => expect(screen.getByText(/142 products/)).toBeInTheDocument())
  })

  it('shows a loading skeleton while fetching', async () => {
    currentParams = new URLSearchParams('q=p')
    let resolve!: (v: SearchResponse) => void
    api.searchFoods.mockImplementation(
      () => new Promise<SearchResponse>((r) => (resolve = r)),
    )
    await act(async () => {
      render(<SearchPage />)
    })
    expect(screen.getByTestId('results-skeleton')).toBeInTheDocument()
    await act(async () => {
      resolve(mockSearchResponse())
    })
    await waitFor(() =>
      expect(screen.queryByTestId('results-skeleton')).not.toBeInTheDocument(),
    )
  })
})

describe('/search page — empty + error states', () => {
  it('shows "No results" when products is empty', async () => {
    currentParams = new URLSearchParams('q=zzz')
    api.searchFoods.mockResolvedValue(
      mockSearchResponse({ products: [], total: 0 }),
    )
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() => expect(screen.getByText(/no results/i)).toBeInTheDocument())
  })

  it('shows an error banner when the fetch fails', async () => {
    currentParams = new URLSearchParams('q=p')
    api.searchFoods.mockRejectedValue(new Error('boom'))
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i),
    )
  })
})

describe('/search page — filters via URL', () => {
  it('fetches with all filters from the URL', async () => {
    currentParams = new URLSearchParams(
      'q=nutella&category=snacks&min_score=60&safe_for=diabetes&safe_for=hypertension&nutri_score=A&nutri_score=B&nova_group=1&nova_group=2&page=2',
    )
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(api.searchFoods).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'nutella',
          category: 'snacks',
          min_score: 60,
          safe_for: ['diabetes', 'hypertension'],
          nutri_score: ['A', 'B'],
          nova_group: [1, 2],
          page: 2,
        }),
        expect.anything(),
      ),
    )
  })

  it('renders FilterChips for active filters', async () => {
    currentParams = new URLSearchParams('category=snacks&min_score=60&safe_for=diabetes')
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() => {
      expect(screen.getByTestId('chip-category')).toHaveTextContent(/snacks/i)
      expect(screen.getByTestId('chip-min_score')).toHaveTextContent(/good\+/i)
      expect(screen.getByTestId('chip-safe_for-diabetes')).toHaveTextContent(
        /safe for diabetes/i,
      )
    })
  })

  it('toggling a checkbox in the panel pushes a new URL', async () => {
    currentParams = new URLSearchParams('q=p')
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(api.searchFoods).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'p' }),
        expect.anything(),
      ),
    )
    const user = userEvent.setup()
    const sidebar = screen.getByTestId('filter-panel-sidebar')
    await user.click(within(sidebar).getByRole('checkbox', { name: /safe for diabetes/i }))
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled()
    })
    const url = mockPush.mock.calls.at(-1)?.[0] as string
    expect(url).toMatch(/\/search\?/)
    expect(url).toContain('safe_for=diabetes')
    expect(url).toContain('q=p')
  })

  it('removing a chip pushes a URL without that param', async () => {
    currentParams = new URLSearchParams('q=p&safe_for=diabetes&safe_for=hypertension')
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(screen.getByTestId('chip-safe_for-diabetes')).toBeInTheDocument(),
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: /remove safe for diabetes/i }),
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const url = mockPush.mock.calls.at(-1)?.[0] as string
    expect(url).toContain('safe_for=hypertension')
    expect(url).not.toContain('safe_for=diabetes')
  })

  it('"Clear all" pushes a URL with only q preserved', async () => {
    currentParams = new URLSearchParams(
      'q=p&safe_for=diabetes&nutri_score=A&min_score=60',
    )
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() => expect(screen.getByText(/clear all/i)).toBeInTheDocument())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const url = mockPush.mock.calls.at(-1)?.[0] as string
    expect(url).toMatch(/\/search\?q=p$/)
  })
})

describe('/search page — pagination', () => {
  it('shows "Load more" when total > products.length', async () => {
    currentParams = new URLSearchParams('q=p')
    api.searchFoods.mockResolvedValue(mockSearchResponse({ total: 50 }))
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument(),
    )
  })

  it('clicking "Load more" pushes ?page=2', async () => {
    currentParams = new URLSearchParams('q=p')
    api.searchFoods.mockResolvedValue(mockSearchResponse({ total: 50 }))
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() => screen.getByRole('button', { name: /load more/i }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const url = mockPush.mock.calls.at(-1)?.[0] as string
    expect(url).toContain('page=2')
  })

  it('hides "Load more" when all results are loaded', async () => {
    currentParams = new URLSearchParams('q=p')
    api.searchFoods.mockResolvedValue(mockSearchResponse({ total: 3 }))
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument(),
    )
  })
})

describe('/search page — edge cases', () => {
  it('renders empty-state copy when no q AND no category', async () => {
    currentParams = new URLSearchParams()
    await act(async () => {
      render(<SearchPage />)
    })
    expect(api.searchFoods).not.toHaveBeenCalled()
    expect(
      screen.getByText(/start by searching or pick a category/i),
    ).toBeInTheDocument()
  })

  it('handles special chars in q (round-trips through searchFoods)', async () => {
    currentParams = new URLSearchParams('q=ben+%26+jerry')
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(api.searchFoods).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'ben & jerry' }),
        expect.anything(),
      ),
    )
  })

  it('handles a very long q without crashing (300 chars)', async () => {
    const long = 'x'.repeat(300)
    currentParams = new URLSearchParams({ q: long })
    await act(async () => {
      render(<SearchPage />)
    })
    await waitFor(() =>
      expect(api.searchFoods).toHaveBeenCalledWith(
        expect.objectContaining({ q: long }),
        expect.anything(),
      ),
    )
  })
})
