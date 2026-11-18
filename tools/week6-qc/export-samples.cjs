// Export only synthetic inputs/results; never export session or account identities.
const fs = require('node:fs/promises');
const path = require('node:path');
const prettier = require('prettier');
const { withLocalWorld } = require('./local-world.cjs');
const { DEFAULT_TASKS } = require('../../miniprogram/shared/task-catalogue');

async function main() {
  const output = process.argv[2];
  if (!output || !path.isAbsolute(output)) {
    throw new Error('Provide an absolute sample output path');
  }
  const samples = [];
  const history = { from: '2026-11-18', to: '2026-11-18' };
  for (const transition of ['complete', 'replace', 'skip', 'readOnly']) {
    await withLocalWorld(async (w) => {
      await w.login();
      const steps = [];
      const send = async (action, payload = {}) => {
        const input = w.request(action, payload);
        const response = await w.raw(input);
        steps.push({ input, response });
      };
      if (transition === 'readOnly') {
        w.taskWrites = false;
      }
      await send('tasks.mine');
      const payload = { taskId: DEFAULT_TASKS[0]._id, expectedDate: '2026-11-18' };
      await send('tasks.transition', { ...payload, transition: 'select' });
      if (transition !== 'readOnly') {
        await send('tasks.transition', { ...payload, transition });
      }
      await send('tasks.history', history);
      // B has an independently issued synthetic session, without A's task history.
      w.who = 'b';
      await w.login();
      await send('tasks.history', history);
      samples.push({ scenario: transition, lastReadAs: 'synthetic B', steps });
    });
  }
  const result = {
    task: 'W6-QC',
    layer: 'LOCAL_PRODUCTION_ENTRY_OFFLINE_SDK',
    clock: '2026-11-18T04:00:00.000Z',
    templates: 'Synthetic task_templates seeded from shared DEFAULT_TASKS; not live templates',
    redactedFields: ['ownerId', '_id', 'scope', 'sessionScope'],
    realCloud: false,
    samples,
  };
  const json = JSON.stringify(
    result,
    (key, value) => (result.redactedFields.includes(key) ? undefined : value),
    2,
  );
  await fs.writeFile(output, await prettier.format(json, { parser: 'json' }));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
