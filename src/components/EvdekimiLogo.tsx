import React from 'react';

interface Props {
  className?: string;
  color?: string; // Kept for compatibility, though img won't use it directly unless using CSS filters
}

export function EvdekimiLogo({ className = "w-8 h-8" }: Props) {
  return (
    <img 
      src="/Logo EV white.png" 
      alt="EVDEkimi Logo" 
      className={`object-contain ${className}`}
    />
  );
}
