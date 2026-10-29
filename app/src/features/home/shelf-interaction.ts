import type { FailReason, SwapTarget } from '@/domain/layout-engine';
import type { FallDirections } from '@/domain/shelf-scene';
import type { ShelfLayout } from '@/domain/types';
import type { Hold } from '@/ui/shelf/preview-hold';

type HintKind = SwapTarget['kind'] | 'beside';
export type Preview =
  | { kind: 'ok'; layout: ShelfLayout; falls: FallDirections; key: string; shelfId: string; hint: HintKind; index?: number; push?: string }
  | { kind: 'same'; key: string; shelfId: string; hint: HintKind; index?: number }
  | { kind: 'bad'; reason: FailReason | 'outside'; key: string; shelfId: string | null; index?: number };
export type Drag = {
  bookId: string; shelfId: string; preview: Preview | null;
  startVx: number; startCenterDU: number; widthDU: number;
  members: string[]; hold: Hold;
};
export type ShelfInteraction = {
  drag: Drag | null;
  bookId: string | null;
  editId: string | null;
  editing: boolean;
  message: string | null;
};
export const INITIAL_INTERACTION: ShelfInteraction = { drag: null, bookId: null, editId: null, editing: false, message: null };
export type InteractionAction =
  | { type: 'open'; id: string }
  | { type: 'close' }
  | { type: 'editing'; on: boolean }
  | { type: 'select'; id: string | null }
  | { type: 'message'; text: string | null }
  | { type: 'drag'; drag: Drag | null };

export function reduceInteraction(state: ShelfInteraction, action: InteractionAction): ShelfInteraction {
  switch (action.type) {
    case 'open':
      if (state.drag) return state;
      return state.editing ? { ...state, editId: action.id, message: null } : { ...state, bookId: action.id };
    case 'close': return { ...state, bookId: null };
    case 'editing': return { ...state, drag: action.on ? state.drag : null, editing: action.on, bookId: null, editId: action.on ? state.editId : null, message: null };
    case 'select': return { ...state, bookId: null, editId: action.id, message: null };
    case 'message': return { ...state, message: action.text };
    case 'drag': return action.drag
      ? { ...state, drag: action.drag, bookId: null, editing: true, editId: action.drag.bookId, message: null }
      : { ...state, drag: null };
  }
}
