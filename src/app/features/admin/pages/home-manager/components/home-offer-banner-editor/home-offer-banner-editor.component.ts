import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { ImagePickerComponent } from '@shared/ui/image-picker';
import { ImageAsset } from '@shared/schemas';
import { HOME_TEXT_LIMITS } from '@features/home/data/home.data';
import { HomeOfferBanner } from '../../models/home-manager.model';
import { textLimitState } from '../../utils/home-text-limits';
import {
  NavTargetFieldComponent,
  type NavTargetChange,
} from '../../../navigation-manager/components/nav-target-field/nav-target-field.component';

/** Admin → Home Page → Section 4: the Offer Banner (ATS-347). */
@Component({
  selector: 'app-home-offer-banner-editor',
  templateUrl: './home-offer-banner-editor.component.html',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    ImagePickerComponent,
    NavTargetFieldComponent,
  ],
})
export class HomeOfferBannerEditorComponent {
  readonly banner = input.required<HomeOfferBanner>();
  /** Why shoppers won't see the banner, or null. */
  readonly note = input<string | null>(null);

  readonly enabledChange = output<boolean>();
  readonly targetChange = output<NavTargetChange>();
  readonly labelChange = output<string>();
  readonly headlineChange = output<string>();
  readonly imageUrlChange = output<string>();
  readonly imageAltChange = output<string>();
  readonly phoneImageUrlChange = output<string>();
  readonly sessionUpload = output<string>();

  readonly limits = HOME_TEXT_LIMITS;
  readonly headlineState = computed(() =>
    textLimitState(this.banner().headline, HOME_TEXT_LIMITS.bannerHeadline),
  );
  readonly labelState = computed(() => textLimitState(this.banner().label, HOME_TEXT_LIMITS.bannerLabel));

  readonly wideAsset = computed<ImageAsset>(() => ({
    path: this.banner().imageUrl,
    alt: this.banner().imageAlt,
  }));
  readonly phoneAsset = computed<ImageAsset | null>(() =>
    this.banner().phoneImageUrl ? { path: this.banner().phoneImageUrl, alt: '' } : null,
  );

  onEnabledChange(event: MatSlideToggleChange): void {
    this.enabledChange.emit(event.checked);
  }

  onWideChange(asset: ImageAsset | null): void {
    const current = this.banner();
    const path = asset?.path ?? '';
    const alt = asset?.alt ?? '';
    if (path !== current.imageUrl) this.imageUrlChange.emit(path);
    if (alt !== current.imageAlt) this.imageAltChange.emit(alt);
  }

  onPhoneChange(asset: ImageAsset | null): void {
    const path = asset?.path ?? '';
    if (path !== this.banner().phoneImageUrl) this.phoneImageUrlChange.emit(path);
  }
}
