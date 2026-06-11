import { useRef, useCallback, useEffect } from 'react';
import type { RemoteInputEvent } from '../types/remote';

export const useRemoteControlReplay = (isActive: boolean) => {
  const capturedElementRef = useRef<Element | null>(null);

  const replayEvent = useCallback((event: RemoteInputEvent) => {
    if (!isActive) return;

    if (event.type === 'keydown' || event.type === 'keyup') {
      document.dispatchEvent(new KeyboardEvent(event.type, {
        bubbles: true, cancelable: true,
        key: event.key, code: event.code,
        ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
        altKey: event.altKey, metaKey: event.metaKey,
        repeat: event.repeat,
      }));
      return;
    }

    const pe = event as Extract<RemoteInputEvent, { nx: number }>;
    const cssX = pe.nx * window.innerWidth;
    const cssY = pe.ny * window.innerHeight;

    let target: Element | null;
    if ((event.type === 'pointermove' || event.type === 'pointerup') && capturedElementRef.current) {
      target = capturedElementRef.current;
    } else {
      target = document.elementFromPoint(cssX, cssY);
    }
    if (!target) return;

    if (event.type === 'pointerdown') {
      capturedElementRef.current = target;
    } else if (event.type === 'pointerup') {
      capturedElementRef.current = null;
    }

    // Patch setPointerCapture so synthetic events don't throw InvalidPointerId
    const origSet = Element.prototype.setPointerCapture;
    const origRelease = Element.prototype.releasePointerCapture;
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = pe as any;
      if (pe.type === 'wheel') {
        target.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true,
          clientX: cssX, clientY: cssY,
          deltaX: a.deltaX, deltaY: a.deltaY,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        }));
      } else if (pe.type === 'click' || pe.type === 'dblclick' || pe.type === 'contextmenu') {
        target.dispatchEvent(new MouseEvent(pe.type, {
          bubbles: true, cancelable: true,
          clientX: cssX, clientY: cssY,
          button: a.button,
        }));
      } else {
        target.dispatchEvent(new PointerEvent(pe.type, {
          bubbles: true, cancelable: true,
          clientX: cssX, clientY: cssY,
          button: a.button,
          buttons: a.buttons,
          pointerId: 999,
          isPrimary: true,
        }));
      }
    } finally {
      Element.prototype.setPointerCapture = origSet;
      Element.prototype.releasePointerCapture = origRelease;
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) capturedElementRef.current = null;
  }, [isActive]);

  return { replayEvent };
};
