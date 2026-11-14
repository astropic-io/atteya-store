import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeGovernorates,
  checkGovernorate,
  governorateFromCity,
  governorateOfAddress,
  searchGovernorates,
  EGYPT_GOVERNORATES,
} from './governorates.js';
import {
  parcelWeight,
  planDelivery,
  shippingFromFee,
  shippingQuote,
  type ParcelLine,
  type ShippingBox,
  type ShippingSettings,
} from './shipping.js';
import type { Offer, PricedProduct, PricingContext, VariantFacts } from './types.js';

/** Client's Egypt rates (Nov 2026): up to 1 kg = 115, up to 3 kg = 135, heavier = agreed. */
const EGYPT: readonly ShippingBox[] = [
  {
    id: 'box1',
    name: 'Box 1',
    maxWeightGrams: 1_000,
    maxLengthCm: 30,
    maxWidthCm: 20,
    maxHeightCm: 10,
    feeEgp: 115,
  },
  {
    id: 'box2',
    name: 'Box 2',
    maxWeightGrams: 3_000,
    maxLengthCm: 45,
    maxWidthCm: 35,
    maxHeightCm: 20,
    feeEgp: 135,
  },
];

const TEE = 250;
const SHORTS = 250;
const HOODIE = 800;
const SOCKS = 0;

function fee(lines: readonly ParcelLine[], region: 'egypt' | 'international' = 'egypt'): number | string {
  const plan = planDelivery(EGYPT, region, parcelWeight(lines));
  return plan.kind === 'box' ? plan.box.feeEgp : plan.kind;
}

describe('client shipping examples (Egypt)', () => {
  it('4 t-shirts = 1 kg = 115', () => {
    assert.equal(fee([{ weightGrams: TEE, quantity: 4 }]), 115);
  });

  it('5 to 10 pieces (over 1 kg, up to 3 kg) = 135', () => {
    assert.equal(fee([{ weightGrams: TEE, quantity: 5 }]), 135);
    assert.equal(
      fee([
        { weightGrams: TEE, quantity: 6 },
        { weightGrams: SHORTS, quantity: 4 },
      ]),
      135,
    );
  });

  it('a hoodie alone = 115; a hoodie with a t-shirt = 135', () => {
    assert.equal(fee([{ weightGrams: HOODIE, quantity: 1 }]), 115);
    assert.equal(
      fee([
        { weightGrams: HOODIE, quantity: 1 },
        { weightGrams: TEE, quantity: 1 },
      ]),
      135,
    );
  });

  it('socks never add weight, and socks alone still pay 115', () => {
    assert.equal(fee([{ weightGrams: SOCKS, quantity: 3 }]), 115);
    assert.equal(
      fee([
        { weightGrams: TEE, quantity: 4 },
        { weightGrams: SOCKS, quantity: 6 },
      ]),
      115,
    );
  });

  it('over 3 kg: the fee is agreed with the customer', () => {
    assert.equal(fee([{ weightGrams: TEE, quantity: 13 }]), 'to-be-agreed');
    assert.equal(fee([{ weightGrams: HOODIE, quantity: 4 }]), 'to-be-agreed');
  });

  it('a product without a weight counts as 500 g per unit', () => {
    assert.equal(parcelWeight([{ weightGrams: null, quantity: 2 }]).totalWeightGrams, 1_000);
    assert.equal(parcelWeight([{ weightGrams: null, quantity: 1 }]).anyWeightMissing, true);
    assert.equal(fee([{ weightGrams: null, quantity: 2 }]), 115);
    assert.equal(
      fee([
        { weightGrams: null, quantity: 1 },
        { weightGrams: TEE, quantity: 3 },
      ]),
      135,
    );
    assert.equal(fee([{ weightGrams: null, quantity: 6 }]), 135);
    assert.equal(fee([{ weightGrams: null, quantity: 7 }]), 'to-be-agreed');
    assert.equal(
      fee([
        { weightGrams: null, quantity: 1 },
        { weightGrams: HOODIE, quantity: 4 },
      ]),
      'to-be-agreed',
    );
  });

  it('abroad, too heavy is placed with the fee to be agreed (ATS-314)', () => {
    assert.equal(fee([{ weightGrams: HOODIE, quantity: 4 }], 'international'), 'to-be-agreed');
  });

  it('abroad, a country with no set shipping price always has its fee agreed (ATS-314)', () => {
    assert.equal(
      planDelivery(EGYPT, 'international', parcelWeight([{ weightGrams: TEE, quantity: 1 }]), false).kind,
      'to-be-agreed',
    );
    // Egypt ignores the flag: its boxes always decide.
    assert.equal(
      planDelivery(EGYPT, 'egypt', parcelWeight([{ weightGrams: TEE, quantity: 1 }]), false).kind,
      'box',
    );
  });

  it('with no boxes delivery is unavailable', () => {
    assert.equal(planDelivery([], 'egypt', parcelWeight([])).kind, 'unavailable');
  });
});

