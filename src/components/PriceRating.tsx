import React, { useState } from 'react';
import { BadgeTurkishLira, Banknote } from 'lucide-react';

interface PriceRatingDisplayProps {
  rating?: number;
  count?: number;
  size?: 'sm' | 'md';
}

export const PriceRatingDisplay: React.FC<PriceRatingDisplayProps> = ({
  rating = 0,
  count,
  size = 'sm',
}) => {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  if (!rating || rating <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap">
        <BadgeTurkishLira className={`${iconSize} shrink-0`} />
        <span>Fiyat yok</span>
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <BadgeTurkishLira className={`${iconSize} text-emerald-700 shrink-0`} />
      <span className="font-mono text-xs sm:text-sm font-semibold text-slate-900 tabular-nums">
        {rating.toFixed(1)}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-xs text-slate-500 tabular-nums">({count})</span>
      )}
    </div>
  );
};

interface PriceRatingInputProps {
  value?: 1 | 2 | 3 | 4 | 5;
  onChange: (value: 1 | 2 | 3 | 4 | 5) => void;
}

export const PRICE_RATING_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Çok Pahalı',
  2: 'Pahalı',
  3: 'Makul',
  4: 'Uygun',
  5: 'Çok Uygun',
};

export const PriceRatingInput: React.FC<PriceRatingInputProps> = ({ value, onChange }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? value ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Fiyat puanı seçimi">
        {([1, 2, 3, 4, 5] as const).map((score) => {
          const filled = score <= active;
          return (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={value === score}
              aria-label={`Fiyat ${score}/5 — ${PRICE_RATING_LABELS[score]}`}
              onClick={() => onChange(score)}
              onMouseEnter={() => setHovered(score)}
              onMouseLeave={() => setHovered(null)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-emerald-50 active:scale-95 transition-transform"
            >
              <Banknote
                className={`w-7 h-7 transition-colors ${
                  filled ? 'fill-emerald-200 text-emerald-700' : 'text-slate-300'
                }`}
              />
            </button>
          );
        })}
      </div>
      <span className="text-sm font-medium text-slate-700 tabular-nums">
        {value ? `${value}/5 · ${PRICE_RATING_LABELS[value]}` : 'Seçilmedi (1-5)'}
      </span>
    </div>
  );
};
