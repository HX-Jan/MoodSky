#!/usr/bin/env node
// W4 JH01 campus catalogue review (Junhan Huang).
//
// Reads Qinghan's approved place import (NDJSON, one place per line) and checks
// the fields the recommendation list and detail actually depend on. It performs
// no import and no cloud call: the output is a review record, not a database
// write. Qinghan's source file stays the source of truth.
//
//   node tools/week4-jh/review-catalogue.cjs [input] [output-dir]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PLACES } = require('../../miniprogram/shared/campus-checkins');

const ROOT = path.join(__dirname, '..', '..');
const INPUT =
  process.argv[2] ||
  path.join(ROOT, 'docs', 'week4', 'qinghan-zhang', 'places-approved-import.json');
const OUT = process.argv[3] || path.join(ROOT, 'docs', 'week4', 'Junhan_Huang');
const MAX_TEXT = 200;

const REQUIRED_TEXT = [
  'name',
  'campus',
  'address',
  'recommendationReason',
  'entryRestrictions',
  'source',
];
const PLACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function textIssue(value) {
  if (typeof value !== 'string') {
    return 'missing';
  }
  if (value.trim().length === 0) {
    return 'empty';
  }
  if (Array.from(value).length > MAX_TEXT) {
    return 'too_long';
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return 'control_characters';
  }
  return null;
}

function parseNdjson(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return { line: index + 1, value: JSON.parse(line) };
      } catch (error) {
        return { line: index + 1, value: null, parseError: error.message };
      }
    });
}

const source = fs.readFileSync(INPUT, 'utf8');
const parsed = parseNdjson(source);
const staticById = new Map(PLACES.map((place) => [place.placeId, place]));
const seen = new Set();
const rows = [];
const issues = [];

for (const entry of parsed) {
  if (!entry.value) {
    issues.push({ line: entry.line, code: 'invalid_json' });
    continue;
  }
  const place = entry.value;
  const rowIssues = [];

  if (typeof place.placeId !== 'string' || !PLACE_ID.test(place.placeId)) {
    rowIssues.push('place_id_invalid');
  } else if (seen.has(place.placeId)) {
    rowIssues.push('place_id_duplicate');
  } else {
    seen.add(place.placeId);
  }

  for (const field of REQUIRED_TEXT) {
    const issue = textIssue(place[field]);
    if (issue) {
      rowIssues.push(field + '_' + issue);
    }
  }

  if (!Array.isArray(place.tags) || place.tags.length === 0 || place.tags.length > 5) {
    rowIssues.push('tags_invalid');
  }
  if (place.enabled !== true) {
    rowIssues.push('not_enabled');
  }
  if (place.isSynthetic !== false) {
    rowIssues.push('not_explicitly_real');
  }

  const verifiedAt = Date.parse(place.verifiedAt);
  const validUntil = Date.parse(place.validUntil);
  if (!Number.isFinite(verifiedAt)) {
    rowIssues.push('verified_at_invalid');
  }
  if (!Number.isFinite(validUntil)) {
    rowIssues.push('valid_until_invalid');
  }
  if (Number.isFinite(verifiedAt) && Number.isFinite(validUntil) && validUntil <= verifiedAt) {
    rowIssues.push('validity_order_invalid');
  }

  const staticPlace = staticById.get(place.placeId);
  if (!staticPlace) {
    rowIssues.push('not_in_checkin_catalogue');
  } else if (staticPlace.name !== place.name) {
    rowIssues.push('name_differs_from_checkin_catalogue');
  }

  const row = {
    placeId: place.placeId,
    name: place.name,
    campus: place.campus,
    tags: place.tags,
    activityLabel: staticPlace ? staticPlace.tag : null,
    recommendationReason: place.recommendationReason,
    entryRestrictions: place.entryRestrictions,
    directionsSource: 'address',
    enabled: place.enabled,
    isSynthetic: place.isSynthetic,
    verificationState: 'verified',
    verifiedAt: place.verifiedAt,
    validUntil: place.validUntil,
    reviewState: place.reviewState || null,
    status: rowIssues.length === 0 ? 'fields_complete' : 'needs_review',
    issues: rowIssues,
  };
  rows.push(row);
  for (const issue of rowIssues) {
    issues.push({ line: entry.line, placeId: place.placeId, code: issue });
  }
}

const missingFromImport = [...staticById.keys()].filter((id) => !seen.has(id));
const summary = {
  source: path.relative(ROOT, INPUT).replace(/\\/g, '/'),
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  total: rows.length,
  fieldsComplete: rows.filter((row) => row.status === 'fields_complete').length,
  needsReview: rows.filter((row) => row.status !== 'fields_complete').length,
  checkinCatalogueSize: staticById.size,
  missingFromImport,
  issueCount: issues.length,
};

const result = {
  _comment:
    'W4 JH01 catalogue review only. "fields_complete" means the imported row has the fields and validity the public recommendation read needs; it is not an independent field check, not a database import and not an acceptance signature.',
  task: 'W4 JH01',
  owner: 'Junhan Huang',
  recordedAt: '2026-11-07',
  environment: 'local NDJSON review; no CloudBase call',
  rules: {
    maxTextCodePoints: MAX_TEXT,
    requiredText: REQUIRED_TEXT,
    mustBeEnabled: true,
    mustBeExplicitlyReal: true,
    mustMatchCheckinCatalogue: true,
    validity: 'validUntil must parse and be later than verifiedAt',
  },
  summary,
  issues,
  places: rows,
};

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'w4-jh01-catalogue-review.json');
fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log('wrote ' + path.relative(ROOT, file));
console.log(JSON.stringify(summary, null, 2));
