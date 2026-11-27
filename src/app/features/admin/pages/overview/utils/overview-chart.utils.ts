import type { DayPoint } from './overview-stats.utils';

/**
 * Geometry of the admin Overview "Sales by day" chart (ATS-340): bars for orders, and a line for
 * pounds received when the viewer may see money. Everything is worked out here so the template
 * only draws. Pure: no Angular.
 */
export interface ChartBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title: string;
}

export interface ChartTick {
  readonly y: number;
  readonly left: string;
  readonly right: string | null;
}

export interface ChartLabel {
  readonly x: number;
  readonly text: string;
}

export interface TrendChart {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly bars: readonly ChartBar[];
  readonly ticks: readonly ChartTick[];
  readonly labels: readonly ChartLabel[];
  readonly labelY: number;
  /** `x,y x,y …` for the pounds line; null when money is hidden. */
  readonly line: string | null;
  readonly lastPoint: { readonly x: number; readonly y: number } | null;
  readonly hasMoney: boolean;
  readonly empty: boolean;
}

/** A round top for an axis that splits into 4 even steps: 1, 2, 4, 6 or 8 times a power of ten. */
export function niceMax(max: number): number {
  if (max <= 0) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 4, 6, 8, 10]) {
    if (step * power >= max) return step * power;
  }
  return 10 * power;
}

const compactEgp = (value: number): string => {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1000) return `${+(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
};

const TICKS = 4;

export function trendChart(
  points: readonly DayPoint[],
  boxWidth: number,
  dayLabel: (day: string) => string,
): TrendChart {
  const width = Math.max(280, Math.min(1200, boxWidth));
  const narrow = width < 500;
  const height = narrow ? 200 : 240;
  const hasMoney = points.some((point) => point.receivedEgp !== null);
  const left = 44;
  const right = hasMoney ? 40 : 12;
  const top = 12;
  const bottom = 26;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const count = Math.max(1, points.length);
  const column = plotWidth / count;

  const maxOrders = niceMax(Math.max(0, ...points.map((point) => point.orders)));
  const maxEgp = niceMax(Math.max(0, ...points.map((point) => point.receivedEgp ?? 0)));
  const y = (value: number, max: number) => top + plotHeight * (1 - value / max);

  // Orders sit on the left axis when money is hidden, else on the right (pounds on the left).
  const ticks: ChartTick[] = [];
  for (let i = 0; i <= TICKS; i += 1) {
    const share = 1 - i / TICKS;
    const ordersText = String(Math.round(maxOrders * share * 10) / 10);
    ticks.push({
      y: top + plotHeight * (i / TICKS),
      left: hasMoney ? compactEgp(maxEgp * share) : ordersText,
      right: hasMoney ? ordersText : null,
    });
  }

  const barWidth = Math.max(1.5, Math.min(36, column * 0.62));
  const bars = points.map((point, index) => {
    const barTop = y(point.orders, maxOrders);
    return {
      x: left + index * column + (column - barWidth) / 2,
      y: barTop,
      width: barWidth,
      height: Math.max(0, height - bottom - barTop),
      title: `${dayLabel(point.day)}: ${point.orders} ${point.orders === 1 ? 'order' : 'orders'}`,
    };
  });

  let line: string | null = null;
  let lastPoint: { x: number; y: number } | null = null;
  if (hasMoney) {
    const coords = points.map((point, index) => ({
      x: left + index * column + column / 2,
      y: y(point.receivedEgp ?? 0, maxEgp),
    }));
    line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    lastPoint = coords[coords.length - 1] ?? null;
  }

  const wanted = narrow ? 4 : 8;
  const step = Math.max(1, Math.ceil(count / wanted));
  const labels: ChartLabel[] = [];
  points.forEach((point, index) => {
    const isLast = index === count - 1;
    // Skip a regular label that would crowd the last one.
    if ((index % step === 0 && (isLast || count - 1 - index >= step / 2)) || isLast) {
      labels.push({ x: left + index * column + column / 2, text: dayLabel(point.day) });
    }
  });

  return {
    width,
    height,
    left,
    right: width - right,
    bars,
    ticks,
    labels,
    labelY: height - 8,
    line,
    lastPoint,
    hasMoney,
    empty: points.every((point) => point.orders === 0 && (point.receivedEgp ?? 0) === 0),
  };
}

// ── Tile trend lines ────────────────────────────────────────────────────────

/** A small trend line drawn in a 100 × 32 box (the SVG stretches it to the tile's width). */
export interface Sparkline {
  /** `x,y x,y …` for the line. */
  readonly line: string;
  /** Closed path for the soft fill under the line. */
  readonly area: string;
}

export const SPARK_WIDTH = 100;
export const SPARK_HEIGHT = 32;

/** Null when there are fewer than two days to draw (Today), so the tile shows no line. */
export function sparkline(values: readonly number[] | null): Sparkline | null {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = SPARK_WIDTH / (values.length - 1);
  // 2 units of room top and bottom so the stroke isn't cut off.
  const y = (value: number) => +(SPARK_HEIGHT - 2 - ((value - min) / span) * (SPARK_HEIGHT - 4)).toFixed(2);
  const points = values.map((value, index) => `${+(index * step).toFixed(2)},${y(value)}`);
  return {
    line: points.join(' '),
    area: `M0,${SPARK_HEIGHT} L${points.join(' L')} L${SPARK_WIDTH},${SPARK_HEIGHT} Z`,
  };
}

// ── Best sellers ring ───────────────────────────────────────────────────────

/** One slice of the best sellers ring: a stroked circle with a dash for its share. */
export interface RingSlice {
  readonly key: string;
  readonly label: string;
  readonly percent: number;
  /** `stroke-dasharray` value. */
  readonly dash: string;
  /** `stroke-dashoffset` value (slices follow each other clockwise from the top). */
  readonly offset: number;
}

/** Radius of the ring circle; its length is 2πr. */
export const RING_RADIUS = 40;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Slices for the products' shares of the pieces sold, plus "Everything else" for the rest.
 * Shares are exact fractions so the slices close the ring; labels use whole percents.
 */
export function ringSlices(
  products: readonly { readonly id: string; readonly name: string; readonly pieces: number }[],
  totalPieces: number,
): RingSlice[] {
  if (totalPieces <= 0) return [];
  const rows = products.map((product) => ({ key: product.id, label: product.name, pieces: product.pieces }));
  const rest = totalPieces - rows.reduce((sum, row) => sum + row.pieces, 0);
  if (rest > 0) rows.push({ key: '__rest', label: 'Everything else', pieces: rest });
  let start = 0;
  return rows
    .filter((row) => row.pieces > 0)
    .map((row) => {
      const length = (row.pieces / totalPieces) * RING_LENGTH;
      const slice: RingSlice = {
        key: row.key,
        label: row.label,
        percent: Math.round((row.pieces / totalPieces) * 100),
        dash: `${+length.toFixed(3)} ${+(RING_LENGTH - length).toFixed(3)}`,
        offset: +(-start).toFixed(3),
      };
      start += length;
      return slice;
    });
}
