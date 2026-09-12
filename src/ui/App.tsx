import { Toast } from './common/Toast.tsx';
import { ExportView } from './export/ExportView.tsx';
import { Footer } from './Footer.tsx';
import { useEngine } from './hooks.ts';
import { LibraryView } from './library/LibraryView.tsx';
import { PerformanceView } from './performance/PerformanceView.tsx';
import { SettingsView } from './settings/SettingsView.tsx';
import { TopBar } from './topbar/TopBar.tsx';

export function App() {
  const view = useEngine((s) => s.ui.view);
  return (
    <div className="app">
      <TopBar />
      <main className="main" id="main">
        {view === 'performance' && <PerformanceView />}
        {view === 'library' && <LibraryView />}
        {view === 'export' && <ExportView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <Footer />
      <Toast />
    </div>
  );
}
