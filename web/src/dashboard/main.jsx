import './dashboard.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LiveProvider } from './live.jsx';
import Shell from './parts/Shell.jsx';
import Floor from './pages/Floor.jsx';
import Crew from './pages/Crew.jsx';
import Report from './pages/Report.jsx';
import Worker from './pages/Worker.jsx';
import Workers from './pages/Workers.jsx';
import Playbooks from './pages/Playbooks.jsx';
import PlaybookEdit from './pages/PlaybookEdit.jsx';
import NotFound from './pages/NotFound.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LiveProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/report/:id" element={<Report />} />
          <Route element={<Shell />}>
            <Route index element={<Floor />} />
            <Route path="sessions/:id" element={<Crew />} />
            <Route path="crew" element={<Workers />} />
            <Route path="crew/:name" element={<Worker />} />
            <Route path="playbooks" element={<Playbooks />} />
            <Route path="playbooks/:id" element={<PlaybookEdit />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LiveProvider>
  </StrictMode>,
);
