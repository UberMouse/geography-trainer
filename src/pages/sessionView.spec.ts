import { describe, expect, it } from 'vitest';
import { startRun } from '../engine/sessionRun';
import { createProgress } from '../engine/srs';
import { Rating } from 'ts-fsrs';
import type { ExerciseResult } from '../exercises/types';
import { buildCurriculum } from '../engine/curriculum';
import type { Country, Place } from '../engine/types';
import { answerEntry, countriesNeedingRegions, questionHeader, questionSeed, unlockLines } from './sessionView';

describe('questionSeed', () => {
  it('is stable, and differs by item, by position and by salt', () => {
    expect(questionSeed('country:france', 3, 7)).toBe(questionSeed('country:france', 3, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:france', 4, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:spain', 3, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:france', 3, 8));
  });
});

describe('questionHeader', () => {
  const questions = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ itemId: `country:c${i}`, rung: 1 as const }));

  it('counts within a full round', () => {
    expect(questionHeader(startRun(questions(50)))).toBe('Question 1 of 20');
  });

  it('uses the remaining count when fewer than a round remain', () => {
    expect(questionHeader(startRun(questions(7)))).toBe('Question 1 of 7');
  });
});

describe('answerEntry', () => {
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

  describe('countriesNeedingRegions', () => {
    const q = (itemId: string) => ({ itemId, rung: 1 as const });

    it('names the owner of each region question and each place under a region, once', () => {
      const questions = [
        q('country:fr'),
        q('region:fr.idf'),
        q('place:brest'),
        q('place:paris'),
        q('country:jp'),
        q('place:tokyo'),
      ];
      expect(countriesNeedingRegions(curriculum, questions)).toEqual(['fr']);
    });

    it('needs nothing for countries and places directly under a country', () => {
      expect(countriesNeedingRegions(curriculum, [q('country:fr'), q('place:tokyo')])).toEqual([]);
    });

    it('throws for an unknown item', () => {
      expect(() => countriesNeedingRegions(curriculum, [q('place:nope')])).toThrow('Unknown item');
    });
  });

  describe('unlockLines', () => {
    it('says regions for a regions-tier country, places for the rest and a region', () => {
      expect(unlockLines(curriculum, ['country:fr', 'country:jp', 'region:fr.bre'], nameOf, () => true)).toEqual([
        { id: 'country:fr', text: "Unlocked: France's regions" },
        { id: 'country:jp', text: "Unlocked: Japan's places" },
        { id: 'region:fr.bre', text: "Unlocked: Brittany's places (France)" },
      ]);
    });

    it('tells a region and a country of the same name apart, by id and by text', () => {
      const lines = unlockLines(curriculum, ['country:lu', 'region:be.lux'], nameOf, () => true);
      expect(lines).toEqual([
        { id: 'country:lu', text: "Unlocked: Luxembourg's places" },
        { id: 'region:be.lux', text: "Unlocked: Luxembourg's places (Belgium)" },
      ]);
    });

    it('lists an item mastered twice once and skips items that unlock nothing', () => {
      expect(unlockLines(curriculum, ['country:jp', 'place:tokyo', 'country:xx', 'country:jp'], nameOf, () => true)).toEqual([
        { id: 'country:jp', text: "Unlocked: Japan's places" },
      ]);
    });

    it('leaves out an item that is no longer mastered', () => {
      const lines = unlockLines(curriculum, ['country:fr', 'country:jp'], nameOf, (id) => id !== 'country:fr');
      expect(lines).toEqual([{ id: 'country:jp', text: "Unlocked: Japan's places" }]);
    });

    it('is empty when nothing was mastered', () => {
      expect(unlockLines(curriculum, [], nameOf, () => true)).toEqual([]);
    });
  });
});
