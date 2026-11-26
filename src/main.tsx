import { createRoot } from 'react-dom/client';
import './index.css';
import './multiplayerBridge';
import './village3d';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
