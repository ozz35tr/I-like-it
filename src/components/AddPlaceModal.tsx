import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeTurkishLira,
  BookmarkCheck,
  BookmarkPlus,
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  EyeOff,
  Globe,
  Link2,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Plus,
  Star,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { findPotentialDuplicatePlaces } from '../lib/duplicatePlaceCheck';
import { formatFriendlyFirestoreError } from '../lib/firebase';
import {
  extractPromoLinkInput,
  extractSharedMapsInput,
  resolveGoogleMapsLink,
} from '../lib/mapsLink';
import { resolveSocialLink } from '../lib/socialLinkResolver';
import { createPlace, type CloudActor } from '../lib/placeRepository';
import {
  CATEGORY_LABELS,
  PRODUCT_TYPE_PRESETS,
  STORAGE_LIMITS,
  type PlaceCategory,
  type PlaceItem,
  type VisitStatus,
} from '../types/place';
import { PhotoUploader } from './PhotoUploader';
import { PriceRatingInput } from './PriceRating';
import { PromoPlatformIcon } from './PromoPlatformIcon';
import { StarRatingInput } from './StarRating';

export interface SelectExistingPlaceOptions {
  openReviewForm?: boolean;
  rating?: 1 | 2 | 3 | 4 | 5;
  priceRating?: 1 | 2 | 3 | 4 | 5;
  comment?: string;
}

interface AddPlaceModalProps {
  actor?: CloudActor | null;
  defaultVisitStatus?: VisitStatus;
  knownRegions?: string[];
  existingPlaces?: PlaceItem[];
  myWishlistPlaceIds?: Set<string>;
  myReviewedPlaceIds?: Set<string>;
  onSelectExistingPlace?: (place: PlaceItem, options?: SelectExistingPlaceOptions) => void;
  onAddExistingToWishlist?: (place: PlaceItem) => Promise<void> | void;
  onRequestSignIn?: () => void;
  onClose: () => void;
  onCreated: (placeId: string, visitStatus: VisitStatus, hideInWishlist?: boolean) => void;
}

