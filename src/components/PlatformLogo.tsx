import React from 'react';

type PlatformLogoProps = {
  platform: string;
  className?: string;
};

/**
 * Local inline brand marks for known OTA platforms.
 * Paths for Airbnb / Booking.com / Expedia / Trip.com come from Simple Icons
 * (CC0) and are embedded so the UI has no runtime CDN dependency.
 * Vrbo + Guesty marks are compact local brand-faithful SVGs (not generic icons).
 */
function normalizePlatformKey(platform: string) {
  return String(platform || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function LogoShell({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 shrink-0"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function AirbnbLogo() {
  return (
    <LogoShell>
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#FF5A5F" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z" />
      </svg>
    </LogoShell>
  );
}

function BookingLogo() {
  return (
    <LogoShell>
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#003B95" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 0H0v24h24ZM8.575 6.563h2.658c2.108 0 3.473 1.15 3.473 2.898 0 1.15-.575 1.82-.91 2.108l-.287.263.335.192c.815.479 1.318 1.389 1.318 2.395 0 1.988-1.51 3.257-3.857 3.257H7.449V7.713c0-.623.503-1.126 1.126-1.15zm1.7 1.868c-.479.024-.694.264-.694.79v1.893h1.676c.958 0 1.294-.743 1.294-1.365 0-.815-.503-1.318-1.318-1.318zm-.096 4.36c-.407.071-.598.31-.598.79v2.251h1.868c.934 0 1.509-.55 1.509-1.533 0-.934-.599-1.509-1.51-1.509zm7.737 2.394c.743 0 1.341.599 1.341 1.342a1.34 1.34 0 0 1-1.341 1.341 1.355 1.355 0 0 1-1.341-1.341c0-.743.598-1.342 1.34-1.342z" />
      </svg>
    </LogoShell>
  );
}

/** Vrbo house mark — brand blues / warm accents (local vector, no remote asset). */
function VrboLogo() {
  return (
    <LogoShell>
      <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
        <path fill="#3D67FF" d="M12 2.4 3.2 9.1v12.5h6.3v-5.6h4.9v5.6h6.4V9.1L12 2.4z" />
        <path fill="#7B61FF" d="M12 2.4 8.1 5.4v7.1h3.9V2.4z" />
        <path fill="#FF6B6B" d="M12 2.4 15.9 5.4v4.2H12V2.4z" />
        <path fill="#2EC4B6" d="M8.1 12.5h3.9v4.1H8.1z" />
        <path fill="#FFB703" d="M12 9.6h3.9v3.9H12z" />
      </svg>
    </LogoShell>
  );
}

function ExpediaLogo() {
  return (
    <LogoShell>
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#191E3B" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.067 0H4.933A4.94 4.94 0 0 0 0 4.933v14.134A4.932 4.932 0 0 0 4.933 24h14.134A4.932 4.932 0 0 0 24 19.067V4.933C24.01 2.213 21.797 0 19.067 0ZM7.336 19.341c0 .19-.148.337-.337.337h-2.33a.333.333 0 0 1-.337-.337v-2.33c0-.189.148-.336.337-.336H7c.19 0 .337.147.337.337zm12.121-1.486-2.308 2.298c-.169.168-.422.053-.422-.2V9.57l-6.44 6.44a.533.533 0 0 1-.421.17H8.169a.32.32 0 0 1-.338-.338v-1.697c0-.2.053-.316.169-.422l6.44-6.44H4.058c-.253 0-.369-.253-.2-.421l2.297-2.309c.137-.137.285-.232.517-.232H18.15c.854 0 1.539.686 1.539 1.54v11.478c-.01.231-.095.368-.232.516z" />
      </svg>
    </LogoShell>
  );
}

/** Official Guesty house mark path (from Guesty site logo SVG). */
function GuestyLogo() {
  return (
    <LogoShell>
      <svg viewBox="0 0 105 105" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
        <path
          fill="#1A1A1A"
          d="M47.73,1.61c3.21-2.17,7.43-2.14,10.61.07l42.28,29.47c2.51,1.75,4.01,4.62,4.01,7.68v64.99h-11.27v-62.11c0-1.19-.58-2.3-1.56-2.98L55.01,13.1c-1.23-.86-2.87-.87-4.11-.03L12.86,38.8c-1,.68-1.6,1.8-1.6,3.01v48.03c0,1.51,1.22,2.73,2.73,2.73h52.8c1.51,0,2.73-1.22,2.73-2.73v-36.39c0-1.23-.63-2.38-1.66-3.05l-12.49-8.08c-1.48-.95-3.37-.97-4.86-.05l-13.21,8.2c-1.07.66-1.72,1.83-1.72,3.09v25.06h-11.27v-28.14c0-3.24,1.67-6.25,4.43-7.96l19.29-11.97c3.08-1.91,6.98-1.87,10.03.09l18.45,11.93c2.67,1.73,4.28,4.69,4.28,7.87v44.03c0,5.17-4.19,9.37-9.37,9.37H9.37c-5.17,0-9.37-4.19-9.37-9.37v-55.59c0-3.11,1.54-6.02,4.12-7.76L47.73,1.61Z"
        />
      </svg>
    </LogoShell>
  );
}

function TripComLogo() {
  return (
    <LogoShell>
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#287DFA" xmlns="http://www.w3.org/2000/svg">
        <path d="M17.834 9.002c-.68 0-1.29.31-1.707.799v-.514h-1.708v8.348h1.897v-2.923c.416.344.943.551 1.518.551 1.677 0 3.036-1.401 3.036-3.13s-1.36-3.13-3.036-3.13zm-.19 4.516c-.733 0-1.328-.62-1.328-1.385s.595-1.385 1.328-1.385c.734 0 1.328.62 1.328 1.385s-.594 1.385-1.328 1.385zm6.356.607a1.138 1.138 0 1 1-2.277 0 1.138 1.138 0 0 1 2.277 0zM13.205 7.428a1.062 1.062 0 1 1-2.125 0 1.062 1.062 0 0 1 2.125 0zm-2.011 1.859h1.897v5.692h-1.897V9.287zM6.83 8.225H4.364v6.754H2.466V8.225H0V6.63h6.83v1.594zm3.035 1.033c.13 0 .255.012.38.03v1.74a1.55 1.55 0 0 0-.297-.031c-.88 0-1.594.612-1.594 1.593v2.389H6.451V9.287h1.707v.9c.363-.558.991-.93 1.707-.93z" />
      </svg>
    </LogoShell>
  );
}

export function PlatformLogo({ platform, className }: PlatformLogoProps) {
  const key = normalizePlatformKey(platform);

  let mark: React.ReactNode = null;
  if (key === 'airbnb') mark = <AirbnbLogo />;
  else if (key === 'booking.com') mark = <BookingLogo />;
  else if (key === 'vrbo') mark = <VrboLogo />;
  else if (key === 'expedia') mark = <ExpediaLogo />;
  else if (key === 'guesty booking engine' || key === 'guesty') mark = <GuestyLogo />;
  else if (key === 'trip.com') mark = <TripComLogo />;

  if (!mark) return null;

  return <span className={className}>{mark}</span>;
}