/** International boxes (placeholder rates): one box, far dearer than Egypt. */
const ABROAD: readonly ShippingBox[] = [
  {
    id: 'box1',
    name: 'Box 1',
    maxWeightGrams: 2_000,
    maxLengthCm: 40,
    maxWidthCm: 30,
    maxHeightCm: 15,
    feeEgp: 1_800,
  },
];

const SETTINGS: ShippingSettings = {
  currency: 'EGP',
  egyptBoxes: EGYPT,
  internationalBoxes: ABROAD,
  freeOver: { active: false, threshold: null },
  promo: { active: false, fee: 0, startsAt: null, endsAt: null, minSubtotal: null, banner: null },
  note: '',
};

const CTX: PricingContext = { now: new Date('2026-11-10T12:00:00Z'), signedIn: true, codes: [] };

const TEE_LINE: PricedProduct = {
  productId: 'tee-1',
  brandId: 'adidas',
  categoryIds: ['apparel', 't-shirts'],
  type: '',
  modelGroup: null,
  colors: [],
  sizes: [],
  tags: [],
  price: 1_000,
  name: 'Tee',
  compareAtPrice: null,
};

function freeShippingOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'free-ship',
    name: 'Free shipping this month',
    title: 'Free shipping',
    badge: null,
    description: null,
    active: true,
    archived: false,
    visibility: 'public',
    audience: 'everyone',
    schedule: { startsAt: null, endsAt: null, timezone: 'Africa/Cairo' },
    priority: 0,
    stacking: 'stackable',
    saleItems: 'bestOf',
    scope: 'cart',
    conditions: { anyOf: [] },
    exclude: { anyOf: [] },
    minimum: null,
    reward: { kind: 'freeShipping' },
    limits: { totalUses: null, perCustomer: null },
    requiresCode: false,
    ...overrides,
  };
}

function quote(
  region: 'egypt' | 'international',
  goodsSubtotal: number,
  offers: readonly Offer[],
  settings: ShippingSettings = SETTINGS,
) {
  return shippingQuote(
    settings,
    { region, totalWeightGrams: 250, goodsSubtotal, lines: [{ product: TEE_LINE, variant: null }] },
    offers,
    CTX,
  );
}

describe('free shipping offers are for Egypt orders only', () => {
  it('Egypt: a live Free shipping offer makes shipping free', () => {
    const result = quote('egypt', 1_000, [freeShippingOffer()]);
    assert.equal(result.fee, 0);
    assert.equal(result.reason, 'offer');
    assert.equal(result.offerId, 'free-ship');
  });

  it('Egypt: below the offer minimum the box fee is paid', () => {
    const offer = freeShippingOffer({ minimum: { subtotal: 2_000 } });
    assert.equal(quote('egypt', 1_999, [offer]).fee, 115);
    assert.equal(quote('egypt', 2_000, [offer]).fee, 0);
  });

  it('Egypt: an offer limited to other products does not apply', () => {
    const offer = freeShippingOffer({
      conditions: { anyOf: [{ allOf: [{ field: 'categoryIds', in: ['rackets'] }] }] },
    });
    assert.equal(quote('egypt', 1_000, [offer]).fee, 115);
  });

  it('abroad: the same offer never changes shipping', () => {
    const result = quote('international', 1_000, [freeShippingOffer()]);
    assert.equal(result.fee, 1_800);
    assert.equal(result.reason, 'box');
    assert.equal(result.offerId, undefined);
  });

  it('abroad: an offer with its minimum met still pays the box fee', () => {
    const offer = freeShippingOffer({ minimum: { subtotal: 500 } });
    assert.equal(quote('international', 5_000, [offer]).fee, 1_800);
  });

  it('both regions: Settings → Shipping free over still applies (unchanged)', () => {
    const settings: ShippingSettings = { ...SETTINGS, freeOver: { active: true, threshold: 3_000 } };
    assert.equal(quote('egypt', 3_000, [], settings).reason, 'freeOver');
    assert.equal(quote('international', 3_000, [freeShippingOffer()], settings).reason, 'freeOver');
  });
});

