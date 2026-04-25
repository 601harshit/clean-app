/**
 * /scan page test.
 *
 * The page is a thin client wrapper around <BarcodeScanner /> — its only
 * real job is to navigate to /food/<barcode> when the scanner emits a
 * decoded code. We mock the scanner so we can drive that callback
 * directly without touching the real @zxing reader.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ScanPage from '@/app/scan/page'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

let lastOnDecode: ((barcode: string) => void) | null = null
jest.mock('@/components/BarcodeScanner', () => ({
  BarcodeScanner: ({ onDecode }: { onDecode: (b: string) => void }) => {
    lastOnDecode = onDecode
    return (
      <button type="button" onClick={() => onDecode('5901234123457')}>
        mock-decode
      </button>
    )
  },
}))

beforeEach(() => {
  mockPush.mockReset()
  lastOnDecode = null
})

describe('ScanPage', () => {
  it('renders the page heading and helper copy', () => {
    render(<ScanPage />)
    expect(
      screen.getByRole('heading', { name: /scan a barcode/i }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: /search by name instead/i }),
    ).toHaveAttribute('href', '/')
  })

  it('navigates to /food/[barcode] when the scanner decodes a code', async () => {
    const user = userEvent.setup()
    render(<ScanPage />)
    await user.click(screen.getByRole('button', { name: /mock-decode/i }))
    expect(mockPush).toHaveBeenCalledWith('/food/5901234123457')
  })

  it('URL-encodes barcodes that contain unsafe path chars', () => {
    render(<ScanPage />)
    expect(lastOnDecode).not.toBeNull()
    lastOnDecode!('weird/barcode value')
    expect(mockPush).toHaveBeenCalledWith(
      '/food/weird%2Fbarcode%20value',
    )
  })

  it('ignores empty / whitespace-only decoded values', () => {
    render(<ScanPage />)
    expect(lastOnDecode).not.toBeNull()
    lastOnDecode!('   ')
    expect(mockPush).not.toHaveBeenCalled()
  })
})
