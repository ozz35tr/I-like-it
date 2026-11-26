import React, { useEffect, useState } from 'react';
import {
  BadgeTurkishLira,
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Link2,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Pencil,
  Plus,
  Star,
  Trash2,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { formatFriendlyFirestoreError } from '../lib/firebase';
import {
  extractPromoLinkInput,
  extractSharedMapsInput,
  getPlaceExternalMapsUrl,
  getPromoPlatformLabel,
  resolveGoogleMapsLink,
} from '../lib/mapsLink';
import {
  addReview,
  deleteReview,
  isLocalDeviceRecord,
  removePlace,
  subscribeUserOrLocalPlaceReviews,
  updateMapsUrl,
  updatePlaceMetadata,
  updatePromoUrl,
  updateReview,
  type CloudActor,
} from '../lib/placeRepository';
import {
  CATEGORY_LABELS,
  PRODUCT_TYPE_PRESETS,
  STORAGE_LIMITS,
  type PlaceCategory,
  type PlaceItem,
  type ReviewItem,
} from '../types/place';
import { PhotoUploader } from './PhotoUploader';
import { PRICE_RATING_LABELS, PriceRatingDisplay, PriceRatingInput } from './PriceRating';
import { PromoPlatformIcon } from './PromoPlatformIcon';
import { StarRatingDisplay, StarRatingInput } from './StarRating';

interface PlaceDetailSheetProps {
  actor?: CloudActor | null;
  place: PlaceItem;
  isHiddenInWishlist?: boolean;
  isInUserWishlist?: boolean;
  onToggleHiddenWishlist?: (placeId: string, hide: boolean) => Promise<void> | void;
  onToggleUserWishlist?: (place: PlaceItem) => Promise<void> | void;
  onRequestSignIn?: () => void;
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
  actor,
  place,
  isHiddenInWishlist = false,
  isInUserWishlist = false,
  onToggleHiddenWishlist,
  onToggleUserWishlist,
  onRequestSignIn,
  onClose,
  onDeleted,
}) => {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [togglingUserWishlist, setTogglingUserWishlist] = useState(false);

  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [priceRating, setPriceRating] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [newReviewRatingTab, setNewReviewRatingTab] = useState<'venue' | 'price'>('venue');
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Per-user own review editing state
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editReviewRating, setEditReviewRating] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [editReviewPriceRating, setEditReviewPriceRating] = useState<1 | 2 | 3 | 4 | 5 | undefined>(undefined);
  const [editReviewRatingTab, setEditReviewRatingTab] = useState<'venue' | 'price'>('venue');
  const [editReviewComment, setEditReviewComment] = useState('');
  const [editReviewPhotos, setEditReviewPhotos] = useState<string[]>([]);
  const [savingReviewEdit, setSavingReviewEdit] = useState(false);

  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState(place.mapsUrl || '');
  const [linkError, setLinkError] = useState<string | null>(null);

  const [editingPromo, setEditingPromo] = useState(false);
  const [promoDraft, setPromoDraft] = useState(place.promoUrl || '');
  const [promoError, setPromoError] = useState<string | null>(null);
  const [savingPromo, setSavingPromo] = useState(false);
  const [copiedPromoLink, setCopiedPromoLink] = useState(false);

  // Multi-product & location metadata editing (available for updating existing records too)
  const [editingMeta, setEditingMeta] = useState(false);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(place.cuisineTypes || []);
  const [customCuisineInput, setCustomCuisineInput] = useState('');
  const [locationDraft, setLocationDraft] = useState(place.locationArea || '');
  const [categoryDraft, setCategoryDraft] = useState<PlaceCategory>(place.category);
  const [savingMeta, setSavingMeta] = useState(false);

  const isLocalPlace = isLocalDeviceRecord(place.ownerId);
  const canWritePlaceOrReview = Boolean(actor) || isLocalPlace;
  const canManagePlace = actor ? place.ownerId === actor.uid : isLocalPlace;
  const isWishlist = place.visitStatus === 'wishlist' && place.reviewCount === 0;
  const hasUserVisited = Boolean(
    actor && (place.ownerId === actor.uid || reviews.some((r) => r.ownerId === actor.uid))
  );

  useEffect(() => {
    setLinkDraft(place.mapsUrl || '');
  }, [place.mapsUrl]);

  useEffect(() => {
    setPromoDraft(place.promoUrl || '');
  }, [place.promoUrl]);

  useEffect(() => {
    setSelectedCuisines(place.cuisineTypes || []);
    setLocationDraft(place.locationArea || '');
    setCategoryDraft(place.category);
  }, [place.cuisineTypes, place.locationArea, place.category]);

  useEffect(() => {
    setLoadingReviews(true);
    const unsub = subscribeUserOrLocalPlaceReviews(
      actor,
      place.id,
      (items) => {
        setReviews(items);
        setLoadingReviews(false);
      },
      (err) => {
        setError(formatFriendlyFirestoreError(err, 'Yorumlar yüklenemedi.'));
        setLoadingReviews(false);
      }
    );
    return () => unsub();
  }, [actor, place.id]);

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
      await addReview(actor, {
        placeId: place.id,
        rating,
        priceRating,
        comment: trimmed,
        photos,
      });
      setComment('');
      setPhotos([]);
      setRating(5);
      setPriceRating(3);
      setNewReviewRatingTab('venue');
      setShowReviewForm(false);
    } catch (err) {
      setError(formatFriendlyFirestoreError(err, 'Yorum eklenemedi.'));
    } finally {
      setSubmitting(false);
    }
  };

  const startEditingReview = (rev: ReviewItem) => {
    setError(null);
    setEditingReviewId(rev.id);
    setEditReviewRating(rev.rating);
    setEditReviewPriceRating(rev.priceRating);
    setEditReviewRatingTab('venue');
    setEditReviewComment(rev.comment);
    setEditReviewPhotos(rev.photos || []);
  };

  const handleSaveReviewEdit = async (e: React.FormEvent, rev: ReviewItem) => {
    e.preventDefault();
    if (actor && rev.ownerId !== actor.uid) {
      setError('Yalnızca kendi yorumunuzu düzenleyebilirsiniz.');
      return;
    }
    const trimmed = editReviewComment.trim();
    if (trimmed.length < STORAGE_LIMITS.COMMENT_MIN) {
      setError('Lütfen en az 2 karakterlik bir yorum yazın.');
      return;
    }
    setSavingReviewEdit(true);
    setError(null);
    try {
      await updateReview(actor, {
        placeId: place.id,
        reviewId: rev.id,
        rating: editReviewRating,
        priceRating: editReviewPriceRating,
        comment: trimmed,
        photos: editReviewPhotos,
      });
      setEditingReviewId(null);
    } catch (err) {
      setError(formatFriendlyFirestoreError(err, 'Yorum güncellenemedi.'));
    } finally {
      setSavingReviewEdit(false);
    }
  };

  const handleSaveLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = linkDraft.trim();
    if (!trimmed) {
      await updateMapsUrl(actor, place.id, '', isWishlist);
      setEditingLink(false);
      setLinkError(null);
      return;
    }
    const { url } = extractSharedMapsInput(trimmed);
    if (!url) {
      setLinkError('Geçerli bir Google Haritalar bağlantısı girin.');
      return;
    }
    try {
      await updateMapsUrl(actor, place.id, url, isWishlist);
      const resolved = await resolveGoogleMapsLink(url);
      if (resolved) {
        const nextArea = place.locationArea || resolved.locationArea || undefined;
        const nextLat = place.lat ?? resolved.lat ?? null;
        const nextLng = place.lng ?? resolved.lng ?? null;
        if (nextArea || (nextLat !== null && nextLng !== null)) {
          await updatePlaceMetadata(
            actor,
            place.id,
            {
              locationArea: nextArea,
              lat: nextLat,
              lng: nextLng,
            },
            isWishlist
          );
        }
      }
      setEditingLink(false);
      setLinkError(null);
    } catch (err) {
      setLinkError(formatFriendlyFirestoreError(err, 'Bağlantı güncellenemedi.'));
    }
  };

  const handleSavePromoLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = promoDraft.trim();
    if (!trimmed) {
      setSavingPromo(true);
      try {
        await updatePromoUrl(actor, place.id, '', isWishlist);
        setEditingPromo(false);
        setPromoError(null);
      } catch (err) {
        setPromoError(formatFriendlyFirestoreError(err, 'Sosyal medya linki güncellenemedi.'));
      } finally {
        setSavingPromo(false);
      }
      return;
    }

    const { url } = extractPromoLinkInput(trimmed);
    if (!url) {
      setPromoError('Geçerli bir sosyal medya bağlantısı girin (Instagram, YouTube, Facebook veya web).');
      return;
    }

    setSavingPromo(true);
    setPromoError(null);
    try {
      await updatePromoUrl(actor, place.id, url, isWishlist);
      setPromoDraft(url);
      setEditingPromo(false);
    } catch (err) {
      setPromoError(formatFriendlyFirestoreError(err, 'Sosyal medya linki güncellenemedi.'));
    } finally {
      setSavingPromo(false);
    }
  };

  const toggleCuisineTag = (label: string) => {
    const clean = label.trim().slice(0, STORAGE_LIMITS.CUISINE_TYPE_MAX);
    if (!clean) return;
    const key = clean.toLocaleLowerCase('tr');

    setSelectedCuisines((prev) => {
      const exists = prev.some((item) => item.toLocaleLowerCase('tr') === key);
      if (exists) {
        return prev.filter((item) => item.toLocaleLowerCase('tr') !== key);
      }
      if (prev.length >= STORAGE_LIMITS.MAX_CUISINE_TYPES) {
        return prev;
      }
      return [...prev, clean];
    });
  };

  const handleAddCustomCuisine = () => {
    const parts = customCuisineInput
      .split(',')
      .map((s) => s.trim().slice(0, STORAGE_LIMITS.CUISINE_TYPE_MAX))
      .filter(Boolean);
    if (parts.length === 0) return;

    setSelectedCuisines((prev) => {
      const next = [...prev];
      for (const p of parts) {
        if (next.length >= STORAGE_LIMITS.MAX_CUISINE_TYPES) break;
        if (!next.some((item) => item.toLocaleLowerCase('tr') === p.toLocaleLowerCase('tr'))) {
          next.push(p);
        }
      }
      return next;
    });
    setCustomCuisineInput('');
  };

  const handleSaveMeta = async () => {
    setSavingMeta(true);
    setError(null);
    try {
      const pendingCustom = customCuisineInput
        .split(',')
        .map((s) => s.trim().slice(0, STORAGE_LIMITS.CUISINE_TYPE_MAX))
        .filter(Boolean);
      const nextCuisines = [...selectedCuisines];
      for (const p of pendingCustom) {
        if (nextCuisines.length >= STORAGE_LIMITS.MAX_CUISINE_TYPES) break;
        if (!nextCuisines.some((item) => item.toLocaleLowerCase('tr') === p.toLocaleLowerCase('tr'))) {
          nextCuisines.push(p);
        }
      }

      await updatePlaceMetadata(
        actor,
        place.id,
        {
          cuisineTypes: nextCuisines,
          cuisineType: nextCuisines.join(', '),
          locationArea: locationDraft.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX),
          category: categoryDraft,
        },
        isWishlist
      );
      setSelectedCuisines(nextCuisines);
      setCustomCuisineInput('');
      setEditingMeta(false);
    } catch (err) {
      setError(formatFriendlyFirestoreError(err, 'Ürün çeşidi ve bölge kaydedilemedi.'));
    } finally {
      setSavingMeta(false);
    }
  };

  const handleDeletePlace = async () => {
    await removePlace(actor, place.id, isWishlist);
    onDeleted();
  };

  const hasSavedMapsUrl = Boolean(place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl));
  const hasSavedPromoUrl = Boolean(place.promoUrl && /^https?:\/\//i.test(place.promoUrl));
  const promoPlatform = hasSavedPromoUrl && place.promoUrl ? getPromoPlatformLabel(place.promoUrl) : null;
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

  const handleCopyPromoUrl = async () => {
    if (!hasSavedPromoUrl || !place.promoUrl || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(place.promoUrl);
      setCopiedPromoLink(true);
      window.setTimeout(() => setCopiedPromoLink(false), 1800);
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
              <p className="text-xs text-slate-500 truncate">
                {CATEGORY_LABELS[place.category]}
                {place.locationArea ? ` · ${place.locationArea}` : ''}
                {place.cuisineType ? ` · ${place.cuisineType}` : ''}
                {' · '}Ekleyen: <span className="font-medium text-slate-700">{place.authorName}</span>
              </p>
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

            {isWishlist && (
              <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                    <Bookmark className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {isHiddenInWishlist
                        ? 'Gitmek İstiyorum Listesinde · Sizin için gizli'
                        : 'Gitmek İstiyorum Listesinde · Henüz puanlanmadı'}
                    </span>
                  </div>
                  {onToggleHiddenWishlist && (
                    <button
                      type="button"
                      onClick={() => void onToggleHiddenWishlist(place.id, !isHiddenInWishlist)}
                      className={`min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold shrink-0 transition-colors ${
                        isHiddenInWishlist
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-white border-amber-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {isHiddenInWishlist ? (
                        <>
                          <Eye className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Göster</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                          <span>Gizle</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                {place.latestComment && (
                  <p className="text-xs text-amber-950 leading-relaxed">{place.latestComment}</p>
                )}
                <button
                  type="button"
                  onClick={() => setShowReviewForm(true)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Gidildi Olarak İşaretle &amp; Puanla</span>
                </button>
              </div>
            )}

            <div className="space-y-3 pb-4 border-b border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {isWishlist ? (
                  <span className="text-xs font-medium text-slate-500">Henüz gidilmedi</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <StarRatingDisplay rating={place.avgRating} reviewCount={place.reviewCount} size="md" />
                    <PriceRatingDisplay
                      rating={place.avgPriceRating}
                      count={place.priceRatingCount}
                      size="md"
                    />
                  </div>
                )}
                {hasSavedMapsUrl ? (
                  <a
                    href={place.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors"
                  >
                    <MapPin className="w-4 h-4 shrink-0" />
                    <span>Haritada Aç</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
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

              {!isWishlist && !hasUserVisited && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50/60 border border-amber-200/80 px-3 py-2">
                  <span className="text-xs text-amber-950">
                    {isInUserWishlist
                      ? 'Bu mekan kişisel Gitmek İstiyorum listenizde.'
                      : 'Henüz gitmediniz mi? Kişisel listenize ekleyebilirsiniz.'}
                  </span>
                  {actor && onToggleUserWishlist ? (
                    <button
                      type="button"
                      disabled={togglingUserWishlist}
                      onClick={async () => {
                        setTogglingUserWishlist(true);
                        try {
                          await onToggleUserWishlist(place);
                        } finally {
                          setTogglingUserWishlist(false);
                        }
                      }}
                      className={`min-h-[36px] shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                        isInUserWishlist
                          ? 'bg-amber-100 border-amber-300 text-amber-950 hover:bg-amber-200/70'
                          : 'bg-white border-amber-300 text-amber-900 hover:bg-amber-100/70'
                      }`}
                    >
                      {togglingUserWishlist ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isInUserWishlist ? (
                        <BookmarkCheck className="w-3.5 h-3.5 text-amber-700" />
                      ) : (
                        <BookmarkPlus className="w-3.5 h-3.5 text-amber-700" />
                      )}
                      <span>{isInUserWishlist ? 'Gitmek İstiyorum Listemde' : 'Gitmek İstiyorum'}</span>
                    </button>
                  ) : (
                    onRequestSignIn && (
                      <button
                        type="button"
                        onClick={onRequestSignIn}
                        className="min-h-[36px] shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100/70"
                      >
                        <BookmarkPlus className="w-3.5 h-3.5 text-amber-700" />
                        <span>Gitmek İstiyorum için Giriş Yap</span>
                      </button>
                    )
                  )}
                </div>
              )}

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
                    {canManagePlace && (
                      <button
                        type="button"
                        onClick={() => setEditingLink(true)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/60"
                      >
                        Değiştir
                      </button>
                    )}
                  </div>
                </div>
              ) : editingLink && canManagePlace ? (
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
                  {canManagePlace && (
                    <button
                      type="button"
                      onClick={() => setEditingLink(true)}
                      className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>Link Ekle</span>
                    </button>
                  )}
                </div>
              )}

              {/* Sosyal Medya */}
              {hasSavedPromoUrl && !editingPromo ? (
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <a
                      href={place.promoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={promoPlatform ? `${promoPlatform} bağlantısını aç` : 'Web bağlantısını aç'}
                      aria-label={promoPlatform ? `${promoPlatform} bağlantısını aç` : 'Web bağlantısını aç'}
                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 shadow-xs shrink-0 transition-transform hover:scale-105"
                    >
                      <PromoPlatformIcon url={place.promoUrl} className="w-5 h-5" />
                    </a>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-slate-800">
                        {promoPlatform ? `Sosyal Medya · ${promoPlatform}` : 'Web Bağlantısı'}
                      </p>
                      <a
                        href={place.promoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] text-slate-600 hover:text-emerald-700 hover:underline truncate block"
                      >
                        {place.promoUrl}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyPromoUrl()}
                      aria-label="Sosyal medya linkini kopyala"
                      className="min-h-[34px] inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {copiedPromoLink ? (
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {canWritePlaceOrReview && (
                      <button
                        type="button"
                        onClick={() => setEditingPromo(true)}
                        className="min-h-[34px] px-2 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/60"
                      >
                        Değiştir
                      </button>
                    )}
                  </div>
                </div>
              ) : editingPromo && canWritePlaceOrReview ? (
                <form onSubmit={(e) => void handleSavePromoLink(e)} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="url"
                      maxLength={STORAGE_LIMITS.PROMO_URL_MAX}
                      value={promoDraft}
                      onChange={(e) => setPromoDraft(e.target.value)}
                      placeholder="https://... (Instagram, YouTube, Facebook veya web)"
                      className="flex-1 min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 text-base sm:text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <button
                      type="submit"
                      disabled={savingPromo}
                      className="min-h-[40px] px-3.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {savingPromo && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Kaydet</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPromo(false);
                        setPromoDraft(place.promoUrl || '');
                        setPromoError(null);
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-600"
                    >
                      İptal
                    </button>
                  </div>
                  {promoError && <p className="text-xs text-rose-600">{promoError}</p>}
                </form>
              ) : (
                <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-500 truncate">
                      Sosyal medya linki eklenmemiş
                    </span>
                  </div>
                  {canWritePlaceOrReview ? (
                    <button
                      type="button"
                      onClick={() => setEditingPromo(true)}
                      className="min-h-[34px] shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <Globe className="w-3.5 h-3.5 text-slate-500" />
                      <span>Sosyal Medya Ekle</span>
                    </button>
                  ) : (
                    onRequestSignIn && (
                      <button
                        type="button"
                        onClick={onRequestSignIn}
                        className="min-h-[34px] shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:text-emerald-700 hover:bg-emerald-50"
                      >
                        Eklemek için giriş yap
                      </button>
                    )
                  )}
                </div>
              )}

              {/* Ürün Çeşidi (Çoklu), Bölge ve Mekan Türü Güncelleme */}
              {!editingMeta ? (
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <UtensilsCrossed className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span className="text-xs text-slate-700 truncate">
                        Ürün çeşidi:{' '}
                        <span className="font-semibold text-slate-900">
                          {place.cuisineTypes.length > 0
                            ? place.cuisineTypes.join(', ')
                            : 'Belirtilmedi'}
                        </span>
                      </span>
                    </div>
                    {canWritePlaceOrReview ? (
                      <button
                        type="button"
                        onClick={() => setEditingMeta(true)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 shrink-0"
                      >
                        Güncelle
                      </button>
                    ) : (
                      onRequestSignIn && (
                        <button
                          type="button"
                          onClick={onRequestSignIn}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 shrink-0"
                        >
                          Düzenlemek için giriş yap
                        </button>
                      )
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <MapPin className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="truncate">
                      Bölge:{' '}
                      <span className="font-semibold text-slate-900">
                        {place.locationArea || 'Belirtilmedi'}
                      </span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-3">
                  <div className="space-y-1.5">
                    <span className="block text-xs font-semibold text-slate-700">Mekan Türü</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(CATEGORY_LABELS) as PlaceCategory[]).map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCategoryDraft(cat)}
                          className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                            categoryDraft === cat
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {CATEGORY_LABELS[cat]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="detail-location-area"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Bölge / Semt / İlçe
                    </label>
                    <input
                      id="detail-location-area"
                      type="text"
                      maxLength={STORAGE_LIMITS.LOCATION_AREA_MAX}
                      value={locationDraft}
                      onChange={(e) => setLocationDraft(e.target.value)}
                      placeholder="Örn: Buca, İzmir veya Kemeraltı"
                      className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-base sm:text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <span className="block text-xs font-semibold text-slate-700">
                      Ürün Çeşidi (Birden fazla seçilebilir · {selectedCuisines.length}/
                      {STORAGE_LIMITS.MAX_CUISINE_TYPES})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {PRODUCT_TYPE_PRESETS.map((preset) => {
                        const active = selectedCuisines.some(
                          (c) => c.toLocaleLowerCase('tr') === preset.toLocaleLowerCase('tr')
                        );
                        return (
                          <button
                            key={preset}
                            type="button"
                            disabled={savingMeta}
                            onClick={() => toggleCuisineTag(preset)}
                            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                              active
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {preset}
                          </button>
                        );
                      })}
                      {selectedCuisines
                        .filter(
                          (c) =>
                            !PRODUCT_TYPE_PRESETS.some(
                              (preset) => preset.toLocaleLowerCase('tr') === c.toLocaleLowerCase('tr')
                            )
                        )
                        .map((custom) => (
                          <button
                            key={custom}
                            type="button"
                            onClick={() => toggleCuisineTag(custom)}
                            className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-700 text-white border border-emerald-700 whitespace-nowrap"
                          >
                            <span>{custom}</span>
                            <X className="w-3 h-3" />
                          </button>
                        ))}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={STORAGE_LIMITS.CUISINE_TYPE_MAX}
                        value={customCuisineInput}
                        onChange={(e) => setCustomCuisineInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomCuisine();
                          }
                        }}
                        placeholder="Özel ürün ekle..."
                        className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-base sm:text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomCuisine}
                        disabled={
                          !customCuisineInput.trim() ||
                          selectedCuisines.length >= STORAGE_LIMITS.MAX_CUISINE_TYPES
                        }
                        className="min-h-[40px] inline-flex items-center gap-1 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Ekle</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMeta(false);
                        setSelectedCuisines(place.cuisineTypes || []);
                        setLocationDraft(place.locationArea || '');
                        setCategoryDraft(place.category);
                        setCustomCuisineInput('');
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600"
                    >
                      İptal
                    </button>
                    <button
                      type="button"
                      disabled={savingMeta}
                      onClick={() => void handleSaveMeta()}
                      className="min-h-[40px] px-4 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {savingMeta && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Değişiklikleri Kaydet</span>
                    </button>
                  </div>
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
                !canWritePlaceOrReview ? (
                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3 text-center">
                    <p className="text-xs text-slate-700 leading-relaxed">
                      Ortak listedeki bu mekana yorum veya puan eklemek için Google hesabınızla giriş yapın.
                    </p>
                    {onRequestSignIn && (
                      <button
                        type="button"
                        onClick={onRequestSignIn}
                        className="min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors"
                      >
                        <Users className="w-4 h-4" />
                        <span>Google ile Giriş Yap</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => void handleSubmitReview(e)}
                    className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3.5"
                  >
                    <div className="space-y-2">
                      <div
                        role="tablist"
                        aria-label="Yorum puanlama türü"
                        className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/70 rounded-xl"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={newReviewRatingTab === 'venue'}
                          onClick={() => setNewReviewRatingTab('venue')}
                          className={`min-h-[36px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                            newReviewRatingTab === 'venue'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                          <span>Lokanta Puanı · {rating}/5</span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={newReviewRatingTab === 'price'}
                          onClick={() => setNewReviewRatingTab('price')}
                          className={`min-h-[36px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                            newReviewRatingTab === 'price'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <BadgeTurkishLira className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          <span>Fiyat Puanı · {priceRating}/5</span>
                        </button>
                      </div>
                      {newReviewRatingTab === 'venue' ? (
                        <StarRatingInput value={rating} onChange={setRating} />
                      ) : (
                        <PriceRatingInput value={priceRating} onChange={setPriceRating} />
                      )}
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
                      <p role="alert" className="text-xs text-rose-600 font-medium break-words">
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
                )
              )}

              {!showReviewForm && error && (
                <p role="alert" className="text-xs text-rose-600 font-medium break-words">
                  {error}
                </p>
              )}

              {loadingReviews ? (
                <div className="py-6 flex justify-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : reviews.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">Henüz yorum yok.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {reviews.map((rev) => {
                    const isOwnReview = actor
                      ? rev.ownerId === actor.uid
                      : isLocalDeviceRecord(rev.ownerId);
                    const isEditingThis = editingReviewId === rev.id;

                    if (isEditingThis && isOwnReview) {
                      return (
                        <form
                          key={rev.id}
                          onSubmit={(e) => void handleSaveReviewEdit(e, rev)}
                          className="py-3 first:pt-0 space-y-3"
                        >
                          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-800">
                                Yorumunuzu Düzenleyin
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingReviewId(null)}
                                className="text-xs font-medium text-slate-500 hover:text-slate-800"
                              >
                                Vazgeç
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div
                                role="tablist"
                                aria-label="Düzenlenen yorum puanlama türü"
                                className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/70 rounded-xl"
                              >
                                <button
                                  type="button"
                                  role="tab"
                                  aria-selected={editReviewRatingTab === 'venue'}
                                  onClick={() => setEditReviewRatingTab('venue')}
                                  className={`min-h-[36px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                    editReviewRatingTab === 'venue'
                                      ? 'bg-white text-slate-900 shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                                  <span>Lokanta · {editReviewRating}/5</span>
                                </button>
                                <button
                                  type="button"
                                  role="tab"
                                  aria-selected={editReviewRatingTab === 'price'}
                                  onClick={() => setEditReviewRatingTab('price')}
                                  className={`min-h-[36px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                    editReviewRatingTab === 'price'
                                      ? 'bg-white text-slate-900 shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  <BadgeTurkishLira className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                  <span>
                                    Fiyat {editReviewPriceRating ? `· ${editReviewPriceRating}/5` : ''}
                                  </span>
                                </button>
                              </div>
                              {editReviewRatingTab === 'venue' ? (
                                <StarRatingInput value={editReviewRating} onChange={setEditReviewRating} />
                              ) : (
                                <PriceRatingInput
                                  value={editReviewPriceRating}
                                  onChange={setEditReviewPriceRating}
                                />
                              )}
                            </div>
                            <textarea
                              required
                              rows={3}
                              maxLength={STORAGE_LIMITS.COMMENT_MAX}
                              value={editReviewComment}
                              onChange={(e) => setEditReviewComment(e.target.value)}
                              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                            />
                            <PhotoUploader photos={editReviewPhotos} onChange={setEditReviewPhotos} />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingReviewId(null)}
                                className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600"
                              >
                                İptal
                              </button>
                              <button
                                type="submit"
                                disabled={savingReviewEdit}
                                className="min-h-[40px] px-4 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-1.5"
                              >
                                {savingReviewEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>Güncelle</span>
                              </button>
                            </div>
                          </div>
                        </form>
                      );
                    }

                    return (
                      <div key={rev.id} className="py-3 first:pt-0 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                              {rev.rating}.0
                            </span>
                            {rev.priceRating && (
                              <>
                                <span className="text-xs text-slate-400">·</span>
                                <span
                                  title={`Fiyat Puanı: ${PRICE_RATING_LABELS[rev.priceRating]}`}
                                  className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-emerald-800 tabular-nums"
                                >
                                  <BadgeTurkishLira className="w-3.5 h-3.5 text-emerald-700" />
                                  {rev.priceRating}.0
                                </span>
                              </>
                            )}
                            <span className="text-xs text-slate-400">·</span>
                            <span className="text-xs font-semibold text-slate-800 truncate">
                              {rev.authorName}
                              {actor && rev.ownerId === actor.uid ? ' (Siz)' : ''}
                            </span>
                            <span className="text-xs text-slate-400">·</span>
                            <span className="text-xs text-slate-500">{formatDate(rev.createdAt)}</span>
                          </div>

                          {isOwnReview && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                aria-label="Yorumu düzenle"
                                onClick={() => startEditingReview(rev)}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-emerald-50"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Yorumu sil"
                                onClick={() => void deleteReview(actor, place.id, rev.id)}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
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
                    );
                  })}
                </div>
              )}
            </div>

            {canManagePlace && (
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
            )}
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
