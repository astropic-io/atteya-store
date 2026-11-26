import { isPlatformBrowser } from '@angular/common';
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
import { AuthService } from '@core/services/auth/auth.service';
import { SeoService } from '@core/services/seo';
import { EgpPricePipe } from '@shared/pipes/egp-price.pipe';
import { SkeletonComponent } from '@shared/ui/skeleton';
import {
  OverviewAdminService,
  type OverviewDays,
  type OverviewLive,
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
  deltaOf,
  PAYMENT_LABELS,
  percentOf,
  shareRows,
  STATUS_ROWS,
  totalsFor,
  type Delta,
  type RangeTotals,
} from './utils/overview-stats.utils';
import { trendChart, type TrendChart } from './utils/overview-chart.utils';

/** One key number box. `money` boxes show "Only admins see pounds" to staff. */
interface KpiTile {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly delta: Delta | null;
  readonly money: boolean;
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
  imports: [RouterLink, EgpPricePipe, SkeletonComponent],
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

  readonly today = signal(cairoToday(new Date()));
  readonly rangeId = signal<OverviewRangeId>('d14');
  readonly customFrom = signal('');
  readonly customTo = signal('');

  /** Admins see pounds; staff don't (and Firestore rules keep the money docs from them). */
  readonly showMoney = computed(() => this.#auth.isAdmin());

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
      try {
        return await this.#overview.days({ from: params.from, to: params.to }, params.money);
      } catch (error: unknown) {
        console.error('[admin/overview] days failed', error);
        throw error;
      }
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
    if (!now || !before) return [];
    const egp = (value: number | null) => (value === null ? '' : this.#egp.transform(value));
    const whole = (value: number) => value.toLocaleString('en-US');
    const share = (part: number) => `${percentOf(part, now.orders)}% of orders`;
    return [
      {
        id: 'received',
        label: 'Pounds received',
        value: egp(now.netEgp),
        note: 'After refunds sent',
        delta: deltaOf(now.netEgp, before.netEgp),
        money: true,
      },
      {
        id: 'orders',
        label: 'Orders',
        value: whole(now.orders),
        note: 'Not counting Payment Failed',
        delta: deltaOf(now.orders, before.orders),
        money: false,
      },
      {
        id: 'average',
        label: 'Average order',
        value: now.averageOrderEgp === null ? '—' : egp(now.averageOrderEgp),
        note: 'Confirmed orders and up',
        delta: deltaOf(now.averageOrderEgp, before.averageOrderEgp),
        money: true,
      },
      {
        id: 'pieces',
        label: 'Pieces sold',
        value: whole(now.pieces),
        note:
          now.soldOrders > 0
            ? `${(now.pieces / now.soldOrders).toFixed(1)} per order`
            : 'Confirmed orders and up',
        delta: deltaOf(now.pieces, before.pieces),
        money: false,
      },
      {
        id: 'delivered',
        label: 'Delivered',
        value: whole(now.delivered),
        note: share(now.delivered),
        delta: deltaOf(now.delivered, before.delivered),
        money: false,
      },
      {
        id: 'cancelled',
        label: 'Cancelled',
        value: whole(now.cancelled),
        note: share(now.cancelled),
        delta: deltaOf(now.cancelled, before.cancelled, true),
        money: false,
      },
      {
        id: 'returns',
        label: 'Return requests',
        value: whole(now.returns),
        note: `${now.returns - now.refundRequests} exchanges, ${now.refundRequests} with a refund`,
        delta: deltaOf(now.returns, before.returns, true),
        money: false,
      },
      {
        id: 'refunds',
        label: 'Refunds sent',
        value: egp(now.refundsEgp),
        note: `${now.refundsSent} sent in this range`,
        delta: deltaOf(now.refundsEgp, before.refundsEgp, true),
        money: true,
      },
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
  }
}
