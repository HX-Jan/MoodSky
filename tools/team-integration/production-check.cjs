// Local verification only. Synthetic adapters; never imported by a cloud entry.
const assert = require('node:assert/strict');
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const { createProductionCleanup } = require('../../cloudfunctions/moodsky/production/cleanup');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../../cloudfunctions/moodsky/production/config');
const { databaseFixture } = require('../../tests/helpers/w2-database');
const { PLACES } = require('../../miniprogram/shared/campus-checkins');
const { WEATHER_TYPES } = require('../../miniprogram/shared/constants');
const START = '2026-11-05T15:59:59.000Z';

async function runProductionTeamCheck() {
  // Fixed public test keys only; no process environment or personal config is read.
  const config = readProductionConfig({
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  });
  const f = databaseFixture({});
  let clock = new Date(START),
    sequence = 0,
    blocked = false;
  const scopes = {},
    checks = [];
  async function call(who, action, payload = {}, requestId) {
    const entry = createProductionEntry({
      tasksWritesEnabled: true,
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID: 'synthetic_team_' + who,
        identityFromCurrentInvocation: true,
      }),
      readConfig: () => config,
      openDatabase: () => f.db,
      now: () => clock,
    });
    const result = await entry({
      apiVersion: '1',
      action,
      payload,
      requestId: requestId || 'req_production_team_' + ++sequence,
      ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
    });
    if (action === 'account.session' && result.ok) {
      scopes[who] = result.data.scope;
    }
    return result;
  }
  function success(response) {
    assert.equal(response.ok, true);
    return response.data;
  }
  function denied(response, code) {
    assert.equal(response.ok, false);
    assert.equal(response.error.code, code);
  }
  async function check(id, label, work) {
    if (blocked) {
      checks.push({ id, label, status: 'not_run' });
      return;
    }
    try {
      await work();
      checks.push({ id, label, status: 'passed' });
    } catch {
      blocked = true;
      checks.push({ id, label, status: 'failed' });
    }
  }
  let oldExport, original;
  const placeId = PLACES[0].placeId;
  await check('protocol', '当前装配协议与未登录拒绝', async () => {
    assert.equal(success(await call('a', 'system.health')).app, 'MoodSky');
    denied(await call('a', 'campus.checkins'), 'UNAUTHENTICATED');
  });
  await check('session', '合成可信身份与本人会话', async () => {
    success(await call('a', 'account.session'));
    success(await call('b', 'account.session'));
    assert.notEqual(scopes.a, scopes.b);
  });
  await check('journal', '七天气记录、回顾正文排除与删除一致', async () => {
    const date = '2026-11-05';
    assert.equal(WEATHER_TYPES.length, 7);
    for (const [index, { code: weather }] of WEATHER_TYPES.entries()) {
      const saved = success(
        await call('a', 'journal.upsert', {
          date,
          weather,
          text: 'SYNTHETIC_PRODUCTION_TEAM_BODY',
          expectedVersion: index,
          ...(weather === 'CUSTOM' ? { weatherName: '合成彩虹' } : {}),
        }),
      );
      assert.equal(saved.entry.weather, weather);
      assert.deepEqual(success(await call('a', 'journal.get', { date })).entry, saved.entry);
    }
    assert.equal(success(await call('b', 'journal.get', { date })).entry, null);
    const before = success(await call('a', 'review.calendar', { month: '2026-11' }));
    assert.equal(before.recordCount, 1);
    assert.doesNotMatch(JSON.stringify(before), /SYNTHETIC_PRODUCTION_TEAM_BODY/);
    success(await call('a', 'journal.delete', { date, expectedVersion: 7 }));
    assert.equal(success(await call('a', 'journal.get', { date })).entry, null);
    const after = success(await call('a', 'review.calendar', { month: '2026-11' }));
    assert.equal(after.recordCount, 0);
    assert.ok(after.sourceRevision > before.sourceRevision);
    oldExport = success(await call('a', 'account.requestExport', { format: 'json' }));
  });
  await check('manual', '无定位手动打卡、同日去重与跨日原请求', async () => {
    denied(await call('a', 'campus.checkIn', { placeId, latitude: 26 }), 'INVALID_INPUT');
    original = success(await call('a', 'campus.checkIn', { placeId }, 'req_production_original'));
    const duplicate = success(await call('a', 'campus.checkIn', { placeId }));
    assert.equal(duplicate.completedAt, original.completedAt);
    assert.equal(success(await call('a', 'campus.checkins')).items.length, 1);
    clock = new Date('2026-11-05T16:00:01.000Z');
    assert.deepEqual(
      success(await call('a', 'campus.checkIn', { placeId }, 'req_production_original')),
      { ...original, replayed: true },
    );
    assert.equal(success(await call('a', 'campus.checkins')).items.length, 0);
    assert.equal(success(await call('a', 'campus.checkIn', { placeId })).date, '2026-11-06');
  });
  await check('history', '本人当日与历史分页、账号隔离', async () => {
    assert.equal(success(await call('a', 'campus.checkins')).items.length, 1);
    const first = success(await call('a', 'campus.checkinHistory', { page: 1, pageSize: 1 }));
    const second = success(await call('a', 'campus.checkinHistory', { page: 2, pageSize: 1 }));
    assert.equal(first.total, 2);
    assert.equal(first.hasMore, true);
    assert.equal(second.hasMore, false);
    assert.deepEqual([first.items[0].date, second.items[0].date], ['2026-11-06', '2026-11-05']);
    assert.equal(success(await call('b', 'campus.checkinHistory')).total, 0);
  });
  await check('export', '打卡使旧导出失效并进入本人文件', async () => {
    denied(await call('a', 'account.downloadExport', { jobId: oldExport.jobId }), 'CONFLICT');
    const json = success(await call('a', 'account.requestExport', { format: 'json' }));
    const content = success(
      await call('a', 'account.downloadExport', { jobId: json.jobId }),
    ).content;
    const rows = JSON.parse(content).data.checkins;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.placeId === placeId));
    const md = success(await call('a', 'account.requestExport', { format: 'markdown' }));
    assert.match(
      success(await call('a', 'account.downloadExport', { jobId: md.jobId })).content,
      /地点打卡（2 条）/,
    );
  });
  await check('tasks', '任务新旧协议兼容、跨日恢复与本人写入', async () => {
    const taskId = 'synthetic_team_task';
    f.put('task_templates', {
      _id: taskId,
      enabled: true,
      title: '合成小任务',
      steps: ['合成步骤'],
      durationMin: 2,
      tags: [],
    });
    const legacy = { taskId, transition: 'select' };
    const dated = { taskId, transition: 'complete', expectedDate: '2026-11-06' };
    const oldRequestId = 'req_production_task_legacy';
    const datedRequestId = 'req_production_task_dated';
    const oldResult = success(await call('a', 'tasks.transition', legacy, oldRequestId));
    const datedResult = success(await call('a', 'tasks.transition', dated, datedRequestId));
    assert.equal(oldResult.date, dated.expectedDate);
    assert.equal(datedResult.date, dated.expectedDate);
    assert.equal(datedResult.state, 'completed');
    clock = new Date('2026-11-06T16:00:01.000Z');
    for (const [payload, id, result] of [
      [legacy, oldRequestId, oldResult],
      [dated, datedRequestId, datedResult],
    ]) {
      assert.deepEqual(success(await call('a', 'tasks.transition', payload, id)), {
        ...result,
        replayed: true,
      });
    }
    const before = f.inspect();
    denied(await call('a', 'tasks.transition', dated, 'req_production_task_unsent'), 'CONFLICT');
    assert.deepEqual(f.inspect(), before);
    const today = '2026-11-07';
    const fresh = success(await call('a', 'tasks.transition', { ...legacy, expectedDate: today }));
    assert.equal(fresh.date, today);
    const rows = Object.entries(f.inspect())
      .filter(([key]) => key.startsWith('task_history:'))
      .map(([, row]) => row);
    const owner = accountId(config, 'synthetic_team_a');
    assert.deepEqual(rows.map(({ ownerId, date, state }) => [ownerId, date, state]).sort(), [
      [owner, dated.expectedDate, 'completed'],
      [owner, today, 'selected'],
    ]);
  });
  await check('cleanup', '注销拒绝访问、清理本人打卡并保留B与公共资料', async () => {
    success(await call('b', 'campus.checkIn', { placeId }));
    const shared = { _id: 'synthetic_team_public', name: '合成公共资料' };
    f.put('places', shared);
    const closure = success(await call('a', 'account.close', { confirm: 'CLOSE' }));
    denied(await call('a', 'campus.checkIn', { placeId }), 'ACCOUNT_DISABLED');
    denied(await call('a', 'campus.checkinHistory'), 'ACCOUNT_DISABLED');
    const cleanup = createProductionCleanup({ db: f.db, now: () => clock });
    let result;
    for (let i = 0; i < 20; i++) {
      result = await cleanup.step(closure.cleanup.jobId);
      if (result.state === 'completed') {
        break;
      }
    }
    assert.equal(result.state, 'completed');
    const owner = accountId(config, 'synthetic_team_a');
    assert.equal(
      Object.values(f.inspect()).some((row) => row.ownerId === owner && row.placeId),
      false,
    );
    assert.equal(success(await call('b', 'campus.checkins')).items.length, 1);
    assert.deepEqual(f.inspect()['places:synthetic_team_public'], shared);
  });
  return {
    mode: 'LOCAL_SYNTHETIC_ONLY',
    assembly: 'PRODUCTION_ENTRY_WITH_SYNTHETIC_ADAPTERS',
    simulatedStart: START,
    status: blocked ? 'failed' : 'passed',
    checks,
    realWechatLogin: 'not_checked',
    realCloudAccess: 'not_checked',
    realDevice: 'not_checked',
    productionBusinessEnabled: false,
  };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== '--json')) {
    console.error('Usage: npm run team:check:production -- [--json]');
    process.exitCode = 2;
  } else {
    runProductionTeamCheck()
      .then((report) => {
        if (args.includes('--json')) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log('MoodSky 当前生产装配核对（仅本机合成适配器）');
          for (const row of report.checks) {
            console.log(
              { passed: '通过', failed: '失败', not_run: '前置失败，未执行' }[row.status] +
                ' | ' +
                row.label,
            );
          }
          console.log('真实微信登录、云和手机：未检查；内存数据退出后清空。');
        }
        if (report.status !== 'passed') {
          process.exitCode = 1;
        }
      })
      .catch(() => {
        console.error('本地核对未完成，请确认源码、依赖和共享契约已准备。');
        process.exitCode = 1;
      });
  }
}
module.exports = { runProductionTeamCheck };
