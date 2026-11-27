import { NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  ITEM_CANCEL_REASON_MAX,
  ITEM_CANCEL_REFUND_TO_MAX,
  planItemCancel,
  type ItemCancelRequest,
} from '@core/config/order-item-cancel';
import { orderStockTaken } from '@core/config/order-status';
import type { OrderDoc } from '@core/services/orders/order.schema';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { formatMoney } from '@shared/utils/money';
import type { OrderDetailItem } from '../../models/order-admin.model';

export interface CancelItemDialogData {
  readonly order: OrderDoc;
  /** `#A1B2C3`. */
  readonly orderRef: string;
  readonly item: OrderDetailItem;
}

const egp = (amount: number) => formatMoney(amount, 'EGP', 0);

/**
 * Cancel Item (ATS-342): how many pieces, the amount off (the paid share by default, editable
 * between the lowest and the paid share), where to send a refund, a staff-only reason and the
 * customer email switch. Previews with the same `planItemCancel()` the server runs. Closes with
 * the request, or nothing for Keep Item.
 */
@Component({
  selector: 'app-cancel-item-dialog',
  imports: [
    NgOptimizedImage,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    SharedIconModule,
    AppImageFallbackDirective,
  ],
  template: `
    <h2 mat-dialog-title class="font-title-lg font-bold!">Cancel an Item from {{ data.orderRef }}?</h2>
    <form (submit)="$event.preventDefault(); save()">
      <mat-dialog-content>
        <div class="elements-start-col items-stretch! gap-4">
          <div
            class="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 p-3 border border-outline-variant border-shape"
          >
            <div class="size-12 admin-order-photo">
              @if (data.item.imagePath; as path) {
                <img
                  [ngSrc]="data.item.imageSrc"
                  [appImageFallback]="path"
                  [alt]="data.item.name"
                  width="48"
                  height="48"
                  class="size-full object-contain p-1"
                />
              }
            </div>
            <div class="elements-start-col gap-0.5 min-w-0">
              <span class="font-body-md font-bold! break-words">{{ data.item.name }}</span>
              <span class="admin-order-muted break-words">
                {{ data.item.options ? data.item.options + ' · ' : '' }}{{ data.item.quantity }} in this order
              </span>
            </div>
          </div>

          @if (data.item.quantity > 1) {
            <div class="elements-start-col gap-2">
              <span id="cancel-item-qty" class="font-label-lg font-bold!">How many to cancel?</span>
              <div class="elements-start gap-2" role="group" aria-labelledby="cancel-item-qty">
                <button
                  matIconButton
                  type="button"
                  aria-label="One less"
                  [disabled]="quantity() <= 1"
                  (click)="setQuantity(quantity() - 1)"
                >
                  <mat-icon name="remove" />
                </button>
                <span class="w-10 text-center font-title-md font-bold!" aria-live="polite">{{
                  quantity()
                }}</span>
                <button
                  matIconButton
                  type="button"
                  aria-label="One more"
                  [disabled]="quantity() >= data.item.quantity"
                  (click)="setQuantity(quantity() + 1)"
                >
                  <mat-icon name="add" />
                </button>
              </div>
            </div>
          }

          @if (refusal(); as message) {
            <p class="font-body-md font-bold!" role="alert">{{ message }}</p>
          }

          @if (plan(); as p) {
            <div
              class="elements-start-col items-stretch! gap-2 p-4 bg-surface-container border-shape font-body-md"
            >
              <span class="font-label-md font-bold! uppercase tracking-wide">What happens</span>
              <p class="admin-order-pair">
                <span>{{ stockLine() }}</span>
              </p>
              <p class="admin-order-pair">
                <span>New order total</span>
                <span class="whitespace-nowrap">
                  <s class="admin-order-muted">{{ money(p.previousTotalEgp) }}</s>
                  <span class="font-bold!"> {{ money(p.totalEgp) }}</span>
                </span>
              </p>
              <p class="admin-order-pair">
                <span>Shipping</span>
                <span class="whitespace-nowrap">{{ money(p.shippingEgp) }}, stays the same</span>
              </p>
              @if (p.refundOwed && p.amountOffEgp > 0) {
                <p class="admin-order-pair font-bold!">
                  <span>Customer paid by InstaPay, so refund</span>
                  <span class="whitespace-nowrap">{{ money(p.amountOffEgp) }}</span>
                </p>
              }
              @if (p.gifts.length) {
                <p class="admin-order-muted">
                  {{ giftLine() }}
                </p>
              }
              @if (p.inGroupDeal && p.minAmountOffEgp < p.maxAmountOffEgp) {
                <p class="p-3 border border-dashed border-outline border-shape font-body-sm">
                  {{ quantity() === 1 ? 'This piece was' : 'These pieces were' }} part of an offer. The
                  {{ p.refundOwed ? 'refund is what the customer paid' : 'amount off is their price' }} for
                  {{ quantity() === 1 ? 'it' : 'them' }}. The pieces left cost more without the full offer, so
                  you can lower it to {{ money(p.minAmountOffEgp) }} if you agreed that with the customer.
                </p>
              }
            </div>

            <div class="elements-start-col items-stretch! gap-3">
              <mat-form-field class="w-full" subscriptSizing="dynamic" appearance="outline">
                <mat-label>{{ p.refundOwed ? 'Refund (EGP)' : 'Amount off (EGP)' }}</mat-label>
                <input
                  matInput
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  [value]="amount()"
                  [placeholder]="'' + p.defaultAmountOffEgp"
                  (input)="amount.set($any($event.target).value)"
                  [attr.aria-invalid]="amountError() ? 'true' : null"
                />
                <mat-hint [attr.role]="amountError() ? 'alert' : null">{{
                  amountError() || amountHint()
                }}</mat-hint>
              </mat-form-field>
              @if (showRefundTo()) {
                <mat-form-field class="w-full" subscriptSizing="dynamic" appearance="outline">
                  <mat-label>Send to (InstaPay)</mat-label>
                  <input
                    matInput
                    type="text"
                    autocomplete="off"
                    [attr.maxlength]="refundToMax"
                    [value]="refundTo()"
                    (input)="refundTo.set($any($event.target).value)"
                  />
                  <mat-hint>The customer sees this number in the email.</mat-hint>
                </mat-form-field>
              }
            </div>
          }

          <mat-form-field class="w-full" subscriptSizing="dynamic" appearance="outline">
            <mat-label>Reason (optional)</mat-label>
            <textarea
              matInput
              rows="2"
              [attr.maxlength]="reasonMax"
              [value]="reason()"
              (input)="reason.set($any($event.target).value)"
            ></textarea>
            <mat-hint>Only staff see this. {{ reason().trim().length }} / {{ reasonMax }}</mat-hint>
          </mat-form-field>

          <mat-checkbox [checked]="emailCustomer()" (change)="emailCustomer.set($event.checked)">
            Email the customer the updated order
          </mat-checkbox>
        </div>
      </mat-dialog-content>
      <mat-dialog-actions align="end" class="gap-2 px-6 pb-4">
        <button matButton="text" type="button" [mat-dialog-close]="undefined">Keep Item</button>
        <button matButton="filled" theme="error" type="submit" [disabled]="!canSave()">
          Cancel {{ quantity() }} {{ quantity() === 1 ? 'Item' : 'Items' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class CancelItemDialogComponent {
  readonly data = inject<CancelItemDialogData>(MAT_DIALOG_DATA);
  readonly #ref = inject<MatDialogRef<CancelItemDialogComponent, ItemCancelRequest>>(MatDialogRef);

  readonly reasonMax = ITEM_CANCEL_REASON_MAX;
  readonly refundToMax = ITEM_CANCEL_REFUND_TO_MAX;
  readonly money = egp;
  readonly #stockTaken = orderStockTaken(this.data.order as unknown as Record<string, unknown>);

  readonly quantity = signal(1);
  /** Typed amount; empty = the paid share (the default). */
  readonly amount = signal('');
  readonly refundTo = signal(this.data.order.shipping.phone ?? '');
  readonly reason = signal('');
  readonly emailCustomer = signal(true);

  /** The typed amount as whole pounds, null when empty, NaN when not a whole number. */
  readonly #typedAmount = computed((): number | null => {
    const text = this.amount().trim().replace(/,/g, '');
    if (text === '') return null;
    return /^\d+$/.test(text) ? Number(text) : Number.NaN;
  });

  /** The plan for the pieces with the default amount (for the range and the preview). */
  readonly #basePlan = computed(() =>
    planItemCancel(this.data.order, {
      lineIndex: this.data.item.lineIndex,
      quantity: this.quantity(),
      amountOffEgp: null,
    }),
  );

  readonly refusal = computed(() => {
    const base = this.#basePlan();
    return base.ok ? null : base.message;
  });

  readonly amountError = computed(() => {
    const base = this.#basePlan();
    const typed = this.#typedAmount();
    if (!base.ok || typed === null) return '';
    if (Number.isNaN(typed)) return 'Enter whole pounds.';
    const { minAmountOffEgp: min, maxAmountOffEgp: max } = base.plan;
    return typed < min || typed > max ? `Enter from ${egp(min)} to ${egp(max)}.` : '';
  });

  readonly amountHint = computed(() => {
    const base = this.#basePlan();
    if (!base.ok) return '';
    const { minAmountOffEgp: min, maxAmountOffEgp: max, refundOwed } = base.plan;
    // Only a Confirmed InstaPay order was paid already; otherwise it's what those pieces cost them.
    const full = `${refundOwed ? 'What they paid' : 'Their price for these pieces'}: ${egp(max)}.`;
    return min < max ? `${full} Lowest: ${egp(min)}.` : full;
  });

  /** The preview with the typed amount when it's valid, else the default. */
  readonly plan = computed(() => {
    const base = this.#basePlan();
    if (!base.ok) return null;
    const typed = this.#typedAmount();
    if (typed === null || Number.isNaN(typed) || this.amountError()) return base.plan;
    const withAmount = planItemCancel(this.data.order, {
      lineIndex: this.data.item.lineIndex,
      quantity: this.quantity(),
      amountOffEgp: typed,
    });
    return withAmount.ok ? withAmount.plan : base.plan;
  });

  readonly showRefundTo = computed(() => {
    const p = this.plan();
    return !!p && p.refundOwed && p.amountOffEgp > 0;
  });

  readonly stockLine = computed(() => {
    if (!this.#stockTaken) return "Nothing was taken out of stock yet, so there's nothing to put back.";
    // The free gifts that drop with the item go back too.
    const q = this.quantity() + this.giftPieces();
    return `${q === 1 ? '1 piece goes' : `${q} pieces go`} back into stock`;
  });

  /** Free gift pieces that drop with this cancel. */
  readonly giftPieces = computed(() => (this.plan()?.gifts ?? []).reduce((sum, g) => sum + g.quantity, 0));

  readonly giftLine = computed(() => {
    const n = this.giftPieces();
    return n === 1 ? 'Its free gift is cancelled with it.' : `Its ${n} free gifts are cancelled with it.`;
  });

  readonly canSave = computed(
    () =>
      this.plan() !== null &&
      !this.amountError() &&
      (!this.showRefundTo() || this.refundTo().trim().length > 0),
  );

  setQuantity(value: number): void {
    this.quantity.set(Math.min(Math.max(1, value), this.data.item.quantity));
  }

  save(): void {
    const p = this.plan();
    if (!p || !this.canSave()) return;
    const typed = this.#typedAmount();
    const reason = this.reason().trim().slice(0, ITEM_CANCEL_REASON_MAX);
    const refundTo = this.refundTo().trim().slice(0, ITEM_CANCEL_REFUND_TO_MAX);
    // What this page showed at that place, so the server refuses if the order changed meanwhile.
    const shown = this.data.order.pricing.lines[this.data.item.lineIndex];
    this.#ref.close({
      orderId: this.data.order.id,
      lineIndex: this.data.item.lineIndex,
      quantity: this.quantity(),
      amountOffEgp: typed === null ? null : p.amountOffEgp,
      refundTo: this.showRefundTo() ? refundTo : null,
      reason: reason || null,
      emailCustomer: this.emailCustomer(),
      expected: shown
        ? {
            productId: shown.productId,
            selection: { ...(shown.selection ?? {}) },
            lineQuantity: shown.quantity,
          }
        : null,
    });
  }
}
