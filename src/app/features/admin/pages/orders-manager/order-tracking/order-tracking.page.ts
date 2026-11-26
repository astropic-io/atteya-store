import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, OnInit, PLATFORM_ID, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { returnEntry } from '@core/services/orders/order-returns';
import { SeoService } from '@core/services/seo';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import {
  RETURN_REQUEST_DIALOG_CONFIG,
  ReturnRequestDialogComponent,
  type ReturnRequestDialogData,
  type ReturnRequestDialogResult,
} from '../../../../returns/dialogs/return-request-dialog/return-request-dialog.component';
import { ReturnsAdminService } from '../../returns-manager/services/returns-admin.service';
import { orderActionError } from '../utils/order-action-error';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { SkeletonComponent } from '@shared/ui/skeleton';
import { StatusBadgeComponent } from '@shared/ui/status-badge/status-badge.component';
import { OrderActionsComponent } from '../components/order-actions/order-actions.component';
import { OrderInfoBoxesComponent } from '../components/order-info-boxes/order-info-boxes.component';
import { OrderItemsComponent } from '../components/order-items/order-items.component';
import { OrderReturnsLineComponent } from '../components/order-returns-line/order-returns-line.component';
import { ORDER_STATUS_CONFIG } from '../models/order-status-config';
import { OrdersAdminService } from '../services/orders-admin.service';
import { toOrderLineAdminRows } from '../utils/order-admin.utils';
import { orderDetails } from '../utils/order-details.utils';
import { orderListError } from '../utils/order-list-error';
import { trackingSteps } from '../utils/order-tracking.utils';

/**
 * One order in full: the header with its actions, the items and money, progress and every change
 * on the left, Customer, Delivery Address and Payment on the right. Below desktop width the
 * right-hand boxes come first, then the items.
 */
@Component({
  selector: 'app-order-tracking-page',
  host: { class: 'block w-full @container' },
  imports: [
    RouterLink,
    MatButtonModule,
    MatProgressSpinnerModule,
    SharedIconModule,
    SkeletonComponent,
    StatusBadgeComponent,
    OrderActionsComponent,
    OrderInfoBoxesComponent,
    OrderItemsComponent,
    OrderReturnsLineComponent,
  ],
  templateUrl: './order-tracking.page.html',
})
export class OrderTrackingPageComponent implements OnInit {
  readonly #ordersAdmin = inject(OrdersAdminService);
  readonly #seo = inject(SeoService);
  readonly #platformId = inject(PLATFORM_ID);
  readonly #dialog = inject(MatDialog);
  readonly #snackbar = inject(SnackbarService);
  readonly #returnsAdmin = inject(ReturnsAdminService);
  readonly #router = inject(Router);

  /** True while Start Return for Customer sends and approves the request. */
  readonly startingReturn = signal(false);

  /** From the `:orderId` route segment. */
  readonly orderId = input.required<string>();

  readonly orderStatusConfig = ORDER_STATUS_CONFIG;

  readonly dataResource = resource({
    params: () => ({ id: this.orderId() }),
    loader: async ({ params }) => {
      if (!isPlatformBrowser(this.#platformId)) return null;
      const order = await this.#ordersAdmin.getOrder(params.id);
      if (!order) return null;
      const [productsById, notesById] = await Promise.all([
        this.#ordersAdmin.loadProductStock([order]),
        this.#ordersAdmin.loadStaffNotes([order]),
      ]);
      return { order, productsById, notesById };
    },
  });

  readonly loadErrorMessage = computed((): string | null => {
    const error = this.dataResource.error();
    return error == null ? null : orderListError(error);
  });

  readonly first = computed(() => {
    const data = this.dataResource.value();
    return data ? (toOrderLineAdminRows([data.order], data.productsById, data.notesById)[0] ?? null) : null;
  });

  readonly order = computed(() => this.dataResource.value()?.order ?? null);

  /** Delivered in Egypt, inside the 14 days, no request open (ATS-342): Start Return for Customer shows. */
  readonly returnEntry = computed(() => {
    const order = this.order();
    return order ? returnEntry(order, Date.now()) : ({ kind: 'none' } as const);
  });

  readonly details = computed(() => {
    const data = this.dataResource.value();
    return data
      ? orderDetails(data.order, data.productsById, data.notesById.get(data.order.id) ?? null)
      : null;
  });

  readonly steps = computed(() => {
    const data = this.dataResource.value();
    return data ? trackingSteps(data.order) : [];
  });

  ngOnInit(): void {
    this.#seo.setPageMetadata({
      title: 'Order | Atteya Admin',
      description: 'Everything about one order: customer, delivery address, items, payment and progress.',
      noindex: true,
    });
  }

  /**
   * Start Return for Customer (ATS-342): the shopper's Return or Exchange screen in staff mode.
   * Once sent it is approved straight away (the customer gets the usual Approved email), unless a
   * Wrong Item Sent item needs the piece that was sent: then the request page opens to approve it.
   */
  async startReturn(): Promise<void> {
    const order = this.order();
    const entry = this.returnEntry();
    if (!order || entry.kind !== 'open' || this.startingReturn()) return;
    const ref = this.#dialog.open<
      ReturnRequestDialogComponent,
      ReturnRequestDialogData,
      ReturnRequestDialogResult
    >(ReturnRequestDialogComponent, {
      ...RETURN_REQUEST_DIALOG_CONFIG,
      data: {
        orderId: order.id,
        viewKey: null,
        order,
        until: entry.until,
        forCustomer: { name: order.shipping.fullName || 'the customer' },
      },
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;
    if (result.wrongItem) {
      this.#snackbar.info(
        `Request ${result.ref} sent. Pick the piece that was sent, then approve it.`,
        'Close',
        8000,
      );
      await this.#router.navigate(['/admin/returns', result.requestId]);
      return;
    }
    this.startingReturn.set(true);
    try {
      await this.#returnsAdmin.approve(result.requestId, []);
      this.#snackbar.success(`Request ${result.ref} approved. The customer gets the Approved email.`);
    } catch (error: unknown) {
      this.#snackbar.error(`Request ${result.ref} was sent but not approved. ${orderActionError(error)}`);
    } finally {
      this.startingReturn.set(false);
    }
    await this.#router.navigate(['/admin/returns', result.requestId]);
  }

  /** Passed to `app-order-actions`, which calls it after a save. */
  readonly reloadFn = (): void => {
    this.dataResource.reload();
  };
}