export const AddPlaceModal: React.FC<AddPlaceModalProps> = ({
  actor,
  defaultVisitStatus = 'visited',
  knownRegions = [],
  existingPlaces = [],
  myWishlistPlaceIds,
  myReviewedPlaceIds,
  onSelectExistingPlace,
  onAddExistingToWishlist,
  onRequestSignIn,
  onClose,
  onCreated,
}) => {
  const [visitStatus, setVisitStatus] = useState<VisitStatus>(
    actor ? defaultVisitStatus : 'visited'
  );
  const [hideInWishlist, setHideInWishlist] = useState(false);

  const effectiveVisitStatus: VisitStatus = actor ? visitStatus : 'visited';

  const [mapsInput, setMapsInput] = useState('');
  const [cleanMapsUrl, setCleanMapsUrl] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);
  const [linkStatus, setLinkStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const mapsInputRef = useRef<HTMLInputElement | null>(null);

  const [promoInput, setPromoInput] = useState('');
  const [promoPasteHint, setPromoPasteHint] = useState<string | null>(null);
  const [resolvingSocial, setResolvingSocial] = useState(false);
  const [socialAutoFillInfo, setSocialAutoFillInfo] = useState<{
    filledLabels: string[];
    noteSnippet: string;
  } | null>(null);
  const promoInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<PlaceCategory>('restaurant');
  const categoryTouchedRef = useRef(false);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [customCuisineInput, setCustomCuisineInput] = useState('');
  const [locationArea, setLocationArea] = useState('');
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({
    lat: null,
    lng: null,
  });

  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [priceRating, setPriceRating] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [ratingTab, setRatingTab] = useState<'venue' | 'price'>('venue');
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingWishlistPlaceId, setAddingWishlistPlaceId] = useState<string | null>(null);
  const duplicateAlertRef = useRef<HTMLDivElement | null>(null);

  const trimmedPromoInput = promoInput.trim();
  const parsedPromo = trimmedPromoInput
    ? extractPromoLinkInput(trimmedPromoInput)
    : { url: null, platform: null, kind: null };
  const promoLinkStatus: 'idle' | 'valid' | 'invalid' = !trimmedPromoInput
    ? 'idle'
    : parsedPromo.url
      ? 'valid'
      : 'invalid';

  const duplicateCandidates = useMemo(
    () =>
      findPotentialDuplicatePlaces(existingPlaces, {
        name,
        locationArea,
        mapsUrl: cleanMapsUrl,
        promoUrl: parsedPromo.url || '',
        lat: coords.lat,
        lng: coords.lng,
      }),
    [existingPlaces, name, locationArea, cleanMapsUrl, parsedPromo.url, coords.lat, coords.lng]
  );

  const hasStrongOrExactMatch = duplicateCandidates.some(
    (c) => c.strength === 'exact' || c.strength === 'strong'
  );

  useEffect(() => {
    const trimmed = mapsInput.trim();
    if (!trimmed) {
      setCleanMapsUrl('');
      setLinkStatus('idle');
      setResolvingLink(false);
      setCoords({ lat: null, lng: null });
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
    setPasteHint(null);
    if (sharedLabel && !name.trim()) {
      setName(sharedLabel.slice(0, STORAGE_LIMITS.NAME_MAX));
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setResolvingLink(true);
      try {
        const resolved = await resolveGoogleMapsLink(trimmed, controller.signal);
        if (resolved && !controller.signal.aborted) {
          if (resolved.name) {
            setName((prev) => (prev.trim() ? prev : resolved.name.slice(0, STORAGE_LIMITS.NAME_MAX)));
          }
          if (resolved.locationArea) {
            setLocationArea((prev) =>
              prev.trim() ? prev : resolved.locationArea.slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX)
            );
          }
          if (typeof resolved.lat === 'number' && typeof resolved.lng === 'number') {
            setCoords({ lat: resolved.lat, lng: resolved.lng });
          }
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
    setPasteHint(null);

    if (navigator.clipboard?.readText) {
      try {
        const clipText = await navigator.clipboard.readText();
        if (clipText.trim()) {
          setMapsInput(clipText.trim());
          return;
        }
        setPasteHint('Panoda kopyalanmış metin yok. Bağlantıyı doğrudan kutuya yapıştırabilirsiniz.');
      } catch {
        setPasteHint('Doğrudan kutunun içine uzun basıp Yapıştır (veya Ctrl+V) yapabilirsiniz.');
      }
    } else {
      setPasteHint('Doğrudan kutunun içine uzun basıp Yapıştır (veya Ctrl+V) yapabilirsiniz.');
    }

    mapsInputRef.current?.focus();
    mapsInputRef.current?.select();
  };

  const handlePastePromoFromClipboard = async () => {
    setError(null);
    setPromoPasteHint(null);

    if (navigator.clipboard?.readText) {
      try {
        const clipText = await navigator.clipboard.readText();
        if (clipText.trim()) {
          setPromoInput(clipText.trim());
          return;
        }
        setPromoPasteHint('Panoda kopyalanmış metin yok. Bağlantıyı doğrudan kutuya yapıştırabilirsiniz.');
      } catch {
        setPromoPasteHint('Doğrudan kutunun içine uzun basıp Yapıştır (veya Ctrl+V) yapabilirsiniz.');
      }
    } else {
      setPromoPasteHint('Doğrudan kutunun içine uzun basıp Yapıştır (veya Ctrl+V) yapabilirsiniz.');
    }

    promoInputRef.current?.focus();
    promoInputRef.current?.select();
  };

  const latestFormRef = useRef({
    name,
    locationArea,
    selectedCuisines,
    mapsInput,
    comment,
    effectiveVisitStatus,
  });
  latestFormRef.current = {
    name,
    locationArea,
    selectedCuisines,
    mapsInput,
    comment,
    effectiveVisitStatus,
  };

  useEffect(() => {
    if (!trimmedPromoInput || parsedPromo.kind !== 'instagram' || !parsedPromo.url) {
      setResolvingSocial(false);
      setSocialAutoFillInfo(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setResolvingSocial(true);
      try {
        const resolved = await resolveSocialLink(
          trimmedPromoInput,
          knownRegions,
          controller.signal
        );
        if (!resolved || controller.signal.aborted) return;

        const current = latestFormRef.current;
        const filledLabels: string[] = [];

        if (resolved.name && !current.name.trim()) {
          setName((prev) => (prev.trim() ? prev : resolved.name.slice(0, STORAGE_LIMITS.NAME_MAX)));
          filledLabels.push('Mekan Adı');
        }
        if (resolved.category && !categoryTouchedRef.current) {
          setCategory(resolved.category);
          filledLabels.push('Mekan Türü');
        }
        if (resolved.locationArea && !current.locationArea.trim()) {
          setLocationArea((prev) =>
            prev.trim() ? prev : resolved.locationArea.slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX)
          );
          filledLabels.push('Bölge');
        }
        if (resolved.cuisineTypes.length > 0 && current.selectedCuisines.length === 0) {
          setSelectedCuisines((prev) =>
            prev.length > 0
              ? prev
              : resolved.cuisineTypes.slice(0, STORAGE_LIMITS.MAX_CUISINE_TYPES)
          );
          filledLabels.push('Ürün Çeşidi');
        }
        if (resolved.mapsUrl && !current.mapsInput.trim()) {
          setMapsInput((prev) => (prev.trim() ? prev : resolved.mapsUrl));
          filledLabels.push('Harita Linki');
        }
        if (
          resolved.noteSnippet &&
          current.effectiveVisitStatus === 'wishlist' &&
          !current.comment.trim()
        ) {
          setComment((prev) =>
            prev.trim() ? prev : resolved.noteSnippet.slice(0, STORAGE_LIMITS.COMMENT_MAX)
          );
          filledLabels.push('Not');
        }

        if (filledLabels.length > 0 || resolved.noteSnippet) {
          setSocialAutoFillInfo({
            filledLabels,
            noteSnippet: resolved.noteSnippet,
          });
        } else {
          setSocialAutoFillInfo(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setResolvingSocial(false);
        }
      }
    }, 280);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmedPromoInput, parsedPromo.kind, parsedPromo.url, knownRegions]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedComment = comment.trim();
    const trimmedMapsInput = mapsInput.trim();
    const extracted = trimmedMapsInput ? extractSharedMapsInput(trimmedMapsInput) : { url: null };
    const finalUrl = cleanMapsUrl || extracted.url || '';

    // Include unsubmitted custom cuisine text if user typed it and didn't click Ekle
    const pendingCustom = customCuisineInput
      .split(',')
      .map((s) => s.trim().slice(0, STORAGE_LIMITS.CUISINE_TYPE_MAX))
      .filter(Boolean);
    const finalCuisines = [...selectedCuisines];
    for (const p of pendingCustom) {
      if (finalCuisines.length >= STORAGE_LIMITS.MAX_CUISINE_TYPES) break;
      if (!finalCuisines.some((item) => item.toLocaleLowerCase('tr') === p.toLocaleLowerCase('tr'))) {
        finalCuisines.push(p);
      }
    }

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
    if (trimmedPromoInput && !parsedPromo.url) {
      setError(
        'Girilen sosyal medya bağlantısı geçerli bir web bağlantısı değil (Instagram, YouTube, Facebook vb.). İsterseniz alanı boş bırakarak da kaydedebilirsiniz.'
      );
      return;
    }
    if (effectiveVisitStatus === 'visited' && trimmedComment.length < STORAGE_LIMITS.COMMENT_MIN) {
      setError('Lütfen mekan hakkında kısa bir yorum yazın.');
      return;
    }
    if (hasStrongOrExactMatch) {
      setError(
        'Bu mekân daha önce eklenmiş. Aşağıdaki veya yukarıdaki mevcut kayda puan/yorum ekleyebilir ya da Gitmek İstiyorum listenize alabilirsiniz.'
      );
      duplicateAlertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const placeId = await createPlace(actor, {
        name: trimmedName,
        category,
        visitStatus: effectiveVisitStatus,
        cuisineTypes: finalCuisines,
        cuisineType: finalCuisines.join(', '),
        locationArea: locationArea.trim().slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX),
        lat: coords.lat,
        lng: coords.lng,
        mapsUrl: finalUrl,
        promoUrl: parsedPromo.url || '',
        initialRating: effectiveVisitStatus === 'visited' ? rating : undefined,
        initialPriceRating: effectiveVisitStatus === 'visited' ? priceRating : undefined,
        initialComment: trimmedComment,
        photos,
      });
      onCreated(
        placeId,
        effectiveVisitStatus,
        effectiveVisitStatus === 'wishlist' ? hideInWishlist : false
      );
    } catch (err) {
      setError(formatFriendlyFirestoreError(err, 'Mekan kaydedilemedi.'));
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
          {!actor && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
              <span>
                Giriş yapmadığınız için bu kayıt yalnızca bu cihazda tutulur. Kişisel Gitmek İstiyorum listeniz ve ortak liste için giriş yapabilirsiniz.
              </span>
              {onRequestSignIn && (
                <button
                  type="button"
                  onClick={onRequestSignIn}
                  className="font-semibold text-emerald-800 hover:underline shrink-0"
                >
                  Google ile Giriş Yap
                </button>
              )}
            </div>
          )}

          {/* Liste Durumu: Gidilenler vs Gidilecekler (Gidilecekler yalnızca giriş yapan kullanıcılara özeldir) */}
          {actor && (
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setVisitStatus('visited');
                  setError(null);
                }}
                className={`min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  effectiveVisitStatus === 'visited'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>Gittiğim Yer</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setVisitStatus('wishlist');
                  setError(null);
                }}
                className={`min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  effectiveVisitStatus === 'wishlist'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookmarkPlus className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Gitmek İstiyorum</span>
              </button>
            </div>
          )}

          {/* Mekan Adı & Benzer Kayıt Kontrolü (En Üstte) */}
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
                placeholder="Örn: İlk Isırık Kokoreç"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            {duplicateCandidates.length > 0 && (
              <div
                ref={duplicateAlertRef}
                role="region"
                aria-label="Benzer mekan uyarısı"
                className={`rounded-2xl border p-3.5 space-y-2.5 ${
                  hasStrongOrExactMatch
                    ? 'bg-rose-500/10 border-rose-300/80'
                    : 'bg-amber-50/75 border-amber-200/80'
                }`}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      hasStrongOrExactMatch ? 'text-rose-600' : 'text-amber-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <p
                      className={`text-xs font-semibold ${
                        hasStrongOrExactMatch ? 'text-rose-950' : 'text-amber-950'
                      }`}
                    >
                      {hasStrongOrExactMatch
                        ? 'Bu mekân daha önce eklenmiş!'
                        : 'Benzer isimde mevcut kayıt(lar) bulundu'}
                    </p>
                    <p
                      className={`text-[11px] leading-relaxed mt-0.5 ${
                        hasStrongOrExactMatch ? 'text-rose-900/90' : 'text-amber-900/90'
                      }`}
                    >
                      {hasStrongOrExactMatch
                        ? 'Aynı mekânın tekrar eklenmesini önlemek için yeni kayıt engellendi. Mevcut kayda puan/yorum ekleyebilir veya listenize alabilirsiniz.'
                        : 'Farklı bir şubeyse yeni kayıt olarak ekleyebilir ya da mevcut kayda puan/yorum bırakabilirsiniz.'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {duplicateCandidates.map(({ place, strength, reason }) => {
                    const isPlaceWishlist = place.visitStatus === 'wishlist' && place.reviewCount === 0;
                    const isAlreadyInMyWishlist = Boolean(myWishlistPlaceIds?.has(place.id));
                    const isAlreadyReviewed = Boolean(
                      actor &&
                        ((place.ownerId === actor.uid && place.visitStatus === 'visited') ||
                          myReviewedPlaceIds?.has(place.id))
                    );
                    const isAddingWish = addingWishlistPlaceId === place.id;

                    return (
                      <div
                        key={place.id}
                        className={`rounded-xl bg-white border p-2.5 space-y-2 ${
                          hasStrongOrExactMatch ? 'border-rose-200/80' : 'border-amber-200/80'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {place.name}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {CATEGORY_LABELS[place.category]}
                              {place.locationArea ? ` · ${place.locationArea}` : ''}
                              {' · '}Ekleyen: {place.authorName}
                            </p>
                            <p
                              className={`text-[11px] font-medium mt-0.5 ${
                                strength === 'exact'
                                  ? 'text-amber-700'
                                  : strength === 'strong'
                                    ? 'text-amber-700'
                                    : 'text-slate-600'
                              }`}
                            >
                              Eşleşme: {reason}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            {isPlaceWishlist ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100/80 text-amber-900 text-[10px] font-semibold">
                                Gitmek İstiyorum
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-[11px] font-semibold tabular-nums">
                                <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                {place.avgRating.toFixed(1)} ({place.reviewCount})
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {onSelectExistingPlace && (
                            <button
                              type="button"
                              onClick={() =>
                                onSelectExistingPlace(place, {
                                  openReviewForm:
                                    effectiveVisitStatus === 'visited' && !isAlreadyReviewed,
                                  rating:
                                    effectiveVisitStatus === 'visited' ? rating : undefined,
                                  priceRating:
                                    effectiveVisitStatus === 'visited' ? priceRating : undefined,
                                  comment: comment.trim() ? comment.trim() : undefined,
                                })
                              }
                              className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold hover:bg-emerald-800 transition-colors"
                            >
                              {effectiveVisitStatus === 'visited' && !isAlreadyReviewed ? (
                                <>
                                  <MessageSquarePlus className="w-3.5 h-3.5" />
                                  <span>Mevcut Mekâna Puan / Yorum Ekle</span>
                                </>
                              ) : (
                                <>
                                  <ArrowRight className="w-3.5 h-3.5" />
                                  <span>Mevcut Kayda Git</span>
                                </>
                              )}
                            </button>
                          )}

                          {onAddExistingToWishlist && !isAlreadyReviewed && (
                            <button
                              type="button"
                              disabled={isAddingWish || isAlreadyInMyWishlist}
                              onClick={async () => {
                                setAddingWishlistPlaceId(place.id);
                                try {
                                  await onAddExistingToWishlist(place);
                                } finally {
                                  setAddingWishlistPlaceId(null);
                                }
                              }}
                              className={`min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                                isAlreadyInMyWishlist
                                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                                  : 'bg-white border-amber-300 text-amber-900 hover:bg-amber-50'
                              }`}
                            >
                              {isAddingWish ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : isAlreadyInMyWishlist ? (
                                <BookmarkCheck className="w-3.5 h-3.5 text-amber-700" />
                              ) : (
                                <BookmarkPlus className="w-3.5 h-3.5 text-amber-700" />
                              )}
                              <span>
                                {isAlreadyInMyWishlist
                                  ? 'Gitmek İstiyorum Listemde'
                                  : 'Gitmek İstiyorum Listeme Ekle'}
                              </span>
                            </button>
                          )}

                          {onSelectExistingPlace && effectiveVisitStatus === 'visited' && !isAlreadyReviewed && (
                            <button
                              type="button"
                              onClick={() => onSelectExistingPlace(place)}
                              className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                            >
                              <span>Detayı Gör</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Google Maps Share Link */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="maps-share-link" className="text-xs font-semibold text-slate-700">
                Google Haritalar Linki{' '}
                <span className="font-normal text-slate-500">
                  ({effectiveVisitStatus === 'wishlist' ? 'Seç & Yapıştır' : 'İsteğe Bağlı'})
                </span>
              </label>
              <a
                href="https://www.google.com/maps"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[34px] shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                <span>Google&apos;da Seç</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Google Haritalar&apos;dan kopyaladığınız bağlantıyı doğrudan aşağıdaki kutuya yapıştırdığınızda mekan adı ve bölge otomatik doldurulur.
            </p>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={mapsInputRef}
                  id="maps-share-link"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  value={mapsInput}
                  onChange={(e) => setMapsInput(e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData?.getData('text');
                    if (pasted) {
                      e.preventDefault();
                      setMapsInput(pasted.trim());
                      setPasteHint(null);
                    }
                  }}
                  placeholder="https://maps.app.goo.gl/..."
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

            {pasteHint && (
              <p className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                {pasteHint}
              </p>
            )}

            {linkStatus === 'invalid' && (
              <p className="text-[11px] font-medium text-rose-600">
                Geçerli bir Google Haritalar linki gibi görünmüyor; isterseniz alanı temizleyip linksiz kaydedebilirsiniz.
              </p>
            )}
          </div>

          {/* Sosyal Medya */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="promo-share-link"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"
              >
                <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>
                  Sosyal Medya{' '}
                  <span className="font-normal text-slate-500">(İsteğe Bağlı)</span>
                </span>
              </label>
              {parsedPromo.url && (
                <a
                  href={parsedPromo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={parsedPromo.platform ? `${parsedPromo.platform} bağlantısını aç` : 'Web bağlantısını aç'}
                  aria-label={parsedPromo.platform ? `${parsedPromo.platform} önizleme bağlantısı` : 'Web bağlantısı önizleme'}
                  className="min-h-[30px] shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <PromoPlatformIcon kind={parsedPromo.kind} className="w-3.5 h-3.5" />
                  <span>{parsedPromo.platform ? `${parsedPromo.platform} Önizle` : 'Önizle'}</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>
              )}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Instagram linki yapıştırdığınızda mekan adı, türü, bölgesi ve ürün çeşitleri otomatik doldurulmaya çalışılır. YouTube, Facebook veya web sitesi de ekleyebilirsiniz.
            </p>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
                  <PromoPlatformIcon kind={parsedPromo.kind} className="w-4 h-4" />
                </span>
                <input
                  ref={promoInputRef}
                  id="promo-share-link"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  maxLength={STORAGE_LIMITS.PROMO_URL_MAX}
                  value={promoInput}
                  onChange={(e) => {
                    setPromoInput(e.target.value);
                    setPromoPasteHint(null);
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData?.getData('text');
                    if (pasted) {
                      e.preventDefault();
                      setPromoInput(pasted.trim());
                      setPromoPasteHint(null);
                    }
                  }}
                  placeholder="https://... (Instagram, YouTube, Facebook veya web linki)"
                  className="w-full min-h-[44px] pl-9 pr-8 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
                {resolvingSocial && (
                  <Loader2 className="w-4 h-4 text-emerald-700 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                )}
                {!resolvingSocial && promoLinkStatus === 'valid' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>
              <button
                type="button"
                onClick={() => void handlePastePromoFromClipboard()}
                className="min-h-[44px] shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ClipboardPaste className="w-4 h-4 text-emerald-700" />
                <span>Yapıştır</span>
              </button>
            </div>

            {promoPasteHint && (
              <p className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                {promoPasteHint}
              </p>
            )}

            {socialAutoFillInfo && !resolvingSocial && (
              <div className="rounded-lg bg-emerald-50/80 border border-emerald-200 px-2.5 py-1.5 space-y-1">
                {socialAutoFillInfo.filledLabels.length > 0 && (
                  <p className="text-[11px] font-medium text-emerald-900">
                    Instagram bağlantısından dolduruldu: {socialAutoFillInfo.filledLabels.join(', ')}
                  </p>
                )}
                {socialAutoFillInfo.noteSnippet &&
                  effectiveVisitStatus === 'visited' &&
                  !comment.trim() && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span className="line-clamp-2 flex-1">{socialAutoFillInfo.noteSnippet}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setComment(
                            socialAutoFillInfo.noteSnippet.slice(0, STORAGE_LIMITS.COMMENT_MAX)
                          )
                        }
                        className="shrink-0 font-semibold text-emerald-800 hover:underline"
                      >
                        Yoruma Ekle
                      </button>
                    </div>
                  )}
              </div>
            )}

            {promoLinkStatus === 'invalid' && (
              <p className="text-[11px] font-medium text-rose-600">
                Geçerli bir sosyal medya linki girin (Instagram, YouTube, Facebook veya web); isterseniz boş bırakabilirsiniz.
              </p>
            )}
          </div>

          {/* İşletme Türü */}
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">Mekan Türü</span>
            <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl">
              {(Object.keys(CATEGORY_LABELS) as PlaceCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    categoryTouchedRef.current = true;
                    setCategory(cat);
                  }}
                  className={`min-h-[38px] flex-1 min-w-[92px] px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
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

          {/* Bölge / Lokasyon */}
          <div className="space-y-2">
            <label
              htmlFor="place-location-area"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"
            >
              <MapPin className="w-3.5 h-3.5 text-emerald-700" />
              <span>Bölge / Semt / İlçe</span>
            </label>
            <input
              id="place-location-area"
              type="text"
              maxLength={STORAGE_LIMITS.LOCATION_AREA_MAX}
              value={locationArea}
              onChange={(e) => setLocationArea(e.target.value)}
              placeholder="Örn: Buca, İzmir veya Kemeraltı, Konak"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            {knownRegions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {knownRegions.slice(0, 8).map((region) => (
                  <button
                    key={region}
                    type="button"
                    onClick={() => setLocationArea(region)}
                    className={`min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                      locationArea.toLocaleLowerCase('tr') === region.toLocaleLowerCase('tr')
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {region}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Çoklu Ürün Çeşidi Seçimi */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="cuisine-type" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <UtensilsCrossed className="w-3.5 h-3.5 text-emerald-700" />
                <span>
                  Ürün Çeşidi (Birden fazla seçilebilir · {selectedCuisines.length}/
                  {STORAGE_LIMITS.MAX_CUISINE_TYPES})
                </span>
              </label>
              {selectedCuisines.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCuisines([])}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
                >
                  Temizle
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PRODUCT_TYPE_PRESETS.map((preset) => {
                const active = selectedCuisines.some(
                  (c) => c.toLocaleLowerCase('tr') === preset.toLocaleLowerCase('tr')
                );
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => toggleCuisineTag(preset)}
                    className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
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
                    className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-700 text-white border border-emerald-700 whitespace-nowrap"
                  >
                    <span>{custom}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
            </div>

            <div className="flex gap-2">
              <input
                id="cuisine-type"
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
                placeholder="Özel ürün ekleyin (ör. Tantuni, Midye)"
                className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <button
                type="button"
                onClick={handleAddCustomCuisine}
                disabled={
                  !customCuisineInput.trim() ||
                  selectedCuisines.length >= STORAGE_LIMITS.MAX_CUISINE_TYPES
                }
                className="min-h-[44px] shrink-0 inline-flex items-center gap-1 px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus className="w-4 h-4 text-emerald-700" />
                <span>Ekle</span>
              </button>
            </div>
          </div>

          {actor && effectiveVisitStatus === 'wishlist' && (
            <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hideInWishlist}
                onChange={(e) => setHideInWishlist(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <EyeOff className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="text-xs font-medium text-slate-700">
                Gitmek İstiyorum listemde şimdilik gizli tut (istediğiniz zaman gösterebilirsiniz)
              </span>
            </label>
          )}

          {/* Lokanta Puanı & Fiyat Puanı Sekmeleri */}
          {effectiveVisitStatus === 'visited' && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2.5">
              <div
                role="tablist"
                aria-label="Puanlama türü"
                className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/70 rounded-xl"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={ratingTab === 'venue'}
                  onClick={() => setRatingTab('venue')}
                  className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    ratingTab === 'venue'
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
                  aria-selected={ratingTab === 'price'}
                  onClick={() => setRatingTab('price')}
                  className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    ratingTab === 'price'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BadgeTurkishLira className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span>Fiyat Puanı · {priceRating}/5</span>
                </button>
              </div>

              {ratingTab === 'venue' ? (
                <div>
                  <span className="block text-[11px] font-medium text-slate-500 mb-1">
                    Lezzet, servis ve genel mekan puanı *
                  </span>
                  <StarRatingInput value={rating} onChange={setRating} />
                </div>
              ) : (
                <div>
                  <span className="block text-[11px] font-medium text-slate-500 mb-1">
                    Fiyat / performans değerlendirmesi (1 Çok Pahalı – 5 Çok Uygun)
                  </span>
                  <PriceRatingInput value={priceRating} onChange={setPriceRating} />
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="place-comment" className="text-xs font-semibold text-slate-700">
                {effectiveVisitStatus === 'visited' ? 'Yorum *' : 'Not (İsteğe Bağlı)'}
              </label>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {comment.length}/{STORAGE_LIMITS.COMMENT_MAX}
              </span>
            </div>
            <textarea
              id="place-comment"
              required={effectiveVisitStatus === 'visited'}
              rows={effectiveVisitStatus === 'visited' ? 3 : 2}
              maxLength={STORAGE_LIMITS.COMMENT_MAX}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                effectiveVisitStatus === 'visited'
                  ? 'Yemekler, kahve veya ortam nasıldı?'
                  : 'Neden gitmek istiyorsunuz? (Örn: Kokoreçi meşhurmuş, hafta sonu bakalım)'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-y"
            />
          </div>

          {effectiveVisitStatus === 'visited' && <PhotoUploader photos={photos} onChange={setPhotos} />}

          {hasStrongOrExactMatch && (
            <div
              role="status"
              className="rounded-xl bg-rose-500/10 border border-rose-300/80 p-3.5 space-y-2"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-rose-950">
                    Bu mekân daha önce eklenmiş.
                  </p>
                  <p className="text-[11px] text-rose-900/90 leading-relaxed">
                    Aynı mekânın tekrar kaydedilmemesi için ekleme işlemi kapatıldı. Mevcut kayda puan/yorum ekleyebilir veya Gitmek İstiyorum listenize alabilirsiniz.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  duplicateAlertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
                className="text-[11px] font-semibold text-rose-700 hover:underline"
              >
                Eşleşen mevcut kaydı incele ↑
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-700 break-words"
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
              disabled={submitting || hasStrongOrExactMatch}
              className="flex-1 min-h-[46px] rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-emerald-700"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {submitting
                  ? 'Kaydediliyor...'
                  : hasStrongOrExactMatch
                    ? 'Bu Mekân Zaten Kayıtlı'
                    : effectiveVisitStatus === 'wishlist'
                      ? 'Gitmek İstiyorum Listesine Ekle'
                      : 'Listeye Ekle'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
