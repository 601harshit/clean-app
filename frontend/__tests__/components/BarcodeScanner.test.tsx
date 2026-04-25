/**
 * BarcodeScanner component tests.
 *
 * jsdom has no MediaDevices and the @zxing/browser reader expects a
 * real camera, so we mock both:
 *   - `navigator.mediaDevices.getUserMedia` returns a fake stream.
 *   - `BrowserMultiFormatReader.prototype.decodeFromVideoDevice` is
 *     replaced per-test to either resolve with a stoppable controls
 *     handle, simulate a successful decode, or reject with the
 *     browser-shaped permission-denied error.
 *
 * Coverage:
 *   - render (idle preview + Start button)
 *   - permission denied -> visible error message + retry path
 *   - successful decode -> onDecode called with the text
 *   - unmount -> reader's controls.stop() invoked (cleanup)
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BarcodeScanner } from '@/components/BarcodeScanner'

type DecodeCb = (
  result: { getText: () => string } | undefined,
  err: Error | undefined,
  controls: { stop: () => void },
) => void

const decodeFromVideoDevice = jest.fn()

jest.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: jest.fn().mockImplementation(() => ({
    decodeFromVideoDevice: (
      _deviceId: string | undefined,
      _video: HTMLVideoElement,
      cb: DecodeCb,
    ) => decodeFromVideoDevice(_deviceId, _video, cb),
  })),
}))

beforeAll(() => {
  // jsdom has no mediaDevices; install a minimal stub so any code that
  // touches navigator.mediaDevices doesn't blow up. Tests that care
  // about getUserMedia override it directly.
  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue({
        getTracks: () => [{ stop: jest.fn() }],
      }),
    },
  })
})

beforeEach(() => {
  decodeFromVideoDevice.mockReset()
})

describe('BarcodeScanner', () => {
  it('renders the idle preview and a Start scanning button', () => {
    render(<BarcodeScanner onDecode={jest.fn()} />)
    expect(screen.getByTestId('barcode-scanner-video')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /start scanning/i }),
    ).toBeInTheDocument()
  })

  it('invokes onDecode and stops the reader when a barcode is decoded', async () => {
    const stop = jest.fn()
    let capturedCb: DecodeCb | null = null
    decodeFromVideoDevice.mockImplementation(
      (_d: unknown, _v: unknown, cb: DecodeCb) => {
        capturedCb = cb
        return Promise.resolve({ stop })
      },
    )
    const onDecode = jest.fn()
    const user = userEvent.setup()
    render(<BarcodeScanner onDecode={onDecode} />)
    await user.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /stop scanning/i }),
      ).toBeInTheDocument(),
    )
    // Simulate a successful decode coming from the @zxing callback.
    const callbackControls = { stop: jest.fn() }
    expect(capturedCb).not.toBeNull()
    act(() => {
      capturedCb!(
        { getText: () => '0123456789012' },
        undefined,
        callbackControls,
      )
    })
    expect(onDecode).toHaveBeenCalledWith('0123456789012')
    expect(onDecode).toHaveBeenCalledTimes(1)
    // Either the cached controls.stop or the per-callback controls.stop
    // should have been invoked to release the camera.
    expect(stop.mock.calls.length + callbackControls.stop.mock.calls.length)
      .toBeGreaterThan(0)
  })

  it('does not call onDecode more than once for repeated callback fires', async () => {
    const stop = jest.fn()
    let capturedCb: DecodeCb | null = null
    decodeFromVideoDevice.mockImplementation(
      (_d: unknown, _v: unknown, cb: DecodeCb) => {
        capturedCb = cb
        return Promise.resolve({ stop })
      },
    )
    const onDecode = jest.fn()
    const user = userEvent.setup()
    render(<BarcodeScanner onDecode={onDecode} />)
    await user.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => expect(capturedCb).not.toBeNull())
    const ctrl = { stop: jest.fn() }
    act(() => {
      capturedCb!({ getText: () => '111' }, undefined, ctrl)
      capturedCb!({ getText: () => '222' }, undefined, ctrl)
    })
    expect(onDecode).toHaveBeenCalledTimes(1)
    expect(onDecode).toHaveBeenCalledWith('111')
  })

  it('shows a permission-denied error message when the browser blocks the camera', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    decodeFromVideoDevice.mockRejectedValue(denied)
    const user = userEvent.setup()
    render(<BarcodeScanner onDecode={jest.fn()} />)
    await user.click(screen.getByRole('button', { name: /start scanning/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/camera permission was denied/i)
    // The CTA should flip to "Try again" so the user can retry.
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument()
  })

  it('shows a generic camera error when no camera is available', async () => {
    const notFound = Object.assign(new Error('no cam'), { name: 'NotFoundError' })
    decodeFromVideoDevice.mockRejectedValue(notFound)
    const user = userEvent.setup()
    render(<BarcodeScanner onDecode={jest.fn()} />)
    await user.click(screen.getByRole('button', { name: /start scanning/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no camera was found/i)
  })

  it('calls controls.stop() on unmount to release the camera', async () => {
    const stop = jest.fn()
    decodeFromVideoDevice.mockImplementation(() =>
      Promise.resolve({ stop }),
    )
    const user = userEvent.setup()
    const { unmount } = render(<BarcodeScanner onDecode={jest.fn()} />)
    await user.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /stop scanning/i }),
      ).toBeInTheDocument(),
    )
    unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('auto-starts when the autoStart prop is true', async () => {
    const stop = jest.fn()
    decodeFromVideoDevice.mockImplementation(() =>
      Promise.resolve({ stop }),
    )
    render(<BarcodeScanner onDecode={jest.fn()} autoStart />)
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled())
  })

  it('clicking Stop scanning tears down the reader and returns to idle', async () => {
    const stop = jest.fn()
    decodeFromVideoDevice.mockImplementation(() =>
      Promise.resolve({ stop }),
    )
    const user = userEvent.setup()
    render(<BarcodeScanner onDecode={jest.fn()} />)
    await user.click(screen.getByRole('button', { name: /start scanning/i }))
    const stopBtn = await screen.findByRole('button', {
      name: /stop scanning/i,
    })
    await user.click(stopBtn)
    expect(stop).toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /start scanning/i }),
    ).toBeInTheDocument()
  })
})
