import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { orderStatusLabel as statusName } from '@core/config/order-status';
import { AuthService } from '@core/services/auth/auth.service';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/ui/dialogs/confirm-dialog/confirm-dialog.component';
import { SharedIconModule } from '@shared/ui/mat-icon';
import {
  CancelOrderDialogComponent,
  type CancelOrderDialogData,
  type CancelOrderDialogResult,
} from '../../dialogs/cancel-order-dialog/cancel-order-dialog.component';
import {
  DeliveryFeeDialogComponent,
  type DeliveryFeeDialogData,
} from '../../dialogs/delivery-fee-dialog/delivery-fee-dialog.component';
import type { OrderLineAdminRow, OrderStatusMove } from '../../models/order-admin.model';
import { OrdersAdminService } from '../../services/orders-admin.service';
import { orderActionError } from '../../utils/order-action-error';

type OrderAction = 'status' | 'fee' | 'delete';

/** The confirm dialog of a forward move (Confirmed, Shipped, Delivered), saying what happens. */
function forwardMoveDialog(row: OrderLineAdminRow, move: OrderStatusMove): ConfirmDialogData {
  const base = { cancelText: 'Keep Status', theme: 'primary' as const };
  switch (move.status) {
    case 'confirmed':
      return {
        ...base,
        title: `Confirm ${row.orderRef}?`,
        message: row.stockTaken
          ? 'This emails the shopper that the order is confirmed.'
          : 'This takes the items out of stock and emails the shopper that the order is confirmed.',
        confirmText: 'Confirm Order',
      };
    case 'shipped':
      return {
        ...base,
        title: `Mark ${row.orderRef} as Shipped?`,
        message: move.emailsShopper
          ? 'This emails the shopper that the order is on its way.'
          : "The shopper's order page shows the order as on its way. They already had the shipping email, so no new email is sent.",
        confirmText: 'Mark as Shipped',
      };
    case 'delivered':
      return {
        ...base,
        title: `Mark ${row.orderRef} as Delivered?`,
        message: move.emailsShopper
          ? 'This emails the shopper that the order was delivered and opens returns.'
          : "The shopper's order page shows the order as delivered and returns open again. They already had the delivered email, so no new email is sent.",
        confirmText: 'Mark as Delivered',
      };
    default:
      return {
        ...base,
        title: `Mark ${row.orderRef} as ${statusName(move.status)}?`,
        message: `The order moves to ${statusName(move.status)}.`,
        confirmText: `Mark as ${statusName(move.status)}`,
      };
  }
}

/** What a step back does, said before staff confirm it. */
function stepBackMessage(status: string): string {
  switch (status) {
    case 'pending':
      return "The items go back into stock and the shopper's order page asks for payment again. Only do this if the payment didn't actually arrive.";
    case 'confirmed':
      return "The shopper's order page shows the order as not sent yet.";
    default:
      return "The shopper's order page shows the order as not delivered yet.";
  }
}

/**
 * The order's actions: WhatsApp (or Copy Number), Set / Change Delivery Fee, Change Status, and
 * Delete Order (admins only, on Cancelled or Payment Failed orders).
 * Used by the opened row on the Orders list and by the order page. `afterChange` runs after a save,
 * so the parent reloads the order. It is a callback, not an output: staff can close the list row
 * while a save is running, which destroys this component, and an output emitted then is dropped.
 */
