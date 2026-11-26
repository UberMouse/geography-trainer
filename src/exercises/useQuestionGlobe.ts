import { useEffect, useMemo } from 'react';
import type { Rung } from '../engine/srs';
import type { LngLat } from '../maps/geo';
import { moveCamera, useGlobe } from '../maps/globeContext';
import {
  questionCamera,
  questionMarkers,
  questionMode,
  questionReveal,
  revealCamera,
} from './questionGlobe';
import type { ExerciseItem } from './types';

/**
 * One question on the shared globe: its mode, its pin (L2, L3) or, once answered, the reveal and
 * the target's name. The camera moves when the question starts and, after a tap's answer, to
 * frame the tap and the answer (see `questionGlobe.ts`). `onTap` is handed to the globe until the
 * question is answered; after that taps are ignored.
 */
export function useQuestionGlobe({
  item,
  rung,
  opening,
  pin = null,
  answered,
  onTap,
}: {
  item: ExerciseItem;
  rung: Rung;
  opening?: boolean;
  pin?: LngLat | null;
  answered: boolean;
  onTap?: (at: LngLat) => void;
}) {
  const mode = questionMode(item, rung);
  // A tap question reveals the confirmed pin, which no longer moves once answered.
  const reveal = useMemo(
    () => (answered ? questionReveal(item, pin ?? undefined) : null),
    [answered, item, pin],
  );
  const markers = useMemo(() => questionMarkers(item, pin, answered), [item, pin, answered]);
  const camera = useGlobe({ mode, reveal, markers, onTap: answered ? undefined : onTap });

  // A question is mounted for its item and rung (see `Exercise`), so this runs as it starts.
  useEffect(() => {
    moveCamera(camera, questionCamera(item, rung, opening));
  }, [camera, item, rung, opening]);

  const tap = reveal?.tap?.at;
  useEffect(() => {
    if (tap) moveCamera(camera, revealCamera(item, tap));
  }, [camera, item, tap]);
}
