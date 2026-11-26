import { ColorSwatch, Group, Stack, Text } from '@mantine/core';
import type { ItemState } from '../engine/curriculum';
import { PROGRESS_COLOURS, STATE_LABELS } from './progressView';

/** A legend entry: its colour's swatch and what it means. */
function LegendEntry({ colour, children }: { colour: string; children: string }) {
  return (
    <Group component="li" gap={6} wrap="nowrap" align="flex-start">
      <ColorSwatch color={colour} size={14} radius={0} withShadow={false} mt={4} />
      <Text size="sm">{children}</Text>
    </Group>
  );
}

/**
 * What the progress globe's colours mean, for the states it can show: Home's world has no locked
 * countries, the Progress page's drill-downs do.
 */
export default function ProgressLegend({ states }: { states: readonly ItemState[] }) {
  return (
    <Stack component="ul" gap={4} m={0} p={0} aria-label="Legend" style={{ listStyle: 'none' }}>
      {states.map((state) => (
        <LegendEntry key={state} colour={PROGRESS_COLOURS[state]}>
          {state === 'mastered'
            ? `${STATE_LABELS[state]} (deeper as its regions and places are mastered)`
            : STATE_LABELS[state]}
        </LegendEntry>
      ))}
      {states.includes('mastered') && (
        <LegendEntry colour={PROGRESS_COLOURS.complete}>Everything below it mastered</LegendEntry>
      )}
    </Stack>
  );
}
