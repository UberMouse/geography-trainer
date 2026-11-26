import { describe, expect, it, vi } from 'vitest';
import { answerCurrent, startRun } from '../engine/sessionRun';
import { createProgress } from '../engine/srs';
import { Rating } from 'ts-fsrs';
import type { ExerciseResult } from '../exercises/types';
import { buildCurriculum } from '../engine/curriculum';
import type { Country, Place } from '../engine/types';
import type { SessionQuestion } from '../engine/session';
import type { SavedSession } from '../storage/sessionRunStore';
import {
  answerEntry,
  countriesNeedingRegions,
  questionHeader,
  questionSeed,
  resumable,
  unlockLines,
  withMastered,
} from './sessionView';

describe('[SES-17] questionSeed', () => {
  it('is stable, and differs by item, by position and by salt', () => {
    expect(questionSeed('country:france', 3, 7)).toBe(questionSeed('country:france', 3, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:france', 4, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:spain', 3, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:france', 3, 8));
  });

  it('[SES-C06] is 32-bit FNV-1a of salt, item and position', () => {
    expect(questionSeed('country:france', 3, 7)).toBe(49630588);
  });
});

describe('[SES-14, SES-C07] questionHeader', () => {
  const questions = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ itemId: `country:c${i}`, rung: 1 as const }));

  it('counts the question in its round and the items done out of those started', () => {
    expect(questionHeader(startRun(questions(50)))).toBe('Question 1 · 0 of 50 done');
    expect(questionHeader(startRun(questions(7)))).toBe('Question 1 · 0 of 7 done');
  });

  it('keeps its total when an item comes back at a higher rung, and counts it done when it leaves', () => {
    const NOW = new Date('2026-03-01T00:00:00Z');
    const climbed = { rating: Rating.Good, correct: true, after: { ...createProgress('country:c0', NOW), rung: 2 as const } };
    const stays = { rating: Rating.Good, correct: true, after: createProgress('country:c1', NOW) };
    let run = answerCurrent(startRun(questions(3)), climbed);
    expect(questionHeader(run)).toBe('Question 2 · 0 of 3 done');
    run = answerCurrent(run, stays);
    expect(questionHeader(run)).toBe('Question 3 · 1 of 3 done');
  });
});

describe('[SES-16, SES-C06] answerEntry', () => {
  const question = { itemId: 'country:france', rung: 1 as const };
  const result: ExerciseResult = { rating: Rating.Good, correct: true, timeMs: 1234 };
  const now = new Date('2026-03-10T23:30:00Z');

  it('starts a fresh item from createProgress and stamps the answer with now', () => {
    const { after, entry } = answerEntry(undefined, question, result, now, 0);
    expect(after.itemId).toBe('country:france');
    expect(entry.progress).toBe(after);
    expect(entry.answer).toMatchObject({
      itemId: 'country:france',
      rung: 1,
      rating: Rating.Good,
      correct: true,
      timeMs: 1234,
      at: now.getTime(),
    });
  });

  it('builds on existing progress', () => {
    const before = createProgress('country:france', new Date('2026-03-01T00:00:00Z'));
    const { after } = answerEntry(before, question, result, now, 0);
    expect(after).not.toBe(before);
    expect(after.itemId).toBe(before.itemId);
  });

  it('answers a card whose last review is after now without throwing', () => {
    const early = new Date('2026-03-01T00:00:00Z');
    const first = answerEntry(undefined, question, result, early, 0).after;
    const card = first.cards[1];
    if (!card) throw new Error('no card');
    const ahead = { ...first, cards: { ...first.cards, 1: { ...card, last_review: now.getTime() + 2 * 86_400_000 } } };
    const { entry } = answerEntry(ahead, question, result, now, 0);
    expect(entry.answer.at).toBe(now.getTime());
  });

  it('takes the day key from the timezone offset', () => {
    expect(answerEntry(undefined, question, result, now, 0).entry.answer.dayKey).toBe('2026-03-10');
    expect(answerEntry(undefined, question, result, now, 120).entry.answer.dayKey).toBe(
      '2026-03-11',
    );
  });

  it('carries km and maptapScore only when the result has them', () => {
    const plain = answerEntry(undefined, question, result, now, 0).entry.answer;
    expect(plain.km).toBeUndefined();
    expect(plain.maptapScore).toBeUndefined();
    const tap = answerEntry(undefined, question, { ...result, km: 12, maptapScore: 99 }, now, 0)
      .entry.answer;
    expect(tap.km).toBe(12);
    expect(tap.maptapScore).toBe(99);
  });
});

