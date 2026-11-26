import { NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ItemCancelRequest } from '@core/config/order-item-cancel';
import { AuthService } from '@core/services/auth/auth.service';
import type { OrderDoc } from '@core/services/orders/order.schema';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/ui/dialogs/confirm-dialog/confirm-dialog.component';
import { formatMoney } from '@shared/utils/money';
import {
  CancelItemDialogComponent,
  type CancelItemDialogData,
} from '../../dialogs/cancel-item-dialog/cancel-item-dialog.component';
import type { OrderCancelledItem, OrderDetailItem, OrderDetails } from '../../models/order-admin.model';
import { OrdersAdminService } from '../../services/orders-admin.service';
import { orderActionError } from '../../utils/order-action-error';

/**
 * The items of one order (photo, options, offer, unit and line price, live stock) and the money
 * under them (Subtotal, Shipping, Total). One layout for every width: photo, text, price.
 * A Bank Transfer order from abroad (`details.abroad`, ATS-304) shows each price three ways:
 * Customer pays, In pounds and Price in Egypt, in columns from \@xl and as label / value rows
 * under each item below that.
 * With `order` and `afterChange` (the order page), each item gets Cancel Item when the order allows
 * it, and a cancelled item still owing a refund gets Refund Sent for admins (ATS-342).
 */
