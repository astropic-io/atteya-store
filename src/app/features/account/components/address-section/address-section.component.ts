import { Component, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { form, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  ABROAD_PHONE_MESSAGE,
  DELIVERY_FIELD_MESSAGES,
  EGYPT_PHONE_MESSAGE,
  isEgyptMobile,
  shopperWhatsappNumber,
} from '@core/config/order-messages';
import { CurrencyService } from '@core/services/currency/currency.service';
import { governorateById, governorateOfAddress } from '@core/services/offers/engine';
import { ShippingSettingsService } from '@core/services/shipping/shipping-settings.service';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import { UserProfileService, type SavedAddress, type UserProfile } from '@core/services/user-profile';
import {
  CHECKOUT_COUNTRY_OPTIONS,
  countryLabel,
  isCheckoutCountry,
} from '@features/checkout/utils/checkout-countries';
import { GovernorateInputComponent } from '@shared/ui/forms/governorate-input/governorate-input.component';
import { SelectInputComponent } from '@shared/ui/forms/select-input/select-input.component';
import { TextInputComponent } from '@shared/ui/forms/text-input/text-input.component';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { SkeletonComponent } from '@shared/ui/skeleton';

interface AddressModel {
  country: string;
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  phone: string;
  /** Egypt: the picked governorate id (its English name goes in `city` when saved). */
  governorateId: string | null;
}

function toModel(address: SavedAddress | null | undefined): AddressModel {
  const country = address && isCheckoutCountry(address.country) ? address.country : 'EG';
  // An old Egypt address has only a typed city: fill in the governorate it names, if any.
  const governorate =
    country === 'EG' && address ? governorateOfAddress(address.governorateId, address.city) : null;
  return {
    country,
    fullName: address?.fullName ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: governorate?.name ?? address?.city ?? '',
    governorateId: governorate?.id ?? null,
    region: address?.region ?? '',
    postalCode: address?.postalCode ?? '',
    phone: address?.phone ?? '',
  };
}

function textRule(label: string, max: number, required: boolean) {
  return (value: string) => {
    const text = value.trim();
    if (required && !text) return { kind: 'required', message: `Enter your ${label}.` };
    if (text.length > max) return { kind: 'max', message: `This must be ${max} characters or fewer.` };
    return undefined;
  };
}

/**
 * Account → Delivery Address: the one saved address (`users/{uid}.address`), with the same
 * fields checkout asks for in that country. Checkout fills it in when the countries match.
 * Saving it moves browsing prices to its country (ATS-317); a signed-in shopper's first order
 * saves its delivery address here when none is saved yet.
 */
@Component({
  selector: 'app-address-section',
  host: { class: 'block w-full account-section' },
  imports: [
    MatButtonModule,
    MatProgressSpinnerModule,
    GovernorateInputComponent,
    SelectInputComponent,
    SharedIconModule,
    SkeletonComponent,
    TextInputComponent,
  ],
  templateUrl: './address-section.component.html',
})
export class AddressSectionComponent {
  readonly #profiles = inject(UserProfileService);
  readonly #snackbar = inject(SnackbarService);
  readonly #currency = inject(CurrencyService);
  /** Governorates we deliver to, for the Egypt Governorate field. */
  readonly governorates = inject(ShippingSettingsService).governorates;
  /** Shows "Choose your governorate." after a save with none picked. */
  readonly governorateError = signal(false);

  readonly uid = input.required<string>();
  readonly profile = input.required<UserProfile | null>();
  readonly loading = input(false);

  readonly countries = CHECKOUT_COUNTRY_OPTIONS;
  readonly isSaving = signal(false);

  /** Saved address; only a real change (not a name or email choice) refills the form. */
  readonly #saved = computed(() => this.profile()?.address ?? null, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  readonly hasSaved = computed(() => this.#saved() !== null);
  readonly savedCountry = computed(() => {
    const saved = this.#saved();
    return saved ? countryLabel(saved.country) : '';
  });

  readonly model = linkedSignal<AddressModel>(() => toModel(this.#saved()));
  readonly isEgypt = computed(() => this.model().country === 'EG');

  constructor() {
    // Leaving Egypt: the governorate's name filled the city, and abroad has its own typed city.
    effect(() => {
      if (this.isEgypt()) return;
      untracked(() => {
        if (this.model().governorateId) {
          this.model.update((current) => ({ ...current, governorateId: null, city: '' }));
        }
      });
    });
  }

  readonly addressForm = form(this.model, (path) => {
    validate(path.fullName, ({ value }) => textRule('full name', 120, true)(value()));
    validate(path.line1, ({ value }) => textRule('address', 200, true)(value()));
    validate(path.city, ({ value, valueOf }) =>
      valueOf(path.country) === 'EG' ? undefined : textRule('city', 80, true)(value()),
    );
    validate(path.governorateId, ({ value, valueOf }) =>
      valueOf(path.country) === 'EG' && !governorateById(value())
        ? { kind: 'governorate', message: 'Choose your governorate.' }
        : undefined,
    );
    validate(path.line2, ({ value, valueOf }) =>
      valueOf(path.country) === 'EG' ? undefined : textRule('address line 2', 200, false)(value()),
    );
    validate(path.region, ({ value, valueOf }) =>
      valueOf(path.country) === 'EG' ? undefined : textRule('region', 80, false)(value()),
    );
    validate(path.postalCode, ({ value, valueOf }) =>
      valueOf(path.country) === 'EG' ? undefined : textRule('postal code', 20, false)(value()),
    );
    validate(path.phone, ({ value, valueOf }) => {
      const phone = value().trim();
      if (!phone) return { kind: 'required', message: DELIVERY_FIELD_MESSAGES.phone };
      const country = valueOf(path.country);
      if (country === 'EG') {
        return isEgyptMobile(phone) ? undefined : { kind: 'phone', message: EGYPT_PHONE_MESSAGE };
      }
      // Same rule as checkout: abroad we reach the shopper on WhatsApp, so it needs its country code.
      if (phone.length > 20 || shopperWhatsappNumber(phone, country) === null) {
        return { kind: 'phone', message: ABROAD_PHONE_MESSAGE };
      }
      return undefined;
    });
  });

  /** The Governorate field picked (or cleared) a governorate: its English name is the city. */
  setGovernorate(id: string | null): void {
    const governorate = governorateById(id);
    this.model.update((current) => ({
      ...current,
      governorateId: governorate?.id ?? null,
      city: governorate?.name ?? '',
    }));
  }

  save(event: Event): void {
    event.preventDefault();
    if (this.isSaving()) return;
    if (this.isEgypt()) this.governorateError.set(true);
    void submit(this.addressForm, async () => {
      const draft = this.model();
      const governorate = draft.country === 'EG' ? governorateById(draft.governorateId) : null;
      this.isSaving.set(true);
      try {
        await this.#profiles.saveAddress(this.uid(), {
          country: draft.country,
          fullName: draft.fullName,
          line1: draft.line1,
          line2: draft.line2 || null,
          city: governorate ? governorate.name : draft.city,
          region: draft.region || null,
          postalCode: draft.postalCode,
          phone: draft.phone,
          governorateId: governorate?.id ?? null,
        });
        // ATS-317: prices across the store follow the newly saved country.
        this.#currency.rememberSavedAddressCountry(this.uid(), draft.country);
        this.#snackbar.success("Your address is saved. We'll fill it in at checkout.");
      } catch {
        this.#snackbar.error("We couldn't save your address. Please try again in a moment.");
      } finally {
        this.isSaving.set(false);
      }
    });
  }
}
