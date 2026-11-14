/** Frame-driven scrolling, independent of refresh rate and subpixel scroll rounding. */
export function startAutoReading(options: {
  getPosition: () => number;
  getMaximum: () => number;
  setPosition: (position: number) => void;
  pixelsPerSecond: number;
  isPaused?: () => boolean;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (id: number) => void;
  onEnd: () => void;
}) {
  let position = options.getPosition();
  let previous: number | null = null;
  let endElapsed = 0;
  let stopped = false;
  let frame: number;
  const tick = (time: number) => {
    if (stopped) return;
    const elapsed = previous === null ? 0 : Math.min(64, Math.max(0, time - previous));
    previous = time;
    if (options.isPaused?.()) {
      position = options.getPosition();
      endElapsed = 0;
      frame = options.requestFrame(tick);
      return;
    }
    // Respect layout/translation anchoring without throwing away subpixel accumulation.
    if (Math.abs(options.getPosition() - position) > 2) position = options.getPosition();
    const maximum = Math.max(0, options.getMaximum());
    position = Math.min(maximum, position + options.pixelsPerSecond * elapsed / 1000);
    options.setPosition(position);
    // Give the last lines (and chapters shorter than a screen) time before advancing.
    endElapsed = position >= maximum ? endElapsed + elapsed : 0;
    if (endElapsed >= 1500) {
      stopped = true;
      options.onEnd();
      return;
    }
    frame = options.requestFrame(tick);
  };
  frame = options.requestFrame(tick);
  return () => { stopped = true; options.cancelFrame(frame); };
}

/** Wait a complete interval after every completed page turn; never overlap turns. */
export function startTimedReading(options: {
  intervalSeconds: number;
  isPaused: () => boolean;
  turnPage: () => Promise<boolean>;
  onEnd: () => void;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (id: number) => void;
}) {
  let stopped = false;
  let previous: number | null = null;
  let elapsed = 0;
  let frame: number;
  const tick = (time: number) => {
    if (stopped) return;
    const delta = previous === null ? 0 : Math.min(64, Math.max(0, time - previous));
    previous = time;
    if (options.isPaused()) elapsed = 0;
    else elapsed += delta;
    if (elapsed >= options.intervalSeconds * 1000) {
      elapsed = 0;
      options.turnPage().then(moved => {
        if (stopped) return;
        if (!moved) { stopped = true; options.onEnd(); return; }
        previous = null;
        frame = options.requestFrame(tick);
      }).catch(() => { if (!stopped) { stopped = true; options.onEnd(); } });
      return;
    }
    frame = options.requestFrame(tick);
  };
  frame = options.requestFrame(tick);
  return () => { stopped = true; options.cancelFrame(frame); };
}