describe('free shipping offers respect Except rules', () => {
  const BRAND_X_LINE: PricedProduct = { ...TEE_LINE, productId: 'x-1', brandId: 'brand-x' };
  const exceptBrandX = freeShippingOffer({
    exclude: { anyOf: [{ allOf: [{ field: 'brandId', in: ['brand-x'] }] }] },
  });

  function quoteLines(lines: readonly PricedProduct[], offers: readonly Offer[]) {
    return shippingQuote(
      SETTINGS,
      {
        region: 'egypt',
        totalWeightGrams: 250,
        goodsSubtotal: 1_000,
        lines: lines.map((product) => ({ product, variant: null })),
      },
      offers,
      CTX,
    );
  }

  it('"all except Brand X" with a Brand X-only bag pays the box fee', () => {
    const result = quoteLines([BRAND_X_LINE], [exceptBrandX]);
    assert.equal(result.fee, 115);
    assert.equal(result.reason, 'box');
    assert.equal(result.offerId, undefined);
  });

  it('"all except Brand X" with a mixed bag ships free', () => {
    const result = quoteLines([BRAND_X_LINE, TEE_LINE], [exceptBrandX]);
    assert.equal(result.fee, 0);
    assert.equal(result.reason, 'offer');
    assert.equal(result.offerId, 'free-ship');
  });

  it('no lines: only an offer with no product rules and no Except rules applies', () => {
    const noLines = (offers: readonly Offer[]) =>
      shippingQuote(SETTINGS, { region: 'egypt', totalWeightGrams: 250, goodsSubtotal: 1_000 }, offers, CTX);
    assert.equal(noLines([freeShippingOffer()]).fee, 0);
    assert.equal(noLines([exceptBrandX]).fee, 115);
  });
});

describe('free shipping offers respect size and colour Except rules (chosen option)', () => {
  const MULTI_COLOUR: PricedProduct = { ...TEE_LINE, productId: 'multi-1', colors: ['black', 'white'] };
  const exceptBlack = freeShippingOffer({
    exclude: { anyOf: [{ allOf: [{ field: 'colors', in: ['black'] }] }] },
  });
  const exceptSizeL = freeShippingOffer({
    exclude: { anyOf: [{ allOf: [{ field: 'sizes', in: ['L'] }] }] },
  });

  function quoteVariant(variant: VariantFacts | null, offers: readonly Offer[], product = MULTI_COLOUR) {
    return shippingQuote(
      SETTINGS,
      { region: 'egypt', totalWeightGrams: 250, goodsSubtotal: 1_000, lines: [{ product, variant }] },
      offers,
      CTX,
    );
  }

  it('"all except Black": a bag of only the multi-colour product in Black pays the box fee', () => {
    const result = quoteVariant({ id: 'v-black', color: 'black', size: null }, [exceptBlack]);
    assert.equal(result.fee, 115);
    assert.equal(result.reason, 'box');
    assert.equal(result.offerId, undefined);
  });

  it('"all except Black": the same product in White ships free', () => {
    const result = quoteVariant({ id: 'v-white', color: 'white', size: null }, [exceptBlack]);
    assert.equal(result.fee, 0);
    assert.equal(result.reason, 'offer');
    assert.equal(result.offerId, 'free-ship');
  });

  it('"all except size L": size L pays the box fee, size M ships free', () => {
    const sized: PricedProduct = { ...TEE_LINE, productId: 'sized-1', sizes: ['M', 'L'] };
    assert.equal(quoteVariant({ id: 'v-l', size: 'L', color: null }, [exceptSizeL], sized).fee, 115);
    assert.equal(quoteVariant({ id: 'v-m', size: 'M', color: null }, [exceptSizeL], sized).fee, 0);
  });
});

