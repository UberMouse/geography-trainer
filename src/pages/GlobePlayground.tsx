import '@mantine/core/styles.css';
import {
  Anchor,
  Box,
  Button,
  Group,
  MantineProvider,
  SimpleGrid,
  Stack,
  Title,
} from '@mantine/core';
import { useHref } from 'react-router';
import GlobeLayout from '../components/GlobeLayout';

const DEMO_CHOICES = ['Choice A', 'Choice B', 'Choice C', 'Choice D'];

/**
 * Dev-only, loaded lazily from the playground so Mantine stays out of every other page: the globe
 * layout with a placeholder where the globe goes, and a sample of a question's four choices.
 */
export default function GlobePlayground() {
  // Full page loads, not router links: Mantine's global styles stay once loaded, and the other
  // tabs render without them.
  const mapsHref = useHref('/playground');
  const exercisesHref = useHref('/playground?mode=exercises');
  return (
    <MantineProvider forceColorScheme="dark">
      <GlobeLayout
        panel={
          <Stack>
            <Group component="nav" aria-label="Playground tabs">
              <Anchor href={mapsHref}>Maps</Anchor>
              <Anchor href={exercisesHref}>Exercises</Anchor>
            </Group>
            <Title order={1} size="h3">
              Globe playground
            </Title>
            <SimpleGrid cols={2}>
              {DEMO_CHOICES.map((label) => (
                <Button key={label} variant="default" data-testid="demo-choice">
                  {label}
                </Button>
              ))}
            </SimpleGrid>
          </Stack>
        }
        globe={<Box data-testid="globe-slot" h="100%" bg="dark.9" />}
      />
    </MantineProvider>
  );
}
