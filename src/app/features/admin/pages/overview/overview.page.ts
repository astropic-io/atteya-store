import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnInit,
  PLATFORM_ID,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { AuthService } from '@core/services/auth/auth.service';
import { SeoService } from '@core/services/seo';
import { EgpPricePipe } from '@shared/pipes/egp-price.pipe';
import { SkeletonComponent } from '@shared/ui/skeleton';
import {
  OverviewAdminService,
  type OverviewDays,
  type OverviewLive,
  type OverviewProduct,
} from './services/overview-admin.service';
import {
  cairoToday,
  customRange,
  OVERVIEW_RANGES,
  overviewPeriod,
  periodLabel,
  shortDayLabel,
  type DayRange,
  type OverviewRangeId,
} from './utils/overview-range.utils';
import {
  bestSellers,
  dayPoints,
  daySeries,
  deltaOf,
  lostOrders,
  lostRate,
  PAYMENT_LABELS,
  percentOf,
  pointsDeltaOf,
  shareRows,
  STATUS_ROWS,
  totalsFor,
  type Delta,
  type RangeTotals,
  type TrendTileId,
} from './utils/overview-stats.utils';
import {
  RING_RADIUS,
  ringSlices,
  SPARK_HEIGHT,
  SPARK_WIDTH,
  sparkline,
  trendChart,
  type Sparkline,
  type TrendChart,
} from './utils/overview-chart.utils';

/** One key number box. `money` boxes show "Only admins see pounds" to staff. */
interface KpiTile {
  readonly id: TrendTileId;
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly delta: Delta | null;
  readonly money: boolean;
  /** Trend line across the range's days; null for a single day or pounds staff can't see. */
  readonly spark: Sparkline | null;
}

/**
 * Admin → Overview (ATS-340): how the store is doing for a chosen range of Cairo days, read from
 * the daily summaries (`storeStats`, and `storeStatsMoney` for admins only), plus live boxes for
 * what needs attention and the catalogue. Dev only until the client agrees to it
 * (`environment.adminOverview`).
 */
@Component({
  selector: 'app-overview-page',
  host: { class: 'block w-full @container' },
  imports: [RouterLink, NgOptimizedImage, AppImageFallbackDirective, EgpPricePipe, SkeletonComponent],
  templateUrl: './overview.page.html',
})
export class OverviewPageComponent implements OnInit {
  readonly #overview = inject(OverviewAdminService);
  readonly #auth = inject(AuthService);
  readonly #seo = inject(SeoService);
  readonly #browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly #egp = new EgpPricePipe();

  readonly ranges = OVERVIEW_RANGES;
  readonly statusRows = STATUS_ROWS;
  readonly sparkBox = `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`;
  readonly ringRadius = RING_RADIUS;

  readonly today = signal(cairoToday(new Date()));
  readonly rangeId = signal<OverviewRangeId>('d14');
  readonly customFrom = signal('');
  readonly customTo = signal('');

