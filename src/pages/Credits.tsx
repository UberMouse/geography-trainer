import { Anchor, List, Stack, Title } from '@mantine/core';
import { Link } from 'react-router';
import { DEPENDENCY_CREDITS } from './credits';

/** Who the place list, the boundaries, the imagery and the libraries come from. */
export default function Credits() {
  return (
    <Stack align="flex-start">
      <Title order={1}>Credits</Title>
      <Anchor component={Link} to="/">
        Back to Home
      </Anchor>
      <Title order={2} size="h4">
        Data
      </Title>
      <List spacing={4}>
        <List.Item>
          Place list courtesy of <Anchor href="https://maptap.gg">MapTap.gg</Anchor>.
        </List.Item>
        <List.Item>
          Boundaries from <Anchor href="https://www.naturalearthdata.com">Natural Earth</Anchor>{' '}
          (public domain).
        </List.Item>
        <List.Item>
          Sentinel-2 cloudless – <Anchor href="https://s2maps.eu">https://s2maps.eu</Anchor> by EOX
          IT Services GmbH (Contains modified Copernicus Sentinel data 2025)
        </List.Item>
      </List>
      <Title order={2} size="h4">
        Libraries
      </Title>
      <List spacing={4}>
        {DEPENDENCY_CREDITS.map((c) => (
          <List.Item key={c.name}>
            <Anchor href={c.url}>{c.name}</Anchor>, {c.licence} licence
          </List.Item>
        ))}
      </List>
    </Stack>
  );
}
