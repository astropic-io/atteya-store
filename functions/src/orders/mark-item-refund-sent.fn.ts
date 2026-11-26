import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions } from '../auth/callable-options.js';
import { requireRole } from '../auth/require-role.js';
import { parseItemRefundSentRequest } from '../store/order-item-cancel.js';
import { markItemRefundSent, type ItemRefundSentResponse } from './order-item-cancel.js';

/** Admin only: the refund of a cancelled item was sent by InstaPay (ATS-342). */
export const markItemRefundSentFn = onCall(
  adminCallableOptions(),
  async (request): Promise<ItemRefundSentResponse> => {
    const actor = await requireRole(request, 'admin');
    const parsed = parseItemRefundSentRequest(request.data);
    if (!parsed)
      throw new HttpsError(
        'invalid-argument',
        'Choose the cancelled item. A reference can be up to 100 characters.',
      );
    return markItemRefundSent(getFirestore(), parsed, actor);
  },
);
