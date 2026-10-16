// Compile-only examples. This file is not a mini-program or cloud entry.
import type {
  CandidateResult,
  JournalEntryView,
  JournalGetData,
  JournalGetRequest,
  JournalUpsertRequest,
  ReviewDistributionRequest,
} from './contracts';
export const save: JournalUpsertRequest = {
  apiVersion: '1',
  requestId: 'req_type_save_001',
  action: 'journal.upsert',
  payload: { date: '2026-10-16', weather: 'SUNNY', expectedVersion: 0 },
};
export const empty: CandidateResult<JournalGetData> = {
  apiVersion: '1',
  requestId: 'req_type_empty_001',
  ok: true,
  data: { entry: null },
};
export const invalidRequest: CandidateResult<JournalGetData> = {
  apiVersion: '1',
  requestId: null,
  ok: false,
  error: { code: 'INVALID_REQUEST', message: '合成错误' },
};
export function publicView(entry: JournalEntryView) {
  // @ts-expect-error Public views do not expose internal ownership.
  const owner = entry.ownerId;
  return { date: entry.date, owner };
}
export const identitySpoof: JournalGetRequest = {
  apiVersion: '1',
  requestId: 'req_type_spoof_001',
  action: 'journal.get',
  payload: {
    date: '2026-10-16',
    // @ts-expect-error Client payload cannot select an account.
    ownerId: 'synthetic_other',
  },
};
export const wrongWindow: ReviewDistributionRequest = {
  apiVersion: '1',
  requestId: 'req_type_window_001',
  action: 'review.distribution',
  payload: {
    // @ts-expect-error Only numeric 7/30/90 are in this draft.
    windowDays: '7',
  },
};
export const wrongWeather: JournalUpsertRequest = {
  ...save,
  payload: {
    ...save.payload,
    // @ts-expect-error Unreviewed weather extensions are not part of the contract.
    weather: 'TYPHOON',
  },
};
// @ts-expect-error Only failure responses may have a null correlation id.
export const uncorrelatedSuccess: CandidateResult<JournalGetData> = {
  apiVersion: '1',
  requestId: null,
  ok: true,
  data: { entry: null },
};
