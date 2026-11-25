import { useEffect, useRef, useState } from 'react';
import type { ExerciseResult } from './types';

/**
 * One question's answer: times it from mount (the first render's commit) and takes the first
 * answer only.
 * `answer(grade)` grades with the elapsed ms, reports the result through `onAnswer` and returns
 * true; once answered it does nothing and returns false.
 */
export function useQuestion(onAnswer: (result: ExerciseResult) => void) {
  const startRef = useRef(0);
  const answeredRef = useRef(false);
  const [result, setResult] = useState<ExerciseResult | null>(null);
  useEffect(() => {
    startRef.current = performance.now();
  }, []);

  const answer = (grade: (timeMs: number) => ExerciseResult): boolean => {
    if (answeredRef.current) return false;
    answeredRef.current = true;
    const r = grade(Math.max(0, performance.now() - startRef.current));
    setResult(r);
    onAnswer(r);
    return true;
  };
  return { result, answer };
}
