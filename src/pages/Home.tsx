import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PLACEMENT_MAX_QUESTIONS } from '../engine/config';
import { todayNumbers } from '../engine/today';
import ProgressMap, { type ProgressFeature } from '../maps/ProgressMap';
import { newTodayText, showsPlacementOffer } from './homeView';
import Status from './LoadStatus';
import { countryLooks, lookOrLocked } from './progressView';
import { useLoaded } from './useLoaded';
import { loadWorldData, type WorldData } from './worldData';

const tzOffset = (now: Date) => -now.getTimezoneOffset();

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

/** Today's numbers, a Start link and the progress map, with links to Progress and Settings. */
export default function Home() {
  const [data, reload] = useLoaded('home', loadWorldData);
  const now = useNow();
  return (
    <>
      <h1>Geography Trainer</h1>
      <Status
        state={data}
        retry={reload}
        failure="Could not load the map data or your saved progress:"
      >
        {(loaded) => <HomeContent data={loaded} now={now} />}
      </Status>
    </>
  );
}

interface HomeContentProps {
  data: WorldData;
  now: Date;
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
  return (
    <>
      <dl className="home-numbers">
        <div>
          <dt>Due reviews</dt>
          <dd data-testid="today-due">{numbers.due}</dd>
        </div>
        <div>
          <dt>New today</dt>
          <dd data-testid="today-new">
            {newTodayText(numbers.newToday, numbers.dailyCap)}
          </dd>
        </div>
        <div>
          <dt>Learning</dt>
          <dd data-testid="today-learning">{numbers.learning}</dd>
        </div>
        <div>
          <dt>Learned</dt>
          <dd data-testid="today-learned">{numbers.learned}</dd>
        </div>
      </dl>
      {showsPlacementOffer(data.curriculum, data.progress, data.finishedTests) && (
        <p>
          Already know some countries? <Link to="/placement">Take the placement test</Link> (about{' '}
          {PLACEMENT_MAX_QUESTIONS} questions)
        </p>
      )}
      {numbers.sessionLength > 0 ? (
        <p>
          <Link to="/session" className="home-start">
            Start ({numbers.sessionLength} {numbers.sessionLength === 1 ? 'question' : 'questions'})
          </Link>
        </p>
      ) : (
        <p>There is nothing to study right now.</p>
      )}
      <div className="home-map">
        <ProgressMap
          features={data.countries.features as ProgressFeature[]}
          look={lookOrLocked(looks)}
        />
        <p>
          <Link to="/progress">See your progress</Link>
        </p>
      </div>
      <p>
        <Link to="/settings">Settings</Link>
      </p>
    </>
  );
}
