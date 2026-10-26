// Test-only transactional repository. No SDK, network, filesystem or platform identity.
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
function createMemoryJournalRepository() {
  const accounts = new Map();
  const queues = new Map();
  const empty = () => ({ days: {}, receipts: {}, revision: 0 });
  const state = (ownerId) => accounts.get(ownerId) || empty();
  function transact(ownerId, work) {
    const previous = queues.get(ownerId) || Promise.resolve();
    const pending = previous.then(async () => {
      const draft = clone(state(ownerId));
      const tx = {
        getDay: async (date) => clone(draft.days[date]),
        setDay: async (date, value) => {
          draft.days[date] = clone(value);
        },
        getReceipt: async (action, id) => clone(draft.receipts[action + ':' + id]),
        setReceipt: async (action, id, value) => {
          draft.receipts[action + ':' + id] = clone(value);
        },
        advanceRevision: async () => {
          draft.revision += 1;
          draft.exportEpoch = (draft.exportEpoch || 0) + 1;
        },
        touchAccount: async () => {
          draft.operationFence = (draft.operationFence || 0) + 1;
        },
        invalidateExports: async () => {
          draft.exportEpoch = (draft.exportEpoch || 0) + 1;
        },
        writeDeletionMarker: async (marker) => {
          if (!draft.deletionMarkers) {
            draft.deletionMarkers = {};
          }
          if (draft.deletionMarkers[marker.entryId + ':' + marker.deletedVersion]) {
            throw new Error('Existing deletion ledger event');
          }
          draft.deletionMarkers[marker.entryId + ':' + marker.deletedVersion] = clone(marker);
        },
        getDecorations: async (month) => clone(draft.decorations && draft.decorations[month]),
        setDecorations: async (month, doc) => {
          if (!draft.decorations) {
            draft.decorations = {};
          }
          draft.decorations[month] = clone(doc);
        },
        listMonthMarks: async (month) =>
          Object.values(draft.days)
            .filter((day) => day.entry && day.entry.date.startsWith(month + '-'))
            .map(({ entry }) => {
              const mark = { id: entry.id, date: entry.date, weather: entry.weather };
              if (entry.weather === 'CUSTOM' && typeof entry.customName === 'string') {
                mark.customName = entry.customName;
              }
              return mark;
            }),
      };
      const result = await work(tx);
      accounts.set(ownerId, draft);
      return clone(result);
    });
    const settled = pending.catch(() => {});
    queues.set(ownerId, settled);
    settled.then(() => {
      if (queues.get(ownerId) === settled) {
        queues.delete(ownerId);
      }
    });
    return pending;
  }
  return {
    transact,
    readDay: async (ownerId, date) => clone(state(ownerId).days[date]),
    async readSnapshot(ownerId, { startDate, endDate }) {
      const current = state(ownerId);
      return {
        revision: current.revision,
        entries: Object.values(current.days)
          .filter((day) => day.entry && day.entry.date >= startDate && day.entry.date <= endDate)
          .map(({ entry }) => {
            const mark = { id: entry.id, date: entry.date, weather: entry.weather };
            if (entry.weather === 'CUSTOM' && typeof entry.customName === 'string') {
              mark.customName = entry.customName;
            }
            return mark;
          }),
      };
    },
    inspect: (ownerId) => clone(state(ownerId)),
  };
}
module.exports = { createMemoryJournalRepository };