@Component({
  selector: 'app-order-actions',
  host: { class: 'flex flex-wrap items-center gap-2' },
  imports: [MatButtonModule, MatMenuModule, MatProgressSpinnerModule, SharedIconModule],
  template: `
    @let r = row();
    @if (r.whatsappUrl) {
      <a
        matButton="outlined"
        theme="success"
        [href]="r.whatsappUrl"
        target="_blank"
        rel="noopener"
        [attr.aria-label]="'Message ' + r.customerName + ' on WhatsApp'"
      >
        <mat-icon name="chat_bubble" />
        <span>WhatsApp</span>
      </a>
    } @else if (showCopyPhone()) {
      <button
        matButton="outlined"
        type="button"
        [attr.aria-label]="'Copy phone number of ' + r.customerName"
        (click)="copyPhone()"
      >
        <span>Copy Number</span>
      </button>
    }
    @if (r.deliveryFeeAction) {
      <button
        [matButton]="r.deliveryFeeAction === 'set' ? 'filled' : 'text'"
        type="button"
        [disabled]="busy() !== null"
        [attr.aria-label]="busy() === 'fee' ? 'Saving delivery fee…' : null"
        (click)="setDeliveryFee()"
      >
        @if (busy() === 'fee') {
          <mat-progress-spinner mode="indeterminate" diameter="18" />
        } @else {
          <span>{{ r.deliveryFeeAction === 'set' ? 'Set Delivery Fee' : 'Change Delivery Fee' }}</span>
        }
      </button>
    }
    @if (r.statusMoves.length || r.reopen) {
      <button
        matButton="filled"
        type="button"
        [matMenuTriggerFor]="statusMenu"
        [disabled]="busy() !== null"
        [attr.aria-label]="busy() === 'status' ? 'Saving status…' : 'Change status of order ' + r.orderRef"
      >
        @if (busy() === 'status') {
          <mat-progress-spinner mode="indeterminate" diameter="18" />
        } @else {
          <span>Change Status</span>
        }
      </button>
      <mat-menu #statusMenu="matMenu">
        @for (move of r.statusMoves; track move.status) {
          <button mat-menu-item type="button" (click)="changeStatus(move)">{{ move.label }}</button>
        }
        @if (r.reopen) {
          <button mat-menu-item type="button" (click)="reopenOrder()">Reopen Order</button>
        }
      </mat-menu>
    }
    @if (canDelete()) {
      <button
        matButton="text"
        theme="error"
        type="button"
        [disabled]="busy() !== null"
        [attr.aria-label]="busy() === 'delete' ? 'Deleting order…' : 'Delete order ' + r.orderRef"
        (click)="deleteOrder()"
      >
        @if (busy() === 'delete') {
          <mat-progress-spinner mode="indeterminate" diameter="18" />
        } @else {
          <span>Delete Order</span>
        }
      </button>
    }
  `,
})
export class OrderActionsComponent {
  readonly #ordersAdmin = inject(OrdersAdminService);
  readonly #snackbar = inject(SnackbarService);
  readonly #dialog = inject(MatDialog);
  readonly #auth = inject(AuthService);
  readonly #router = inject(Router);

  readonly row = input.required<OrderLineAdminRow>();
  /** The parent's reload; still called when this component was destroyed meanwhile. */
  readonly afterChange = input.required<() => void>();

  readonly busy = signal<OrderAction | null>(null);

  /** Same rule as the server's `deleteOrder`: admins only, and only a finished-for-good order. */
  readonly canDelete = computed(
    () => this.#auth.isAdmin() && (this.row().status === 'cancelled' || this.row().status === 'failed'),
  );

  /** The number can't be turned into a WhatsApp link safely: let staff copy and check it. */
  showCopyPhone(): boolean {
    const r = this.row();
    return !r.whatsappUrl && r.stage !== 'paymob-pending' && r.stage !== 'unknown' && !!r.phone;
  }

  async copyPhone(): Promise<void> {
    const phone = this.row().phone;
    try {
      await navigator.clipboard.writeText(phone);
      this.#snackbar.success('Phone number copied.');
    } catch {
      this.#snackbar.info(`Couldn't copy. The number is ${phone}.`);
    }
  }

