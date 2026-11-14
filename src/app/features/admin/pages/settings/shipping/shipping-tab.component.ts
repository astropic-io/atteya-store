import { isPlatformBrowser } from '@angular/common';
import { Component, effect, inject, OnInit, PLATFORM_ID, resource, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { deleteField, doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { injectFirestore } from '@core/firebase';
import { AuthService } from '@core/services/auth/auth.service';
import { SeoService } from '@core/services/seo';
import {
  EGYPT_GOVERNORATES,
  formatCairoDateTimeInput,
  governorateSetting,
  MAX_GOVERNORATE_EXTRA_FEE_EGP,
  parseCairoDateTimeInput,
  type GovernorateSetting,
  type ShippingBoxId,
} from '@core/services/offers/engine';
import {
  DEFAULT_EGYPT_BOXES,
  DEFAULT_INTERNATIONAL_BOXES,
  ShippingSettingsSchema,
  type ShippingBoxDoc,
} from '@core/services/shipping/shipping-settings.schema';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { SkeletonComponent } from '@shared/ui/skeleton';
import { createValibotConverter } from '@shared/utils/firebase/firestore-converter';

type RegionTab = 'egypt' | 'international';

interface BoxDraft {
  id: ShippingBoxId;
  name: string;
  maxWeightGrams: number;
  maxLengthCm: number;
  maxWidthCm: number;
  maxHeightCm: number;
  feeEgp: number;
}

interface ShippingDraft {
  egyptBoxes: BoxDraft[];
  internationalBoxes: BoxDraft[];
  freeOverActive: boolean;
  freeOverThreshold: number | null;
  promoActive: boolean;
  promoFee: number;
  promoStartsAt: Date | null;
  promoEndsAt: Date | null;
  promoMinSubtotal: number | null;
  promoBanner: string;
  note: string;
  /** Egypt extra fee (as typed) and switch per governorate id. */
  governorates: Record<string, GovernorateDraft>;
}

interface GovernorateDraft {
  /** The Extra Fee (EGP) box as typed; checked on save (`parseExtraFee`). */
  extraFee: string;
  active: boolean;
}

/** Every governorate's draft from the saved map (a missing one is the default: 10 EGP, delivered). */
function governorateDrafts(
  saved: Readonly<Record<string, GovernorateSetting>>,
): Record<string, GovernorateDraft> {
  return Object.fromEntries(
    EGYPT_GOVERNORATES.map((governorate) => {
      const setting = governorateSetting({ egyptGovernorates: saved }, governorate.id);
      return [governorate.id, { extraFee: String(setting.extraFeeEgp), active: setting.active }];
    }),
  );
}

function cloneBoxes(boxes: readonly ShippingBoxDoc[]): BoxDraft[] {
  return boxes.map((box) => ({ ...box }));
}

const BOX_IDS: readonly ShippingBoxId[] = ['box1', 'box2', 'box3'];

function sortedById(boxes: readonly ShippingBoxDoc[]): ShippingBoxDoc[] {
  return [...boxes].sort((a, b) => BOX_IDS.indexOf(a.id) - BOX_IDS.indexOf(b.id));
}

const EMPTY_DRAFT: ShippingDraft = {
  egyptBoxes: cloneBoxes(DEFAULT_EGYPT_BOXES),
  internationalBoxes: cloneBoxes(DEFAULT_INTERNATIONAL_BOXES),
  freeOverActive: false,
  freeOverThreshold: null,
  promoActive: false,
  promoFee: 0,
  promoStartsAt: null,
  promoEndsAt: null,
  promoMinSubtotal: null,
  promoBanner: '',
  note: '',
  governorates: governorateDrafts({}),
};

function toDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (
    typeof raw === 'object' &&
    'toDate' in raw &&
    typeof (raw as { toDate: () => unknown }).toDate === 'function'
  ) {
    return (raw as { toDate: () => Date }).toDate();
  }
  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Whole pounds from 0 to 1,000, or null for anything else (an empty box included). */
function parseExtraFee(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 && value <= MAX_GOVERNORATE_EXTRA_FEE_EGP ? value : null;
}

@Component({
  selector: 'app-shipping-tab',
  host: { class: 'block w-full' },
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    SharedIconModule,
    SkeletonComponent,
  ],
  templateUrl: './shipping-tab.component.html',
})
export class ShippingTabComponent implements OnInit {
  readonly #firestore = injectFirestore();
  readonly #auth = inject(AuthService);
  readonly #snackbar = inject(SnackbarService);
  readonly #seo = inject(SeoService);
  readonly #platformId = inject(PLATFORM_ID);

  ngOnInit(): void {
    this.#seo.setPageMetadata({
      title: 'Shipping | Atteya Admin',
      description: 'Delivery boxes, free shipping, and promotions.',
      noindex: true,
    });
  }

  readonly region = signal<RegionTab>('egypt');
  readonly draft = signal<ShippingDraft>(EMPTY_DRAFT);
  readonly isSaving = signal(false);
  readonly formatInput = formatCairoDateTimeInput;
  readonly governorateList = EGYPT_GOVERNORATES;
  readonly maxExtraFee = MAX_GOVERNORATE_EXTRA_FEE_EGP;

  readonly settingsResource = resource({
    loader: async () => {
      if (!isPlatformBrowser(this.#platformId)) return null;
      const ref = doc(this.#firestore, 'settings', 'shipping').withConverter(
        createValibotConverter(ShippingSettingsSchema),
      );
      const snap = await getDoc(ref);
      return snap.exists() ? snap.data() : null;
    },
  });

  constructor() {
    effect(() => {
      const data = this.settingsResource.value();
      if (!data) return;
      untracked(() =>
        this.draft.set({
          egyptBoxes: cloneBoxes(sortedById(data.egyptBoxes)),
          internationalBoxes: cloneBoxes(sortedById(data.internationalBoxes)),
          freeOverActive: data.freeOver.active,
          freeOverThreshold: data.freeOver.threshold,
          promoActive: data.promo.active,
          promoFee: data.promo.fee,
          promoStartsAt: toDate(data.promo.startsAt),
          promoEndsAt: toDate(data.promo.endsAt),
          promoMinSubtotal: data.promo.minSubtotal,
          promoBanner: data.promo.banner ?? '',
          note: data.note,
          governorates: governorateDrafts(data.egyptGovernorates),
        }),
      );
    });
  }

  activeBoxes(): BoxDraft[] {
    const d = this.draft();
    return this.region() === 'egypt' ? d.egyptBoxes : d.internationalBoxes;
  }

  setRegion(value: RegionTab): void {
    this.region.set(value);
  }

  numberFrom(event: Event): number | null {
    const parsed = Number.parseInt((event.target as HTMLInputElement).value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  textFrom(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  patch(change: Partial<ShippingDraft>): void {
    this.draft.update((prev) => ({ ...prev, ...change }));
  }

  patchBox(index: number, change: Partial<BoxDraft>): void {
    const key = this.region() === 'egypt' ? 'egyptBoxes' : 'internationalBoxes';
    this.draft.update((prev) => ({
      ...prev,
      [key]: prev[key].map((box, i) => (i === index ? { ...box, ...change } : box)),
    }));
  }

  /** Adds the next box (up to three), starting from the biggest box so far. */
  addBox(): void {
    const key = this.region() === 'egypt' ? 'egyptBoxes' : 'internationalBoxes';
    this.draft.update((prev) => {
      const boxes = prev[key];
      // First free id, so a saved list with a gap (box1 + box3) never gets a repeated id.
      const id = BOX_IDS.find((candidate) => !boxes.some((box) => box.id === candidate));
      const last = boxes.at(-1);
      if (!id || !last) return prev;
      const box: BoxDraft = { ...last, id, name: `Box ${boxes.length + 1}` };
      return { ...prev, [key]: [...boxes, box] };
    });
  }

  /** Removes the last box. Orders heavier than the boxes left are handled as described above them. */
  removeLastBox(): void {
    const key = this.region() === 'egypt' ? 'egyptBoxes' : 'internationalBoxes';
    this.draft.update((prev) => (prev[key].length > 1 ? { ...prev, [key]: prev[key].slice(0, -1) } : prev));
  }

  patchGovernorate(id: string, change: Partial<GovernorateDraft>): void {
    this.draft.update((prev) => ({
      ...prev,
      governorates: { ...prev.governorates, [id]: { ...prev.governorates[id], ...change } },
    }));
  }

  dateFrom(event: Event, endOfDay: boolean): Date | null {
    return parseCairoDateTimeInput((event.target as HTMLInputElement).value, endOfDay);
  }

  async save(): Promise<void> {
    if (this.isSaving()) return;
    const d = this.draft();
    const allBoxes = [...d.egyptBoxes, ...d.internationalBoxes];
    if (allBoxes.some((box) => box.feeEgp > 1_000_000)) {
      this.#snackbar.error('A shipping fee is too high.');
      return;
    }
    if (allBoxes.some((box) => !box.name.trim())) {
      this.#snackbar.error('Give every box a name.');
      return;
    }
    if (d.egyptBoxes.length < 1 || d.internationalBoxes.length < 1) {
      this.#snackbar.error('Each region needs at least one box.');
      return;
    }
    if (allBoxes.some((box) => box.maxWeightGrams < 1)) {
      this.#snackbar.error('Each box needs a maximum weight.');
      return;
    }
    if (allBoxes.some((box) => box.maxLengthCm < 1 || box.maxWidthCm < 1 || box.maxHeightCm < 1)) {
      this.#snackbar.error('Each box needs length, width, and height.');
      return;
    }
    if (d.freeOverActive && !d.freeOverThreshold) {
      this.#snackbar.error('Enter the order amount that unlocks free shipping.');
      return;
    }
    if (d.promoStartsAt && d.promoEndsAt && d.promoEndsAt <= d.promoStartsAt) {
      this.#snackbar.error('The promotion must end after it starts.');
      return;
    }
    if (Object.values(d.governorates).some((row) => parseExtraFee(row.extraFee) === null)) {
      this.region.set('egypt');
      this.#snackbar.error('Each governorate needs an extra fee in whole pounds, from 0 to 1,000.');
      return;
    }
    if (!Object.values(d.governorates).some((row) => row.active)) {
      this.region.set('egypt');
      this.#snackbar.error('Turn on delivery for at least one governorate.');
      return;
    }

    this.isSaving.set(true);
    try {
      await setDoc(
        doc(this.#firestore, 'settings', 'shipping'),
        {
          currency: 'EGP',
          egyptBoxes: d.egyptBoxes,
          internationalBoxes: d.internationalBoxes,
          freeOver: {
            active: d.freeOverActive,
            threshold: d.freeOverThreshold,
          },
          promo: {
            active: d.promoActive,
            fee: d.promoFee,
            startsAt: d.promoStartsAt ? Timestamp.fromDate(d.promoStartsAt) : null,
            endsAt: d.promoEndsAt ? Timestamp.fromDate(d.promoEndsAt) : null,
            minSubtotal: d.promoMinSubtotal,
            banner: d.promoBanner.trim() || null,
          },
          note: d.note.trim(),
          egyptGovernorates: Object.fromEntries(
            EGYPT_GOVERNORATES.map((governorate) => {
              const row = d.governorates[governorate.id];
              return [
                governorate.id,
                { extraFeeEgp: parseExtraFee(row?.extraFee ?? '') ?? 0, active: row?.active !== false },
              ];
            }),
          ),
          // Drop legacy zone / flat-fee fields on the next admin save.
          baseFee: deleteField(),
          zones: deleteField(),
          internationalShippingFeeEgp: deleteField(),
          updatedAt: serverTimestamp(),
          updatedBy: this.#auth.user()?.uid ?? 'admin',
        },
        { merge: true },
      );
      this.#snackbar.success('Shipping settings saved.');
    } catch {
      this.#snackbar.error("We couldn't save shipping settings. Please try again.");
    } finally {
      this.isSaving.set(false);
    }
  }
}
