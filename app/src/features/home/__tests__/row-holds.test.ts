import { createRowHolds } from '../row-holds';

describe('temporary shelf residency', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps a book through a second drag until its latest release', () => {
    const holds = createRowHolds(() => [], () => 100);
    holds.holdRows(['book'], ['first']);
    holds.releaseLater(['book']);
    jest.advanceTimersByTime(50);
    holds.holdRows(['book'], ['second']);
    jest.advanceTimersByTime(100);
    expect(holds.getSnapshot()).toEqual({ book: ['first', 'second'] });
    holds.releaseLater(['book']);
    jest.advanceTimersByTime(100);
    expect(holds.getSnapshot()).toEqual({});
    expect(jest.getTimerCount()).toBe(0);
  });

  it('releases stack members separately and never evicts an active drag', () => {
    let busy = ['top'];
    const holds = createRowHolds(() => busy, () => 100);
    holds.holdRows(['base', 'top'], ['first']);
    holds.releaseLater(['base', 'top']);
    jest.advanceTimersByTime(100);
    expect(holds.getSnapshot()).toEqual({ top: ['first'] });
    busy = [];
    holds.releaseLater(['top']);
    jest.advanceTimersByTime(100);
    expect(holds.getSnapshot()).toEqual({});
  });

  it('cancels release callbacks when its screen unmounts', () => {
    const holds = createRowHolds(() => [], () => 100);
    holds.holdRows(['book'], ['first']);
    const listener = jest.fn();
    holds.subscribe(listener);
    holds.releaseLater(['book']);
    holds.cancelTimers();
    jest.runAllTimers();
    expect(listener).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
