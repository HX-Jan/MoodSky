// Backend adapter proposal; does not change the shared client contract.
import type { BusinessDate, JournalEntry, WeatherCode } from '../shared/types';

export type EntryView = Omit<JournalEntry, 'ownerId'>;
export interface JournalDay {
  version: number;
  entry: EntryView | null;
}
export interface ReceiptBinding {
  canonicalVersion: 'original-json-v1';
  keyId: string;
  digest: string;
  acceptedAt: string;
  expiresAt: string;
}
export interface ExpiredReceipt {
  state: 'expired';
}
export interface RejectedReceipt extends ReceiptBinding {
  state: 'rejected';
  code: 'CONFLICT' | 'INVALID_INPUT';
  version: number;
}
export interface SaveReceipt extends ReceiptBinding {
  version: number;
  entryId: string;
}
export interface DeleteReceipt extends ReceiptBinding {
  version: number;
  deleted: boolean;
}
export interface DecorationItem {
  stickerId: string;
  targetEntryId?: string;
}
export interface DecorationDocument {
  version: number;
  stickers: DecorationItem[];
  backgroundId: string | null;
}
export interface DecorationReceipt extends ReceiptBinding {
  version: number;
  month: string;
}
export interface RejectedDecorationReceipt extends RejectedReceipt {
  month: string;
}
export interface JournalTransaction {
  getDay(date: BusinessDate): Promise<JournalDay | undefined>;
  setDay(date: BusinessDate, day: JournalDay): Promise<void>;
  getReceipt(
    action: 'journal.upsert',
    requestId: string,
  ): Promise<SaveReceipt | RejectedReceipt | ExpiredReceipt | undefined>;
  getReceipt(
    action: 'journal.delete',
    requestId: string,
  ): Promise<DeleteReceipt | RejectedReceipt | ExpiredReceipt | undefined>;
  getReceipt(
    action: 'review.decorations',
    requestId: string,
  ): Promise<DecorationReceipt | RejectedDecorationReceipt | ExpiredReceipt | undefined>;
  setReceipt(
    action: 'journal.upsert',
    requestId: string,
    receipt: SaveReceipt | RejectedReceipt,
  ): Promise<void>;
  setReceipt(
    action: 'journal.delete',
    requestId: string,
    receipt: DeleteReceipt | RejectedReceipt,
  ): Promise<void>;
  setReceipt(
    action: 'review.decorations',
    requestId: string,
    receipt: DecorationReceipt | RejectedDecorationReceipt,
  ): Promise<void>;
  advanceRevision(): Promise<void>;
  touchAccount(): Promise<void>;
  invalidateExports(): Promise<void>;
  writeDeletionMarker(marker: {
    date: BusinessDate;
    entryId: string;
    deletedVersion: number;
    deletedAt: string;
  }): Promise<void>;
  getDecorations(month: string): Promise<DecorationDocument | undefined>;
  setDecorations(month: string, doc: DecorationDocument): Promise<void>;
  listMonthMarks(month: string): Promise<ReviewMark[]>;
}
export interface ReviewMark {
  id: string;
  date: BusinessDate;
  weather: WeatherCode;
}
export interface SnapshotRange {
  startDate: BusinessDate;
  endDate: BusinessDate;
}
export interface JournalSnapshot {
  revision: number;
  entries: ReviewMark[];
}
export interface JournalRepository {
  readDay(ownerId: string, date: BusinessDate): Promise<JournalDay | undefined>;
  transact<T>(ownerId: string, work: (tx: JournalTransaction) => Promise<T>): Promise<T>;
  readSnapshot(ownerId: string, range: SnapshotRange): Promise<JournalSnapshot>;
}
