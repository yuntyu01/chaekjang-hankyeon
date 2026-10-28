import { createPreviewFrame } from '../preview-frame';

describe('slider preview frames', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextId: number;
  const flush = () => {
    const current = [...callbacks.values()];
    callbacks.clear();
    current.forEach((run) => run(0));
  };

  beforeEach(() => {
    callbacks = new Map();
    nextId = 0;
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { if (id != null) callbacks.delete(id); });
  });
  afterEach(() => jest.restoreAllMocks());

  it('only applies the most recent drag position each frame', () => {
    const preview = createPreviewFrame();
    const apply = jest.fn();
    preview.schedule(() => apply(10));
    preview.schedule(() => apply(20));
    expect(callbacks.size).toBe(1);
    flush();
    expect(apply.mock.calls).toEqual([[20]]);
    expect(preview.pending).toBe(false);
  });

  it('cancels a drag before its first preview runs', () => {
    const preview = createPreviewFrame();
    const apply = jest.fn();
    preview.schedule(apply);
    expect(preview.pending).toBe(true);
    preview.cancel();
    flush();
    expect(apply).not.toHaveBeenCalled();
    expect(preview.pending).toBe(false);
  });

  it('cannot replay the previous book preview after cancellation', () => {
    const preview = createPreviewFrame();
    const oldBook = jest.fn();
    const newBook = jest.fn();
    preview.schedule(oldBook);
    preview.cancel();
    preview.schedule(newBook);
    flush();
    expect(oldBook).not.toHaveBeenCalled();
    expect(newBook).toHaveBeenCalledTimes(1);
  });
});
