// Entirely synthetic snapshot, never imported by the production cloud entry.
function syntheticSnapshot() {
  const ownerId = 'synthetic_export_owner';
  const timestamp = '2026-10-18T00:00:00.000Z';
  return {
    ownerId,
    accountStatus: 'active',
    sourceRevision: 3,
    campusId: 'synthetic_campus',
    journals: [
      {
        ownerId,
        id: 'synthetic_journal_2',
        date: '2026-10-18',
        weather: 'SUNNY',
        tags: ['REST'],
        text: 'SIMULATED · 今天的合成记录。',
        version: 1,
        state: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        ownerId,
        id: 'synthetic_journal_1',
        date: '2026-10-17',
        weather: 'CLOUDY',
        tags: [],
        text: '',
        version: 2,
        state: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { ownerId, id: 'synthetic_deleted', date: '2026-10-16', state: 'deleted', version: 2 },
    ],
    favorites: [
      {
        ownerId,
        placeId: 'synthetic_place',
        placeName: 'SIMULATED · 合成地点',
        createdAt: timestamp,
      },
    ],
    taskHistory: [
      {
        ownerId,
        taskId: 'synthetic_task',
        taskTitle: 'SIMULATED · 自主休息建议',
        date: '2026-10-18',
        state: 'completed',
        createdAt: timestamp,
      },
    ],
    preferences: {
      ownerId,
      cardTextPreview: false,
      decorationsEnabled: true,
      updatedAt: timestamp,
    },
    monthDecorations: [
      {
        ownerId,
        month: '2026-10',
        version: 1,
        stickers: [
          { stickerId: 'synthetic_sticker', targetEntryId: 'synthetic_journal_2' },
          { stickerId: 'synthetic_sticker', targetEntryId: 'synthetic_deleted' },
        ],
        backgroundId: 'synthetic_background',
      },
    ],
  };
}
module.exports = { syntheticSnapshot };
