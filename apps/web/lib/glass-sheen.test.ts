import { expect, it, vi } from 'vitest';
import { attachSheen } from './glass-sheen';

function fakeDock() {
  return {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ left: 100, top: 40 })),
    querySelectorAll: vi.fn(() => [] as ReturnType<typeof fakeButton>[]),
    style: { setProperty: vi.fn() },
  };
}
function fakeButton() {
  return { getBoundingClientRect: () => ({ left: 130, top: 60 }), style: { setProperty: vi.fn() } };
}
it('translates dock coordinates into button coordinates, including wrapped buttons', () => {
  const dock = fakeDock(), button = fakeButton();
  dock.querySelectorAll.mockReturnValue([button]);
  attachSheen(dock as unknown as HTMLElement);
  dock.addEventListener.mock.calls[0][1]({ clientX: 145, clientY: 67 });
  expect(button.style.setProperty).toHaveBeenCalledWith('--mx', '15px');
  expect(button.style.setProperty).toHaveBeenCalledWith('--my', '7px');
});
it('registers one pointer listener, uses dock coordinates, and detaches it', () => {
  const dock = fakeDock();
  const detach = attachSheen(dock as unknown as HTMLElement);
  expect(dock.addEventListener).toHaveBeenCalledTimes(1);
  const [type, listener] = dock.addEventListener.mock.calls[0];
  expect(type).toBe('pointermove');
  listener({ clientX: 145, clientY: 67 });
  expect(dock.style.setProperty).toHaveBeenCalledWith('--mx', '45px');
  expect(dock.style.setProperty).toHaveBeenCalledWith('--my', '27px');
  detach();
  expect(dock.removeEventListener).toHaveBeenCalledExactlyOnceWith('pointermove', listener);
});
it('does not attach or update styles when motion is reduced', () => {
  const dock = fakeDock();
  attachSheen(dock as unknown as HTMLElement, { reducedMotion: true })();
  expect(dock.addEventListener).not.toHaveBeenCalled();
  expect(dock.removeEventListener).not.toHaveBeenCalled();
  expect(dock.style.setProperty).not.toHaveBeenCalled();
});
