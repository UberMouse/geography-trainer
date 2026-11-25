import { Link } from 'react-router';

export default function Footer() {
  return (
    <footer className="app-footer">
      <p>
        Place list courtesy of <a href="https://maptap.gg">MapTap.gg</a>
      </p>
      <p>
        Boundaries: <a href="https://www.naturalearthdata.com">Natural Earth</a>
      </p>
      <p>
        <Link to="/credits">Credits</Link>
      </p>
    </footer>
  );
}
