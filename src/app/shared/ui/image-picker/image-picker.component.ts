import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgOptimizedImage } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { ImageInputError, ImageSourceService } from '@core/services/storage';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import { ImageAsset } from '@shared/schemas';
import { PhotoFitNoteComponent, PhotoSizeLineComponent } from '@shared/ui/photo-fit';
import {
  checkPhotoFit,
  heroPhoneAreaPercent,
  IMAGE_LIMITS,
  PHOTO_SPOTS,
  PhotoSpot,
  PhotoSpotId,
  ImageFolderPath,
  isExternalUrl,
  looksLikeDomainUrl,
  normalizeImageKitPath,
  sanitizeAltFromFilename,
} from '@shared/utils/image';

let nextPickerId = 0;

@Component({
  selector: 'app-image-picker',
  templateUrl: './image-picker.component.html',
  imports: [
    FormsModule,
    NgOptimizedImage,
    AppImageFallbackDirective,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    SharedIconModule,
    PhotoSizeLineComponent,
    PhotoFitNoteComponent,
  ],
})
export class ImagePickerComponent {
  readonly #imageSource = inject(ImageSourceService);
  readonly #snackbar = inject(SnackbarService);

  readonly folder = input<ImageFolderPath>('hero');
  readonly asset = model<ImageAsset | null>(null);
  readonly label = input<string>('Image');
  readonly subtitle = input<string>('Upload a photo or import from a web link.');
  readonly altPlaceholder = input<string>('e.g. Athlete training in performance sportswear');
  /** Preview shape when no `spot` is set. A spot sets the shape itself. */
  readonly aspectClass = input<string>('aspect-video');
  /** Where the photo shows on the store: sets the size line, preview shape and fit check (ATS-328). */
  readonly spot = input<PhotoSpotId | null>(null);
  readonly allowRemove = input<boolean>(false);
  /** Decorative photos can skip a description. Shop cards keep this off. */
  readonly altOptional = input<boolean>(false);

  readonly uploaded = output<string>();

  readonly #uid = ++nextPickerId;
  readonly #isUploadingFile = signal(false);
  readonly #isResolvingUrl = signal(false);
  readonly #showManualUrlInput = signal(false);
  readonly #manualUrlInput = signal('');
  readonly #hasImageLoadFailed = signal(false);

  protected readonly urlInputId = `image-picker-url-${this.#uid}`;
  protected readonly altInputId = `image-picker-alt-${this.#uid}`;
  protected readonly maxAltLength = IMAGE_LIMITS.maxAltLength;

  protected readonly isUploadingFile = this.#isUploadingFile.asReadonly();
  protected readonly isResolvingUrl = this.#isResolvingUrl.asReadonly();
  protected readonly showManualUrlInput = this.#showManualUrlInput.asReadonly();
  protected readonly manualUrlInput = this.#manualUrlInput.asReadonly();

  protected readonly photoSpot = computed<PhotoSpot | null>(() => {
    const id = this.spot();
    return id ? PHOTO_SPOTS[id] : null;
  });
  protected readonly isHeroBanner = computed(() => this.spot() === 'heroBanner');
  protected readonly previewAspectClass = computed(() => this.photoSpot()?.aspectClass ?? this.aspectClass());
  /** A tall photo preview is kept narrow, so it never fills the whole editor (about 20 × 25 rem for 4:5). */
  protected readonly previewSizeClass = computed(() => {
    const spot = this.photoSpot();
    return spot && spot.ratioHeight > spot.ratioWidth ? 'mx-auto max-w-80' : '';
  });
  /**
   * Size read at the last upload or import. Some editors keep only the path and alt text, so the
   * size would be lost on the way back in; this keeps the fit check working for that photo.
   */
  readonly #lastSize = signal<{ path: string; width?: number; height?: number } | null>(null);
  /** Null until the photo's size is known; never blocks saving. */
  protected readonly photoFit = computed(() => {
    const spot = this.photoSpot();
    const current = this.asset();
    if (!spot || !current?.path) return null;
    const last = this.#lastSize();
    const fromUpload = last?.path === current.path ? last : null;
    return checkPhotoFit(spot, current.width ?? fromUpload?.width, current.height ?? fromUpload?.height);
  });
  protected readonly photoWidth = computed(() => this.photoFit()?.size.width);
  protected readonly photoHeight = computed(() => this.photoFit()?.size.height);
  /** Hero: the phone's slice drawn on the computer preview, matching the Phone preview beside it. */
  protected readonly phoneArea = computed(() => {
    const fit = this.photoFit();
    return heroPhoneAreaPercent(fit?.size, !!fit && !fit.fits);
  });

