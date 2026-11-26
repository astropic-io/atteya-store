import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions } from '../auth/callable-options.js';
import { requireRole } from '../auth/require-role.js';
import { parseItemCancelRequest } from '../store/order-item-cancel.js';
import { cancelOrderItem, type ItemCancelResponse } from './order-item-cancel.js';

/**
 * Staff cancel some pieces of one item in a Waiting for Payment or Confirmed order (ATS-342).
 * Every rule runs on the live order in `cancelOrderItem()`.
 */
export const cancelOrderItemFn = onCall(
  adminCallableOptions(),
  async (request): Promise<ItemCancelResponse> => {
    const actor = await requireRole(request, 'staff');
    const parsed = parseItemCancelRequest(request.data);
    if (!parsed) {
      throw new HttpsError(
        'invalid-argument',
        'Choose an item and how many to cancel. A reason can be up to 300 characters, the InstaPay details up to 100.',
      );
    }
    return cancelOrderItem(getFirestore(), parsed, actor);
  },
);
