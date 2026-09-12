import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from './brand.ts';
import { blinkOn } from './midi/leds.ts';
import { startRuntime } from './runtime.ts';
import { applyTokens } from './theme/tokens.ts';
import { App } from './ui/App.tsx';
import './theme/fonts.css';
import './theme/global.css';

applyTokens();
document.title = APP_NAME;

// On-screen blinking runs on the same 250 ms phase as the LEDs written to the unit.
setInterval(() => {
  document.documentElement.dataset.blink = blinkOn(performance.now()) ? '1' : '0';
}, 50);

startRuntime();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
