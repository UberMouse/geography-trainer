import { Navigate, Route, Routes } from 'react-router';
import Footer from './components/Footer';
import SaveStatus from './components/SaveStatus';
import Credits from './pages/Credits';
import Home from './pages/Home';
import Placement from './pages/Placement';
import Progress from './pages/Progress';
import ProgressDrill from './pages/ProgressDrill';
import Playground from './pages/Playground';
import Session from './pages/Session';
import Settings from './pages/Settings';
import TestOut from './pages/TestOut';

export default function App() {
  return (
    <div className="app">
      <main className="app-main">
        <SaveStatus />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/progress/:country" element={<ProgressDrill />} />
          <Route path="/progress/:country/:region" element={<ProgressDrill />} />
          <Route path="/placement" element={<Placement />} />
          <Route path="/placement/:country" element={<TestOut />} />
          <Route path="/placement/:country/:region" element={<TestOut />} />
          <Route path="/session" element={<Session />} />
          <Route path="/credits" element={<Credits />} />
          <Route path="/settings" element={<Settings />} />
          {import.meta.env.DEV && <Route path="/playground" element={<Playground />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
