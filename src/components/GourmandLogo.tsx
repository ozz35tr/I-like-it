import React from 'react';

interface GourmandLogoProps {
  className?: string;
}

export const GourmandLogo: React.FC<GourmandLogoProps> = ({ className = 'w-8 h-8' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <mask id="gourmand-header-bite">
        <rect width="64" height="64" fill="#ffffff" />
        <circle cx="47.5" cy="19.5" r="7" fill="#000000" />
        <circle cx="51.5" cy="26.5" r="5.75" fill="#000000" />
        <circle cx="41.5" cy="15.75" r="4.5" fill="#000000" />
      </mask>
    </defs>
    <rect width="64" height="64" rx="15" fill="#047857" />
    <g mask="url(#gourmand-header-bite)">
      <path
        d="M14.5 29c0-9.25 7.75-15.25 17.5-15.25S49.5 19.75 49.5 29c0 1.5-1.1 2.5-2.75 2.5H17.25c-1.65 0-2.75-1-2.75-2.5z"
        fill="#F59E0B"
      />
      <ellipse cx="24.5" cy="20.75" rx="1.4" ry="0.8" transform="rotate(-22 24.5 20.75)" fill="#FEF3C7" />
      <ellipse cx="31.75" cy="18.25" rx="1.4" ry="0.8" transform="rotate(10 31.75 18.25)" fill="#FEF3C7" />
      <ellipse cx="20.25" cy="24.75" rx="1.3" ry="0.75" transform="rotate(-12 20.25 24.75)" fill="#FEF3C7" />
      <ellipse cx="30.25" cy="24.5" rx="1.4" ry="0.8" transform="rotate(-8 30.25 24.5)" fill="#FEF3C7" />
      <path
        d="M13 33c2-1.75 4.25-1.75 6.25 0s4.25 1.75 6.25 0 4.25-1.75 6.25 0 4.25 1.75 6.25 0 4.25-1.75 6.25 0 4.25 1.75 6.75 0c1.25-1 2.75 0 2.25 1.5s-2.25 2-3.75 1.75c-1.75-.25-3.5-1.5-5.25-.5s-3.5 1-5.25 0-3.5-1-5.25 0-3.5 1-5.25 0-3.5-1-5.25 0-3.5.25-4.5-1c-.75-.9-.5-1.25.5-2z"
        fill="#4ADE80"
      />
      <path
        d="M15.25 35.5h33.5c1 0 1.75.75 1.75 1.75v1c0 1-.75 1.75-1.75 1.75H41l-3.5 3.25L34.25 40h-19c-1 0-1.75-.75-1.75-1.75v-1c0-1 .75-1.75 1.75-1.75z"
        fill="#FACC15"
      />
      <rect x="14" y="39.5" width="36" height="5.5" rx="2.75" fill="#5C2D16" />
      <path
        d="M15.5 46h33c1 0 1.75.75 1.75 1.75v.75c0 3-2.75 5-6.25 5H20c-3.5 0-6.25-2-6.25-5v-.75c0-1 .75-1.75 1.75-1.75z"
        fill="#D97706"
      />
    </g>
    <circle cx="49.25" cy="14" r="1.15" fill="#FBBF24" />
    <circle cx="53.5" cy="19.25" r="0.9" fill="#FEF3C7" />
    <circle cx="52.25" cy="31.5" r="0.8" fill="#4ADE80" />
  </svg>
);