describe('the full tree', () => {
  const countries: Country[] = [
    { id: 'fr', name: 'France', places: 2, hasRegions: true },
    { id: 'jp', name: 'Japan', places: 1, hasRegions: false },
    { id: 'xx', name: 'Nowhere', places: 0, hasRegions: false },
    { id: 'be', name: 'Belgium', places: 1, hasRegions: true },
    { id: 'lu', name: 'Luxembourg', places: 1, hasRegions: false },
  ];
  const place = (id: string, country: string, region: string | null): Place => ({
    id,
    name: id,
    country,
    region,
    lat: 0,
    lng: 0,
    type: 'city',
    level: 1,
  });
  const places = [place('paris', 'fr', 'fr.idf'), place('brest', 'fr', 'fr.bre'), place('tokyo', 'jp', null),
    place('arlon', 'be', 'be.lux'),
    place('lux-city', 'lu', null),
  ];
  const curriculum = buildCurriculum(countries, [{ id: 'fr.idf', country: 'fr' }, { id: 'fr.bre', country: 'fr' }, { id: 'be.lux', country: 'be' }], places);
  const names: Record<string, string> = {
    'country:fr': 'France',
    'country:jp': 'Japan',
    'region:fr.bre': 'Brittany',
    'country:be': 'Belgium',
    'country:lu': 'Luxembourg',
    'region:be.lux': 'Luxembourg',
  };
  const nameOf = (id: string) => names[id] ?? id;

  describe('[SES-C07] countriesNeedingRegions', () => {
    it('names the owner of each region question and each place under a region, once', () => {
      const itemIds = [
        'country:fr',
        'region:fr.idf',
        'place:brest',
        'place:paris',
        'country:jp',
        'place:tokyo',
      ];
      expect(countriesNeedingRegions(curriculum, itemIds)).toEqual(['fr']);
    });

    it('needs nothing for countries and places directly under a country', () => {
      expect(countriesNeedingRegions(curriculum, ['country:fr', 'place:tokyo'])).toEqual([]);
    });

    it('throws for an unknown item', () => {
      expect(() => countriesNeedingRegions(curriculum, ['place:nope'])).toThrow('Unknown item');
    });
  });

  describe('[SES-23, SES-C07] unlockLines', () => {
    it('says regions for a regions-tier country, places for the rest and a region', () => {
      expect(unlockLines(curriculum, ['country:fr', 'country:jp', 'region:fr.bre'], nameOf)).toEqual([
        { id: 'country:fr', text: "Unlocked: France's regions" },
        { id: 'country:jp', text: "Unlocked: Japan's places" },
        { id: 'region:fr.bre', text: "Unlocked: Brittany's places (France)" },
      ]);
    });

    it('tells a region and a country of the same name apart, by id and by text', () => {
      const lines = unlockLines(curriculum, ['country:lu', 'region:be.lux'], nameOf);
      expect(lines).toEqual([
        { id: 'country:lu', text: "Unlocked: Luxembourg's places" },
        { id: 'region:be.lux', text: "Unlocked: Luxembourg's places (Belgium)" },
      ]);
    });

    it('lists an item mastered twice once and skips items that unlock nothing', () => {
      expect(unlockLines(curriculum, ['country:jp', 'place:tokyo', 'country:xx', 'country:jp'], nameOf)).toEqual([
        { id: 'country:jp', text: "Unlocked: Japan's places" },
      ]);
    });

    it('is empty when nothing was mastered', () => {
      expect(unlockLines(curriculum, [], nameOf)).toEqual([]);
    });
  });
});

describe('[SES-26, SES-C05] resumable', () => {
  const question = { itemId: 'country:france', rung: 1 } as const;
  const saved = (queue: SessionQuestion[]): SavedSession => ({
    run: { ...startRun(queue), queue },
    mastered: [],
    testable: [],
  });
  const other = { itemId: 'country:spain', rung: 1 } as const;
  const asked = (queue: SessionQuestion[], ids: string[]): SavedSession => {
    const s = saved(queue);
    return { ...s, run: { ...s.run, asks: Object.fromEntries(ids.map((id) => [id, 1])) } };
  };
  it('is null when the queue is empty and a review has come due', () => {
    expect(resumable(saved([]), () => [question])).toBeNull();
  });
  it('is the session when the queue is empty and nothing is due', () => {
    const empty = saved([]);
    expect(resumable(empty, () => [])).toBe(empty);
  });
  it('is the session when the queue still has questions, due reviews or not', () => {
    const midRound = saved([question]);
    expect(resumable(midRound, () => [question])).toBe(midRound);
  });
  it('does not consult the due reviews while the queue has questions', () => {
    const midRound = saved([question]);
    const due = vi.fn(() => {
      throw new Error('No card for rung 1');
    });
    expect(resumable(midRound, due)).toBe(midRound);
    expect(due).not.toHaveBeenCalled();
  });
  it('is the session when the only due item is one the round asked', () => {
    const empty = asked([], [question.itemId]);
    expect(resumable(empty, () => [question])).toBe(empty);
  });
  it('is null when a due item is not one the round asked, whatever else is due', () => {
    expect(resumable(asked([], [question.itemId]), () => [question, other])).toBeNull();
  });
  it('is null when nothing was saved', () => {
    expect(resumable(null, () => [question])).toBeNull();
  });
});

describe('[SES-25, SES-C07] withMastered', () => {
  it('adds the item in answer order, to testable only when it can be tested out of', () => {
    const start = { mastered: ['country:france'], testable: ['country:france'] };
    const peru = withMastered(start, 'country:peru', false);
    expect(peru).toEqual({ mastered: ['country:france', 'country:peru'], testable: ['country:france'] });
    expect(withMastered(peru, 'country:chile', true)).toEqual({
      mastered: ['country:france', 'country:peru', 'country:chile'],
      testable: ['country:france', 'country:chile'],
    });
    // The round it was given is not changed.
    expect(start).toEqual({ mastered: ['country:france'], testable: ['country:france'] });
  });
});
