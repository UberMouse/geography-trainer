import { Link } from 'react-router';
import { DEPENDENCY_CREDITS } from './credits';

/** Who the place list, the boundaries and the libraries come from. */
export default function Credits() {
  return (
    <>
      <h1>Credits</h1>
      <p>
        <Link to="/">Back to Home</Link>
      </p>
      <h2>Data</h2>
      <ul>
        <li>
          Place list courtesy of <a href="https://maptap.gg">MapTap.gg</a>.
        </li>
        <li>
          Boundaries from <a href="https://www.naturalearthdata.com">Natural Earth</a> (public
          domain).
        </li>
      </ul>
      <h2>Libraries</h2>
      <ul>
        {DEPENDENCY_CREDITS.map((c) => (
          <li key={c.name}>
            <a href={c.url}>{c.name}</a>, {c.licence} licence
          </li>
        ))}
      </ul>
    </>
  );
}
