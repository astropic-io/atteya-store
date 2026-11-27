import { homeWordCount, type HomeTextLimit } from '@features/home/data/home.data';

/** What a field's counter shows ("12 / 40 characters · 3 / 7 words") and whether it is over. */
export interface TextLimitState {
  readonly label: string;
  readonly over: boolean;
}

export function textLimitState(text: string, limit: HomeTextLimit): TextLimitState {
  const trimmed = text.trim();
  const chars = trimmed.length;
  const charsLabel = `${chars} / ${limit.chars} characters`;
  if (limit.words === undefined) return { label: charsLabel, over: chars > limit.chars };
  const words = homeWordCount(trimmed);
  return {
    label: `${charsLabel} · ${words} / ${limit.words} words`,
    over: chars > limit.chars || words > limit.words,
  };
}

/** "Use 40 characters and 7 words or fewer." */
export function textLimitRule(limit: HomeTextLimit): string {
  return limit.words === undefined
    ? `Use ${limit.chars} characters or fewer.`
    : `Use ${limit.chars} characters and ${limit.words} words or fewer.`;
}