@Component({
  selector: 'app-order-items',
  host: { class: 'block w-full @container' },
  imports: [
    NgOptimizedImage,
    NgTemplateOutlet,
    RouterLink,
    MatButtonModule,
    MatProgressSpinnerModule,
    AppImageFallbackDirective,
  ],
  template: `
    @let d = details();
    <section class="admin-order-box gap-0!" [attr.aria-label]="'Items, ' + d.pieces">
      <h3 class="admin-order-box__title pb-2">Items ({{ d.pieces }})</h3>
      @let a = d.abroad;
      @if (a) {
        <div
          class="hidden @xl:grid admin-order-abroad-row pb-2 font-label-md text-on-surface-variant"
          [class.admin-order-abroad-row--two]="!a.showPounds"
          aria-hidden="true"
        >
          <span class="col-span-2"></span>
          <span class="text-end">Customer pays</span>
          @if (a.showPounds) {
            <span class="text-end">In pounds</span>
          }
          <span class="text-end">Price in Egypt</span>
        </div>
      }
      <ul>
        @for (item of d.items; track item.key) {
          @if (item.abroad; as cells) {
            <li
              class="admin-order-abroad-row py-3 border-t border-outline-variant"
              [class.admin-order-abroad-row--two]="!a?.showPounds"
            >
              <ng-container [ngTemplateOutlet]="photo" [ngTemplateOutletContext]="{ $implicit: item }" />
              <ng-container [ngTemplateOutlet]="info" [ngTemplateOutletContext]="{ $implicit: item }" />
              <dl class="admin-order-abroad-cells">
                <div class="admin-order-abroad-cell">
                  <dt class="admin-order-muted @xl:sr-only">Customer pays</dt>
                  <dd class="elements-end-col items-end! gap-0.5">
                    @if (item.was; as was) {
                      <s class="admin-order-muted">{{ was }}</s>
                    }
                    <span class="font-body-md font-bold!">{{ cells.customer }}</span>
                  </dd>
                </div>
                @if (cells.pounds; as pounds) {
                  <div class="admin-order-abroad-cell">
                    <dt class="admin-order-muted @xl:sr-only">In pounds</dt>
                    <dd>{{ pounds }}</dd>
                  </div>
                }
                <div class="admin-order-abroad-cell admin-order-muted">
                  <dt class="@xl:sr-only">Price in Egypt</dt>
                  <dd class="elements-end-col items-end! gap-0.5">
                    <span>{{ cells.egypt }}</span>
                    @if (cells.extra; as extra) {
                      <span>{{ extra }}</span>
                    }
                  </dd>
                </div>
              </dl>
            </li>
          } @else {
            <li
              class="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-start gap-3 py-3 border-t border-outline-variant"
            >
              <ng-container [ngTemplateOutlet]="photo" [ngTemplateOutletContext]="{ $implicit: item }" />
              <ng-container [ngTemplateOutlet]="info" [ngTemplateOutletContext]="{ $implicit: item }" />
              <div class="elements-end-col items-end! gap-0.5 text-end whitespace-nowrap">
                @if (item.was; as was) {
                  <s class="admin-order-muted">{{ was }}</s>
                }
                <span class="font-body-md font-bold!">{{ item.price }}</span>
                @if (canAct() && item.cancellable) {
                  <button
                    matButton="outlined"
                    type="button"
                    class="mt-1"
                    [disabled]="busy() !== null"
                    [attr.aria-label]="'Cancel item: ' + item.name"
                    (click)="cancelItem(item)"
                  >
                    @if (busy() === item.key) {
                      <mat-progress-spinner mode="indeterminate" diameter="18" />
                    } @else {
                      <span>Cancel Item</span>
                    }
                  </button>
                }
              </div>
            </li>
          }
        }
        @for (c of d.cancelled; track c.id) {
          <li
            class="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-start gap-3 py-3 border-t border-dashed border-outline bg-surface-container-low"
          >
            <div class="size-14 admin-order-photo opacity-60">
              @if (c.imagePath; as path) {
                <img
                  [ngSrc]="c.imageSrc"
                  [appImageFallback]="path"
                  [alt]="c.name"
                  width="56"
                  height="56"
                  class="size-full object-contain p-1"
                />
              }
            </div>
            <div class="elements-start-col gap-0.5 min-w-0 text-on-surface-variant">
              <span class="elements-start flex-wrap gap-2">
                <s class="font-body-md break-words">{{ c.name }}</s>
                <span class="admin-order-cancelled-tag">Cancelled ×{{ c.quantity }}</span>
              </span>
              @if (c.options) {
                <span class="font-label-md break-words">{{ c.options }}</span>
              }
              <span class="font-label-md">{{ c.stock }}{{ c.gifts ? ' · ' + c.gifts : '' }}</span>
              <span class="font-label-md break-words">{{ c.meta }}</span>
            </div>
            <div class="elements-end-col items-end! gap-0.5 text-end">
              <s class="admin-order-muted whitespace-nowrap">{{ c.amountOff }}</s>
              @if (c.refund; as refund) {
                <span class="font-label-md font-bold! break-words max-w-40">{{ refund }}</span>
              }
              @if (canAct() && isAdmin() && c.refundToSendEgp > 0) {
                <button
                  matButton="filled"
                  type="button"
                  class="mt-1"
                  [disabled]="busy() !== null"
                  (click)="refundSent(c)"
                >
                  @if (busy() === c.id) {
                    <mat-progress-spinner mode="indeterminate" diameter="18" />
                  } @else {
                    <span>Refund Sent</span>
                  }
                </button>
              }
            </div>
          </li>
        }
      </ul>

      @if (a) {
        <div class="admin-order-totals">
          @for (row of a.totals; track row.label) {
            <div
              role="group"
              [attr.aria-label]="row.label"
              class="admin-order-abroad-row gap-y-1"
              [class.admin-order-abroad-row--two]="!a.showPounds"
              [class.pt-2]="row.strong"
              [class.border-t]="row.strong"
              [class.border-primary]="row.strong"
              [class.font-title-md]="row.strong"
              [class.font-bold!]="row.strong"
            >
              <span class="col-span-2">{{ row.label }}</span>
              <p class="admin-order-abroad-cell">
                <span class="admin-order-muted @xl:sr-only">Customer pays</span>
                <span>{{ row.customer }}</span>
              </p>
              @if (a.showPounds) {
                <p class="admin-order-abroad-cell">
                  <span class="admin-order-muted @xl:sr-only">In pounds</span>
                  <span>{{ row.pounds }}</span>
                </p>
              }
              <p class="admin-order-abroad-cell admin-order-muted">
                <span class="@xl:sr-only">Price in Egypt</span>
                <span>{{ row.egypt }}</span>
              </p>
            </div>
          }
          @if (a.note; as note) {
            <div class="elements-start-col items-stretch! gap-1 mt-1 p-3 bg-surface-container border-shape">
              <p class="admin-order-pair font-bold!">
                <span>Extra from abroad prices</span>
                <span class="whitespace-nowrap">{{ note.extra }}</span>
              </p>
              @if (note.rate; as rate) {
                <p class="admin-order-muted">{{ rate }}</p>
              }
              <p class="admin-order-muted">Pounds are about: your bank's rate may differ</p>
            </div>
          }
        </div>
      } @else {
        <dl class="admin-order-totals @xl:ms-auto @xl:w-80">
          @for (row of d.totals; track row.label) {
            <div class="admin-order-pair">
              <dt>{{ row.label }}</dt>
              <dd class="whitespace-nowrap">{{ row.value }}</dd>
            </div>
          }
          <div class="admin-order-pair pt-2 border-t border-primary font-title-md font-bold!">
            <dt>Total</dt>
            <dd class="whitespace-nowrap">{{ d.total }}</dd>
          </div>
          @if (d.totalEgp; as egp) {
            <div class="admin-order-pair admin-order-muted">
              <dt>Total in EGP</dt>
              <dd class="whitespace-nowrap">{{ egp }}</dd>
            </div>
          }
          @for (row of d.afterTotal; track row.label) {
            <div
              class="admin-order-pair"
              [class.admin-order-muted]="row.muted"
              [class.font-bold!]="row.strong"
            >
              <dt>{{ row.label }}</dt>
              <dd class="whitespace-nowrap">
                @if (row.muted) {
                  <s>{{ row.value }}</s>
                } @else {
                  {{ row.value }}
                }
              </dd>
            </div>
          }
        </dl>
      }
    </section>

    <ng-template #photo let-item>
      <div class="size-14 admin-order-photo">
        @if (item.imagePath; as path) {
          <img
            [ngSrc]="item.imageSrc"
            [appImageFallback]="path"
            [alt]="item.name"
            width="56"
            height="56"
            class="size-full object-contain p-1"
          />
        }
      </div>
    </ng-template>

    <ng-template #info let-item>
      <div class="elements-start-col gap-0.5 min-w-0">
        @if (item.productExists) {
          <a
            class="font-body-md font-bold! underline-offset-2 hover:underline break-words"
            [routerLink]="['/admin/products', item.productId]"
            >{{ item.name }}</a
          >
        } @else {
          <span class="font-body-md font-bold! break-words">{{ item.name }}</span>
        }
        @if (item.gift; as gift) {
          <span class="admin-order-muted">{{ gift }} · × {{ item.quantity }}</span>
        }
        @if (item.options) {
          <span class="admin-order-muted break-words">{{ item.options }}</span>
        }
        @if (item.unit; as unit) {
          <span class="admin-order-muted">{{ unit }}</span>
        }
        @if (item.deal; as deal) {
          <span class="font-label-md font-bold!">Offer · {{ deal }}</span>
        }
        <span class="admin-order-muted" [class.font-bold!]="item.stockStatus !== 'in'"
          >Stock now: {{ item.stock }}</span
        >
      </div>
    </ng-template>
  `,
})
export class OrderItemsComponent {
  readonly #ordersAdmin = inject(OrdersAdminService);
  readonly #snackbar = inject(SnackbarService);
  readonly #dialog = inject(MatDialog);
  readonly #auth = inject(AuthService);

