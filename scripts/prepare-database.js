const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collections } = require('../database/collections.json');

const target = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-database-'));
const plan = { collections: [], indexes: [], clientRule: { read: false, write: false } };
for (const collection of collections) {
  plan.collections.push(collection.name);
  if (!collection.uniqueKeys.length && !collection.queryIndexes?.length) {
    continue;
  }
  const options = {
    CreateIndexes: [
      ...collection.uniqueKeys.map((keys) => ({
        IndexName: 'uniq_' + keys.join('_'),
        MgoKeySchema: {
          MgoIndexKeys: keys.map((name) => ({ Name: name, Direction: '1' })),
          MgoIsUnique: true,
        },
      })),
      ...(collection.queryIndexes || []).map((index) => ({
        IndexName: index.name,
        MgoKeySchema: {
          MgoIndexKeys: index.keys.map((key) => ({ Name: key.name, Direction: key.direction })),
          MgoIsUnique: false,
        },
      })),
    ],
  };
  const file = path.join(target, collection.name + '-indexes.json');
  fs.writeFileSync(file, JSON.stringify(options, null, 2) + '\n');
  plan.indexes.push({ collection: collection.name, optionsFile: file });
}
fs.writeFileSync(path.join(target, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
console.log('Database plan directory: ' + target);
console.log('This command prepares files only; apply collection permissions in the console.');
