import { Component, computed, input, model } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { OfferDraft, OfferSaleItemsPolicy } from '@core/services/offers/engine';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { SALE_SKIP_FIX_LINE, saleSkipWarning } from '../../models/offer-admin.model';

/** Step 3 → Extras → More settings: products already on sale, badge override and priority. */
@Component({
  selector: 'app-offer-settings',
  host: { class: 'block w-full' },
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, SharedIconModule],
  templateUrl: './offer-settings.component.html',
})
export class OfferSettingsComponent {
  readonly draft = model.required<OfferDraft>();
  /** How many products the offer reaches (step 2's count). */
  readonly total = input(0);
  /** How many of them are already on sale (step 2's "already on sale" number). */
  readonly onSale = input(0);

  readonly saleSkipWarning = computed(() =>
    saleSkipWarning(this.draft().saleItems, { total: this.total(), onSale: this.onSale() }),
  );
  readonly saleSkipFixLine = SALE_SKIP_FIX_LINE;

  readonly saleItemsExplanation = computed(() =>
    this.draft().saleItems === 'exclude'
      ? 'Products that already have a sale price keep it and get nothing more.'
      : 'Shoppers get whichever price is lower, never both discounts.',
  );

  onBadgeChange(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.draft.update((prev) => ({ ...prev, badge: raw.trim() ? raw : null }));
  }

  onSaleItemsChange(value: OfferSaleItemsPolicy): void {
    this.draft.update((prev) => ({ ...prev, saleItems: value === 'exclude' ? 'exclude' : 'bestOf' }));
  }

  onPriorityChange(event: Event): void {
    const parsed = Number.parseInt((event.target as HTMLInputElement).value, 10);
    const priority = Number.isFinite(parsed) ? Math.max(-100, Math.min(100, parsed)) : 0;
    this.draft.update((prev) => ({ ...prev, priority }));
  }
}
