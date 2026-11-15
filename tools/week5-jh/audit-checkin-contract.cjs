#!/usr/bin/env node
// W5 JH campus check-in contract audit (Junhan Huang).
//
// Compares the actions the active Campus page sends, the actions the source
// backend accepts, the shared registry, and the actions the reported target
// deployment (moodsky-release 0.4.0) understands. The deployment list comes
// from Qinghan's W5 report; this tool does not query the cloud.
//
//   node tools/week5-jh/audit-checkin-contract.cjs [output-dir]
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'week5', 'Junhan_Huang');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function actionsIn(source) {
  return [
    ...new Set([...source.matchAll(/['"](campus\.[A-Za-z]+)['"]/g)].map((match) => match[1])),
  ].sort();
}

const activeClient = actionsIn(
  read('miniprogram/modules/campus/checkin-controller.js') +
    read('miniprogram/modules/campus/checkin-history-controller.js'),
);
const alternateClient = actionsIn(read('miniprogram/modules/campus/checkin/transport.js'));
const serverAccepted = actionsIn(read('cloudfunctions/moodsky/production/backend.js'));
const registry = actionsIn(read('miniprogram/shared/contracts.js'));

// Qinghan's 2026-11-10 read-only diagnosis and downloaded package comparison:
// moodsky-release 0.4.0 accepts lowercase campus.checkin (write) and
// campus.checkinHistory, but not campus.checkIn or campus.checkins.
const deployed = {
  source: 'docs/week5/qinghan-zhang/README.md#11月10日实际部署包比对',
  functionName: 'moodsky-release',
  reportedVersion: '0.4.0',
  accepted: ['campus.checkin', 'campus.checkinHistory'],
};

const activeMissing = activeClient.filter((action) => !deployed.accepted.includes(action));
const serverHasAliases = activeMissing.every((action) => serverAccepted.includes(action));

const result = {
  _comment:
    'W5 JH contract audit only. The deployment list is reported evidence from Qinghan, not a live cloud call; permissions and the actually deployed build still require the release owner.',
  task: 'W5-JH',
  owner: 'Junhan Huang',
  recordedAt: '2026-11-12',
  environment: 'static source audit; no CloudBase call',
  activeClientActions: activeClient,
  alternateTransportActions: alternateClient,
  sourceBackendAccepted: serverAccepted,
  registryActions: registry,
  deployed,
  activeMissingOnDeployed: activeMissing,
  status: activeMissing.length === 0 ? 'compatible' : 'blocked',
  analysis: {
    sourceBackendAcceptsActiveActions: serverHasAliases,
    explanation:
      activeMissing.length === 0
        ? 'The active client actions are present in the reported deployment.'
        : 'The active Campus page sends actions the reported deployment does not accept. The source backend already accepts both the active names and the deployed aliases, so deploying the current backend would restore compatibility; changing only the client would still leave campus.checkins unsupported.',
    minimumCloudActions: ['campus.checkIn', 'campus.checkins', 'campus.checkinHistory'],
    minimumCollections: ['place_checkins', 'campus_checkin_states', 'request_receipts'],
    requiredPermissions:
      'Client read/write disabled; all access through the cloud function with trusted OPENID. Verify in the console before opening private check-in.',
  },
  decision:
    activeMissing.length === 0
      ? 'proceed'
      : 'For the 1.0.0 review scope, keep the five recommendations and written directions readable and do not claim private check-in until the backend is deployed or the release owner narrows the entry to read-only.',
};

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'w5-jh01-checkin-contract-audit.json');
fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log('wrote ' + path.relative(ROOT, file));
console.log(JSON.stringify({ status: result.status, missing: activeMissing }, null, 2));
