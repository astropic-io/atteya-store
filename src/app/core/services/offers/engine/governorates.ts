// GENERATED — edit functions/src/offers/engine
/**
 * Egypt's 27 governorates. Egypt delivery is priced per governorate: the weight box fee plus the
 * governorate's extra fee from `settings/shipping.egyptGovernorates` (ATS-306). Checkout and the
 * account address pick one from this list; the order stores its id and English name.
 */
export interface Governorate {
  readonly id: string;
  /** English name, shown in the field after picking and saved as the address city. */
  readonly name: string;
  readonly nameAr: string;
  /** Other spellings, big cities and areas that should find this governorate in the search. */
  readonly aliases: readonly string[];
}

/** One governorate's delivery setting in `settings/shipping.egyptGovernorates`. */
export interface GovernorateSetting {
  /** Whole EGP added to the Egypt box fee. */
  readonly extraFeeEgp: number;
  /** False: we don't deliver there (hidden at checkout and refused by the server). */
  readonly active: boolean;
}

/** Extra fee of a governorate with no saved setting. */
export const DEFAULT_GOVERNORATE_EXTRA_FEE_EGP = 10;

/** Highest extra fee the admin can set for one governorate (whole EGP). */
export const MAX_GOVERNORATE_EXTRA_FEE_EGP = 1000;

export const DEFAULT_GOVERNORATE_SETTING: GovernorateSetting = {
  extraFeeEgp: DEFAULT_GOVERNORATE_EXTRA_FEE_EGP,
  active: true,
};

export const EGYPT_GOVERNORATES: readonly Governorate[] = [
  {
    id: 'cairo',
    name: 'Cairo',
    nameAr: 'القاهرة',
    aliases: ['Nasr City', 'New Cairo', 'Heliopolis', 'Maadi', 'Shubra'],
  },
  {
    id: 'giza',
    name: 'Giza',
    nameAr: 'الجيزة',
    aliases: ['6th of October', 'October', 'Sheikh Zayed', 'Haram', 'Dokki', 'Mohandessin'],
  },
  {
    id: 'alexandria',
    name: 'Alexandria',
    nameAr: 'الإسكندرية',
    aliases: ['Alex', 'Iskandariya', 'Iskenderiya', 'Eskendereya'],
  },
  {
    id: 'qalyubia',
    name: 'Qalyubia',
    nameAr: 'القليوبية',
    aliases: ['Qalyubiya', 'Banha', 'Benha', 'Shubra El Kheima', 'Obour'],
  },
  { id: 'sharqia', name: 'Sharqia', nameAr: 'الشرقية', aliases: ['Sharkia', 'Zagazig', '10th of Ramadan'] },
  { id: 'dakahlia', name: 'Dakahlia', nameAr: 'الدقهلية', aliases: ['Dakahleya', 'Mansoura'] },
  { id: 'gharbia', name: 'Gharbia', nameAr: 'الغربية', aliases: ['Gharbeya', 'Tanta', 'El Mahalla'] },
  {
    id: 'monufia',
    name: 'Monufia',
    nameAr: 'المنوفية',
    aliases: ['Menoufia', 'Menofia', 'Shebin El Kom', 'Sadat City'],
  },
  { id: 'beheira', name: 'Beheira', nameAr: 'البحيرة', aliases: ['Behera', 'Damanhour'] },
  { id: 'kafr-el-sheikh', name: 'Kafr El Sheikh', nameAr: 'كفر الشيخ', aliases: [] },
  { id: 'damietta', name: 'Damietta', nameAr: 'دمياط', aliases: ['Dumyat', 'New Damietta'] },
  { id: 'port-said', name: 'Port Said', nameAr: 'بورسعيد', aliases: ['Portsaid'] },
  { id: 'ismailia', name: 'Ismailia', nameAr: 'الإسماعيلية', aliases: [] },
  { id: 'suez', name: 'Suez', nameAr: 'السويس', aliases: ['Ain Sokhna', 'Sokhna'] },
  { id: 'faiyum', name: 'Faiyum', nameAr: 'الفيوم', aliases: ['Fayoum', 'Fayum'] },
  { id: 'beni-suef', name: 'Beni Suef', nameAr: 'بني سويف', aliases: ['Bani Sweif'] },
  { id: 'minya', name: 'Minya', nameAr: 'المنيا', aliases: ['Menya', 'Minia'] },
  { id: 'asyut', name: 'Asyut', nameAr: 'أسيوط', aliases: ['Assiut', 'Asyout'] },
  { id: 'sohag', name: 'Sohag', nameAr: 'سوهاج', aliases: [] },
  { id: 'qena', name: 'Qena', nameAr: 'قنا', aliases: ['Kena'] },
  { id: 'luxor', name: 'Luxor', nameAr: 'الأقصر', aliases: [] },
  { id: 'aswan', name: 'Aswan', nameAr: 'أسوان', aliases: [] },
  {
    id: 'red-sea',
    name: 'Red Sea',
    nameAr: 'البحر الأحمر',
    aliases: ['Hurghada', 'El Gouna', 'Safaga', 'Marsa Alam'],
  },
  { id: 'new-valley', name: 'New Valley', nameAr: 'الوادي الجديد', aliases: ['Kharga', 'Dakhla'] },
  {
    id: 'matrouh',
    name: 'Matrouh',
    nameAr: 'مطروح',
    aliases: ['Marsa Matrouh', 'Siwa', 'El Alamein', 'North Coast', 'Sahel'],
  },
  { id: 'north-sinai', name: 'North Sinai', nameAr: 'شمال سيناء', aliases: ['Arish', 'El Arish'] },
  {
    id: 'south-sinai',
    name: 'South Sinai',
    nameAr: 'جنوب سيناء',
    aliases: ['Sharm El Sheikh', 'Sharm', 'Dahab', 'Nuweiba'],
  },
];

