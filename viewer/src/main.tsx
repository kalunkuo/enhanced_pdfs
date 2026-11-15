import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/typography.css';
import './components/ui/icon-button.css';
import './components/ui/kit.css';
import './styles/app.css';
import './styles/review.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
