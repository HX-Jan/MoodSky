(function registerSessionBoundary(root) {
  function createSessionBoundary(client) {
    let scope = null;
    let principal = null;
    let sequence = 0;
    let disposed = false;
    const listeners = new Set();
    function invalidate() {
      sequence++;
      scope = null;
      principal = null;
      listeners.forEach((listener) => listener());
    }
    const unwatch =
      typeof client.watchSession === 'function' ? client.watchSession(invalidate) : null;
    return {
      capture: () => scope,
      isCurrent: (token) => !disposed && token !== null && token === scope,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      invalidate,
      async refresh() {
        if (disposed) {
          return null;
        }
        const token = ++sequence;
        let data;
        try {
          data = await client.session();
        } catch (_error) {
          if (token === sequence) {
            invalidate();
          }
          const error = new Error('UNAUTHENTICATED');
          error.code = 'UNAUTHENTICATED';
          throw error;
        }
        if (disposed || token !== sequence) {
          return null;
        }
        const id = data?.session && (data.user?.id || data.user?.uid);
        if (typeof id !== 'string' || !id) {
          invalidate();
          return null;
        }
        if (id !== principal) {
          principal = id;
          scope = Object.freeze({});
          listeners.forEach((listener) => listener());
        }
        return scope;
      },
      dispose() {
        invalidate();
        disposed = true;
        listeners.clear();
        if (typeof unwatch === 'function') {
          unwatch();
        }
      },
    };
  }
  root.MoodSkyAdminSession = Object.freeze({ createSessionBoundary });
})(globalThis);
