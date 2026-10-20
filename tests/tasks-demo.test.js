const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskDemoService } = require('../miniprogram/modules/tasks/demo');

test('task demo exposes three public suggestions and hides private history for guests', () => {
  const service = createTaskDemoService({ now: () => new Date('2026-10-15T08:00:00Z') });
  assert.equal(service.suggestions().length, 3);
  assert.equal(service.suggestions()[0].state, 'available');
  assert.deepEqual(service.snapshot().history, []);
  assert.throws(() => service.getHistory(), { code: 'UNAUTHENTICATED' });
  assert.throws(() => service.transition({ taskId: 'task_demo_001', action: 'select' }), {
    code: 'UNAUTHENTICATED',
  });
});

test('task demo supports select, complete, replace and skip with idempotent requests', () => {
  const service = createTaskDemoService({ now: () => new Date('2026-10-15T08:00:00Z') });
  service.setAuthenticated(true);
  const selected = service.transition({
    taskId: 'task_demo_001',
    action: 'select',
    requestId: 'task_req_001',
  });
  assert.equal(selected.state, 'selected');
  const repeated = service.transition({
    taskId: 'task_demo_001',
    action: 'select',
    requestId: 'task_req_001',
  });
  assert.equal(repeated.state, selected.state);
  assert.equal(repeated.entry.id, selected.entry.id);
  assert.equal(
    service.transition({ taskId: 'task_demo_001', action: 'complete' }).state,
    'completed',
  );
  assert.throws(() => service.transition({ taskId: 'task_demo_001', action: 'select' }), {
    code: 'INVALID_INPUT',
  });

  service.transition({ taskId: 'task_demo_002', action: 'select' });
  assert.equal(
    service.transition({ taskId: 'task_demo_002', action: 'replace' }).state,
    'replaced',
  );
  assert.equal(service.transition({ taskId: 'task_demo_002', action: 'select' }).state, 'selected');
  service.transition({ taskId: 'task_demo_003', action: 'select' });
  assert.equal(service.transition({ taskId: 'task_demo_003', action: 'skip' }).state, 'skipped');
  assert.ok(service.getHistory().length >= 6);
});

test('same request id cannot be reused with different task input', () => {
  const service = createTaskDemoService();
  service.setAuthenticated(true);
  service.transition({ taskId: 'task_demo_001', action: 'select', requestId: 'task_req_002' });
  assert.throws(
    () =>
      service.transition({ taskId: 'task_demo_002', action: 'select', requestId: 'task_req_002' }),
    { code: 'CONFLICT' },
  );
});
