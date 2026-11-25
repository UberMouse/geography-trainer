import { Navigate, Route, Routes } from 'react-router';
import Footer from './components/Footer';
import Home from './pages/Home';
import Playground from './pages/Playground';
import Session from './pages/Session';

export default function App() {
  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/session" element={<Session />} />
          {import.meta.env.DEV && <Route path="/playground" element={<Playground />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
