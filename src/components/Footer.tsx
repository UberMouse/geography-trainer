import { Anchor, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';

export default function Footer() {
  return (
    <Stack component="footer" gap={0} py="md">
      <Text size="sm" c="dimmed">
        Place list courtesy of <Anchor href="https://maptap.gg">MapTap.gg</Anchor>
      </Text>
      <Text size="sm" c="dimmed">
        Boundaries: <Anchor href="https://www.naturalearthdata.com">Natural Earth</Anchor>
      </Text>
      <Text size="sm">
        <Anchor component={Link} to="/credits">
          Credits
        </Anchor>
      </Text>
    </Stack>
  );
}