  protected readonly isExternalUrlInput = computed(() => {
    const raw = this.#manualUrlInput().trim();
    if (!raw) return false;
    const target = looksLikeDomainUrl(raw) ? `https://${raw}` : raw;
    return isExternalUrl(target);
  });

  protected readonly validPreviewPath = computed<string | null>(() => {
    if (this.#hasImageLoadFailed()) return null;
    const current = this.asset();
    if (!current?.path) return null;
    const path = normalizeImageKitPath(current.path);
    if (!path || path === 'hero/default-hero.jpg') {
      return null;
    }
    return path;
  });

  constructor() {
    effect(() => {
      const _currentPath = this.asset()?.path;
      this.#hasImageLoadFailed.set(false);
    });
  }

  protected toggleManualUrl(): void {
    this.#showManualUrlInput.update((open) => !open);
  }

  protected setManualUrlInput(value: string): void {
    this.#manualUrlInput.set(value);
  }

  protected onImageFailed(): void {
    this.#hasImageLoadFailed.set(true);
  }

  protected onAltChange(newAlt: string): void {
    const trimmedAlt = newAlt.slice(0, IMAGE_LIMITS.maxAltLength);
    const current = this.asset();
    this.asset.set({
      path: current?.path ?? '',
      alt: trimmedAlt,
      width: current?.width,
      height: current?.height,
    });
  }

  protected removeAsset(): void {
    this.asset.set(null);
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;

    this.#isUploadingFile.set(true);
    try {
      this.#hasImageLoadFailed.set(false);
      const resolved = await this.#imageSource.uploadFile(file, this.folder());
      this.uploaded.emit(resolved.path);

      const currentAlt = this.asset()?.alt?.trim() ?? '';
      // An optional description stays empty rather than becoming the file name.
      const fallbackAlt = this.altOptional() ? '' : sanitizeAltFromFilename(file.name) || 'Store image';
      const nextAlt = currentAlt || fallbackAlt;

      this.#lastSize.set({ path: resolved.path, width: resolved.width, height: resolved.height });
      this.asset.set({
        path: resolved.path,
        alt: nextAlt,
        width: resolved.width,
        height: resolved.height,
      });

      if (resolved.cdnDelayed) {
        this.#snackbar.info('Image saved. It may take a moment to sync across the CDN.');
      } else {
        this.#snackbar.success('Image uploaded and ready in your live preview.');
      }
    } catch (err: unknown) {
      const message =
        err instanceof ImageInputError
          ? err.message
          : 'Unable to upload image. Please check your connection and try again.';
      this.#snackbar.error(message);
    } finally {
      this.#isUploadingFile.set(false);
      inputEl.value = '';
    }
  }

  protected async applyManualInput(): Promise<void> {
    const raw = this.#manualUrlInput().trim();
    if (!raw) return;

    this.#isResolvingUrl.set(true);
    try {
      this.#hasImageLoadFailed.set(false);
      const resolved = await this.#imageSource.resolveInput(raw, this.folder());
      if (resolved.wasUploaded) {
        this.uploaded.emit(resolved.path);
      }

      const currentAlt = this.asset()?.alt?.trim() ?? '';
      const lastSeg = resolved.path.split('/').pop() ?? '';
      const nextAlt =
        currentAlt || (this.altOptional() ? '' : sanitizeAltFromFilename(lastSeg) || 'Store image');

      this.#lastSize.set({ path: resolved.path, width: resolved.width, height: resolved.height });
      this.asset.set({
        path: resolved.path,
        alt: nextAlt,
        width: resolved.width,
        height: resolved.height,
      });

      this.#manualUrlInput.set('');
      if (resolved.cdnDelayed) {
        this.#snackbar.info('Image saved. It may take a moment to appear.');
      } else if (resolved.wasUploaded) {
        this.#snackbar.success('Image imported and saved to your store library.');
      } else {
        this.#snackbar.success('Image path verified and updated.');
      }
    } catch (err: unknown) {
      const message =
        err instanceof ImageInputError
          ? err.message
          : 'Unable to use that image link. Please verify the link and try again.';
      this.#snackbar.error(message);
    } finally {
      this.#isResolvingUrl.set(false);
    }
  }
}
