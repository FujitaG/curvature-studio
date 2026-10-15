import { StrictMode } from 'react';
import { initializeWorkspace } from './project/autosave';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyCssTokenVariables } from './design/tokens';
import { ErrorBoundary } from './ui/ErrorBoundary';

applyCssTokenVariables();
void initializeWorkspace().finally(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
));
