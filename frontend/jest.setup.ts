import '@testing-library/jest-dom'

// jsdom doesn't implement PointerEvent, but @base-ui/react components
// (Checkbox, Radio, etc.) require it for click handlers. Polyfill with a
// minimal MouseEvent-based subclass — sufficient for unit-test interactions.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pointerType: string
    isPrimary: boolean
    width: number
    height: number
    pressure: number
    tangentialPressure: number
    tiltX: number
    tiltY: number
    twist: number
    altitudeAngle: number
    azimuthAngle: number

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? ''
      this.isPrimary = init.isPrimary ?? false
      this.width = init.width ?? 1
      this.height = init.height ?? 1
      this.pressure = init.pressure ?? 0
      this.tangentialPressure = init.tangentialPressure ?? 0
      this.tiltX = init.tiltX ?? 0
      this.tiltY = init.tiltY ?? 0
      this.twist = init.twist ?? 0
      this.altitudeAngle = init.altitudeAngle ?? 0
      this.azimuthAngle = init.azimuthAngle ?? 0
    }
  }
  // @ts-expect-error -- jsdom global polyfill
  globalThis.PointerEvent = PointerEventPolyfill
}

if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false
}
if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = () => undefined
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = () => undefined
}
