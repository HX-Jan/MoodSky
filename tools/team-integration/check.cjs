const assert = require('node:assert/strict');
const { createLocalTeamBackend, SIMULATED_NOW } = require('./local-backend.cjs');
const { WEATHER_TYPES } = require('../../miniprogram/shared/constants');

async function runTeamCheck() {
  const backend = createLocalTeamBackend();
  const checks = [];
  const success = (response) => {
    assert.equal(response.ok, true);
    return response.data;
  };
  const denied = (response, code) => {
    assert.equal(response.ok, false);
    assert.equal(response.error.code, code);
  };
  const check = async (id, label, work) => {
    try {
      await work();
      checks.push({ id, label, status: 'passed' });
    } catch (_error) {
      checks.push({ id, label, status: 'failed' });
    }
  };
  const call = backend.call;
  const date = '2026-10-29';
  await check('health', '基础请求与响应', async () => {
    success(await call('system.health'));
  });
  await check('weather', '七天气保存和读回', async () => {
    assert.equal(WEATHER_TYPES.length, 7);
    for (let i = 0; i < WEATHER_TYPES.length; i++) {
      const weather = WEATHER_TYPES[i].code;
      const day = '2026-10-' + (22 + i);
      const saved = success(
        await call(
          'journal.upsert',
          {
            date: day,
            weather,
            ...(weather === 'CUSTOM' ? { weatherName: '合成彩虹😀' } : {}),
            expectedVersion: 0,
          },
          { actor: 'a' },
        ),
      );
      assert.equal(saved.entry.weather, weather);
      const read = success(await call('journal.get', { date: day }, { actor: 'a' }));
      assert.deepEqual(read.entry, saved.entry);
    }
  });
  const payload = { date, weather: 'SUNNY', text: 'SYNTHETIC_TEAM_BODY', expectedVersion: 0 };
  await check('replay', '原请求重试与版本冲突', async () => {
    const options = { actor: 'a', requestId: 'req_team_fixed_retry' };
    const first = await call('journal.upsert', payload, options);
    success(first);
    assert.deepEqual(await call('journal.upsert', payload, options), first);
    denied(await call('journal.upsert', payload, { actor: 'a' }), 'CONFLICT');
  });
  await check('identity', '游客、停用与账号隔离', async () => {
    denied(await call('journal.get', { date }), 'UNAUTHENTICATED');
    denied(await call('journal.get', { date }, { actor: 'disabled' }), 'ACCOUNT_DISABLED');
    assert.equal(success(await call('journal.get', { date }, { actor: 'b' })).entry, null);
  });
  await check('review', '回顾不返回正文、删除后读取一致', async () => {
    const before = success(await call('review.calendar', { month: '2026-10' }, { actor: 'a' }));
    assert.equal(
      before.entries.some((entry) => entry.date === date),
      true,
    );
    assert.doesNotMatch(JSON.stringify(before), /SYNTHETIC_TEAM_BODY/);
    success(await call('journal.delete', { date, expectedVersion: 1 }, { actor: 'a' }));
    assert.equal(success(await call('journal.get', { date }, { actor: 'a' })).entry, null);
    const after = success(await call('review.calendar', { month: '2026-10' }, { actor: 'a' }));
    assert.equal(
      after.entries.some((entry) => entry.date === date),
      false,
    );
    assert.equal(after.recordCount, before.recordCount - 1);
    assert.ok(after.sourceRevision > before.sourceRevision);
  });
  await check('campus', '校园公开筛选和详情', async () => {
    const list = success(await call('campus.listPlaces', { tags: ['安静'] }));
    assert.equal(list.items.length, 1);
    assert.equal(
      success(await call('campus.getPlace', { placeId: list.items[0].placeId })).name,
      '合成联调地点',
    );
  });
  await check('operator', '运营门禁、资料保存和重读', async () => {
    denied(await call('admin.listPlaces', {}, { actor: 'a' }), 'FORBIDDEN');
    const current = success(
      await call('admin.getPlace', { placeId: 'synthetic_team_place' }, { actor: 'operator' }),
    );
    const saved = success(
      await call(
        'admin.updatePlace',
        {
          placeId: current.placeId,
          expectedUpdatedAt: current.updatedAt,
          changes: { name: '合成已修改' },
        },
        { actor: 'operator' },
      ),
    );
    assert.equal(saved.verified, true);
    assert.equal(
      success(await call('admin.getPlace', { placeId: current.placeId }, { actor: 'operator' }))
        .name,
      '合成已修改',
    );
  });
  await check('correction', '纠错审核不自动修改地点', async () => {
    const placeId = 'synthetic_team_place';
    success(await call('campus.correctPlace', { placeId, text: '合成纠错' }, { actor: 'a' }));
    const queue = success(await call('admin.listCorrections', {}, { actor: 'operator' }));
    const reviewed = success(
      await call(
        'admin.reviewCorrection',
        { correctionId: queue.items[0].correctionId, decision: 'approved' },
        { actor: 'operator' },
      ),
    );
    assert.equal(reviewed.placeUpdated, false);
    assert.equal(success(await call('campus.getPlace', { placeId })).name, '合成已修改');
  });
  await check('tasks', '公开任务只读候选', async () => {
    const result = success(await call('tasks.suggestions'));
    assert.equal(result.readOnly, true);
    assert.equal(result.items.length, 1);
    denied(
      await call(
        'tasks.transition',
        { taskId: 'synthetic_team_task', operation: 'select' },
        { actor: 'a' },
      ),
      'NOT_IMPLEMENTED',
    );
  });
  return {
    mode: 'LOCAL_SYNTHETIC_ONLY',
    simulatedClock: SIMULATED_NOW,
    status: checks.every((c) => c.status === 'passed') ? 'passed' : 'failed',
    checks,
    realCloudAccess: 'not_checked',
    realDevice: 'not_checked',
    productionBusinessEnabled: false,
  };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--json') || args.length > 1) {
    console.error('Usage: npm run team:check -- [--json]');
    process.exitCode = 2;
  } else {
    runTeamCheck()
      .then((report) => {
        if (args.includes('--json')) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log('MoodSky 本地合成联调（不连接云端，不验证组员云权限）');
          for (const c of report.checks) {
            console.log((c.status === 'passed' ? '通过' : '失败') + ' | ' + c.label);
          }
          console.log('真实云访问与手机：未检查；内存数据退出后清空。');
        }
        if (report.status !== 'passed') {
          process.exitCode = 1;
        }
      })
      .catch(() => {
        console.error('本地联调未完成，请先运行 npm run setup 并按开发说明检查依赖。');
        process.exitCode = 1;
      });
  }
}
module.exports = { runTeamCheck };
