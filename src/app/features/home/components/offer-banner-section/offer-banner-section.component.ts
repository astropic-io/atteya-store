import { Component, computed, input } from '@angular/core';
import { NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LinkTargetPipe } from '@shared/pipes/link-target.pipe';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { normalizeImageKitPath } from '@shared/utils/image';
import { HomeOfferBanner } from '../../models/home.model';

/** Text for the link when an older banner saved none. */
const FALLBACK_LINK_TEXT = 'Shop Now';

/**
 * Home Page Section 4 (ATS-347): one photo banner with its text on a dark fade, the whole banner
 * one link. The phone photo (4:5) is optional; without it the phone crops the wide photo.
 * `previewMode` (Admin → Home Page) draws it without the link.
 */
@Component({
  selector: 'app-offer-banner-section',
  host: {
    class: 'block w-full',
  },
  templateUrl: './offer-banner-section.component.html',
  imports: [
    RouterLink,
    LinkTargetPipe,
    NgOptimizedImage,
    NgTemplateOutlet,
    AppImageFallbackDirective,
    SharedIconModule,
  ],
})
export class OfferBannerSectionComponent {
  readonly banner = input.required<HomeOfferBanner>();
  readonly previewMode = input<boolean>(false);

  readonly widePhoto = computed(() => photoPath(this.banner().imageUrl));
  readonly phonePhoto = computed(() => photoPath(this.banner().phoneImageUrl));
  readonly linkText = computed(() => this.banner().linkText || FALLBACK_LINK_TEXT);
}

function photoPath(url: string): string | null {
  const path = normalizeImageKitPath(url);
  return path && path !== 'hero/default-hero.jpg' ? path : null;
}