describe('Egypt delivery by governorate (ATS-306)', () => {
  function quoteGov(
    goodsSubtotal: number,
    offers: readonly Offer[],
    settings: ShippingSettings,
    governorateId: string | null,
  ) {
    const check = checkGovernorate(settings, governorateId);
    if (!check.ok) return check.code;
    return shippingQuote(
      settings,
      {
        region: 'egypt',
        totalWeightGrams: 250,
        goodsSubtotal,
        lines: [{ product: TEE_LINE, variant: null }],
        governorateExtraEgp: check.extraFeeEgp,
      },
      offers,
      CTX,
    );
  }

  const withAswan: ShippingSettings = {
    ...SETTINGS,
    egyptGovernorates: {
      aswan: { extraFeeEgp: 40, active: true },
      sohag: { extraFeeEgp: 10, active: false },
    },
  };

  it('box + default extra: 115 + 10 = 125', () => {
    const result = quoteGov(1_000, [], SETTINGS, 'cairo');
    assert.ok(typeof result !== 'string');
    assert.equal(result.fee, 125);
    assert.equal(result.reason, 'box');
    assert.equal(result.extraFeeEgp, 10);
  });

  it('box + saved extra: 115 + 40 = 155', () => {
    const result = quoteGov(1_000, [], withAswan, 'aswan');
    assert.ok(typeof result !== 'string');
    assert.equal(result.fee, 155);
  });

  it('free over makes the whole delivery free, the extra included', () => {
    const settings: ShippingSettings = { ...withAswan, freeOver: { active: true, threshold: 3_000 } };
    const result = quoteGov(3_000, [], settings, 'aswan');
    assert.ok(typeof result !== 'string');
    assert.equal(result.fee, 0);
    assert.equal(result.reason, 'freeOver');
  });

  it('a Free shipping offer makes the whole delivery free, the extra included', () => {
    const result = quoteGov(1_000, [freeShippingOffer()], withAswan, 'aswan');
    assert.ok(typeof result !== 'string');
    assert.equal(result.fee, 0);
    assert.equal(result.reason, 'offer');
  });

  it('a promotion at 0 makes the whole delivery free', () => {
    const settings: ShippingSettings = { ...withAswan, promo: { ...SETTINGS.promo, active: true, fee: 0 } };
    const result = quoteGov(1_000, [], settings, 'aswan');
    assert.ok(typeof result !== 'string');
    assert.equal(result.fee, 0);
    assert.equal(result.reason, 'promo');
  });

  it('a promotion above 0 is the whole fee (no extra on top) when it is the cheapest', () => {
    const settings: ShippingSettings = { ...withAswan, promo: { ...SETTINGS.promo, active: true, fee: 50 } };
    const result = quoteGov(1_000, [], settings, 'aswan');
    assert.ok(typeof result !== 'string');
    assert.equal(result.fee, 50);
    assert.equal(result.reason, 'promo');
    const dearPromo: ShippingSettings = { ...settings, promo: { ...settings.promo, fee: 200 } };
    const boxWins = quoteGov(1_000, [], dearPromo, 'aswan');
    assert.ok(typeof boxWins !== 'string');
    assert.equal(boxWins.fee, 155);
    assert.equal(boxWins.reason, 'box');
  });

  it('a switched-off governorate, an unknown id and a missing one are refused', () => {
    assert.equal(quoteGov(1_000, [], withAswan, 'sohag'), 'inactive');
    assert.equal(quoteGov(1_000, [], withAswan, 'atlantis'), 'unknown');
    assert.equal(quoteGov(1_000, [], withAswan, null), 'missing');
  });

  it('abroad never adds a governorate extra', () => {
    const result = shippingQuote(
      SETTINGS,
      { region: 'international', totalWeightGrams: 250, goodsSubtotal: 1_000, governorateExtraEgp: 10 },
      [],
      CTX,
    );
    assert.equal(result.fee, 1_800);
    assert.equal(result.extraFeeEgp, 0);
  });

  it('"Shipping from" adds the lowest extra of the governorates we deliver to', () => {
    assert.equal(shippingFromFee(SETTINGS), 125);
    const allFive = Object.fromEntries(
      EGYPT_GOVERNORATES.map((g) => [
        g.id,
        { extraFeeEgp: g.id === 'sohag' ? 0 : 5, active: g.id !== 'sohag' },
      ]),
    );
    assert.equal(shippingFromFee({ ...SETTINGS, egyptGovernorates: allFive }), 120);
  });

  it('a switched-off governorate is left out of the list', () => {
    const ids = activeGovernorates(withAswan).map((g) => g.id);
    assert.equal(ids.length, 26);
    assert.ok(!ids.includes('sohag'));
  });

  it('search finds governorates by English, Arabic and aliases', () => {
    const find = (query: string) => searchGovernorates(EGYPT_GOVERNORATES, query).map((g) => g.id);
    for (const query of ['Alex', 'Iskenderiya', 'Eskendereya', 'اسكندرية', 'الاسكندرية', 'alexANDRIA']) {
      assert.ok(find(query).includes('alexandria'), query);
    }
    assert.deepEqual(find('Hurghada'), ['red-sea']);
    assert.deepEqual(find('Sharm'), ['south-sinai']);
    assert.deepEqual(find('October'), ['giza']);
    assert.deepEqual(find('Sheikh Zayed'), ['giza']);
    assert.deepEqual(find('Mansoura'), ['dakahlia']);
    assert.deepEqual(find('port-said'), ['port-said']);
    assert.deepEqual(find('zzz'), []);
  });

  it('an old typed city fills in its governorate when it names one exactly', () => {
    assert.equal(governorateFromCity('cairo')?.id, 'cairo');
    assert.equal(governorateFromCity(' Hurghada ')?.id, 'red-sea');
    assert.equal(governorateFromCity('اسكندرية')?.id, 'alexandria');
    assert.equal(governorateFromCity('Somewhere')?.id, undefined);
  });

  it('an address uses its saved id first, then a typed city that names a governorate', () => {
    assert.equal(governorateOfAddress('giza', 'Cairo')?.id, 'giza');
    assert.equal(governorateOfAddress(null, 'Mansoura')?.id, 'dakahlia');
    assert.equal(governorateOfAddress('atlantis', 'Nowhere'), null);
  });
});
