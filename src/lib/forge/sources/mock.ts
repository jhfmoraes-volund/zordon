import type { ForgeEvent } from "../types";
import type { ForgeSource } from "../source";
import { MOCK_SCRIPT, MS_PER_UNIT, stepToEvent } from "./mock-script";

export function createMockSource(): ForgeSource {
  const subscribers = new Set<(e: ForgeEvent) => void>();
  let speed = 1;
  let running = false;
  let paused = false;
  let cursor = 0;
  let seq = 0;
  let startedAt = 0;
  let pausedElapsed = 0;
  let raf: number | null = null;

  function emit(e: ForgeEvent) {
    for (const s of subscribers) s(e);
  }

  function tick() {
    raf = null;
    if (!running || paused) return;
    const elapsedScript =
      ((performance.now() - startedAt) * speed + pausedElapsed) / MS_PER_UNIT;
    while (cursor < MOCK_SCRIPT.length && MOCK_SCRIPT[cursor].at <= elapsedScript) {
      seq += 1;
      emit(stepToEvent(MOCK_SCRIPT[cursor], seq, Date.now()));
      cursor += 1;
    }
    if (cursor < MOCK_SCRIPT.length) {
      raf = requestAnimationFrame(tick);
    } else {
      running = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      paused = false;
      cursor = 0;
      seq = 0;
      pausedElapsed = 0;
      startedAt = performance.now();
      raf = requestAnimationFrame(tick);
    },
    pause() {
      if (!running || paused) return;
      paused = true;
      pausedElapsed += (performance.now() - startedAt) * speed;
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },
    resume() {
      if (!running || !paused) return;
      paused = false;
      startedAt = performance.now();
      raf = requestAnimationFrame(tick);
    },
    reset() {
      running = false;
      paused = false;
      cursor = 0;
      seq = 0;
      pausedElapsed = 0;
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },
    setSpeed(next) {
      if (running && !paused) {
        // freeze current elapsed in script units, restart timer with new speed
        pausedElapsed += (performance.now() - startedAt) * speed;
        startedAt = performance.now();
      }
      speed = Math.max(0.25, next);
    },
    isRunning() {
      return running && !paused;
    },
    onEvent(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
}
