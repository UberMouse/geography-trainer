import { describe, expect, it, vi } from 'vitest';
import { answerCurrent, startRun } from '../engine/sessionRun';
import { createProgress, type ItemProgress } from '../engine/srs';
import { gateFillers, withFillersMastered } from '../engine/gateFixtures';
import { Rating } from 'ts-fsrs';
import type { ExerciseResult } from '../exercises/types';
import { buildCurriculum } from '../engine/curriculum';
import type { Country, Place } from '../engine/types';
import type { SessionQuestion } from '../engine/session';
import type { SavedSession } from '../storage/sessionRunStore';
import {
  answerEntry,
  countriesNeedingRegions,
  gateOpenedLines,
  questionHeader,
  questionSeed,
  keepTestable,
  resumable,
  unlockLines,
  withGateRecheck,
  withMastered,
} from './sessionView';
import { showsTestOutLink } from './testOutView';

// Mastered: L3 passed on two different days.
const mastered = (itemId: string): ItemProgress =>
  ({
    itemId,
    rung: 3,
    highestRung: 3,
    cards: {},
    l3PassDays: ['2026-01-10', '2026-01-20'],
    inL3Lapse: false,
    introducedAt: 1,
  }) as unknown as ItemProgress;

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
  // The fillers (placeless countries) are in the curriculum only: `open` masters every one of them,
  // which opens every gate (CUR-21).
  const fillers = gateFillers();
  const curriculum = buildCurriculum([...countries, ...fillers], [{ id: 'fr.idf', country: 'fr' }, { id: 'fr.bre', country: 'fr' }, { id: 'be.lux', country: 'be' }], places);
  const open = withFillersMastered({}, mastered('country:filler'), fillers);
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
      expect(unlockLines(curriculum, open, ['country:fr', 'country:jp', 'region:fr.bre'], nameOf)).toEqual([
        { id: 'country:fr', text: "Unlocked: France's regions" },
        { id: 'country:jp', text: "Unlocked: Japan's places" },
        { id: 'region:fr.bre', text: "Unlocked: Brittany's places (France)" },
      ]);
    });

    it('tells a region and a country of the same name apart, by id and by text', () => {
      const lines = unlockLines(curriculum, open, ['country:lu', 'region:be.lux'], nameOf);
      expect(lines).toEqual([
        { id: 'country:lu', text: "Unlocked: Luxembourg's places" },
        { id: 'region:be.lux', text: "Unlocked: Luxembourg's places (Belgium)" },
      ]);
    });

    it('lists an item mastered twice once and skips items that unlock nothing', () => {
      expect(unlockLines(curriculum, open, ['country:jp', 'place:tokyo', 'country:xx', 'country:jp'], nameOf)).toEqual([
        { id: 'country:jp', text: "Unlocked: Japan's places" },
      ]);
    });

    it('is empty when nothing was mastered', () => {
      expect(unlockLines(curriculum, open, [], nameOf)).toEqual([]);
    });

    it('names the gate for a country whose gate is still shut, with no test-out', () => {
      const progress = { 'country:fr': mastered('country:fr'), 'country:jp': mastered('country:jp') };
      expect(unlockLines(curriculum, progress, ['country:fr', 'country:jp', 'region:fr.bre'], nameOf)).toEqual([
        { id: 'country:fr', text: "France: its regions open once you've mastered 150 countries (2 so far)" },
        { id: 'country:jp', text: "Japan: its places open once you've mastered 150 countries (2 so far)" },
        { id: 'region:fr.bre', text: "Unlocked: Brittany's places (France)" },
      ]);
      expect(showsTestOutLink(curriculum, progress, new Set(), 'country:fr')).toBe(false);
      expect(showsTestOutLink(curriculum, { ...open, ...progress }, new Set(), 'country:fr')).toBe(true);
    });
  });
});

