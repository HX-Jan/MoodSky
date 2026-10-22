// H02/H04 candidate wiring; imports the current shared weather/input contract.
import type {
  BusinessDate,
  WeatherCode,
  JournalEntry,
  JournalInput,
  RequestEnvelope,
} from '../../miniprogram/shared/types';
export type JournalEntryView = Omit<JournalEntry, 'ownerId'>;
export type CandidateRequest<A extends string, P> = Omit<RequestEnvelope, 'action' | 'payload'> & {
  action: A;
  payload: P;
};
export type CandidateResult<T> =
  | { apiVersion: '1'; requestId: string; ok: true; data: T }
  | {
      apiVersion: '1';
      requestId: string | null;
      ok: false;
      error: { code: string; message: string };
    };
export interface JournalGetInput {
  date: BusinessDate;
}
export interface JournalDeleteInput extends JournalGetInput {
  expectedVersion: number;
}
export interface JournalUpsertData {
  entry: JournalEntryView;
}
export interface JournalGetData {
  entry: JournalEntryView | null;
}
export interface JournalDeleteData {
  date: BusinessDate;
  deleted: boolean;
}
export type JournalUpsertRequest = CandidateRequest<'journal.upsert', JournalInput>;
export type JournalGetRequest = CandidateRequest<'journal.get', JournalGetInput>;
export type JournalDeleteRequest = CandidateRequest<'journal.delete', JournalDeleteInput>;
export type MonthString = string;
export type ReviewWindow = 7 | 30 | 90;
export interface MonthReviewInput {
  month: MonthString;
}
export interface WindowReviewInput {
  windowDays: ReviewWindow;
}
export interface ReviewEntryMark {
  id: string;
  date: BusinessDate;
  weather: WeatherCode;
  weatherName?: string;
}
export interface SourceMeta {
  sourceRevision: number;
  recordCount: number;
}
export interface WindowReviewMeta extends SourceMeta {
  startDate: BusinessDate;
  endDate: BusinessDate;
  windowDays: ReviewWindow;
}
export interface CalendarData extends SourceMeta {
  month: MonthString;
  entries: ReviewEntryMark[];
}
export interface DistributionData extends WindowReviewMeta {
  bins: { weather: WeatherCode; count: number }[];
}
export interface TimelineData extends WindowReviewMeta {
  items: ReviewEntryMark[];
  trendEligible: boolean;
}
export interface MonthArchiveData extends SourceMeta {
  month: MonthString;
  cards: ReviewEntryMark[];
  cardTextPreview: false;
}
export interface DecorationItem {
  stickerId: string;
  targetEntryId?: string;
}
export type DecorationInput =
  | { operation: 'get'; month: MonthString }
  | {
      operation: 'replace';
      month: MonthString;
      expectedVersion: number;
      stickers: DecorationItem[];
      backgroundId: string | null;
    }
  | { operation: 'reset'; month: MonthString; expectedVersion: number };
export interface DecorationData {
  month: MonthString;
  version: number;
  stickers: DecorationItem[];
  backgroundId: string | null;
}
export type ReviewCalendarRequest = CandidateRequest<'review.calendar', MonthReviewInput>;
export type ReviewDistributionRequest = CandidateRequest<'review.distribution', WindowReviewInput>;
export type ReviewTimelineRequest = CandidateRequest<'review.timeline', WindowReviewInput>;
export type ReviewMonthArchiveRequest = CandidateRequest<'review.monthArchive', MonthReviewInput>;
export type ReviewDecorationsRequest = CandidateRequest<'review.decorations', DecorationInput>;
export type CandidateRequestUnion =
  | JournalUpsertRequest
  | JournalGetRequest
  | JournalDeleteRequest
  | ReviewCalendarRequest
  | ReviewDistributionRequest
  | ReviewTimelineRequest
  | ReviewMonthArchiveRequest
  | ReviewDecorationsRequest;
