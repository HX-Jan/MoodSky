// In-memory account binding only; never an owner ID or a bearer credential.
function createSessionState() {
  let current = null;
  let generation = 0;
  const listeners = new Set();
  return {
    capture: () => current,
    isCurrent: (value) => value !== null && value === current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    accept(scope) {
      if (typeof scope !== 'string' || !/^scope_[a-f0-9]{64}$/.test(scope)) {
        throw new TypeError('Invalid account binding.');
      }
      if (current?.scope === scope) {
        return current;
      }
      current = Object.freeze({ scope, generation: ++generation });
      listeners.forEach((listener) => listener());
      return current;
    },
    clear() {
      if (current === null) {
        return;
      }
      current = null;
      generation++;
      listeners.forEach((listener) => listener());
    },
  };
}
module.exports = { createSessionState, cloudSessionState: createSessionState() };
