import type { ForgeEvent } from "./types";

export type ForgeSource = {
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  setSpeed(speed: number): void;
  isRunning(): boolean;
  onEvent(cb: (e: ForgeEvent) => void): () => void;
};
