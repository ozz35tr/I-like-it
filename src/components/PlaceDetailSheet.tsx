import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquarePlus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { extractSharedMapsInput, getPlaceExternalMapsUrl } from '../lib/mapsLink';
import {
  addReview,
  deleteReview,
  removePlace,
  subscribeUserOrLocalPlaceReviews,
  updateMapsUrl,
} from '../lib/placeRepository';
import {
  CATEGORY_LABELS,
  STORAGE_LIMITS,
  type PlaceItem,
  type ReviewItem,
} from '../types/place';
import { PhotoUploader } from './PhotoUploader';
import { StarRatingDisplay, StarRatingInput } from './StarRating';

interface PlaceDetailSheetProps {
  userId?: string | null;
  place: PlaceItem;
  onClose: () => void;
  onDeleted: () => void;
}

function formatDate(ts: number): string {
  if (!ts) return 'Az önce';
  return new Date(ts).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const PlaceDetailSheet: React.FC<PlaceDetailSheetProps> = ({
  userId,
  place,
  onClose,
  onDeleted,
}) => {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [showReviewForm, setShowReviewForm] = useState(false);

  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState(place.mapsUrl || '');
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    setLinkDraft(place.mapsUrl || '');
  }, [place.mapsUrl]);

  useEffect(() => {
    setLoadingReviews(true);
    const unsub = subscribeUserOrLocalPlaceReviews(
      userId,
      place.id,
      (items) => {
        setReviews(items);
        setLoadingReviews(false);
      },
      (err) => {
        setError(err.message);
        setLoadingReviews(false);
      }
    );
    return () => unsub();
  }, [userId, place.id]);

  const allPhotos = [
    ...(place.coverImage ? [place.coverImage] : []),
    ...reviews.flatMap((r) => r.photos || []),
  ].filter((src, idx, arr) => arr.indexOf(src) === idx);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = comment.trim();
    if (trimmed.length < STORAGE_LIMITS.COMMENT_MIN) {
      setError('Lütfen en az 2 karakterlik bir yorum yazın.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await addReview(userId, {
        placeId: place.id,
        rating,
        comment: trimmed,
        photos,
      });
      setComment('');
      setPhotos([]);
      setRating(5);
      setShowReviewForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yorum eklenemedi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = linkDraft.trim();
    if (!trimmed) {
      await updateMapsUrl(userId, place.id, '');
      setEditingLink(false);
      setLinkError(null);
      return;
    }
    const { url } = extractSharedMapsInput(trimmed);
    if (!url) {
      setLinkError('Geçerli bir Google Haritalar bağlantısı girin.');
      return;
    }
    await updateMapsUrl(userId, place.id, url);
    setEditingLink(false);
    setLinkError(null);
  };

  const handleDeletePlace = async () => {
    await removePlace(userId, place.id);
    onDeleted();
  };

  const hasSavedMapsUrl = Boolean(place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl));
  const fallbackSearchUrl = getPlaceExternalMapsUrl(place);

  const handleCopyMapsUrl = async () => {
    if (!hasSavedMapsUrl || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(place.mapsUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end lg:items-stretch lg:justify-end bg-slate-900/50 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-place-title"
      >
        <div className="w-full lg:max-w-lg max-h-[92dvh] lg:max-h-full bg-white rounded-t-3xl lg:rounded-none lg:border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden">
          <div className="lg:hidden pt-3 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1.5 rounded-full bg-slate-300" />
          </div>

          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">{CATEGORY_LABELS[place.category]}</p>
              <h2 id="detail-place-title" className="text-lg font-semibold text-slate-900 truncate">
                {place.name}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Kapat"
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {allPhotos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {allPhotos.slice(0, 6).map((src, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setLightboxImage(src)}
                    className="aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                  >
                    <img
                      src={src}
                      alt={`${place.name} fotoğraf ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-3 pb-4 border-b border-slate-200">
              <div className="flex items-center justify-between gap-3">
                <StarRatingDisplay rating={place.avgRating} reviewCount={place.reviewCount} size="md" />
                {hasSavedMapsUrl ? (
                  <a
                    href={place.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors"
                  >
                    <span>Haritada Aç</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <a
                    href={fallbackSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-semibold hover:bg-slate-100 transition-colors"
                  >
                    <span>Google&apos;da Ara</span>
                    <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
                  </a>
                )}
              </div>

              {hasSavedMapsUrl && !editingLink ? (
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="font-mono text-xs text-slate-600 truncate">
                      {place.mapsUrl}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyMapsUrl()}
                      aria-label="Linki kopyala"
                      className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Kopyalandı</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Kopyala</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingLink(true)}
                      className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/60"
                    >
                      Değiştir
                    </button>
                  </div>
                </div>
              ) : editingLink ? (
                <form onSubmit={(e) => void handleSaveLink(e)} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={linkDraft}
                      onChange={(e) => setLinkDraft(e.target.value)}
                      placeholder="https://maps.app.goo.gl/..."
                      className="flex-1 min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 text-base sm:text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-3.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800"
                    >
                      Kaydet
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingLink(false);
                        setLinkError(null);
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-600"
                    >
                      İptal
                    </button>
                  </div>
                  {linkError && <p className="text-xs text-rose-600">{linkError}</p>}
                </form>
              ) : (
                <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">Lokasyon linki eklenmemiş</span>
                  <button
                    type="button"
                    onClick={() => setEditingLink(true)}
                    className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Link Ekle</span>
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Yorumlar ({place.reviewCount})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowReviewForm((prev) => !prev)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  <span>{showReviewForm ? 'Gizle' : 'Yorum / Foto Ekle'}</span>
                </button>
              </div>

              {showReviewForm && (
                <form
                  onSubmit={(e) => void handleSubmitReview(e)}
                  className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3.5"
                >
                  <div>
                    <span className="block text-xs font-semibold text-slate-700 mb-1">
                      Puanınız
                    </span>
                    <StarRatingInput value={rating} onChange={setRating} />
                  </div>

                  <div>
                    <label htmlFor="new-review-comment" className="block text-xs font-semibold text-slate-700 mb-1">
                      Yorumunuz
                    </label>
                    <textarea
                      id="new-review-comment"
                      required
                      rows={3}
                      maxLength={STORAGE_LIMITS.COMMENT_MAX}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Notunuzu yazın..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>

                  <PhotoUploader photos={photos} onChange={setPhotos} />

                  {error && (
                    <p role="alert" className="text-xs text-rose-600 font-medium">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full min-h-[44px] rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>{submitting ? 'Kaydediliyor...' : 'Yorumu Kaydet'}</span>
                  </button>
                </form>
              )}

              {loadingReviews ? (
                <div className="py-6 flex justify-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : reviews.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">Henüz yorum yok.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {reviews.map((rev) => (
                    <div key={rev.id} className="py-3 first:pt-0 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                            <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                            {rev.rating}.0
                          </span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500">{formatDate(rev.createdAt)}</span>
                        </div>

                        <button
                          type="button"
                          aria-label="Yorumu sil"
                          onClick={() => void deleteReview(userId, place.id, rev.id)}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                        {rev.comment}
                      </p>

                      {rev.photos && rev.photos.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 pt-1">
                          {rev.photos.map((photo, pIdx) => (
                            <button
                              key={pIdx}
                              type="button"
                              onClick={() => setLightboxImage(photo)}
                              className="aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-100"
                            >
                              <img
                                src={photo}
                                alt={`Yorum fotoğrafı ${pIdx + 1}`}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 pb-safe border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => void handleDeletePlace()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Mekanı Listeden Sil</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            aria-label="Görseli kapat"
            className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 min-h-[44px] min-w-[44px] rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxImage}
            alt="Büyütülmüş mekan fotoğrafı"
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[88dvh] rounded-xl object-contain"
          />
        </div>
      )}
    </>
  );
};
