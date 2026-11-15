#!/usr/bin/env node
// W5 JH place readiness review (Junhan Huang).
//
// Re-checks the five approved Fuzhou University places against the current
// catalogue cut-off: field completeness, validity, enablement, identity match
// and whether the recommendation still publishes. It does NOT claim a site
// visit: entry conditions remain Qinghan's field notes until independently
// verified.
//
//   node tools/week5-jh/review-place-readiness.cjs [output-dir]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PLACES } = require('../../miniprogram/shared/campus-checkins');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'week5', 'Junhan_Huang');
const SOURCE = path.join(ROOT, 'docs', 'week4', 'qinghan-zhang', 'places-approved-import.json');
const NOW = Date.parse('2026-11-12T09:00:00.000Z');
const MAX_TEXT = 200;

const rows = fs
  .readFileSync(SOURCE, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const staticById = new Map(PLACES.map((place) => [place.placeId, place]));

function textOk(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Array.from(value).length <= MAX_TEXT &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

const places = rows.map((row) => {
  const issues = [];
  for (const field of [
    'name',
    'campus',
    'address',
    'recommendationReason',
    'entryRestrictions',
    'source',
  ]) {
    if (!textOk(row[field])) {
      issues.push(field + '_invalid');
    }
  }
  const staticPlace = staticById.get(row.placeId);
  if (!staticPlace) {
    issues.push('not_in_checkin_catalogue');
  }
  if (row.enabled !== true) {
    issues.push('not_enabled');
  }
  if (row.isSynthetic !== false) {
    issues.push('not_explicitly_real');
  }
  const validUntil = Date.parse(row.validUntil);
  if (!Number.isFinite(validUntil)) {
    issues.push('valid_until_invalid');
  } else if (validUntil <= NOW) {
    issues.push('expired');
  }
  return {
    placeId: row.placeId,
    name: row.name,
    campus: row.campus,
    activityLabel: staticPlace ? staticPlace.tag : null,
    recommendationReason: row.recommendationReason,
    entryRestrictions: row.entryRestrictions,
    directions: row.address,
    source: row.source,
    verifiedAt: row.verifiedAt,
    validUntil: row.validUntil,
    fieldsComplete: issues.length === 0,
    publishable: issues.length === 0,
    issues,
    entryCheckedBy: 'Qinghan Zhang（用户提供的现场记录）',
    independentSiteVisitByJunhan: false,
    status: issues.length === 0 ? 'ready_for_read_only' : 'needs_review',
  };
});

const result = {
  _comment:
    'W5 JH place readiness only. "ready_for_read_only" means the row has complete recommendation fields and is still valid at the 2026-11-12 cut-off; it is not a site-visit signature and does not open private check-in.',
  task: 'W5-JH',
  owner: 'Junhan Huang',
  recordedAt: '2026-11-12',
  environment: 'local catalogue review; no CloudBase and no site visit',
  source: {
    path: 'docs/week4/qinghan-zhang/places-approved-import.json',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex'),
  },
  cutOff: new Date(NOW).toISOString(),
  summary: {
    total: places.length,
    fieldsComplete: places.filter((place) => place.fieldsComplete).length,
    publishable: places.filter((place) => place.publishable).length,
    independentlyVisitedByJunhan: 0,
    entryConditionsIndependentlyVerified: false,
  },
  recommendation:
    'Keep the five recommendations and written directions readable. Do not open private check-in for 1.0.0 until the target cloud accepts the active client actions and permissions are verified; see w5-jh01-checkin-contract-audit.json.',
  places,
};

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'w5-jh02-place-readiness.json');
fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log('wrote ' + path.relative(ROOT, file));
console.log(JSON.stringify(result.summary, null, 2));
