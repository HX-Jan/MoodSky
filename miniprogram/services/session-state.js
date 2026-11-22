// Account scope and optional signed phone credential are cleared together.
function createSessionState() {
  let current = null;
  let generation = 0;
  const listeners = new Set();
  return {
    capture: () => current,
    getGeneration: () => generation,
    isCurrent: (value) => value !== null && value === current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    accept(scope, phoneSession) {
      if (typeof scope !== 'string' || !/^scope_[a-f0-9]{64}$/.test(scope)) {
        throw new TypeError('Invalid account binding.');
      }
      if (current?.scope === scope && current?.phoneSession === phoneSession) {
        return current;
      }
      current = Object.freeze({
        scope,
        generation: ++generation,
        ...(phoneSession ? { phoneSession } : {}),
      });
      listeners.forEach((listener) => listener());
      return current;
    },
    clear() {
      // Also cancel authentication started while no binding existed. Views only
      // need a notification when an established identity actually disappears.
      generation++;
      if (current === null) {
        return;
      }
      current = null;
      listeners.forEach((listener) => listener());
    },
  };
}
module.exports = { createSessionState, cloudSessionState: createSessionState() };