  /**
   * The status dropdown. Every move asks first (ATS-325): Confirmed on a pending InstaPay or Bank
   * Transfer order asks staff to check the bank app; Cancelled asks for an optional reason; a step
   * back and every other move say what happens. The server checks the move again and takes or
   * returns stock.
   */
  async changeStatus(move: OrderStatusMove): Promise<void> {
    const row = this.row();
    if (this.busy()) return;
    let reason: string | null = null;
    if (move.status === 'confirmed' && row.confirmAction === 'confirm-payment') {
      const ok = await this.#ask({
        title: `Confirm Payment for ${row.orderRef}?`,
        message: `Only confirm after you see ${row.amountDueLabel ?? 'the full amount'} arrive in your bank app. A screenshot alone isn't proof. This takes the items out of stock and emails the shopper.`,
        confirmText: 'Payment Received',
        cancelText: 'Not Yet',
        theme: 'primary',
      });
      if (!ok) return;
    } else if (move.status === 'cancelled') {
      const ref = this.#dialog.open<
        CancelOrderDialogComponent,
        CancelOrderDialogData,
        CancelOrderDialogResult
      >(CancelOrderDialogComponent, {
        data: { orderRef: row.orderRef, stockTaken: row.stockTaken, confirmed: row.status === 'confirmed' },
        width: '440px',
      });
      const result = await firstValueFrom(ref.afterClosed());
      if (!result) return;
      reason = result.reason || null;
    } else if (move.label.startsWith('Back to')) {
      const ok = await this.#ask({
        title: `Move ${row.orderRef} back to ${statusName(move.status)}?`,
        message: stepBackMessage(move.status),
        confirmText: move.label,
        cancelText: 'Keep Status',
        theme: 'primary',
      });
      if (!ok) return;
    } else {
      // Every other move asks too: it can email the shopper and move stock.
      if (!(await this.#ask(forwardMoveDialog(row, move)))) return;
    }
    await this.#run('status', async () => {
      const result = await this.#ordersAdmin.setOrderStatus(row.orderId, move.status, reason);
      const done =
        move.status === 'cancelled' ? 'Order cancelled.' : `Order marked as ${statusName(move.status)}.`;
      const missed = result.notReturned ?? 0;
      if (missed > 0) {
        this.#snackbar.info(
          `${done} ${missed === 1 ? '1 item' : `${missed} items`} couldn't go back into stock because the size or product is gone. Check the product's stock.`,
          'Close',
          8000,
        );
      } else {
        this.#snackbar.success(done);
      }
    });
  }

  /**
   * Reopen Order (ATS-325): asks first, then puts the cancelled order back to its status before
   * the cancel. The server checks the 7 days, takes stock again and emails the shopper.
   */
  async reopenOrder(): Promise<void> {
    const row = this.row();
    const reopen = row.reopen;
    if (!reopen || this.busy()) return;
    const ok = await this.#ask({
      title: `Reopen ${row.orderRef}?`,
      message: `This puts the order back to ${statusName(reopen.status)}, ${reopen.takesStock ? 'takes the items out of stock again ' : ''}and emails the shopper that their order is back on.`,
      confirmText: 'Reopen Order',
      cancelText: 'Keep Cancelled',
      theme: 'primary',
    });
    if (!ok) return;
    await this.#run('status', async () => {
      const result = await this.#ordersAdmin.reopenOrder(row.orderId);
      this.#snackbar.success(`Order reopened as ${statusName(result.status)}.`);
    });
  }

  /**
   * Large Egypt order: save the delivery fee agreed with the shopper on WhatsApp. Sets the order
   * total, so the shopper's order page shows what to pay; Confirm unlocks after this.
   */
  async setDeliveryFee(): Promise<void> {
    const row = this.row();
    if (!row.deliveryFeeAction || this.busy()) return;
    const ref = this.#dialog.open<DeliveryFeeDialogComponent, DeliveryFeeDialogData, number>(
      DeliveryFeeDialogComponent,
      { data: { orderRef: row.orderRef, currentFeeEgp: row.deliveryFeeEgp }, width: '440px' },
    );
    const fee = await firstValueFrom(ref.afterClosed());
    if (typeof fee !== 'number') return;
    await this.#run('fee', async () => {
      await this.#ordersAdmin.setDeliveryFee(row.orderId, fee);
      this.#snackbar.success('Delivery fee saved.');
    });
  }

  /** Asks first, then deletes the order for good. On the order's own page, goes back to the list. */
  async deleteOrder(): Promise<void> {
    const row = this.row();
    if (!this.canDelete() || this.busy()) return;
    const ok = await this.#ask({
      title: `Delete order ${row.orderRef}?`,
      message:
        "The order disappears from Orders and from the customer's account, and its order link stops working. This can't be undone.",
      confirmText: 'Delete Order',
      cancelText: 'Keep Order',
      theme: 'error',
    });
    if (!ok) return;
    const onOrderPage = this.#router.url.startsWith(`/admin/orders/${row.orderId}`);
    this.busy.set('delete');
    try {
      await this.#ordersAdmin.deleteOrder(row.orderId);
      this.#snackbar.success(`Order ${row.orderRef} deleted.`);
      if (onOrderPage) {
        await this.#router.navigateByUrl('/admin/orders');
      } else {
        this.afterChange()();
      }
    } catch (error: unknown) {
      this.#snackbar.error(orderActionError(error));
    } finally {
      this.busy.set(null);
    }
  }

  async #run(action: OrderAction, work: () => Promise<void>): Promise<void> {
    this.busy.set(action);
    try {
      await work();
      this.afterChange()();
    } catch (error: unknown) {
      this.#snackbar.error(orderActionError(error));
    } finally {
      this.busy.set(null);
    }
  }

  async #ask(data: ConfirmDialogData): Promise<boolean> {
    const ref = this.#dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      { data, width: '440px' },
    );
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
