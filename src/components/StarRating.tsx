import React, { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingDisplayProps {
  rating: number;
  reviewCount?: number;
  size?: 'sm' | 'md';
}

export const StarRatingDisplay: React.FC<StarRatingDisplayProps> = ({
  rating,
  reviewCount,
  size = 'sm',
}) => {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const formatted = rating > 0 ? rating.toFixed(1) : '0.0';

  return (
    <div className="inline-flex items-center gap-1.5">
      <Star className={`${iconSize} fill-amber-500 text-amber-500 shrink-0`} />
      <span className="font-mono text-xs sm:text-sm font-semibold text-slate-900 tabular-nums">
        {formatted}
      </span>
      {typeof reviewCount === 'number' && (
        <span className="text-xs text-slate-500 tabular-nums">({reviewCount})</span>
      )}
    </div>
  );
};

interface StarRatingInputProps {
  value: 1 | 2 | 3 | 4 | 5;
  onChange: (value: 1 | 2 | 3 | 4 | 5) => void;
}

const RATING_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Zayıf',
  2: 'Orta Altı',
  3: 'İdare Eder',
  4: 'Çok İyi',
  5: 'Mükemmel',
};

export const StarRatingInput: React.FC<StarRatingInputProps> = ({ value, onChange }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? value;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Puan seçimi">
        {([1, 2, 3, 4, 5] as const).map((star) => {
          const filled = star <= active;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={value === star}
              aria-label={`${star} yıldız — ${RATING_LABELS[star]}`}
              onClick={() => onChange(star)}
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(null)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-amber-50 active:scale-95 transition-transform"
            >
              <Star
                className={`w-7 h-7 transition-colors ${
                  filled ? 'fill-amber-500 text-amber-500' : 'text-slate-300'
                }`}
              />
            </button>
          );
        })}
      </div>
      <span className="text-sm font-medium text-slate-700 tabular-nums">
        {value}/5 · {RATING_LABELS[value]}
      </span>
    </div>
  );
};
