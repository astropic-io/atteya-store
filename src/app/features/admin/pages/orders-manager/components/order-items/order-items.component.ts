import { NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import type { OrderDetails } from '../../models/order-admin.model';

/**
 * The items of one order (photo, options, offer, unit and line price, live stock) and the money
 * under them (Subtotal, Shipping, Total). One layout for every width: photo, text, price.
 * A Bank Transfer order from abroad (`details.abroad`, ATS-304) shows each price three ways:
 * Customer pays, In pounds and Price in Egypt, in columns from \@xl and as label / value rows
 * under each item below that.
 */
@Component({
  selector: 'app-order-items',
  host: { class: 'block w-full @container' },
  imports: [NgOptimizedImage, NgTemplateOutlet, RouterLink, AppImageFallbackDirective],
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
              </div>
            </li>
          }
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
  readonly details = input.required<OrderDetails>();
}
