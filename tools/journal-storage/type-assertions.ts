import type {
  JournalRepository,
  JournalTransaction,
  EntryView,
  JournalSnapshot,
  ReceiptBinding,
} from '../../cloudfunctions/moodsky/services/repository';

async function adapterUsage(repository: JournalRepository) {
  const day = await repository.readDay('synthetic_account', '2026-10-18');
  if (day && day.entry) {
    const entry: EntryView = day.entry;
    // @ts-expect-error The client view never includes an internal owner identifier.
    entry.ownerId;
  }
  const snapshot: JournalSnapshot = await repository.readSnapshot('synthetic_account', {
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  // @ts-expect-error Review snapshots contain no journal writing.
  snapshot.entries[0]?.text;
  return repository.transact('synthetic_account', async (tx: JournalTransaction) => {
    const binding: ReceiptBinding = {
      canonicalVersion: 'original-json-v1',
      keyId: 'synthetic_key_id',
      digest: 'synthetic_digest',
      acceptedAt: '2026-10-18T00:00:00.000Z',
      expiresAt: '2026-10-18T01:00:00.000Z',
    };
    await tx.setReceipt('journal.upsert', 'req_synthetic_type', {
      ...binding,
      version: 1,
      entryId: 'synthetic_entry',
    });
    await tx.setReceipt('journal.delete', 'req_synthetic_type', {
      ...binding,
      version: 2,
      deleted: true,
    });
    // @ts-expect-error Save receipts cannot be substituted for deletion receipts.
    await tx.setReceipt('journal.delete', 'req_synthetic_type', {
      ...binding,
      version: 1,
      entryId: 'synthetic_entry',
    });
    // @ts-expect-error Review actions cannot write journal mutation receipts.
    await tx.setReceipt('review.calendar', 'req_synthetic_type', {
      ...binding,
      version: 1,
      entryId: 'synthetic_entry',
    });
    return snapshot.revision;
  });
}
void adapterUsage;