  /** Admins see pounds; staff don't (and Firestore rules keep the money docs from them). */
  readonly showMoney = computed(() => this.#auth.hasExtra('money'));

  readonly period = computed(() => {
    const custom: DayRange | null =
      this.rangeId() === 'custom' ? { from: this.customFrom(), to: this.customTo() } : null;
    return overviewPeriod(this.rangeId(), this.today(), custom);
  });

  readonly periodText = computed(() => periodLabel(this.period()));

  readonly daysResource = resource({
    params: () => ({
      from: this.period().previous.from,
      to: this.period().current.to,
      money: this.showMoney(),
    }),
    loader: async ({ params }): Promise<OverviewDays | null> => {
      if (!this.#browser) return null;
      return this.#overview.days({ from: params.from, to: params.to }, params.money);
    },
  });

  readonly liveResource = resource({
    loader: async (): Promise<OverviewLive | null> =>
      this.#browser ? this.#overview.live(new Date()) : null,
  });

  readonly live = computed(() => (this.liveResource.hasValue() ? this.liveResource.value() : null));

  readonly offerNote = computed(() => {
    const boxes = this.live();
    if (!boxes || boxes.offersRunning === null) return '';
    if (boxes.offersRunning === 0) return 'None running now';
    switch (boxes.offerEndsInDays) {
      case null:
        return 'No end dates set';
      case 0:
        return 'One ends today';
      case 1:
        return 'One ends tomorrow';
      default:
        return `One ends in ${boxes.offerEndsInDays} days`;
    }
  });

  readonly #days = computed(() => (this.daysResource.hasValue() ? this.daysResource.value() : null));

  readonly current = computed<RangeTotals | null>(() => {
    const days = this.#days();
    return days ? totalsFor(this.period().current, days.counts, days.money) : null;
  });

  readonly previous = computed<RangeTotals | null>(() => {
    const days = this.#days();
    return days ? totalsFor(this.period().previous, days.counts, days.money) : null;
  });

  readonly tiles = computed<readonly KpiTile[]>(() => {
    const now = this.current();
    const before = this.previous();
    const days = this.#days();
    if (!now || !before || !days) return [];
    const range = this.period().current;
    const spark = (id: TrendTileId) => sparkline(daySeries(id, range, days.counts, days.money));
    const egp = (value: number | null) => (value === null ? '' : this.#egp.transform(value));
    const whole = (value: number) => value.toLocaleString('en-US');
    const share = (part: number) => `${percentOf(part, now.orders)}% of orders`;
    const placed = now.orders + now.failedOrders;
    const lost = lostOrders(now);
    const rate = lostRate(now);
    const rateBefore = lostRate(before);
    const tile = (
      id: TrendTileId,
      label: string,
      value: string,
      note: string,
      delta: Delta | null,
      money = false,
    ): KpiTile => ({ id, label, value, note, delta, money, spark: spark(id) });
    return [
      tile(
        'received',
        'Pounds received',
        egp(now.netEgp),
        'After refunds sent',
        deltaOf(now.netEgp, before.netEgp),
        true,
      ),
      tile(
        'orders',
        'Orders',
        whole(now.orders),
        'Not counting Payment Failed',
        deltaOf(now.orders, before.orders),
      ),
      tile(
        'average',
        'Average order',
        now.averageOrderEgp === null ? '—' : egp(now.averageOrderEgp),
        'Confirmed orders and up',
        deltaOf(now.averageOrderEgp, before.averageOrderEgp),
        true,
      ),
      tile(
        'pieces',
        'Pieces sold',
        whole(now.pieces),
        now.soldOrders > 0
          ? `${(now.pieces / now.soldOrders).toFixed(1)} per order`
          : 'Confirmed orders and up',
        deltaOf(now.pieces, before.pieces),
      ),
      tile(
        'new',
        'Waiting for Payment',
        whole(now.byStatus.pending),
        'Placed in this range, not paid or confirmed yet',
        deltaOf(now.byStatus.pending, before.byStatus.pending),
      ),
      tile(
        'delivered',
        'Delivered',
        whole(now.delivered),
        share(now.delivered),
        deltaOf(now.delivered, before.delivered),
      ),
      tile(
        'returns',
        'Return requests',
        whole(now.returns),
        `${now.returns - now.refundRequests} exchanges, ${now.refundRequests} with a refund`,
        deltaOf(now.returns, before.returns, true),
      ),
      tile(
        'refunds',
        'Refunds sent',
        egp(now.refundsEgp),
        `${now.refundsSent} sent in this range`,
        deltaOf(now.refundsEgp, before.refundsEgp, true),
        true,
      ),
      tile(
        'cancelled',
        'Cancelled',
        whole(now.cancelled),
        share(now.cancelled),
        deltaOf(now.cancelled, before.cancelled, true),
      ),
      tile(
        'failed',
        'Payment Failed',
        whole(now.failedOrders),
        "Card payments that didn't go through",
        deltaOf(now.failedOrders, before.failedOrders, true),
      ),
      tile(
        'lost',
        'Lost orders',
        whole(lost),
        'Cancelled and Payment Failed',
        deltaOf(lost, lostOrders(before), true),
      ),
      tile(
        'lostRate',
        'Lost rate',
        rate === null ? '—' : `${rate}%`,
        `Of ${whole(placed)} ${placed === 1 ? 'order' : 'orders'} placed`,
        pointsDeltaOf(rate, rateBefore, true),
      ),
    ];
  });

  readonly statusShares = computed(() => {
    const now = this.current();
    if (!now) return [];
    return STATUS_ROWS.map((row) => ({
      ...row,
      count: now.byStatus[row.key],
      percent: percentOf(now.byStatus[row.key], now.orders),
    }));
  });

  readonly payments = computed(() => {
    const now = this.current();
    return now ? shareRows(now.byPayment, (key) => PAYMENT_LABELS[key] ?? 'Other', 4, 'Other') : [];
  });

  readonly places = computed(() => {
    const now = this.current();
    if (!now) return [];
    return shareRows(
      now.byPlace,
      (key) => (key === 'abroad' ? 'Outside Egypt' : key === 'unknown' ? 'Not given' : key),
      4,
      'Other governorates',
      ['abroad'],
    );
  });

  readonly sellers = computed(() => {
    const now = this.current();
    return now ? bestSellers(now) : [];
  });

  /** Ring of each best seller's share of the pieces sold, plus everything else. */
  readonly ring = computed(() => {
    const now = this.current();
    return now ? ringSlices(this.sellers(), now.pieces) : [];
  });

  /** Photos for the best sellers, read when the list changes. */
  readonly photosResource = resource({
    // A joined key, so the same five products aren't read again when the range changes.
    params: () =>
      this.sellers()
        .map((seller) => seller.id)
        .join('\n'),
    loader: async ({ params }): Promise<ReadonlyMap<string, OverviewProduct>> =>
      this.#browser && params ? this.#overview.products(params.split('\n')) : new Map(),
  });

  readonly photos = computed<ReadonlyMap<string, OverviewProduct>>(() =>
    this.photosResource.hasValue() ? this.photosResource.value() : new Map(),
  );

  /** Live products running low, fewest pieces first (not affected by the date range). */
  readonly lowStockResource = resource({
    loader: async (): Promise<readonly OverviewProduct[]> => (this.#browser ? this.#overview.lowStock() : []),
  });

  /** Chart width in px, measured from its box so labels keep their size on a phone. */
  readonly chartWidth = signal(720);
  readonly chartBox = viewChild<ElementRef<HTMLElement>>('chartBox');

  readonly chart = computed<TrendChart | null>(() => {
    const days = this.#days();
    if (!days) return null;
    return trendChart(
      dayPoints(this.period().current, days.counts, days.money),
      this.chartWidth(),
      shortDayLabel,
    );
  });

  constructor() {
    effect((onCleanup) => {
      const element = this.chartBox()?.nativeElement;
      if (!element || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect.width ?? 0);
        if (width > 0 && Math.abs(width - this.chartWidth()) > 4) this.chartWidth.set(width);
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }

  ngOnInit(): void {
    this.#seo.setPageMetadata({
      title: 'Overview | Atteya Admin',
      description: 'How the store is doing: orders, sales, returns and stock.',
      noindex: true,
    });
  }

  setRange(id: OverviewRangeId): void {
    if (id === 'custom' && (!this.customFrom() || !this.customTo())) {
      const start = customRange(null, this.today());
      this.customFrom.set(start.from);
      this.customTo.set(start.to);
    }
    this.today.set(cairoToday(new Date()));
    this.rangeId.set(id);
  }

  setCustom(edge: 'from' | 'to', value: string): void {
    if (edge === 'from') this.customFrom.set(value);
    else this.customTo.set(value);
  }

  refresh(): void {
    this.today.set(cairoToday(new Date()));
    this.daysResource.reload();
    this.liveResource.reload();
    this.lowStockResource.reload();
  }
}
