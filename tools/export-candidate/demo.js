const { formatExport } = require('./formatter');
const { syntheticSnapshot } = require('./fixture');
const format = process.argv[2];
if (!['json', 'markdown'].includes(format)) {
  console.error('Usage: node tools/export-candidate/demo.js json|markdown');
  process.exitCode = 1;
} else {
  const snapshot = syntheticSnapshot();
  const result = formatExport(snapshot, {
    format,
    accountId: snapshot.ownerId,
    exportedAt: '2026-10-18T01:00:00.000Z',
    maxRecords: 100,
    maxBytes: 1048576,
  });
  process.stdout.write(result.content);
}
