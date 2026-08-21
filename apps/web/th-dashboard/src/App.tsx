import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { NewScan } from './pages/NewScan';
import { ScanDetail } from './pages/ScanDetail';
import { ScanHistory } from './pages/ScanHistory';
import { ReportView } from './pages/ReportView';
import { Settings } from './pages/Settings';

const App: React.FC = () => (
  <Routes>
    <Route element={<Layout />}>
      <Route path="/" element={<Dashboard />} />
      <Route path="/scans/new" element={<NewScan />} />
      <Route path="/scans/:id" element={<ScanDetail />} />
      <Route path="/history" element={<ScanHistory />} />
      <Route path="/scans/:id/report" element={<ReportView />} />
      <Route path="/settings" element={<Settings />} />
    </Route>
  </Routes>
);

export default App;
