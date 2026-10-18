// Pure formatter candidate. It neither queries storage nor authorizes file delivery.
// Callers must obtain ONE complete, owner-filtered snapshot after trusted authentication.
const { AppError } = require('../../cloudfunctions/moodsky/shared/result');
const { validateJournalInput } = require('../../cloudfunctions/moodsky/shared/validation');
const { isBusinessDate } = require('../../cloudfunctions/moodsky/shared/date');
const {
  WEATHER_TYPES,
  JOURNAL_TAGS,
  LIMITS,
} = require('../../cloudfunctions/moodsky/shared/constants');
const idValid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (code = 'INVALID_INPUT') => {
  throw new AppError(code, '导出来源或参数无效。');
};
function timestamp(value) {
  if (
    typeof value === 'string' &&
    (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) ||
      !isBusinessDate(value.slice(0, 10)))
  ) {
    return fail();
  }
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    return fail();
  }
  return date.toISOString();
}
function requireOwner(row, ownerId) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.ownerId !== ownerId) {
    return fail('FORBIDDEN');
  }
}
function array(value, maxRecords) {
  if (!Array.isArray(value) || value.length > maxRecords) {
    return fail();
  }
  return value;
}
function text(value) {
  if (typeof value !== 'string') {
    return fail();
  }
  return value;
}
function projectSnapshot(snapshot, { accountId, exportedAt, maxRecords }) {
  if (!idValid(accountId) || !snapshot || snapshot.ownerId !== accountId) {
    return fail('FORBIDDEN');
  }
  if (snapshot.accountStatus !== 'active') {
    return fail('ACCOUNT_DISABLED');
  }
  if (
    !Number.isSafeInteger(snapshot.sourceRevision) ||
    snapshot.sourceRevision < 0 ||
    !Number.isSafeInteger(maxRecords) ||
    maxRecords <= 0
  ) {
    return fail();
  }
  const date = timestamp(exportedAt);
  const journals = [];
  const journalIds = new Map();
  const sourceJournalIds = new Set();
  const journalDates = new Set();
  for (const row of array(snapshot.journals, maxRecords)) {
    requireOwner(row, accountId);
    if (
      !['active', 'deleted'].includes(row.state) ||
      !isBusinessDate(row.date) ||
      !Number.isSafeInteger(row.version) ||
      row.version <= 0 ||
      journalDates.has(row.date) ||
      (row.id !== undefined && (!idValid(row.id) || sourceJournalIds.has(row.id)))
    ) {
      return fail();
    }
    journalDates.add(row.date);
    if (row.id !== undefined) {
      sourceJournalIds.add(row.id);
    }
    if (row.state === 'deleted') {
      continue;
    }
    if (
      row.state !== 'active' ||
      !Number.isSafeInteger(row.version) ||
      row.version <= 0 ||
      !idValid(row.id)
    ) {
      return fail();
    }
    const input = validateJournalInput({
      date: row.date,
      weather: row.weather,
      tags: row.tags,
      text: row.text,
      expectedVersion: row.version,
    });
    journalIds.set(row.id, row.date);
    const createdAt = timestamp(row.createdAt);
    const updatedAt = timestamp(row.updatedAt);
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      return fail();
    }
    journals.push({
      date: input.date,
      weather: input.weather,
      tags: input.tags,
      text: input.text,
      version: row.version,
      createdAt,
      updatedAt,
    });
  }
  journals.sort((a, b) => a.date.localeCompare(b.date));
  const places = new Set();
  const favorites = array(snapshot.favorites, maxRecords)
    .map((row) => {
      requireOwner(row, accountId);
      if (!idValid(row.placeId) || places.has(row.placeId)) {
        return fail();
      }
      places.add(row.placeId);
      return {
        placeId: row.placeId,
        ...(row.placeName === undefined ? {} : { placeName: text(row.placeName) }),
        createdAt: timestamp(row.createdAt),
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.placeId.localeCompare(b.placeId));
  const taskHistory = array(snapshot.taskHistory, maxRecords)
    .map((row) => {
      requireOwner(row, accountId);
      if (
        !idValid(row.taskId) ||
        !isBusinessDate(row.date) ||
        !['selected', 'completed', 'replaced', 'skipped'].includes(row.state)
      ) {
        return fail();
      }
      return {
        taskId: row.taskId,
        ...(row.taskTitle === undefined ? {} : { taskTitle: text(row.taskTitle) }),
        date: row.date,
        state: row.state,
        createdAt: timestamp(row.createdAt),
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.taskId.localeCompare(b.taskId));
  let preferences = null;
  if (snapshot.preferences !== null) {
    const row = snapshot.preferences;
    requireOwner(row, accountId);
    if (typeof row.cardTextPreview !== 'boolean' || typeof row.decorationsEnabled !== 'boolean') {
      return fail();
    }
    preferences = {
      cardTextPreview: row.cardTextPreview,
      decorationsEnabled: row.decorationsEnabled,
      updatedAt: timestamp(row.updatedAt),
    };
  }
  const months = new Set();
  const monthDecorations = array(snapshot.monthDecorations, maxRecords)
    .map((row) => {
      requireOwner(row, accountId);
      if (
        typeof row.month !== 'string' ||
        !/^\d{4}-\d{2}$/.test(row.month) ||
        !isBusinessDate(row.month + '-01') ||
        months.has(row.month) ||
        !Number.isSafeInteger(row.version) ||
        row.version <= 0 ||
        !Array.isArray(row.stickers) ||
        row.stickers.length > LIMITS.staticStickers ||
        (row.backgroundId !== null && !idValid(row.backgroundId))
      ) {
        return fail();
      }
      months.add(row.month);
      const seen = new Set();
      const stickers = [];
      for (const sticker of row.stickers) {
        if (
          !sticker ||
          !idValid(sticker.stickerId) ||
          (sticker.targetEntryId !== undefined && !idValid(sticker.targetEntryId))
        ) {
          return fail();
        }
        const key = JSON.stringify([sticker.stickerId, sticker.targetEntryId || null]);
        if (seen.has(key)) {
          return fail();
        }
        seen.add(key);
        if (sticker.targetEntryId !== undefined) {
          const targetDate = journalIds.get(sticker.targetEntryId);
          // A deleted/missing target cannot survive as a dangling export reference.
          if (!targetDate || !targetDate.startsWith(row.month + '-')) {
            continue;
          }
          stickers.push({ stickerId: sticker.stickerId, targetDate });
        } else {
          stickers.push({ stickerId: sticker.stickerId });
        }
      }
      return { month: row.month, version: row.version, stickers, backgroundId: row.backgroundId };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
  if (snapshot.campusId !== undefined && !idValid(snapshot.campusId)) {
    return fail();
  }
  return {
    exportVersion: '1.0-candidate',
    exportedAt: date,
    ...(snapshot.campusId === undefined ? {} : { campusId: snapshot.campusId }),
    data: { journals, favorites, taskHistory, preferences, monthDecorations },
  };
}
function inline(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1')
    .replace(/[\r\n\u2028\u2029]/g, ' ');
}
function fenced(value) {
  const runs = value.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return fence + 'text\n' + value + '\n' + fence;
}
function markdown(document) {
  const data = document.data;
  const lines = [
    '# MoodSky 数据导出（格式候选）',
    '',
    '- 导出时间：' + document.exportedAt,
    '- 格式版本：' + document.exportVersion,
  ];
  if (document.campusId !== undefined) {
    lines.push('- 所属校区：' + inline(document.campusId));
  }
  lines.push('', '## 天气记录（' + data.journals.length + ' 条）', '');
  for (const entry of data.journals) {
    const label = WEATHER_TYPES.find(({ code }) => code === entry.weather).label;
    const tags =
      entry.tags.map((tag) => JOURNAL_TAGS.find(({ id }) => id === tag).label).join('、') ||
      '（无）';
    lines.push(
      '### ' + entry.date + ' ' + label,
      '',
      '- 标签：' + tags,
      '- 版本：' + entry.version,
      '- 创建时间：' + entry.createdAt,
      '- 更新时间：' + entry.updatedAt,
      '',
      '正文：',
      '',
      fenced(entry.text),
      '',
    );
  }
  lines.push('## 收藏地点（' + data.favorites.length + ' 个）', '');
  for (const place of data.favorites) {
    lines.push(
      '- ' +
        inline(place.placeName || place.placeId) +
        '（' +
        inline(place.placeId) +
        '） · ' +
        place.createdAt,
    );
  }
  lines.push('', '## 任务历史（' + data.taskHistory.length + ' 条）', '');
  const states = { selected: '已选择', completed: '已完成', replaced: '已替换', skipped: '已跳过' };
  for (const task of data.taskHistory) {
    lines.push(
      '- ' +
        task.date +
        '：' +
        inline(task.taskTitle || task.taskId) +
        '（' +
        states[task.state] +
        '） · ' +
        task.createdAt,
    );
  }
  lines.push('', '## 偏好设置', '');
  if (data.preferences) {
    lines.push(
      '- 卡片正文预览：' + (data.preferences.cardTextPreview ? '开启' : '关闭'),
      '- 装饰启用：' + (data.preferences.decorationsEnabled ? '开启' : '关闭'),
      '- 更新时间：' + data.preferences.updatedAt,
    );
  } else {
    lines.push('尚无已保存的偏好设置。');
  }
  lines.push('', '## 月份装饰（' + data.monthDecorations.length + ' 个月）', '');
  for (const month of data.monthDecorations) {
    lines.push(
      '### ' + month.month,
      '',
      '- 版本：' + month.version,
      '- 背景：' + inline(month.backgroundId || '（无）'),
    );
    for (const sticker of month.stickers) {
      lines.push(
        '- 贴纸：' +
          inline(sticker.stickerId) +
          (sticker.targetDate ? ' · ' + sticker.targetDate : ' · 月份装饰'),
      );
    }
    lines.push('');
  }
  lines.push(
    '',
    '此文件包含私人数据，请自行妥善保管。此格式化器不提供云端领取、撤销或到期控制。',
    '',
  );
  return lines.join('\n');
}
function formatExport(snapshot, { format, accountId, exportedAt, maxRecords, maxBytes }) {
  if (!['json', 'markdown'].includes(format) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return fail();
  }
  const document = projectSnapshot(snapshot, { accountId, exportedAt, maxRecords });
  const content = format === 'json' ? JSON.stringify(document, null, 2) + '\n' : markdown(document);
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > maxBytes) {
    return fail();
  }
  return {
    content,
    byteLength,
    mimeType:
      format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
    extension: format === 'json' ? 'json' : 'md',
  };
}
module.exports = { formatExport };
