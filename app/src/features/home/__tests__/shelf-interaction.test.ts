import { INITIAL_INTERACTION, reduceInteraction, type Drag } from '../shelf-interaction';
const drag: Drag = { bookId: 'a', shelfId: 's', preview: null, startVx: 0, startCenterDU: 10, widthDU: 5, members: ['a'], hold: { sig: '', at: 10 } };

test('starting drag closes details and selects the dragged book for editing', () => {
  const opened = reduceInteraction(INITIAL_INTERACTION, { type: 'open', id: 'b' });
  const moving = reduceInteraction(opened, { type: 'drag', drag });
  expect(moving).toMatchObject({ bookId: null, editId: 'a', editing: true, drag });
  expect(reduceInteraction(moving, { type: 'open', id: 'b' })).toBe(moving);
});
test('canceling a drag retains edit selection; exiting clears transient interaction', () => {
  const moving = reduceInteraction(INITIAL_INTERACTION, { type: 'drag', drag });
  expect(reduceInteraction(moving, { type: 'drag', drag: null })).toMatchObject({ drag: null, editing: true, editId: 'a' });
  expect(reduceInteraction(moving, { type: 'editing', on: false })).toEqual(INITIAL_INTERACTION);
});
test('accessibility activation during editing changes selection without opening details', () => {
  const editing = reduceInteraction(INITIAL_INTERACTION, { type: 'editing', on: true });
  expect(reduceInteraction(editing, { type: 'open', id: 'a' })).toMatchObject({ bookId: null, editId: 'a', editing: true });
});
