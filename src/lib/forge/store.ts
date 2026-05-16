import { applyEvent } from "./reducer";
import { EMPTY_STATE, type ForgeEvent, type ForgeState } from "./types";

type Listener = () => void;

export type ForgeStore = {
  getState: () => ForgeState;
  subscribe: (fn: Listener) => () => void;
  dispatch: (e: ForgeEvent) => void;
  reset: () => void;
};

export function createForgeStore(): ForgeStore {
  let state: ForgeState = EMPTY_STATE;
  const listeners = new Set<Listener>();
  const buffer: ForgeEvent[] = [];
  let pending: ForgeEvent[] = [];
  let raf: number | null = null;

  function flush() {
    raf = null;
    if (pending.length === 0) return;
    let next = state;
    for (const e of pending) {
      buffer.push(e);
    }
    pending = [];

    // try to drain in order from buffer
    let progressed = true;
    while (progressed) {
      progressed = false;
      buffer.sort((a, b) => a.seq - b.seq);
      for (let i = 0; i < buffer.length; i++) {
        const e = buffer[i];
        if (e.seq === next.lastSeq + 1) {
          next = applyEvent(next, e);
          buffer.splice(i, 1);
          progressed = true;
          break;
        }
        if (e.seq <= next.lastSeq) {
          buffer.splice(i, 1);
          progressed = true;
          break;
        }
      }
    }

    if (next !== state) {
      state = next;
      for (const l of listeners) l();
    }
  }

  function schedule() {
    if (raf !== null) return;
    if (typeof requestAnimationFrame === "function") {
      raf = requestAnimationFrame(flush);
    } else {
      raf = setTimeout(flush, 16) as unknown as number;
    }
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispatch(e) {
      pending.push(e);
      schedule();
    },
    reset() {
      if (raf !== null) {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
        else clearTimeout(raf as unknown as ReturnType<typeof setTimeout>);
        raf = null;
      }
      buffer.length = 0;
      pending = [];
      state = EMPTY_STATE;
      for (const l of listeners) l();
    },
  };
}
