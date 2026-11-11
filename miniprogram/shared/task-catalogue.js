// Public product copy. The same activities are available in the offline demo.
const DEFAULT_TASKS = Object.freeze([
  {
    _id: 'moodsky_01_walk',
    title: '去散散心',
    steps: ['挑一个想走走的地方，给自己留几分钟。'],
    durationMin: 10,
    tags: ['户外', '散心'],
    enabled: true,
  },
  {
    _id: 'moodsky_02_read',
    title: '找个地方看会儿书',
    steps: ['带上一本书，选一个能安静读几页的地方。'],
    durationMin: 15,
    tags: ['校园阅读'],
    enabled: true,
  },
  {
    _id: 'moodsky_03_journal',
    title: '记录一下心情',
    steps: ['选一种天气。想多写一点时，可以加标签或留几句话。'],
    durationMin: 3,
    tags: ['记录心情'],
    enabled: true,
  },
]);

module.exports = { DEFAULT_TASKS };
