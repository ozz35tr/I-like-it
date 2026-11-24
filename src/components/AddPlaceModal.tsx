import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  Link2,
  Loader2,
  X,
} from 'lucide-react';
import { extractSharedMapsInput, resolveGoogleMapsLink } from '../lib/mapsLink';
import { createPlace, type CloudActor } from '../lib/placeRepository';
import {
  CATEGORY_LABELS,
  STORAGE_LIMITS,
  type PlaceCategory,
} from '../types/place';
import { PhotoUploader } from './PhotoUploader';
import { StarRatingInput } from './StarRating';

interface AddPlaceModalProps {
  actor?: CloudActor | null;
  onClose: () => void;
  onCreated: (placeId: string) => void;
}

export const AddPlaceModal: React.FC<AddPlaceModalProps> = ({
  actor,
  onClose,
  onCreated,
}) => {
  const [mapsInput, setMapsInput] = useState('');
  const [cleanMapsUrl, setCleanMapsUrl] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);
  const [linkStatus, setLinkStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');

  const [name, setName] = useState('');
  const [category, setCategory] = useState<PlaceCategory>('restaurant');
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = mapsInput.trim();
    if (!trimmed) {
      setCleanMapsUrl('');
      setLinkStatus('idle');
      setResolvingLink(false);
      return;
    }

    const { url, sharedLabel } = extractSharedMapsInput(trimmed);
    if (!url) {
      setCleanMapsUrl('');
      setLinkStatus('invalid');
      setResolvingLink(false);
      return;
    }

    setCleanMapsUrl(url);
    setLinkStatus('valid');
    if (sharedLabel && !name.trim()) {
      setName(sharedLabel.slice(0, STORAGE_LIMITS.NAME_MAX));
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setResolvingLink(true);
      try {
        const resolved = await resolveGoogleMapsLink(trimmed, controller.signal);
        if (resolved && !controller.signal.aborted && resolved.name && !name.trim()) {
          setName(resolved.name.slice(0, STORAGE_LIMITS.NAME_MAX));
        }
      } finally {
        if (!controller.signal.aborted) {
          setResolvingLink(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [mapsInput]);

  const handlePasteFromClipboard = async () => {
    setError(null);
    if (!navigator.clipboard?.readText) {
      setError('Tarayıcınız tek dokunuşla yapıştırmayı desteklemiyor; kutuya basılı tutup yapıştırabilirsiniz.');
      return;
    }
    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText.trim()) {
        setError('Panoda kopyalanmış bir metin veya link bulunamadı.');
        return;
      }
      setMapsInput(clipText.trim());
    } catch {
      setError('Pano izni verilemedi; linki doğrudan kutuya yapıştırabilirsiniz.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedComment = comment.trim();
    const trimmedMapsInput = mapsInput.trim();
    const extracted = trimmedMapsInput ? extractSharedMapsInput(trimmedMapsInput) : { url: null };
    const finalUrl = cleanMapsUrl || extracted.url || '';

    if (trimmedName.length < STORAGE_LIMITS.NAME_MIN) {
      setError('Lütfen mekan adını en az 2 karakter olarak girin.');
      return;
    }
    if (trimmedMapsInput && !finalUrl) {
      setError(
        'Girilen bağlantı geçerli bir Google Haritalar linki değil. İsterseniz link alanını boş bırakarak da kaydedebilirsiniz.'
      );
      return;
    }
    if (trimmedComment.length < STORAGE_LIMITS.COMMENT_MIN) {
      setError('Lütfen mekan hakkında kısa bir yorum yazın.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const placeId = await createPlace(actor, {
        name: trimmedName,
        category,
        mapsUrl: finalUrl,
        initialRating: rating,
        initialComment: trimmedComment,
        photos,
      });
      onCreated(placeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mekan kaydedilemedi.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-place-title"
    >
      <div className="w-full sm:max-w-lg max-h-[92dvh] bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        <div className="sm:hidden pt-3 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-slate-300" />
        </div>

        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 id="add-place-title" className="text-lg font-semibold text-slate-900">
            Yeni Mekan Ekle
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 1. Restoran / Mekan Adı & Tür */}
          <div className="space-y-3">
            <div>
              <label htmlFor="place-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Restoran / Mekan Adı *
              </label>
              <input
                id="place-name"
                type="text"
                required
                maxLength={STORAGE_LIMITS.NAME_MAX}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn: Köşe Kahve"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-xl">
              {(Object.keys(CATEGORY_LABELS) as PlaceCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`min-h-[38px] px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    category === cat
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Optional Google Maps Share Link */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="maps-share-link" className="text-xs font-semibold text-slate-700">
                Lokasyon Linki <span className="font-normal text-slate-500">(İsteğe Bağlı)</span>
              </label>
              <a
                href="https://www.google.com/maps"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[32px] shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                <span>Haritayı Aç</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              İsterseniz Google Haritalar&apos;dan <span className="font-medium text-slate-700">Paylaş → Bağlantıyı Kopyala</span> yapıp yapıştırabilirsiniz; link olmadan da kaydedebilirsiniz.
            </p>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="maps-share-link"
                  type="text"
                  value={mapsInput}
                  onChange={(e) => setMapsInput(e.target.value)}
                  placeholder="https://maps.app.goo.gl/... (boş bırakılabilir)"
                  className="w-full min-h-[44px] pl-9 pr-8 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
                {resolvingLink && (
                  <Loader2 className="w-4 h-4 text-emerald-700 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                )}
                {!resolvingLink && linkStatus === 'valid' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>
              <button
                type="button"
                onClick={() => void handlePasteFromClipboard()}
                className="min-h-[44px] shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ClipboardPaste className="w-4 h-4 text-emerald-700" />
                <span>Yapıştır</span>
              </button>
            </div>

            {linkStatus === 'invalid' && (
              <p className="text-[11px] font-medium text-rose-600">
                Geçerli bir Google Haritalar linki gibi görünmüyor; isterseniz alanı temizleyip linksiz kaydedebilirsiniz.
              </p>
            )}
          </div>

          {/* 3. Puan */}
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1">Puan *</span>
            <StarRatingInput value={rating} onChange={setRating} />
          </div>

          {/* 4. Yorum */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="place-comment" className="text-xs font-semibold text-slate-700">
                Yorum *
              </label>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {comment.length}/{STORAGE_LIMITS.COMMENT_MAX}
              </span>
            </div>
            <textarea
              id="place-comment"
              required
              rows={3}
              maxLength={STORAGE_LIMITS.COMMENT_MAX}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Yemekler, kahve veya ortam nasıldı?"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-y"
            />
          </div>

          {/* 5. Fotoğraf (İsteğe Bağlı) */}
          <PhotoUploader photos={photos} onChange={setPhotos} />

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-700"
            >
              {error}
            </div>
          )}

          <div className="pt-2 pb-safe flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[46px] px-5 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 min-h-[46px] rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{submitting ? 'Kaydediliyor...' : 'Listeye Ekle'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
