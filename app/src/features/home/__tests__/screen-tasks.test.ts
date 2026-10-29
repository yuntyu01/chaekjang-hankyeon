import { createScreenTasks } from '../useScreenTasks';

afterEach(() => jest.useRealTimers());
test('a later focus request replaces the old book and navigation cancels pending UI work', () => {
  jest.useFakeTimers();
  const tasks = createScreenTasks();
  const open = jest.fn();
  tasks.later('focus', () => open('old'), 450);
  tasks.later('focus', () => open('new'), 450);
  jest.advanceTimersByTime(450);
  expect(open.mock.calls).toEqual([['new']]);
  tasks.later('focus', () => open('after navigation'), 450);
  tasks.dispose();
  tasks.later('late-measurement', () => open('after unmount'), 0);
  jest.runAllTimers();
  expect(open.mock.calls).toEqual([['new']]);
});
