import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { NewSession } from './pages/NewSession';
import { SessionDetail } from './pages/SessionDetail';
import { SessionHistory } from './pages/SessionHistory';
import { ReportView } from './pages/ReportView';
import { Settings } from './pages/Settings';

const App: React.FC = () => (
  <Routes>
    <Route element={<Layout />}>
      <Route path="/" element={<Dashboard />} />
      <Route path="/sessions/new" element={<NewSession />} />
      <Route path="/sessions/:id/report" element={<ReportView />} />
      <Route path="/sessions/:id" element={<SessionDetail />} />
      <Route path="/history" element={<SessionHistory />} />
      <Route path="/settings" element={<Settings />} />
    </Route>
  </Routes>
);

export default App;
