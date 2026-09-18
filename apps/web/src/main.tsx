import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './layout/AppShell.tsx';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 容器。');

createRoot(container).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
