import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';

/**
 * `orderStaffNotes/{orderId}`: the staff-only side of an order, kept off `orders/{id}` because the
 * signed-in owner can read that whole doc. Holds `statusHistory` (who moved the order and when,
 * with the staff email), `cancelReason` and, on a Bank Transfer paid in another currency,
 * `payInRate` (`{ markupPercent, rate }` behind `pricing.payIn.factor`, ATS-304). Admins read it;
 * only the Admin SDK writes it.
 */
export const ORDER_STAFF_NOTES_COLLECTION = 'orderStaffNotes';

export function orderStaffNotesRef(db: Firestore, orderId: string) {
  return db.collection(ORDER_STAFF_NOTES_COLLECTION).doc(orderId);
}

/** Merge patch that appends one history row (and, on a cancel, sets the reason). */
export function staffNotesPatch(entry: DocumentData, cancelReason?: string | null): DocumentData {
  return {
    statusHistory: FieldValue.arrayUnion(entry),
    ...(cancelReason !== undefined ? { cancelReason } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