describe('[SES-23, SES-C07] gateOpenedLines', () => {
  // big and big2 are in the first wave (50 places each), small and the fillers in the second; only
  // big, big2 and small have children.
  const fillers = gateFillers();
  const cityIn = (country: string, id: string): Place => ({
    id,
    name: id,
    country,
    region: null,
    lat: 0,
    lng: 0,
    type: 'city',
    level: 1,
  });
  const curriculum = buildCurriculum(
    [
      { id: 'big', name: 'Big', places: 50, hasRegions: false },
      { id: 'big2', name: 'Big 2', places: 50, hasRegions: false },
      { id: 'small', name: 'Small', places: 1, hasRegions: false },
      ...fillers,
    ],
    [],
    [
      ...Array.from({ length: 50 }, (_, i) => cityIn('big', `b${i}`)),
      ...Array.from({ length: 50 }, (_, i) => cityIn('big2', `c${i}`)),
      cityIn('small', 's0'),
    ],
  );
  /** big and small mastered, then `n` fillers: n + 2 mastered countries. */
  const progressWith = (n: number) =>
    withFillersMastered(
      { 'country:big': mastered('country:big'), 'country:small': mastered('country:small') },
      mastered('country:filler'),
      fillers.slice(0, n),
    );
  const fillerIds = (from: number, to: number) => fillers.slice(from, to).map((f) => `country:${f.id}`);

  it('names 60 when the round brings the count from below 60 to 60', () => {
    expect(gateOpenedLines(curriculum, progressWith(58), ['country:big', 'place:b0'])).toEqual([
      { id: 'gate:60', text: "You've mastered 60 countries: regions and places are open for 1 of them", opened: 1 },
    ]);
  });

  it('names 150 when the round brings the count from below 150 to 150 or more', () => {
    expect(gateOpenedLines(curriculum, progressWith(149), ['country:small', ...fillerIds(147, 149)])).toEqual([
      { id: 'gate:150', text: "You've mastered 150 countries: regions and places are open for 1 of them", opened: 1 },
    ]);
  });

  it('gives both lines, 60 then 150, for a round that crosses both', () => {
    expect(gateOpenedLines(curriculum, progressWith(148), fillerIds(0, 148)).map((l) => l.id)).toEqual([
      'gate:60',
      'gate:150',
    ]);
  });

  it('counts every mastered country of the wave with children', () => {
    const progress = withFillersMastered(
      {
        'country:big': mastered('country:big'),
        'country:big2': mastered('country:big2'),
        'country:small': mastered('country:small'),
      },
      mastered('country:filler'),
      fillers.slice(0, 57),
    );
    expect(gateOpenedLines(curriculum, progress, ['country:big'])).toEqual([
      { id: 'gate:60', text: "You've mastered 60 countries: regions and places are open for 2 of them", opened: 2 },
    ]);
  });

  it('says the wave opens as each country is mastered when the gate opened none', () => {
    const at60 = withFillersMastered(
      { 'country:small': mastered('country:small') },
      mastered('country:filler'),
      fillers.slice(0, 59),
    );
    expect(gateOpenedLines(curriculum, at60, fillerIds(58, 59))).toEqual([
      {
        id: 'gate:60',
        text: "You've mastered 60 countries: the most-asked countries' regions and places open as you master each",
        opened: 0,
      },
    ]);
    const at150 = withFillersMastered(
      { 'country:big': mastered('country:big') },
      mastered('country:filler'),
      fillers.slice(0, 149),
    );
    expect(gateOpenedLines(curriculum, at150, fillerIds(148, 149))).toEqual([
      {
        id: 'gate:150',
        text: "You've mastered 150 countries: the other countries' regions and places open as you master each",
        opened: 0,
      },
    ]);
  });

  it('gives no line for a round that crosses no gate, and counts a repeated id once', () => {
    expect(gateOpenedLines(curriculum, progressWith(59), ['country:small'])).toEqual([]);
    expect(gateOpenedLines(curriculum, progressWith(56), ['country:big'])).toEqual([]);
    expect(gateOpenedLines(curriculum, progressWith(58), ['country:big', 'country:big', 'place:b0'])).toHaveLength(1);
    expect(gateOpenedLines(curriculum, progressWith(58), [])).toEqual([]);
  });
});

describe('[SES-23, SES-C05, SES-C07] withGateRecheck', () => {
  it('is the same round when nothing new is testable', () => {
    const round = { mastered: ['country:peru', 'country:chile'], testable: ['country:peru'] };
    expect(withGateRecheck(round, () => false)).toBe(round);
    expect(withGateRecheck(round, (id) => id === 'country:peru')).toBe(round);
  });

  it('adds only country ids, after the testable ones, in mastered order and once each', () => {
    const round = {
      mastered: ['country:peru', 'region:fr.bre', 'country:chile', 'country:japan', 'country:chile'],
      testable: ['region:fr.bre'],
    };
    expect(withGateRecheck(round, (id) => id !== 'country:japan')).toEqual({
      mastered: round.mastered,
      testable: ['region:fr.bre', 'country:peru', 'country:chile'],
    });
  });

  it('leaves a non-country mastered id out even when it is testable', () => {
    const round = { mastered: ['region:fr.bre'], testable: [] };
    expect(withGateRecheck(round, () => true)).toBe(round);
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

describe('[SES-27, SES-C05] keepTestable', () => {
  const saved: SavedSession = {
    run: startRun([]),
    mastered: ['country:france', 'country:spain'],
    testable: ['country:france', 'country:spain'],
  };
  it('drops a test-out finished since from testable, and keeps it in mastered', () => {
    const kept = keepTestable(saved, (id) => id !== 'country:france');
    expect(kept.testable).toEqual(['country:spain']);
    expect(kept.mastered).toEqual(saved.mastered);
    expect(kept.run).toBe(saved.run);
  });
  it('keeps every id whose link is still shown', () => {
    expect(keepTestable(saved, () => true).testable).toEqual(saved.testable);
  });
});
