import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TapMarks } from '@/components/watch/TapMarks'
import { actionText, placeOnIosFrame } from '@/lib/watchActions'

// A2: a tap is drawn where the agent tapped, through the platform's placement; a swipe as its line.
describe('TapMarks', () => {
  it('places a tap through the given conversion, and draws a swipe from start to end', () => {
    const place = (x: number, y: number) => ({ left: 0.1 + x * 0.8, top: 0.05 + y * 0.9 })
    render(<TapMarks place={place} marks={[
      { id: 1, at: 0, action: { kind: 'tap', x: 0.5, y: 0.5 } },
      { id: 2, at: 0, action: { kind: 'swipe', from: [0.5, 1], to: [0.5, 0] } },
    ]} />)
    const tap = screen.getByTestId('tap-mark')
    expect(tap.style.left).toBe('50%')
    expect(tap.style.top).toBe('50%')
    const line = screen.getByTestId('swipe-mark').querySelector('line')!
    expect([line.getAttribute('y1'), line.getAttribute('y2')]).toEqual(['95%', '5%'])
    expect(screen.getByTestId('tap-marks').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('actionText', () => {
  it('says what happened without what was typed or opened', () => {
    expect(actionText({ kind: 'swipe', from: [0.5, 0.8], to: [0.5, 0.2] })).toBe('Swipe up')
    expect(actionText({ kind: 'type', chars: 1 })).toBe('Typed 1 character')
    expect(actionText({ kind: 'key', key: 'character' })).toBe('Key (a character)')
    expect(actionText({ kind: 'open-url' })).toBe('Opened a link')
  })
})

describe('placeOnIosFrame', () => {
  it('puts a screen point inside the screen\'s box in the frame, not the frame itself', () => {
    const place = placeOnIosFrame({ screenPctLeft: 5, screenPctTop: 2, screenPctW: 90, screenPctH: 96 })
    expect(place(0, 0)).toEqual({ left: 0.05, top: 0.02 })
    expect(place(1, 1)).toEqual({ left: 0.95, top: 0.98 })
    expect(place(0.5, 0.5)).toEqual({ left: 0.5, top: 0.5 })
  })
})
