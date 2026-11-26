import { Anchor, Button, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PLACEMENT_MAX_QUESTIONS, PLACEMENT_MIN_QUESTIONS } from '../engine/config';
import { todayNumbers } from '../engine/today';
import { newTodayText, showsPlacementOffer } from './homeView';
import type { ItemState } from '../engine/curriculum';
import Status from './LoadStatus';
import ProgressLegend from './ProgressLegend';
import { countryLooks } from './progressView';
import { useCountriesGlobe } from './useCountriesGlobe';
import { useLoaded } from './useLoaded';
import { loadWorldData, type WorldData } from './worldData';

const tzOffset = (now: Date) => -now.getTimezoneOffset();
/**
 * Home's globe shows countries only, and a curriculum country is never locked, so the legend leaves
 * locked out. A feature with no look (not in the curriculum) still falls back to the locked colour
 * (`lookOrLocked`).
 */
const HOME_LEGEND: ItemState[] = ['new', 'learning', 'mastered'];

/** The current time, refreshed every minute and when the tab comes back to the foreground. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return now;
}

/**
 * Today's numbers, a Start link and the links to Progress and Settings, beside the globe filled by
 * country progress.
 */
export default function Home() {
  const [data, reload] = useLoaded('home', loadWorldData);
  const now = useNow();
  return (
    <Stack>
      <Title order={1}>Geography Trainer</Title>
      <Status
        state={data}
        retry={reload}
        failure="Could not load the map data or your saved progress:"
      >
        {(loaded) => <HomeContent data={loaded} now={now} />}
      </Status>
    </Stack>
  );
}

interface HomeContentProps {
  data: WorldData;
  now: Date;
}

/** One of today's numbers: its label over its value. */
function TodayNumber({ label, testId, value }: { label: string; testId: string; value: string | number }) {
  return (
    <div>
      <Text component="dt" size="sm" c="dimmed">
        {label}
      </Text>
      <Text component="dd" size="xl" m={0} data-testid={testId}>
        {value}
      </Text>
    </div>
  );
}

function HomeContent({ data, now }: HomeContentProps) {
  const { curriculum } = data;
  const looks = useMemo(
    () => countryLooks(curriculum, data.progress, data.countries.countries),
    [curriculum, data.progress, data.countries],
  );
  const numbers = useMemo(
    () => todayNumbers(curriculum, data.progress, now, tzOffset(now), data.dailyNewCap),
    [curriculum, data.progress, now, data.dailyNewCap],
  );
  useCountriesGlobe(data, looks);
  return (
    <Stack align="flex-start">
      <SimpleGrid component="dl" cols={2} spacing="sm" m={0} w="100%">
        <TodayNumber label="Due reviews" testId="today-due" value={numbers.due} />
        <TodayNumber
          label="New today"
          testId="today-new"
          value={newTodayText(numbers.newToday, numbers.dailyCap)}
        />
        <TodayNumber label="Learning" testId="today-learning" value={numbers.learning} />
        <TodayNumber label="Learned" testId="today-learned" value={numbers.learned} />
      </SimpleGrid>
      {showsPlacementOffer(data.curriculum, data.progress, data.finishedTests) && (
        <Text>
          Already know some countries?{' '}
          <Anchor component={Link} to="/placement">
            Take the placement test
          </Anchor>{' '}
          ({PLACEMENT_MIN_QUESTIONS}–{PLACEMENT_MAX_QUESTIONS} questions)
        </Text>
      )}
      {numbers.sessionLength > 0 ? (
        <Button component={Link} to="/session" size="md">
          Start ({numbers.sessionLength} to study)
        </Button>
      ) : (
        <Text>There is nothing to study right now.</Text>
      )}
      <ProgressLegend states={HOME_LEGEND} />
      <Anchor component={Link} to="/progress">
        See your progress
      </Anchor>
      <Anchor component={Link} to="/settings">
        Settings
      </Anchor>
    </Stack>
  );
}
