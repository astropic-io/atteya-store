import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions } from '../auth/callable-options.js';
import { requireExtra } from '../auth/require-role.js';
import { parseItemRefundSentRequest } from '../store/order-item-cancel.js';
import { markItemRefundSent, type ItemRefundSentResponse } from './order-item-cancel.js';

/** Admin only: the refund of a cancelled item was sent by InstaPay (ATS-342). */
export const markItemRefundSentFn = onCall(
  adminCallableOptions(),
  async (request): Promise<ItemRefundSentResponse> => {
    const actor = await requireExtra(request, 'refunds');
    const parsed = parseItemRefundSentRequest(request.data);
    if (!parsed)
      throw new HttpsError(
        'invalid-argument',
        'Choose the cancelled item. A reference can be up to 100 characters.',
      );
    return markItemRefundSent(getFirestore(), parsed, actor);
  },
);
