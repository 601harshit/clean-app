/**
 * SearchBar component tests (TDD).
 *
 * The SearchBar is a controlled input that:
 *   - submits on form submit (Enter key or button click)
 *   - navigates to `/search?q=<term>` via next/navigation router
 *   - trims whitespace; refuses to submit empty / whitespace-only queries
 *   - debounces an optional `onDebouncedChange` callback (used on the home
 *     page only, see spec §Implementation notes)
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SearchBar } from '@/components/SearchBar'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

beforeEach(() => {
  mockPush.mockReset()
  jest.useRealTimers()
})

describe('SearchBar', () => {
  it('renders an input with placeholder', () => {
    render(<SearchBar />)
    expect(
      screen.getByPlaceholderText(/search foods/i),
    ).toBeInTheDocument()
  })

  it('navigates to /search?q=<term> on submit', async () => {
    const user = userEvent.setup()
    render(<SearchBar />)
    const input = screen.getByRole('searchbox')
    await user.type(input, 'nutella')
    await user.keyboard('{Enter}')
    expect(mockPush).toHaveBeenCalledWith('/search?q=nutella')
  })

  it('submits via the search button click', async () => {
    const user = userEvent.setup()
    render(<SearchBar />)
    await user.type(screen.getByRole('searchbox'), 'oats')
    await user.click(screen.getByRole('button', { name: /search/i }))
    expect(mockPush).toHaveBeenCalledWith('/search?q=oats')
  })

  it('URL-encodes special characters', async () => {
    const user = userEvent.setup()
    render(<SearchBar />)
    await user.type(screen.getByRole('searchbox'), 'ben & jerry')
    await user.keyboard('{Enter}')
    // & must be encoded in the query string so it doesn't split params
    expect(mockPush).toHaveBeenCalledWith('/search?q=ben+%26+jerry')
  })

  it('trims whitespace before submitting', async () => {
    const user = userEvent.setup()
    render(<SearchBar />)
    await user.type(screen.getByRole('searchbox'), '   tea   ')
    await user.keyboard('{Enter}')
    expect(mockPush).toHaveBeenCalledWith('/search?q=tea')
  })

  it('does not submit when input is empty', async () => {
    const user = userEvent.setup()
    render(<SearchBar />)
    await user.click(screen.getByRole('button', { name: /search/i }))
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('does not submit when input is whitespace only', async () => {
    const user = userEvent.setup()
    render(<SearchBar />)
    await user.type(screen.getByRole('searchbox'), '     ')
    await user.keyboard('{Enter}')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('respects defaultValue and pre-fills the input', () => {
    render(<SearchBar defaultValue="yogurt" />)
    expect(screen.getByRole('searchbox')).toHaveValue('yogurt')
  })

  it('handles very long input (256+ chars) without crashing', async () => {
    const user = userEvent.setup()
    render(<SearchBar />)
    const longString = 'a'.repeat(300)
    await user.type(screen.getByRole('searchbox'), longString)
    await user.keyboard('{Enter}')
    expect(mockPush).toHaveBeenCalledTimes(1)
    const url = mockPush.mock.calls[0][0] as string
    expect(url.startsWith('/search?q=')).toBe(true)
  })

  it('debounces onDebouncedChange (home-page typeahead) when provided', async () => {
    jest.useFakeTimers()
    const onChange = jest.fn()
    render(<SearchBar onDebouncedChange={onChange} debounceMs={400} />)
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'n' } })
    fireEvent.change(input, { target: { value: 'nu' } })
    fireEvent.change(input, { target: { value: 'nutella' } })
    expect(onChange).not.toHaveBeenCalled()
    jest.advanceTimersByTime(399)
    expect(onChange).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('nutella'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
