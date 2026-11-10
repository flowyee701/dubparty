import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Toasts } from '../components/Layout';
import { HomePage } from '../pages/HomePage';
import { HowToPlayPage } from '../pages/HowToPlayPage';
import { MicCheckPage } from '../pages/MicCheckPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PackEditorPage } from '../pages/PackEditorPage';
import { PacksPage } from '../pages/PacksPage';
import { RoomPage } from '../pages/RoomPage';
import { SoloPage } from '../pages/SoloPage';
import { applyTheme, usePrefs } from '../store/prefs';

export function App() {
  const theme = usePrefs((s) => s.theme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/how" element={<HowToPlayPage />} />
        <Route path="/mic" element={<MicCheckPage />} />
        <Route path="/solo" element={<SoloPage />} />
        <Route path="/packs" element={<PacksPage />} />
        <Route path="/packs/:id" element={<PackEditorPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toasts />
    </>
  );
}
