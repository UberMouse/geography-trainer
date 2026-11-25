// The numbers Home shows and the Session page's daily-cap input, from the curriculum and progress.

import { DAILY_NEW_CAP } from './config';
import type { Curriculum } from './curriculum';
import { buildSession, dueQuestions } from './session';
import { isIntroduced, isMastered, localDayKey, type ItemProgress } from './srs';

type Progress = Readonly<Record<string, ItemProgress>>;

export interface TodayNumbers {
  due: number;
  newToday: number;
  dailyCap: number;
  learning: number;
  learned: number;
  sessionLength: number;
}

/** Curriculum items whose progress was first answered as new on today's local day. */
export function introducedToday(
  curriculum: Curriculum,
  progress: Progress,
  now: Date,
  tzOffsetMinutes: number,
): number {
  const today = localDayKey(now, tzOffsetMinutes);
  let n = 0;
  for (const id of curriculum.items.keys()) {
    const at = progress[id]?.introducedAt;
    if (at != null && localDayKey(new Date(at), tzOffsetMinutes) === today) n++;
  }
  return n;
}

export function todayNumbers(
  curriculum: Curriculum,
  progress: Progress,
  now: Date,
  tzOffsetMinutes: number,
  dailyCap: number = DAILY_NEW_CAP,
): TodayNumbers {
  const newToday = introducedToday(curriculum, progress, now, tzOffsetMinutes);
  let learning = 0;
  let learned = 0;
  for (const id of curriculum.items.keys()) {
    const p = progress[id];
    if (!p) continue;
    if (isMastered(p)) learned++;
    else if (isIntroduced(p)) learning++;
  }
  return {
    due: dueQuestions({ curriculum, progress, now }).length,
    newToday,
    dailyCap,
    learning,
    learned,
    sessionLength: buildSession({ curriculum, progress, now, introducedToday: newToday, dailyCap }).length,
  };
}
