import { MantineProvider } from '@mantine/core';
import { matchPath, Navigate, Route, Routes, useLocation } from 'react-router';
import AppBar from './components/AppBar';
import Footer from './components/Footer';
import GlobeLayout from './components/GlobeLayout';
import SaveStatus from './components/SaveStatus';
import { useNewPageFocus } from './components/useNewPageFocus';
import { GlobeProvider, SharedGlobe } from './maps/GlobeProvider';
import Credits from './pages/Credits';
import Home from './pages/Home';
import Placement from './pages/Placement';
import Progress from './pages/Progress';
import ProgressDrill from './pages/ProgressDrill';
import Playground from './pages/Playground';
import Session from './pages/Session';
import Settings from './pages/Settings';
import TestOut from './pages/TestOut';

/** Pages whose column fills a phone's screen, the globe hidden (it stays mounted). */
const NO_PHONE_GLOBE = ['/settings', '/credits'];

/**
 * The app shell: Mantine's dark theme, and one globe for every page, beside the column that holds
 * the page, the save status and the footer.
 */
export default function App() {
  const { pathname } = useLocation();
  const columnRef = useNewPageFocus();
  const hideGlobeOnPhone = NO_PHONE_GLOBE.some((path) => matchPath(path, pathname));
  return (
    <MantineProvider forceColorScheme="dark">
      <GlobeProvider>
        <GlobeLayout
          hideGlobeOnPhone={hideGlobeOnPhone}
          columnRef={columnRef}
          globe={<SharedGlobe />}
          column={
            <>
              <AppBar />
              <main>
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
            </>
          }
        />
      </GlobeProvider>
    </MantineProvider>
  );
}
