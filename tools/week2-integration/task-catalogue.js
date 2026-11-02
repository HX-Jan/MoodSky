// Opt-in server-side read adapter. No SDK initialization or production import.
const { LIMITS } = require('../../cloudfunctions/moodsky/shared/constants');
function createTaskCatalogueRepository(db) {
  if (!db || typeof db.collection !== 'function') {
    throw new TypeError('A server-owned database is required');
  }
  return {
    async listEnabled({ limit }) {
      if (limit !== LIMITS.taskSuggestions) {
        throw new TypeError('Task catalogue reads must use the shared suggestion limit');
      }
      const result = await db
        .collection('task_templates')
        .where({ enabled: true })
        .orderBy('_id', 'asc')
        .limit(limit)
        .field({
          _id: true,
          title: true,
          steps: true,
          durationMin: true,
          tags: true,
          enabled: true,
        })
        .get();
      return result.data;
    },
  };
}
module.exports = { createTaskCatalogueRepository };
