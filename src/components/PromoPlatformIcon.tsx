import React, { useId } from 'react';
import { Globe } from 'lucide-react';
import { getPromoPlatformKind, type PromoPlatformKind } from '../lib/mapsLink';

interface PromoPlatformIconProps {
  url?: string;
  kind?: PromoPlatformKind | null;
  className?: string;
}

export const PromoPlatformIcon: React.FC<PromoPlatformIconProps> = ({
  url,
  kind,
  className = 'w-4 h-4',
}) => {
  const igGradId = useId();
  const resolvedKind: PromoPlatformKind = kind ?? (url ? getPromoPlatformKind(url) : 'web');

  switch (resolvedKind) {
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true">
          <defs>
            <linearGradient id={igGradId} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#F58529" />
              <stop offset="50%" stopColor="#DD2A7B" />
              <stop offset="100%" stopColor="#8134AF" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="6" fill={`url(#${igGradId})`} />
          <rect
            x="6.2"
            y="6.2"
            width="11.6"
            height="11.6"
            rx="3.4"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="12" r="2.7" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
          <circle cx="15.7" cy="8.3" r="0.9" fill="#FFFFFF" />
        </svg>
      );

    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true">
          <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#FF0000" />
          <polygon points="10,8.7 16.2,12 10,15.3" fill="#FFFFFF" />
        </svg>
      );

    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true">
          <circle cx="12" cy="12" r="10.5" fill="#1877F2" />
          <path
            d="M15.4 12.6l.4-2.8h-2.7V8c0-.8.4-1.5 1.6-1.5H16V4.1s-1.1-.2-2.2-.2c-2.2 0-3.7 1.3-3.7 3.8v2.1H7.7v2.8h2.4v7.1a10.6 10.6 0 003 0v-7.1h2.3z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5.5" fill="#0F172A" />
          <path
            d="M15.8 7.5a3.7 3.7 0 01-1.9-2.2h-2.1v9.3a1.9 1.9 0 11-1.3-1.8V10.6a4.1 4.1 0 103.4 4V9.8a5.6 5.6 0 003.3 1.1V8.8c-.5 0-1-.2-1.4-.5z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'x':
      return (
        <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5.5" fill="#0F172A" />
          <path
            d="M13.3 11.1L17.9 6h-1.1l-4 4.4L9.7 6H6l4.8 6.8L6 18h1.1l4.2-4.7 3.3 4.7H18l-4.7-6.9zm-1.5 1.7l-.5-.7L7.5 6.8h1.7l3.1 4.3.5.7 4 5.5h-1.7l-3.3-4.5z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'linkedin':
      return (
        <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="4.5" fill="#0A66C2" />
          <circle cx="7.6" cy="8.1" r="1.3" fill="#FFFFFF" />
          <rect x="6.5" y="10.6" width="2.2" height="7.1" rx="0.4" fill="#FFFFFF" />
          <path
            d="M11 10.6h2.1v1c.5-.7 1.4-1.2 2.4-1.2 2 0 3 1.3 3 3.4v3.9h-2.2v-3.5c0-1-.4-1.7-1.4-1.7-.9 0-1.6.6-1.6 1.7v3.5H11v-7.1z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'web':
    default:
      return <Globe className={`${className} text-slate-600 shrink-0`} aria-hidden="true" />;
  }
};
