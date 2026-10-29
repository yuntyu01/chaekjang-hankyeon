import { useCallback, useReducer, useRef } from 'react';
import { INITIAL_INTERACTION, reduceInteraction, type Drag } from './shelf-interaction';

export function useShelfInteraction() {
  const [state, dispatch] = useReducer(reduceInteraction, INITIAL_INTERACTION);
  // Gesture callbacks need the current drag before React's next commit.
  const dragRef = useRef<Drag | null>(null);
  const updateDrag = useCallback((drag: Drag | null) => {
    dragRef.current = drag;
    dispatch({ type: 'drag', drag });
  }, []);
  return {
    ...state, dragRef, updateDrag,
    openBook: useCallback((id: string) => dispatch({ type: 'open', id }), []),
    closeBook: useCallback(() => dispatch({ type: 'close' }), []),
    setEditing: useCallback((on: boolean) => {
      if (!on) dragRef.current = null;
      dispatch({ type: 'editing', on });
    }, []),
    setEditId: useCallback((id: string | null) => dispatch({ type: 'select', id }), []),
    setEditMsg: useCallback((text: string | null) => dispatch({ type: 'message', text }), []),
  };
}