  readonly details = input.required<OrderDetails>();
  /** The order itself; with `afterChange`, Cancel Item and Refund Sent show. */
  readonly order = input<OrderDoc | null>(null);
  /** `#A1B2C3`, for the dialog titles. */
  readonly orderRef = input('');
  /** The parent's reload after a cancel or Refund Sent. */
  readonly afterChange = input<(() => void) | null>(null);

  /** The item key or cancel id being saved. */
  readonly busy = signal<string | null>(null);
  readonly isAdmin = this.#auth.isAdmin;

  canAct(): boolean {
    return this.order() !== null && this.afterChange() !== null;
  }

  /** Opens Cancel Item; the server checks the rules again on the live order. */
  async cancelItem(item: OrderDetailItem): Promise<void> {
    const order = this.order();
    if (!order || this.busy()) return;
    const ref = this.#dialog.open<CancelItemDialogComponent, CancelItemDialogData, ItemCancelRequest>(
      CancelItemDialogComponent,
      { data: { order, orderRef: this.orderRef(), item }, width: '520px', maxWidth: '95vw' },
    );
    const request = await firstValueFrom(ref.afterClosed());
    if (!request) return;
    await this.#run(item.key, async () => {
      const result = await this.#ordersAdmin.cancelOrderItem(request);
      const pieces = request.quantity === 1 ? 'Item' : `${request.quantity} items`;
      let done = `${pieces} cancelled. New total ${egp(result.totalEgp)}.`;
      if (result.refundEgp > 0) done += ` Send ${egp(result.refundEgp)} back, then press Refund Sent.`;
      if (result.notReturned > 0) {
        this.#snackbar.info(
          `${done} ${result.notReturned === 1 ? '1 piece' : `${result.notReturned} pieces`} couldn't go back into stock because the size or product is gone.`,
          'Close',
          8000,
        );
      } else {
        this.#snackbar.success(done);
      }
    });
  }

  /** Admins: the item's refund went out by InstaPay. Asks first. */
  async refundSent(item: OrderCancelledItem): Promise<void> {
    const order = this.order();
    if (!order || this.busy()) return;
    const ref = this.#dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: `Mark ${egp(item.refundToSendEgp)} as Sent?`,
          message: `Only press this after the ${egp(item.refundToSendEgp)} for ${item.name} left your InstaPay. The customer's order page then shows the refund as sent.`,
          confirmText: 'Refund Sent',
          cancelText: 'Not Yet',
          theme: 'primary',
        },
        width: '440px',
      },
    );
    if ((await firstValueFrom(ref.afterClosed())) !== true) return;
    await this.#run(item.id, async () => {
      await this.#ordersAdmin.markItemRefundSent(order.id, item.id);
      this.#snackbar.success('Refund marked as sent.');
    });
  }

  async #run(key: string, work: () => Promise<void>): Promise<void> {
    this.busy.set(key);
    try {
      await work();
      this.afterChange()?.();
    } catch (error: unknown) {
      this.#snackbar.error(orderActionError(error));
    } finally {
      this.busy.set(null);
    }
  }
}

const egp = (amount: number) => formatMoney(amount, 'EGP', 0);