const BY_ID = new Map(EGYPT_GOVERNORATES.map((governorate) => [governorate.id, governorate]));

/** The governorate with this id, or null. */
export function governorateById(id: string | null | undefined): Governorate | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** A saved governorate setting, or the default (10 EGP, delivered) when none is saved. */
export function governorateSetting(
  settings: { readonly egyptGovernorates?: Readonly<Record<string, GovernorateSetting>> },
  id: string,
): GovernorateSetting {
  return settings.egyptGovernorates?.[id] ?? DEFAULT_GOVERNORATE_SETTING;
}

/** Governorates we deliver to, in list order. */
export function activeGovernorates(settings: {
  readonly egyptGovernorates?: Readonly<Record<string, GovernorateSetting>>;
}): Governorate[] {
  return EGYPT_GOVERNORATES.filter((governorate) => governorateSetting(settings, governorate.id).active);
}

/** Lowest extra fee among the governorates we deliver to (0 when none is switched on). */
export function lowestGovernorateExtraFee(settings: {
  readonly egyptGovernorates?: Readonly<Record<string, GovernorateSetting>>;
}): number {
  const fees = activeGovernorates(settings).map((governorate) =>
    Math.max(0, Math.round(governorateSetting(settings, governorate.id).extraFeeEgp)),
  );
  return fees.length === 0 ? 0 : Math.min(...fees);
}

export type GovernorateCheck =
  | { readonly ok: true; readonly governorate: Governorate; readonly extraFeeEgp: number }
  | { readonly ok: false; readonly code: 'missing' | 'unknown' }
  | { readonly ok: false; readonly code: 'inactive'; readonly governorate: Governorate };

/** Checks a governorate id against the list and the saved settings, and gives its extra fee. */
export function checkGovernorate(
  settings: { readonly egyptGovernorates?: Readonly<Record<string, GovernorateSetting>> },
  id: string | null | undefined,
): GovernorateCheck {
  if (!id) return { ok: false, code: 'missing' };
  const governorate = governorateById(id);
  if (!governorate) return { ok: false, code: 'unknown' };
  const setting = governorateSetting(settings, governorate.id);
  if (!setting.active) return { ok: false, code: 'inactive', governorate };
  return { ok: true, governorate, extraFeeEgp: Math.max(0, Math.round(setting.extraFeeEgp)) };
}

/**
 * Text for comparing governorate names: lower case, no spaces, hyphens, dots or apostrophes, and
 * one form for Arabic letters written several ways (أ/إ/آ → ا, ة → ه, ى → ي). Plain string work,
 * no regular expression is built from what the shopper typed.
 */
export function normalizeGovernorateText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\-_.'’ـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

function searchKeys(governorate: Governorate): string[] {
  return [governorate.name, governorate.nameAr, governorate.id, ...governorate.aliases].map(
    normalizeGovernorateText,
  );
}

const KEYS = new Map(EGYPT_GOVERNORATES.map((governorate) => [governorate.id, searchKeys(governorate)]));

/** True when the typed text is part of the governorate's name, Arabic name or one of its aliases. */
export function governorateMatches(governorate: Governorate, query: string): boolean {
  const needle = normalizeGovernorateText(query);
  if (!needle) return true;
  const keys = KEYS.get(governorate.id) ?? searchKeys(governorate);
  // Arabic names are often typed without "ال" ("اسكندرية" for "الإسكندرية").
  const bare = needle.startsWith('ال') ? needle.slice(2) : needle;
  return keys.some((key) => key.includes(needle) || (bare.length > 0 && key.includes(bare)));
}

/** The governorates whose names or aliases contain the typed text, in list order. */
export function searchGovernorates(list: readonly Governorate[], query: string): Governorate[] {
  return list.filter((governorate) => governorateMatches(governorate, query));
}

/**
 * The governorate an old typed city names exactly (its English or Arabic name, id or an alias,
 * compared with `normalizeGovernorateText`), or null. Used to fill in old saved addresses.
 */
export function governorateFromCity(city: string | null | undefined): Governorate | null {
  if (!city) return null;
  const needle = normalizeGovernorateText(city);
  if (!needle) return null;
  const bare = needle.startsWith('ال') ? needle.slice(2) : needle;
  for (const governorate of EGYPT_GOVERNORATES) {
    const keys = KEYS.get(governorate.id) ?? [];
    if (
      keys.some((key) => key === needle || key === bare || (key.startsWith('ال') && key.slice(2) === bare))
    ) {
      return governorate;
    }
  }
  return null;
}
