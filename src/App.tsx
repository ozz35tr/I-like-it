import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  browserPopupRedirectResolver,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeTurkishLira,
  BookmarkCheck,
  BookmarkPlus,
  CloudUpload,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  LogOut,
  MapPin,
  Navigation,
  Plus,
  Search,
  Share2,
  Star,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { AddPlaceModal, type SelectExistingPlaceOptions } from './components/AddPlaceModal';
import { GourmandLogo } from './components/GourmandLogo';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PlaceDetailSheet } from './components/PlaceDetailSheet';
import { PriceRatingDisplay } from './components/PriceRating';
import { PromoPlatformIcon } from './components/PromoPlatformIcon';
import { PWAInstallButton } from './components/PWAInstallButton';
import { auth, formatFriendlyFirestoreError, googleProvider } from './lib/firebase';
import {
  clearLegacyLocalDatabase,
  exportDatabaseBackup as exportLocalBackup,
  listPlaces as listLocalIndexedDbPlaces,
} from './lib/localDb';
import {
  formatDistanceLabel,
  getPromoPlatformLabel,
  haversineDistanceKm,
  matchesDetectedArea,
  matchesMultiWordQuery,
  normalizeTurkishSearchText,
  reverseGeocodeArea,
} from './lib/mapsLink';
import { sharePlaceDetails } from './lib/sharePlace';
import {
  clearFirestoreReadCaches,
  exportBackup,
  importBackup,
  isLocalDeviceRecord,
  removePlace,
  subscribeHiddenWishlistIds,
  subscribeUserOrLocalPlaces,
  subscribeUserWishlistPlaceIds,
  syncUserWishlistToShared,
  toggleExistingPlaceWishlist,
  toggleWishlistPlaceHidden,
  type CloudActor,
} from './lib/placeRepository';
import {
  countLegacyPersonalCloudPlaces,
  findUserReviewedPlaceIds,
  importBackupToFirestore,
  migrateLegacyPersonalCloudToShared,
  resolveSafeAuthorName,
  type UserReviewLookupCacheEntry,
} from './lib/placesService';
import {
  CATEGORY_LABELS,
  PRODUCT_TYPE_PRESETS,
  type PlaceItem,
  type SortDirection,
  type SortField,
} from './types/place';

type ListStatusFilter = 'visited' | 'wishlist' | 'hidden';
type VisitedOwnerFilter = 'all' | 'visited_only' | 'wishlist_only' | 'mine' | 'others';

function renderStars(avgRating: number) {
  const rounded = Math.round(avgRating);
  return (
    <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="inline-flex items-center gap-0.5" aria-label={`${avgRating.toFixed(1)} yıldız`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`w-3.5 h-3.5 ${
              n <= rounded ? 'fill-amber-500 text-amber-500' : 'text-slate-300'
            }`}
          />
        ))}
      </span>
      <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums">
        {avgRating.toFixed(1)}
      </span>
    </div>
  );
}

function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|Snapchat|TikTok/i.test(ua);
}

function formatAuthErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code || '';
  const msg = err instanceof Error ? err.message : String(err || '');

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Giriş penceresi kapatıldı. Devam etmek için tekrar deneyin.';
  }
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    return `Bu site adresi (${host}) Firebase Yetkili Alan Adları (Authorized domains) listesinde ekli değil.`;
  }
  if (
    /Requested action is invalid|missing initial state|missing-or-invalid-nonce|invalid-action-code/i.test(
      `${code} ${msg}`
    )
  ) {
    return 'Mobil tarayıcı çerez/depolama kısıtlaması nedeniyle yönlendirme tamamlanamadı. Sayfayı Safari veya Chrome üzerinden doğrudan açıp Ortak Liste düğmesine tekrar dokunun.';
  }
  if (isInAppBrowser()) {
    return 'Google, uygulama içi tarayıcılardan (WhatsApp/Instagram vb.) girişe izin vermiyor. Bağlantıyı Safari veya Chrome ile açın.';
  }
  return msg ? `Giriş yapılamadı: ${msg}` : 'Google ile giriş yapılamadı.';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [allPlaces, setAllPlaces] = useState<PlaceItem[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<ListStatusFilter>('visited');
  const [visitedOwnerFilter, setVisitedOwnerFilter] = useState<VisitedOwnerFilter>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');

  const [hiddenWishlistIds, setHiddenWishlistIds] = useState<string[]>([]);
  const optimisticHiddenOverridesRef = useRef<Map<string, boolean>>(new Map());
  const [myWishlistPlaceIds, setMyWishlistPlaceIds] = useState<Set<string>>(() => new Set());
  const [myReviewedPlaceIds, setMyReviewedPlaceIds] = useState<Set<string>>(() => new Set());
  const userReviewCacheRef = useRef<Map<string, UserReviewLookupCacheEntry>>(new Map());

  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedUserArea, setDetectedUserArea] = useState<string | null>(null);
  const [locatingUser, setLocatingUser] = useState(false);
  const [bestInAreaActive, setBestInAreaActive] = useState(false);
  const [locatingBestInArea, setLocatingBestInArea] = useState(false);

  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const [detailPlace, setDetailPlace] = useState<PlaceItem | null>(null);
  const [detailDraftOptions, setDetailDraftOptions] = useState<SelectExistingPlaceOptions | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [togglingWishlistId, setTogglingWishlistId] = useState<string | null>(null);
  const [localLegacyCount, setLocalLegacyCount] = useState(0);
  const [legacyCloudCount, setLegacyCloudCount] = useState(0);
  const [migratingLegacy, setMigratingLegacy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const actor: CloudActor | null = useMemo(
    () =>
      authReady && user
        ? {
            uid: user.uid,
            authorName: resolveSafeAuthorName(user.displayName, user.email),
          }
        : null,
    [authReady, user]
  );

  useEffect(() => {
    void getRedirectResult(auth, browserPopupRedirectResolver).catch((err) => {
      if (err) {
        setAuthError(formatAuthErrorMessage(err));
      }
    });

    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const lastUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    const prevUid = lastUidRef.current;
    const currentUid = actor?.uid ?? null;
    const uidChanged = prevUid !== currentUid;
    lastUidRef.current = currentUid;

    if (uidChanged) {
      optimisticHiddenOverridesRef.current.clear();
      userReviewCacheRef.current.clear();
      setMyReviewedPlaceIds(new Set());
      setMyWishlistPlaceIds(new Set());
      if (prevUid !== null) {
        clearFirestoreReadCaches();
      }
    }

    setLoadingPlaces(true);
    setSyncError(null);

    const unsubPlaces = subscribeUserOrLocalPlaces(
      actor,
      (places) => {
        setAllPlaces(places);
        setLoadingPlaces(false);
      },
      (err) => {
        setLoadingPlaces(false);
        setSyncError(
          formatFriendlyFirestoreError(err, 'Veriler yüklenirken bir hata oluştu.')
        );
      }
    );

    if (!actor) {
      setStatusFilter('visited');
      setVisitedOwnerFilter('all');
      setHiddenWishlistIds([]);
      setMyWishlistPlaceIds(new Set());
    }

    const unsubHidden = subscribeHiddenWishlistIds(
      actor,
      (serverIds) => {
        const merged = new Set(serverIds);
        optimisticHiddenOverridesRef.current.forEach((shouldHide, placeId) => {
          if (shouldHide) merged.add(placeId);
          else merged.delete(placeId);
        });
        setHiddenWishlistIds(Array.from(merged));
      },
      (err) => {
        setNotice(
          formatFriendlyFirestoreError(err, 'Gizlenen Gitmek İstiyorum tercihiniz yüklenemedi.')
        );
      }
    );

    const unsubWishlistIds = subscribeUserWishlistPlaceIds(actor, (ids) => {
      setMyWishlistPlaceIds(ids);
    });

    if (actor) {
      void syncUserWishlistToShared(actor.uid, actor.authorName);

      void listLocalIndexedDbPlaces()
        .then((localItems) => {
          setLocalLegacyCount(localItems.length);
        })
        .catch(() => {
          setLocalLegacyCount(0);
        });

      void countLegacyPersonalCloudPlaces(actor.uid)
        .then((count) => {
          setLegacyCloudCount(count);
        })
        .catch(() => {
          setLegacyCloudCount(0);
        });
    } else {
      setLocalLegacyCount(0);
      setLegacyCloudCount(0);
    }

    return () => {
      unsubPlaces();
      unsubHidden();
      unsubWishlistIds();
    };
  }, [authReady, actor]);

  useEffect(() => {
    if (!actor) {
      setMyReviewedPlaceIds(new Set());
      return;
    }

    let cancelled = false;
    void findUserReviewedPlaceIds(actor.uid, allPlaces, userReviewCacheRef.current, {
      fetchMissing:
        statusFilter === 'visited' &&
        (visitedOwnerFilter === 'mine' || visitedOwnerFilter === 'others'),
    }).then((ids) => {
      if (!cancelled) {
        setMyReviewedPlaceIds(ids);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [actor, allPlaces, statusFilter, visitedOwnerFilter]);

  const hiddenWishlistSet = useMemo(() => new Set(hiddenWishlistIds), [hiddenWishlistIds]);
  const wishlistPlaceIdSet = myWishlistPlaceIds;

  const liveDetailPlace = useMemo(() => {
    if (!detailPlace) return null;
    const detailIsWish = detailPlace.visitStatus === 'wishlist' && detailPlace.reviewCount === 0;
    return (
      allPlaces.find(
        (p) =>
          p.id === detailPlace.id &&
          (p.visitStatus === 'wishlist' && p.reviewCount === 0) === detailIsWish
      ) ||
      allPlaces.find((p) => p.id === detailPlace.id) ||
      null
    );
  }, [allPlaces, detailPlace]);

  const deepLinkHandledRef = useRef(false);

  useEffect(() => {
    if (deepLinkHandledRef.current || loadingPlaces || allPlaces.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const sharedPlaceId = params.get('place');
    if (!sharedPlaceId) {
      deepLinkHandledRef.current = true;
      return;
    }
    const matched = allPlaces.find((p) => p.id === sharedPlaceId);
    if (matched) {
      deepLinkHandledRef.current = true;
      setDetailPlace(matched);
    }
  }, [allPlaces, loadingPlaces]);

  const handleCloseDetailPlace = () => {
    setDetailPlace(null);
    setDetailDraftOptions(null);
    if (typeof window !== 'undefined' && window.location.search.includes('place=')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('place');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  };

  const handleSharePlace = async (sourcePlace: PlaceItem) => {
    const result = await sharePlaceDetails(sourcePlace);
    if (result === 'copied') {
      setNotice(`${sourcePlace.name} bilgileri panoya kopyalandı.`);
      window.setTimeout(() => setNotice(null), 2600);
    } else if (result === 'unsupported') {
      setNotice('Bu tarayıcıda paylaşım desteklenmiyor.');
      window.setTimeout(() => setNotice(null), 3000);
    }
  };

  const handleTogglePlaceWishlist = async (sourcePlace: PlaceItem) => {
    if (!actor) {
      setNotice('Gitmek İstiyorum listenize eklemek için Google hesabınızla giriş yapın.');
      window.setTimeout(() => setNotice(null), 3200);
      void handleSignIn();
      return;
    }
    if (togglingWishlistId === sourcePlace.id) return;
    const currentlyInWishlist = wishlistPlaceIdSet.has(sourcePlace.id);
    setTogglingWishlistId(sourcePlace.id);
    try {
      await toggleExistingPlaceWishlist(actor, sourcePlace, !currentlyInWishlist);
      if (!currentlyInWishlist && hiddenWishlistSet.has(sourcePlace.id)) {
        await handleToggleHiddenWishlist(sourcePlace.id, false);
      }
      setNotice(
        currentlyInWishlist
          ? `${sourcePlace.name} Gitmek İstiyorum listenizden çıkarıldı.`
          : `${sourcePlace.name} Gitmek İstiyorum listenize eklendi.`
      );
      window.setTimeout(() => setNotice(null), 2600);
    } catch (err) {
      setNotice(
        formatFriendlyFirestoreError(err, 'Gitmek İstiyorum listesi güncellenemedi.')
      );
      window.setTimeout(() => setNotice(null), 4000);
    } finally {
      setTogglingWishlistId((prev) => (prev === sourcePlace.id ? null : prev));
    }
  };

  const handleToggleHiddenWishlist = async (placeId: string, hide: boolean) => {
    optimisticHiddenOverridesRef.current.set(placeId, hide);
    setHiddenWishlistIds((prev) => {
      const next = new Set(prev);
      if (hide) next.add(placeId);
      else next.delete(placeId);
      return Array.from(next);
    });

    try {
      const committedIds = await toggleWishlistPlaceHidden(actor, placeId, hide);
      if (optimisticHiddenOverridesRef.current.get(placeId) === hide) {
        optimisticHiddenOverridesRef.current.delete(placeId);
      }
      const merged = new Set(committedIds);
      optimisticHiddenOverridesRef.current.forEach((shouldHide, pendingId) => {
        if (shouldHide) merged.add(pendingId);
        else merged.delete(pendingId);
      });
      setHiddenWishlistIds(Array.from(merged));
      setNotice(
        hide
          ? 'Kayıt yalnızca sizin Gitmek İstiyorum listenizde gizlendi.'
          : 'Kayıt tekrar Gitmek İstiyorum listenizde gösteriliyor.'
      );
      window.setTimeout(() => setNotice(null), 2600);
    } catch (err) {
      if (optimisticHiddenOverridesRef.current.get(placeId) === hide) {
        optimisticHiddenOverridesRef.current.delete(placeId);
      }
      setHiddenWishlistIds((prev) => {
        const reverted = new Set(prev);
        if (hide) reverted.delete(placeId);
        else reverted.add(placeId);
        return Array.from(reverted);
      });
      setNotice(formatFriendlyFirestoreError(err, 'Gizleme tercihi kaydedilemedi.'));
      window.setTimeout(() => setNotice(null), 3500);
    }
  };

  const resolveAndStoreUserArea = async (lat: number, lng: number): Promise<string> => {
    const area = await reverseGeocodeArea(lat, lng);
    if (area) {
      setDetectedUserArea(area);
      return area;
    }
    return '';
  };

  const handleToggleNearMe = () => {
    if (userCoords && !bestInAreaActive) {
      setUserCoords(null);
      setDetectedUserArea(null);
      if (sortField === 'distance') {
        setSortField('date');
        setSortDir('desc');
      }
      return;
    }

    if (userCoords && bestInAreaActive) {
      setBestInAreaActive(false);
      setSortField('distance');
      setSortDir('asc');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNotice('Tarayıcınız konum servisini desteklemiyor; arama kutusuna semt/ilçe yazabilirsiniz.');
      window.setTimeout(() => setNotice(null), 3500);
      return;
    }

    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lng: longitude });
        setBestInAreaActive(false);
        setSortField('distance');
        setSortDir('asc');
        setLocatingUser(false);
        void resolveAndStoreUserArea(latitude, longitude);
        setNotice('Konumunuz alındı; koordinatlı mekanlar yakınlığa göre sıralandı.');
        window.setTimeout(() => setNotice(null), 3000);
      },
      () => {
        setLocatingUser(false);
        setNotice('Konum izni alınamadı. Arama kutusuna veya Bölge filtresine semt/ilçe yazabilirsiniz.');
        window.setTimeout(() => setNotice(null), 3500);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  };

  const handleToggleBestInArea = () => {
    if (bestInAreaActive) {
      setBestInAreaActive(false);
      if (sortField === 'rating') {
        setSortField(userCoords ? 'distance' : 'date');
        setSortDir(userCoords ? 'asc' : 'desc');
      }
      return;
    }

    const activateWithCoords = async (lat: number, lng: number) => {
      setBestInAreaActive(true);
      setSortField('rating');
      setSortDir('desc');
      if (statusFilter === 'wishlist' || statusFilter === 'hidden') {
        setStatusFilter('visited');
      }
      const resolvedArea = detectedUserArea || (await resolveAndStoreUserArea(lat, lng));
      setNotice(
        resolvedArea
          ? `${resolvedArea} bölgesindeki en yüksek yıldızlı mekanlar gösteriliyor.`
          : 'Konumunuzdaki en yüksek yıldızlı mekanlar gösteriliyor.'
      );
      window.setTimeout(() => setNotice(null), 3200);
    };

    if (userCoords) {
      void activateWithCoords(userCoords.lat, userCoords.lng);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setBestInAreaActive(true);
      setSortField('rating');
      setSortDir('desc');
      if (statusFilter === 'wishlist' || statusFilter === 'hidden') setStatusFilter('visited');
      setNotice('Konum servisi kullanılamıyor; mevcut görünümdeki en yüksek puanlı yerler sıralandı.');
      window.setTimeout(() => setNotice(null), 3500);
      return;
    }

    setLocatingBestInArea(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lng: longitude });
        setLocatingBestInArea(false);
        void activateWithCoords(latitude, longitude);
      },
      () => {
        setLocatingBestInArea(false);
        setBestInAreaActive(true);
        setSortField('rating');
        setSortDir('desc');
        if (statusFilter === 'wishlist' || statusFilter === 'hidden') setStatusFilter('visited');
        setNotice(
          'Konum izni alınamadı; Bölge seçerek veya listedeki en yüksek yıldızlı yerlerden devam edebilirsiniz.'
        );
        window.setTimeout(() => setNotice(null), 3500);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  };

  const handleSignIn = async () => {
    if (isInAppBrowser()) {
      setAuthError(
        'Google, uygulama içi tarayıcılardan (WhatsApp/Instagram vb.) girişe izin vermiyor. Sağ alttan/üstten Safari veya Chrome ile açın.'
      );
      return;
    }

    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code || '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        try {
          await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
          return;
        } catch (redirectErr) {
          setAuthError(formatAuthErrorMessage(redirectErr));
        }
      } else {
        setAuthError(formatAuthErrorMessage(err));
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    clearFirestoreReadCaches();
    await signOut(auth);
    setDetailPlace(null);
  };

  const handleMigrateToShared = async () => {
    if (!actor) return;
    setMigratingLegacy(true);
    try {
      let totalMoved = 0;

      if (localLegacyCount > 0) {
        const localPayload = await exportLocalBackup();
        const importedLocal = await importBackupToFirestore(
          actor.uid,
          actor.authorName,
          JSON.stringify(localPayload)
        );
        await clearLegacyLocalDatabase();
        setLocalLegacyCount(0);
        totalMoved += importedLocal;
      }

      if (legacyCloudCount > 0) {
        const migratedCloud = await migrateLegacyPersonalCloudToShared(
          actor.uid,
          actor.authorName
        );
        setLegacyCloudCount(0);
        totalMoved += migratedCloud;
      }

      setNotice(`${totalMoved} kayıt ortak listeye aktarıldı.`);
      window.setTimeout(() => setNotice(null), 3500);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Eski kayıtlar aktarılamadı.');
    } finally {
      setMigratingLegacy(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'rating' || field === 'price' || field === 'date' ? 'desc' : 'asc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
    );
  };

  const totalCatalogCount = allPlaces.length;

  const visitedCount = useMemo(
    () =>
      allPlaces.filter((p) => !(p.visitStatus === 'wishlist' && p.reviewCount === 0)).length,
    [allPlaces]
  );

  const wishlistCatalogCount = useMemo(
    () =>
      allPlaces.filter((p) => p.visitStatus === 'wishlist' && p.reviewCount === 0).length,
    [allPlaces]
  );

  const mineVisitedCount = useMemo(() => {
    if (!actor) return 0;
    return allPlaces.filter((p) => {
      const isWish = p.visitStatus === 'wishlist' && p.reviewCount === 0;
      if (isWish) return false;
      return p.ownerId === actor.uid || myReviewedPlaceIds.has(p.id);
    }).length;
  }, [allPlaces, actor, myReviewedPlaceIds]);

  const othersVisitedCount = useMemo(() => {
    if (!actor) return visitedCount;
    return allPlaces.filter((p) => {
      const isWish = p.visitStatus === 'wishlist' && p.reviewCount === 0;
      if (isWish) return false;
      return p.ownerId !== actor.uid && !myReviewedPlaceIds.has(p.id);
    }).length;
  }, [allPlaces, actor, myReviewedPlaceIds, visitedCount]);

  const personalWishlistCount = useMemo(() => {
    if (!actor) return 0;
    return allPlaces.filter(
      (p) => myWishlistPlaceIds.has(p.id) && !hiddenWishlistSet.has(p.id)
    ).length;
  }, [allPlaces, actor, myWishlistPlaceIds, hiddenWishlistSet]);

  const hiddenWishlistCount = useMemo(() => {
    if (!actor) return 0;
    return allPlaces.filter(
      (p) => myWishlistPlaceIds.has(p.id) && hiddenWishlistSet.has(p.id)
    ).length;
  }, [allPlaces, actor, myWishlistPlaceIds, hiddenWishlistSet]);

  const wishlistCount = personalWishlistCount;

  const statusScopedPlaces = useMemo(() => {
    return allPlaces.filter((p) => {
      const isCatalogWish = p.visitStatus === 'wishlist' && p.reviewCount === 0;

      switch (statusFilter) {
        case 'visited': {
          if (visitedOwnerFilter === 'all') return true;
          if (visitedOwnerFilter === 'visited_only') return !isCatalogWish;
          if (visitedOwnerFilter === 'wishlist_only') return isCatalogWish;
          if (visitedOwnerFilter === 'mine') {
            if (!actor) return false;
            return !isCatalogWish && (p.ownerId === actor.uid || myReviewedPlaceIds.has(p.id));
          }
          if (visitedOwnerFilter === 'others') {
            if (!actor) return true;
            return !isCatalogWish && p.ownerId !== actor.uid && !myReviewedPlaceIds.has(p.id);
          }
          return true;
        }
        case 'wishlist':
          if (!actor) return false;
          return myWishlistPlaceIds.has(p.id) && !hiddenWishlistSet.has(p.id);
        case 'hidden':
          if (!actor) return false;
          return myWishlistPlaceIds.has(p.id) && hiddenWishlistSet.has(p.id);
        default:
          return true;
      }
    });
  }, [
    allPlaces,
    statusFilter,
    visitedOwnerFilter,
    hiddenWishlistSet,
    actor,
    myReviewedPlaceIds,
    myWishlistPlaceIds,
  ]);

  const knownRegions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allPlaces) {
      const area = (p.locationArea || '').trim();
      if (!area) continue;
      const key = normalizeTurkishSearchText(area);
      if (!map.has(key)) map.set(key, area);
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [allPlaces]);

  const productFilterOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();

    for (const preset of PRODUCT_TYPE_PRESETS) {
      counts.set(normalizeTurkishSearchText(preset), { label: preset, count: 0 });
    }

    for (const p of statusScopedPlaces) {
      if (regionFilter !== 'all') {
        const areaKey = normalizeTurkishSearchText(p.locationArea || '');
        if (!areaKey.includes(regionFilter)) continue;
      }
      for (const tag of p.cuisineTypes) {
        const clean = tag.trim();
        if (!clean) continue;
        const key = normalizeTurkishSearchText(clean);
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(key, { label: clean, count: 1 });
        }
      }
    }

    return Array.from(counts.entries())
      .map(([key, info]) => ({ key, ...info }))
      .sort((a, b) => {
        if (b.count > 0 && a.count === 0) return 1;
        if (a.count > 0 && b.count === 0) return -1;
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label, 'tr');
      });
  }, [statusScopedPlaces, regionFilter]);

  const regionFilterOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();

    for (const p of statusScopedPlaces) {
      if (productFilter !== 'all') {
        const hasProduct = p.cuisineTypes.some(
          (t) => normalizeTurkishSearchText(t) === productFilter
        );
        if (!hasProduct) continue;
      }
      const area = (p.locationArea || '').trim();
      if (!area) continue;
      const key = normalizeTurkishSearchText(area);
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { label: area, count: 1 });
      }
    }

    return Array.from(counts.entries())
      .map(([key, info]) => ({ key, ...info }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr'));
  }, [statusScopedPlaces, productFilter]);

  // Bidirectional intelligence: detect active product or region from explicit filter OR search query
  const inferredSearchProduct = useMemo(() => {
    if (productFilter !== 'all') {
      return productFilterOptions.find((o) => o.key === productFilter) || null;
    }
    const qNorm = normalizeTurkishSearchText(searchText);
    if (!qNorm || qNorm.length < 3) return null;
    const matched = productFilterOptions.find(
      (o) => o.key === qNorm || (o.key.includes(qNorm) && qNorm.length >= 4)
    );
    return matched || null;
  }, [productFilter, productFilterOptions, searchText]);

  const inferredSearchRegion = useMemo(() => {
    if (regionFilter !== 'all') {
      return regionFilterOptions.find((o) => o.key === regionFilter) || null;
    }
    const qNorm = normalizeTurkishSearchText(searchText);
    if (!qNorm || qNorm.length < 3) return null;
    const matched = regionFilterOptions.find(
      (o) => o.key === qNorm || o.key.includes(qNorm)
    );
    return matched || null;
  }, [regionFilter, regionFilterOptions, searchText]);

  const regionsForActiveProduct = useMemo(() => {
    if (!inferredSearchProduct) return [];
    const targetKey = inferredSearchProduct.key;
    const map = new Map<string, { key: string; label: string; count: number }>();

    for (const p of statusScopedPlaces) {
      const matchesProd = p.cuisineTypes.some(
        (t) => normalizeTurkishSearchText(t) === targetKey
      );
      if (!matchesProd) continue;
      const area = (p.locationArea || '').trim();
      if (!area) continue;
      const key = normalizeTurkishSearchText(area);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { key, label: area, count: 1 });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr')
    );
  }, [inferredSearchProduct, statusScopedPlaces]);

  const productsInActiveRegion = useMemo(() => {
    if (!inferredSearchRegion) return [];
    const targetRegionKey = inferredSearchRegion.key;
    const map = new Map<string, { key: string; label: string; count: number }>();

    for (const p of statusScopedPlaces) {
      const areaKey = normalizeTurkishSearchText(p.locationArea || '');
      if (!areaKey.includes(targetRegionKey)) continue;
      for (const tag of p.cuisineTypes) {
        const clean = tag.trim();
        if (!clean) continue;
        const key = normalizeTurkishSearchText(clean);
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(key, { key, label: clean, count: 1 });
        }
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr')
    );
  }, [inferredSearchRegion, statusScopedPlaces]);

  const effectiveDetectedArea = useMemo(() => {
    if (detectedUserArea && detectedUserArea.trim()) return detectedUserArea.trim();
    if (!userCoords) return null;

    let nearestArea = '';
    let nearestDist = Infinity;
    for (const p of allPlaces) {
      if (p.lat === null || p.lng === null || !p.locationArea.trim()) continue;
      const dist = haversineDistanceKm(userCoords.lat, userCoords.lng, p.lat, p.lng);
      if (dist <= 12 && dist < nearestDist) {
        nearestDist = dist;
        nearestArea = p.locationArea.split(',')[0]?.trim() || p.locationArea.trim();
      }
    }
    return nearestArea || null;
  }, [detectedUserArea, userCoords, allPlaces]);

  const bestInAreaResult = useMemo(() => {
    const filtered = statusScopedPlaces.filter((p) => {
      if (productFilter !== 'all') {
        const hasProduct = p.cuisineTypes.some(
          (t) => normalizeTurkishSearchText(t) === productFilter
        );
        if (!hasProduct) return false;
      }
      if (regionFilter !== 'all') {
        const areaKey = normalizeTurkishSearchText(p.locationArea || '');
        if (!areaKey.includes(regionFilter)) return false;
      }
      return matchesMultiWordQuery(
        [
          p.name,
          p.locationArea,
          p.cuisineType,
          ...p.cuisineTypes,
          p.latestComment,
          p.authorName,
          CATEGORY_LABELS[p.category],
          p.mapsUrl,
          p.promoUrl,
        ],
        searchText
      );
    });

    const withDistance = filtered.map((place) => ({
      place,
      distanceKm:
        userCoords && place.lat !== null && place.lng !== null
          ? haversineDistanceKm(userCoords.lat, userCoords.lng, place.lat, place.lng)
          : null,
    }));

    let workingList = withDistance;
    let usedAreaScope = false;
    let usedGlobalFallback = false;

    if (bestInAreaActive && regionFilter === 'all' && userCoords) {
      const inRegion = withDistance.filter(
        (item) =>
          (item.distanceKm !== null && item.distanceKm <= 12) ||
          matchesDetectedArea(item.place.locationArea, effectiveDetectedArea)
      );
      if (inRegion.length > 0) {
        workingList = inRegion;
        usedAreaScope = true;
      } else {
        usedGlobalFallback = true;
      }
    }

    const factor = sortDir === 'asc' ? 1 : -1;
    const sorted = [...workingList].sort((aWrap, bWrap) => {
      const a = aWrap.place;
      const b = bWrap.place;
      switch (sortField) {
        case 'distance': {
          if (aWrap.distanceKm !== null && bWrap.distanceKm !== null) {
            return (aWrap.distanceKm - bWrap.distanceKm) * factor;
          }
          if (aWrap.distanceKm !== null) return -1;
          if (bWrap.distanceKm !== null) return 1;
          return a.name.localeCompare(b.name, 'tr');
        }
        case 'name':
          return a.name.localeCompare(b.name, 'tr') * factor;
        case 'product': {
          const prodA = a.cuisineType || CATEGORY_LABELS[a.category];
          const prodB = b.cuisineType || CATEGORY_LABELS[b.category];
          return (prodA.localeCompare(prodB, 'tr') || a.name.localeCompare(b.name, 'tr')) * factor;
        }
        case 'rating': {
          const ratingDiff = a.avgRating - b.avgRating;
          if (ratingDiff !== 0) return ratingDiff * factor;
          const reviewDiff = a.reviewCount - b.reviewCount;
          if (reviewDiff !== 0) return reviewDiff * factor;
          if (aWrap.distanceKm !== null && bWrap.distanceKm !== null) {
            return aWrap.distanceKm - bWrap.distanceKm;
          }
          return a.name.localeCompare(b.name, 'tr');
        }
        case 'price': {
          const priceA = a.avgPriceRating ?? 0;
          const priceB = b.avgPriceRating ?? 0;
          if (priceA > 0 && priceB <= 0) return -1;
          if (priceB > 0 && priceA <= 0) return 1;
          if (priceA !== priceB) return (priceA - priceB) * factor;
          if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
          return a.name.localeCompare(b.name, 'tr');
        }
        case 'location': {
          const locA = a.locationArea || a.mapsUrl || '';
          const locB = b.locationArea || b.mapsUrl || '';
          return locA.localeCompare(locB, 'tr') * factor;
        }
        case 'comment':
          return (a.latestComment || '').localeCompare(b.latestComment || '', 'tr') * factor;
        case 'date':
        default:
          return (a.updatedAt - b.updatedAt) * factor;
      }
    });

    return {
      items: sorted,
      usedAreaScope,
      usedGlobalFallback,
    };
  }, [
    statusScopedPlaces,
    productFilter,
    regionFilter,
    searchText,
    sortField,
    sortDir,
    userCoords,
    bestInAreaActive,
    effectiveDetectedArea,
  ]);

  const sortedAndFilteredPlaces = bestInAreaResult.items;

  const handleExport = async () => {
    const payload = await exportBackup(actor);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gourmand-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Yedek dosyası indirildi.');
    window.setTimeout(() => setNotice(null), 2500);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = await importBackup(actor, text);
      setNotice(`${count} mekan listenize eklendi.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Yedek okunamadı.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      window.setTimeout(() => setNotice(null), 3000);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col bg-slate-50 text-slate-900">
      {/* Compact Safe-Area Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 pt-safe">
        <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => {
                clearFirestoreReadCaches();
                window.location.reload();
              }}
              title="Sayfayı yenile"
              aria-label="Gourmand - Sayfayı yenile"
              className="min-h-[44px] inline-flex items-center gap-2.5 rounded-xl pr-1 text-left hover:opacity-85 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 cursor-pointer"
            >
              <GourmandLogo className="w-8 h-8 shrink-0" />
              <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap">
                Gourmand
              </span>
            </button>
            {user?.email && (
              <span className="hidden md:inline-block text-xs text-slate-500 truncate max-w-[180px]">
                {user.email}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <PWAInstallButton compact />

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void handleImport(e)}
            />
            <button
              type="button"
              onClick={() => void handleExport()}
              title="Yedek İndir"
              aria-label="Yedek İndir"
              className="hidden md:inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 px-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-xs font-medium"
            >
              <Download className="w-4 h-4 text-emerald-700" />
              <span className="hidden lg:inline">Yedekle</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Yedek Yükle"
              aria-label="Yedek Yükle"
              className="hidden md:inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 px-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-xs font-medium"
            >
              <Upload className="w-4 h-4 text-emerald-700" />
              <span className="hidden lg:inline">Yükle</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="hidden md:inline-flex min-h-[40px] items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Yeni Ekle</span>
            </button>

            {user ? (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                title="Google Çıkışı"
                aria-label="Google Çıkışı"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50"
              >
                <LogOut className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSignIn()}
                disabled={signingIn}
                title="Yeni mekan/yorum eklemek ve listeni senkronize etmek için Google ile giriş yap"
                className="min-h-[40px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {signingIn ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                ) : (
                  <Users className="w-3.5 h-3.5 text-emerald-700" />
                )}
                <span>Giriş Yap</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4 pb-24 md:pb-12">
        {notice && (
          <div
            role="status"
            className="fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto md:max-w-sm z-[60] rounded-xl bg-slate-900 text-white shadow-lg border border-slate-700 px-4 py-2.5 text-xs font-medium"
          >
            {notice}
          </div>
        )}

        {(syncError || authError) && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-700 break-words"
          >
            {syncError || authError}
          </div>
        )}

        {localLegacyCount + legacyCloudCount > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-amber-950">
              Daha önce kişisel olarak kaydedilmiş{' '}
              <span className="font-mono font-semibold">{localLegacyCount + legacyCloudCount}</span>{' '}
              mekan bulundu. Herkesle ortak listeye taşıyabilirsiniz.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleMigrateToShared()}
                disabled={migratingLegacy}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 disabled:opacity-50"
              >
                {migratingLegacy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" />
                )}
                <span>Ortak Listeye Aktar</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocalLegacyCount(0);
                  setLegacyCloudCount(0);
                }}
                className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                Gizle
              </button>
            </div>
          </div>
        )}

        {/* Ana Sekmeler: Lezzet Noktaları / Gitmek İstiyorum | Gizlediklerim */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {actor ? (
              <div
                role="tablist"
                aria-label="Mekan listesi görünümü"
                className="inline-flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 border border-slate-200/80 rounded-2xl self-start max-w-full"
              >
                {(
                  [
                    ['visited', 'Tüm Mekanlar', totalCatalogCount],
                    ['wishlist', 'Gitmek İstiyorum', personalWishlistCount],
                  ] as const
                ).map(([key, label, count]) => {
                  const active = statusFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setStatusFilter(key)}
                      className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 tabular-nums ${
                        active
                          ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/90'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${
                          active
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-slate-200/80 text-slate-700'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}

                <span
                  className="hidden sm:block h-5 w-px bg-slate-300/80 mx-0.5"
                  aria-hidden="true"
                />

                <button
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === 'hidden'}
                  onClick={() => setStatusFilter('hidden')}
                  title="Gitmek İstiyorum listenizden gizlediğiniz kayıtlar"
                  className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 tabular-nums ${
                    statusFilter === 'hidden'
                      ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/90'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <EyeOff className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Gizlediklerim</span>
                  <span
                    className={`inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${
                      statusFilter === 'hidden'
                        ? 'bg-amber-100 text-amber-900'
                        : hiddenWishlistCount > 0
                          ? 'bg-amber-100/80 text-amber-900'
                          : 'bg-slate-200/80 text-slate-700'
                    }`}
                  >
                    {hiddenWishlistCount}
                  </span>
                </button>
              </div>
            ) : (
              <div className="inline-flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-900 tabular-nums">
                  Tüm Mekanlar ({totalCatalogCount})
                </span>
                <span className="text-xs text-slate-500">
                  Kendi değerlendirmeleriniz ve Gitmek İstiyorum listeniz için giriş yapabilirsiniz
                </span>
              </div>
            )}

            <p className="text-xs text-slate-500 tabular-nums shrink-0">
              Gösterilen{' '}
              <span className="font-mono font-semibold text-slate-900">
                {sortedAndFilteredPlaces.length}
              </span>{' '}
              mekan
              {actor && hiddenWishlistCount > 0 && statusFilter === 'wishlist'
                ? ` (${hiddenWishlistCount} gizli hariç)`
                : ''}{' '}
              · {actor ? 'Ortak liste · Bulut senkronize' : 'Ortak liste · Giriş yapmadan görüntüleniyor'}
            </p>
          </div>

          {statusFilter === 'visited' && (
            <div
              role="group"
              aria-label="Mekan listesi alt filtresi"
              className="inline-flex flex-wrap items-center gap-1.5"
            >
              {(
                [
                  ['all', 'Hepsi', totalCatalogCount],
                  ['visited_only', 'Lezzet Noktalarım', visitedCount],
                  ['wishlist_only', 'Gitmek İstenenler', wishlistCatalogCount],
                  ...(actor
                    ? ([
                        ['mine', 'Gittiklerim', mineVisitedCount],
                        ['others', 'Keşfet', othersVisitedCount],
                      ] as const)
                    : []),
                ] as const
              ).map(([key, label, count]) => {
                const active = visitedOwnerFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setVisitedOwnerFilter(key)}
                    className={`min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap tabular-nums ${
                      active
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900 font-semibold'
                        : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`inline-flex items-center justify-center min-w-[18px] px-1 py-0.2 rounded text-[10px] tabular-nums ${
                        active
                          ? 'bg-emerald-100/90 text-emerald-950 font-semibold'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Çoklu Kelime Akıllı Arama + Ürün & Bölge Seçimi + Konumum & Bölgenin En İyileri */}
          <div className="grid grid-cols-2 lg:grid-cols-12 gap-2.5">
            <div className="relative col-span-2 lg:col-span-4">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Canın ne çekiyor?, Nerdesin?, Hangi Mekan?"
                className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="col-span-1 lg:col-span-2">
              <label htmlFor="product-select-filter" className="sr-only">
                Lezzetlere göre filtrele
              </label>
              <select
                id="product-select-filter"
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-base sm:text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="all">Lezzetler</option>
                {productFilterOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                    {opt.count > 0 ? ` (${opt.count})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-1 lg:col-span-2">
              <label htmlFor="region-select-filter" className="sr-only">
                Bölgeye göre filtrele
              </label>
              <select
                id="region-select-filter"
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-base sm:text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="all">Tüm Bölgeler</option>
                {regionFilterOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label} ({opt.count})
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-1 lg:col-span-2">
              <button
                type="button"
                onClick={handleToggleNearMe}
                disabled={locatingUser || locatingBestInArea}
                className={`w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
                  userCoords && !bestInAreaActive
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {locatingUser ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Navigation className="w-4 h-4" />
                )}
                <span>{userCoords && !bestInAreaActive ? 'Yakınımda Aktif' : 'Yakınımdakiler'}</span>
              </button>
            </div>

            <div className="col-span-1 lg:col-span-2">
              <button
                type="button"
                onClick={handleToggleBestInArea}
                disabled={locatingUser || locatingBestInArea}
                title="Bulunduğunuz bölgedeki en yüksek yıldızlı mekanları sırala"
                className={`w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
                  bestInAreaActive
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {locatingBestInArea ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Star
                    className={`w-4 h-4 ${
                      bestInAreaActive ? 'fill-amber-400 text-amber-400' : 'fill-amber-500 text-amber-500'
                    }`}
                  />
                )}
                <span>Bölgenin En İyileri</span>
              </button>
            </div>
          </div>

          {bestInAreaActive && (
            <div className="rounded-xl bg-amber-50/80 border border-amber-200 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
              <div className="flex items-center gap-1.5 min-w-0">
                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                <span>
                  {bestInAreaResult.usedAreaScope ? (
                    <>
                      <span className="font-semibold">
                        {effectiveDetectedArea || 'Bulunduğunuz bölge'}
                      </span>{' '}
                      içindeki en yüksek yıldızlı mekanlar sıralanıyor
                    </>
                  ) : bestInAreaResult.usedGlobalFallback ? (
                    <>
                      Konumunuzdaki bölgede (
                      <span className="font-semibold">{effectiveDetectedArea || '12 km çevre'}</span>)
                      henüz kayıt yok; tüm bölgelerdeki en yüksek puanlılar gösteriliyor
                    </>
                  ) : (
                    <>
                      {regionFilter !== 'all'
                        ? 'Seçili bölgedeki en yüksek yıldızlı mekanlar gösteriliyor'
                        : 'En yüksek yıldızlı mekanlar gösteriliyor'}
                    </>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBestInAreaActive(false);
                  setSortField(userCoords ? 'distance' : 'date');
                  setSortDir(userCoords ? 'asc' : 'desc');
                }}
                className="font-semibold text-amber-900 hover:underline shrink-0"
              >
                Filtreyi Kapat
              </button>
            </div>
          )}

          {/* Hızlı Ürün Çeşidi Seçim Çubuğu */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setProductFilter('all')}
              className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-medium border whitespace-nowrap shrink-0 transition-colors ${
                productFilter === 'all'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
              }`}
            >
              Tümü
            </button>
            {productFilterOptions.map((opt) => {
              const active = productFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setProductFilter(active ? 'all' : opt.key)}
                  className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-medium border whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                    active
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                  {opt.count > 0 ? ` (${opt.count})` : ''}
                </button>
              );
            })}
          </div>

          {/* Çift Yönlü Ürün ↔ Bölge Özeti */}
          {(inferredSearchProduct || inferredSearchRegion) && (
            <div className="rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 space-y-2">
              {inferredSearchProduct && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-slate-700 inline-flex items-center gap-1 mr-1">
                    <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                    {inferredSearchProduct.label} bulunan bölgeler:
                  </span>
                  {regionsForActiveProduct.length === 0 ? (
                    <span className="text-slate-500">Henüz bölge bilgisi eklenmemiş</span>
                  ) : (
                    regionsForActiveProduct.map((reg) => {
                      const active = regionFilter === reg.key;
                      return (
                        <button
                          key={reg.key}
                          type="button"
                          onClick={() => setRegionFilter(active ? 'all' : reg.key)}
                          className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors tabular-nums ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {reg.label} · {reg.count}
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {inferredSearchRegion && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-slate-700 mr-1">
                    {inferredSearchRegion.label} bölgesindeki ürünler:
                  </span>
                  {productsInActiveRegion.length === 0 ? (
                    <span className="text-slate-500">Bu bölgede henüz ürün etiketi yok</span>
                  ) : (
                    productsInActiveRegion.map((prod) => {
                      const active = productFilter === prod.key;
                      return (
                        <button
                          key={prod.key}
                          type="button"
                          onClick={() => setProductFilter(active ? 'all' : prod.key)}
                          className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors tabular-nums ${
                            active
                              ? 'bg-emerald-700 text-white border-emerald-700'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {prod.label} · {prod.count}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {loadingPlaces ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-700" />
            <p className="text-xs text-slate-500">Liste yükleniyor...</p>
          </div>
        ) : sortedAndFilteredPlaces.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 text-center space-y-3.5 max-w-xl mx-auto mt-6">
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
              {allPlaces.length === 0
                ? 'Gittiğiniz ve Gideceğiniz Mekanları Ekleyin'
                : statusFilter === 'visited' &&
                    visitedOwnerFilter === 'mine' &&
                    mineVisitedCount === 0 &&
                    !searchText &&
                    productFilter === 'all' &&
                    regionFilter === 'all'
                  ? 'Henüz Değerlendirdiğiniz Bir Mekan Yok'
                  : statusFilter === 'visited' &&
                      visitedOwnerFilter === 'others' &&
                      othersVisitedCount === 0 &&
                      !searchText &&
                      productFilter === 'all' &&
                      regionFilter === 'all'
                    ? 'Keşfedilecek Yeni Bir Mekan Yok'
                    : statusFilter === 'hidden' &&
                        hiddenWishlistCount === 0 &&
                        !searchText &&
                        productFilter === 'all' &&
                        regionFilter === 'all'
                      ? 'Gizlediğiniz Kayıt Bulunmuyor'
                      : statusFilter === 'wishlist' &&
                          hiddenWishlistCount > 0 &&
                          !searchText &&
                          productFilter === 'all' &&
                          regionFilter === 'all'
                        ? `Gizlediğiniz ${hiddenWishlistCount} Gitmek İstiyorum Mekanı Var`
                        : 'Seçili Filtreye Uygun Mekan Yok'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {allPlaces.length === 0
                ? 'İster gittiğiniz restoran ve lokantaları puanlayın, ister Google Haritalar’dan seçtiğiniz mekanları Gitmek İstiyorum listenize ekleyin.'
                : statusFilter === 'visited' &&
                    visitedOwnerFilter === 'mine' &&
                    mineVisitedCount === 0 &&
                    !searchText &&
                    productFilter === 'all' &&
                    regionFilter === 'all'
                  ? 'Yeni bir lezzet noktası ekleyebilir veya topluluktaki mevcut mekanlara yorum ve puan bırakarak kendi listenizi oluşturabilirsiniz.'
                  : statusFilter === 'visited' &&
                      visitedOwnerFilter === 'others' &&
                      othersVisitedCount === 0 &&
                      !searchText &&
                      productFilter === 'all' &&
                      regionFilter === 'all'
                    ? 'Topluluktaki mevcut lezzet noktalarının tamamını değerlendirmişsiniz veya henüz başka bir kullanıcının eklediği mekan yok.'
                    : statusFilter === 'hidden' &&
                        hiddenWishlistCount === 0 &&
                        !searchText &&
                        productFilter === 'all' &&
                        regionFilter === 'all'
                      ? 'Gitmek İstiyorum listenizden gizlediğiniz mekanlar burada listelenir.'
                      : statusFilter === 'wishlist' &&
                          hiddenWishlistCount > 0 &&
                          !searchText &&
                          productFilter === 'all' &&
                          regionFilter === 'all'
                        ? 'Gitmek İstiyorum listenizdeki kayıtlarınız şu anda Gizlediklerim sekmesinde tutuluyor.'
                        : 'Farklı bir ürün çeşidi, bölge veya liste sekmesi seçebilir ya da yeni bir mekan ekleyebilirsiniz.'}
            </p>
            <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
              {actor && hiddenWishlistCount > 0 && statusFilter === 'wishlist' && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('hidden')}
                  className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs sm:text-sm font-semibold hover:bg-amber-100 transition-colors"
                >
                  <Eye className="w-4 h-4 text-amber-700" />
                  <span>Gizlediklerim&apos;e Git ({hiddenWishlistCount})</span>
                </button>
              )}
              {actor && statusFilter === 'hidden' && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('wishlist')}
                  className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors"
                >
                  <span>Gitmek İstiyorum&apos;a Dön</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{statusFilter === 'wishlist' ? 'Gitmek İstediğim Yer Ekle' : 'Yeni Mekan Ekle'}</span>
              </button>
              {(productFilter !== 'all' ||
                regionFilter !== 'all' ||
                searchText ||
                statusFilter !== 'visited' ||
                visitedOwnerFilter !== 'all' ||
                bestInAreaActive) && (
                <button
                  type="button"
                  onClick={() => {
                    setProductFilter('all');
                    setRegionFilter('all');
                    setSearchText('');
                    setStatusFilter('visited');
                    setVisitedOwnerFilter('all');
                    setBestInAreaActive(false);
                  }}
                  className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors"
                >
                  Filtreleri Temizle
                </button>
              )}
              <a
                href="https://www.google.com/maps"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-100 transition-colors"
              >
                <span>Google Haritalar&apos;dan Seç</span>
                <ExternalLink className="w-4 h-4 text-emerald-700" />
              </a>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop / Tablet Clean Sortable Table */}
            <div className="hidden md:block rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                      <th scope="col" className="py-3 px-3 lg:px-4 w-[19%]">
                        <button
                          type="button"
                          onClick={() => handleSort('name')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1 whitespace-nowrap"
                        >
                          <span>Mekan Adı</span>
                          {renderSortIcon('name')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-3 lg:px-4 w-[13%]">
                        <button
                          type="button"
                          onClick={() => handleSort('product')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1 whitespace-nowrap"
                        >
                          <span>Ürün Çeşidi</span>
                          {renderSortIcon('product')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-3 lg:px-4 w-[12%]">
                        <button
                          type="button"
                          onClick={() => handleSort('rating')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1 whitespace-nowrap"
                        >
                          <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                          <span>Lokanta Puanı</span>
                          {renderSortIcon('rating')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-3 lg:px-4 w-[11%]">
                        <button
                          type="button"
                          onClick={() => handleSort('price')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1 whitespace-nowrap"
                        >
                          <BadgeTurkishLira className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          <span>Fiyat Puanı</span>
                          {renderSortIcon('price')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-3 lg:px-4 w-[14%]">
                        <button
                          type="button"
                          onClick={() => handleSort(userCoords ? 'distance' : 'location')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1 whitespace-nowrap"
                        >
                          <span>{userCoords ? 'Bölge / Mesafe' : 'Bölge & Konum'}</span>
                          {renderSortIcon(userCoords ? 'distance' : 'location')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-3 lg:px-4">
                        <button
                          type="button"
                          onClick={() => handleSort('comment')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1 whitespace-nowrap"
                        >
                          <span>Yorum / Not</span>
                          {renderSortIcon('comment')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-3 lg:px-4 w-[148px] text-right">
                        <button
                          type="button"
                          onClick={() => handleSort('date')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 py-1 whitespace-nowrap"
                        >
                          <span>Tarih</span>
                          {renderSortIcon('date')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {sortedAndFilteredPlaces.map(({ place, distanceKm }) => {
                      const hasLink = Boolean(place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl));
                      const hasPromoLink = Boolean(place.promoUrl && /^https?:\/\//i.test(place.promoUrl));
                      const promoPlatform =
                        hasPromoLink && place.promoUrl ? getPromoPlatformLabel(place.promoUrl) : null;
                      const canDeletePlace = actor
                        ? place.ownerId === actor.uid
                        : isLocalDeviceRecord(place.ownerId);
                      const isWishlist = place.visitStatus === 'wishlist' && place.reviewCount === 0;
                      const isMyReviewed = actor
                        ? (place.ownerId === actor.uid && place.visitStatus === 'visited') ||
                          myReviewedPlaceIds.has(place.id)
                        : false;
                      const canToggleAsWishlist = !isMyReviewed;
                      const isMarkedWishlist = actor ? myWishlistPlaceIds.has(place.id) : false;
                      const isHidden = actor ? isMarkedWishlist && hiddenWishlistSet.has(place.id) : false;
                      const isTogglingWishlist = togglingWishlistId === place.id;
                      return (
                        <tr
                          key={`${place.id}-${isWishlist ? 'w' : 'v'}`}
                          className={`hover:bg-slate-50/80 transition-colors align-top ${
                            isHidden ? 'opacity-65' : ''
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => setDetailPlace(place)}
                              className="text-left group focus-visible:outline-none"
                            >
                              <div className="flex items-center gap-2.5">
                                {place.coverImage && (
                                  <img
                                    src={place.coverImage}
                                    alt={place.name}
                                    referrerPolicy="no-referrer"
                                    className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                                  />
                                )}
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors">
                                    {place.name}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {CATEGORY_LABELS[place.category]}
                                  </p>
                                  <p className="text-[11px] text-slate-400 truncate max-w-[190px]">
                                    Ekleyen: {place.authorName}
                                    {actor && place.ownerId === actor.uid ? ' (Siz)' : ''}
                                    {actor &&
                                      place.ownerId !== actor.uid &&
                                      myReviewedPlaceIds.has(place.id) && (
                                        <span className="text-emerald-700 font-medium">
                                          {' '}
                                          · Değerlendirdiniz
                                        </span>
                                      )}
                                  </p>
                                </div>
                              </div>
                            </button>
                          </td>

                          <td className="py-3.5 px-4">
                            <p className="text-xs font-medium text-slate-800">
                              {place.cuisineTypes.length > 0
                                ? place.cuisineTypes.join(', ')
                                : CATEGORY_LABELS[place.category]}
                            </p>
                            {place.cuisineTypes.length === 0 && (
                              <button
                                type="button"
                                onClick={() => setDetailPlace(place)}
                                className="text-[11px] text-emerald-700 hover:underline mt-0.5"
                              >
                                Ürün çeşidi ekle
                              </button>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            {isWishlist ? (
                              <span className="text-xs font-semibold text-amber-700">
                                {isHidden ? 'Gitmek İstiyorum (Gizli)' : 'Gitmek İstiyorum'}
                              </span>
                            ) : (
                              <>
                                {renderStars(place.avgRating)}
                                {place.reviewCount > 1 && (
                                  <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                                    {place.reviewCount} yorum
                                  </p>
                                )}
                              </>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            {isWishlist ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : (
                              <PriceRatingDisplay
                                rating={place.avgPriceRating}
                                count={place.priceRatingCount}
                              />
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="space-y-0.5">
                              {place.locationArea && (
                                <p className="text-xs font-medium text-slate-800">
                                  {place.locationArea}
                                </p>
                              )}
                              {distanceKm !== null && (
                                <p className="font-mono text-[11px] text-emerald-700 tabular-nums">
                                  {formatDistanceLabel(distanceKm)}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                {hasLink ? (
                                  <a
                                    href={place.mapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Lokasyonu Haritada Aç"
                                    aria-label={`${place.name} - Lokasyonu haritada aç`}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 shadow-xs transition-all hover:scale-105"
                                  >
                                    <MapPin className="w-4 h-4" />
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setDetailPlace(place)}
                                    className="text-xs text-slate-400 hover:text-emerald-700 py-0.5"
                                  >
                                    {place.locationArea ? 'Link ekle' : 'Bölge / link ekle'}
                                  </button>
                                )}
                                {hasPromoLink && place.promoUrl && (
                                  <a
                                    href={place.promoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={promoPlatform ? `${promoPlatform} bağlantısını aç` : 'Web bağlantısını aç'}
                                    aria-label={
                                      promoPlatform
                                        ? `${place.name} - ${promoPlatform} bağlantısını aç`
                                        : `${place.name} - bağlantıyı aç`
                                    }
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 shadow-xs transition-all hover:scale-105"
                                  >
                                    <PromoPlatformIcon url={place.promoUrl} className="w-4 h-4" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => setDetailPlace(place)}
                              className="text-left w-full group focus-visible:outline-none"
                            >
                              <p className="text-sm text-slate-700 line-clamp-2 group-hover:text-slate-900">
                                {place.latestComment ||
                                  (isWishlist
                                    ? 'Gidildi olarak işaretlemek için dokunun'
                                    : 'Yorum eklemek için dokunun')}
                              </p>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 group-hover:text-emerald-700 mt-1">
                                {place.coverImage && <ImageIcon className="w-3 h-3" />}
                                <span>{isWishlist ? 'Detay / Puanla' : 'Detay / Yorum Ekle'}</span>
                              </span>
                            </button>
                          </td>

                          <td className="py-3.5 px-3 lg:px-4 text-right">
                            <div className="flex flex-col items-end gap-1.5">
                              <div className="inline-flex items-center justify-end gap-1">
                                <span className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                                  {new Date(place.updatedAt).toLocaleDateString('tr-TR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                  })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleSharePlace(place)}
                                  title="Paylaş"
                                  aria-label={`${place.name} mekânını paylaş`}
                                  className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                                >
                                  <Share2 className="w-3.5 h-3.5" />
                                </button>
                                {canDeletePlace && (
                                  <button
                                    type="button"
                                    onClick={() => void removePlace(actor, place.id, isWishlist)}
                                    aria-label={`${place.name} kaydını sil`}
                                    className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                              {actor && isMarkedWishlist && (
                                <button
                                  type="button"
                                  onClick={() => void handleToggleHiddenWishlist(place.id, !isHidden)}
                                  title={
                                    isHidden
                                      ? 'Gitmek İstiyorum listemde tekrar göster'
                                      : 'Gitmek İstiyorum listemde gizle'
                                  }
                                  aria-label={
                                    isHidden ? `${place.name} kaydını göster` : `${place.name} kaydını gizle`
                                  }
                                  className={`min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors ${
                                    isHidden
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                      : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-50'
                                  }`}
                                >
                                  {isHidden ? (
                                    <>
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>Göster</span>
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="w-3.5 h-3.5" />
                                      <span>Gizle</span>
                                    </>
                                  )}
                                </button>
                              )}
                              {canToggleAsWishlist && (
                                <button
                                  type="button"
                                  disabled={isTogglingWishlist}
                                  onClick={() => void handleTogglePlaceWishlist(place)}
                                  title={
                                    isMarkedWishlist
                                      ? 'Gitmek İstiyorum listemde — kaldırmak için tıklayın'
                                      : 'Bu mekanı Gitmek İstiyorum listeme ekle'
                                  }
                                  aria-label={
                                    isMarkedWishlist
                                      ? `${place.name} kaydını Gitmek İstiyorum listemden çıkar`
                                      : `${place.name} kaydını Gitmek İstiyorum olarak işaretle`
                                  }
                                  className={`min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors disabled:opacity-50 ${
                                    isMarkedWishlist
                                      ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                      : 'bg-white text-slate-600 border-slate-200 hover:text-amber-800 hover:border-amber-200 hover:bg-amber-50/70'
                                  }`}
                                >
                                  {isTogglingWishlist ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                                  ) : isMarkedWishlist ? (
                                    <BookmarkCheck className="w-3.5 h-3.5 text-amber-700" />
                                  ) : (
                                    <BookmarkPlus className="w-3.5 h-3.5 text-amber-700" />
                                  )}
                                  <span>{isMarkedWishlist ? 'Listemde' : 'Gitmek İstiyorum'}</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Sort Header Bar + Clean List Rows */}
            <div className="md:hidden space-y-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {(
                  [
                    ...(userCoords ? ([['distance', 'Mesafe']] as const) : []),
                    ['name', 'Mekan Adı'],
                    ['product', 'Ürün Çeşidi'],
                    ['location', 'Bölge'],
                    ['rating', 'Lokanta Puanı'],
                    ['price', 'Fiyat Puanı'],
                    ['date', 'Tarih'],
                  ] as const
                ).map(([field, label]) => {
                  const active = sortField === field;
                  return (
                    <button
                      key={field}
                      type="button"
                      onClick={() => handleSort(field)}
                      className={`min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200'
                      }`}
                    >
                      {field === 'rating' && (
                        <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                      )}
                      {field === 'price' && (
                        <BadgeTurkishLira
                          className={`w-3.5 h-3.5 shrink-0 ${
                            active ? 'text-emerald-300' : 'text-emerald-700'
                          }`}
                        />
                      )}
                      <span>{label}</span>
                      {active ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDown className="w-3.5 h-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {sortedAndFilteredPlaces.map(({ place, distanceKm }) => {
                  const hasLink = Boolean(place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl));
                  const hasPromoLink = Boolean(place.promoUrl && /^https?:\/\//i.test(place.promoUrl));
                  const promoPlatform =
                    hasPromoLink && place.promoUrl ? getPromoPlatformLabel(place.promoUrl) : null;
                  const canDeletePlace = actor
                    ? place.ownerId === actor.uid
                    : isLocalDeviceRecord(place.ownerId);
                  const isWishlist = place.visitStatus === 'wishlist' && place.reviewCount === 0;
                  const isMyReviewed = actor
                    ? (place.ownerId === actor.uid && place.visitStatus === 'visited') ||
                      myReviewedPlaceIds.has(place.id)
                    : false;
                  const canToggleAsWishlist = !isMyReviewed;
                  const isMarkedWishlist = actor ? myWishlistPlaceIds.has(place.id) : false;
                  const isHidden = actor ? isMarkedWishlist && hiddenWishlistSet.has(place.id) : false;
                  const isTogglingWishlist = togglingWishlistId === place.id;
                  return (
                    <div
                      key={`${place.id}-${isWishlist ? 'w' : 'v'}`}
                      className={`p-3.5 space-y-2 ${isHidden ? 'opacity-65' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setDetailPlace(place)}
                          className="min-w-0 flex-1 text-left flex items-center gap-2.5"
                        >
                          {place.coverImage && (
                            <img
                              src={place.coverImage}
                              alt={place.name}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">
                              {place.name}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {CATEGORY_LABELS[place.category]}
                              {place.locationArea ? ` · ${place.locationArea}` : ''}
                              {distanceKm !== null ? ` · ${formatDistanceLabel(distanceKm)}` : ''}
                              {place.cuisineType ? ` · ${place.cuisineType}` : ''}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              Ekleyen: {place.authorName}
                              {actor && place.ownerId === actor.uid ? ' (Siz)' : ''}
                              {actor &&
                                place.ownerId !== actor.uid &&
                                myReviewedPlaceIds.has(place.id) && (
                                  <span className="text-emerald-700 font-medium">
                                    {' '}
                                    · Değerlendirdiniz
                                  </span>
                                )}
                            </p>
                          </div>
                        </button>

                        <div className="shrink-0 pt-0.5 flex flex-col items-end gap-1">
                          {isWishlist ? (
                            <span className="text-xs font-semibold text-amber-700">
                              {isHidden ? 'Gizli' : 'Gitmek İstiyorum'}
                            </span>
                          ) : (
                            <>
                              {renderStars(place.avgRating)}
                              <PriceRatingDisplay
                                rating={place.avgPriceRating}
                                count={place.priceRatingCount}
                              />
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setDetailPlace(place)}
                        className="w-full text-left"
                      >
                        <p className="text-xs text-slate-700 leading-relaxed line-clamp-2">
                          {place.latestComment ||
                            (isWishlist
                              ? 'Gidildi olarak işaretlemek için dokunun'
                              : 'Yorum eklemek için dokunun')}
                        </p>
                      </button>

                      <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                        <div className="flex items-center gap-3 flex-wrap">
                          {hasLink ? (
                            <a
                              href={place.mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Lokasyonu Aç"
                              aria-label={`${place.name} - Lokasyonu aç`}
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100 shadow-xs transition-transform active:scale-95"
                            >
                              <MapPin className="w-[18px] h-[18px]" />
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDetailPlace(place)}
                              className="min-h-[36px] text-xs text-slate-400 hover:text-emerald-700"
                            >
                              Bölge / link ekle
                            </button>
                          )}
                          {hasPromoLink && place.promoUrl && (
                            <a
                              href={place.promoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={promoPlatform ? `${promoPlatform} bağlantısını aç` : 'Web bağlantısını aç'}
                              aria-label={
                                promoPlatform
                                  ? `${place.name} - ${promoPlatform} bağlantısını aç`
                                  : `${place.name} - bağlantıyı aç`
                              }
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 shadow-xs transition-transform active:scale-95"
                            >
                              <PromoPlatformIcon url={place.promoUrl} className="w-[18px] h-[18px]" />
                            </a>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {canToggleAsWishlist && (
                            <button
                              type="button"
                              disabled={isTogglingWishlist}
                              onClick={() => void handleTogglePlaceWishlist(place)}
                              aria-label={
                                isMarkedWishlist
                                  ? `${place.name} kaydını Gitmek İstiyorum listemden çıkar`
                                  : `${place.name} kaydını Gitmek İstiyorum olarak işaretle`
                              }
                              className={`min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                                isMarkedWishlist
                                  ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                  : 'bg-white text-slate-600 border-slate-200 hover:text-amber-800 hover:border-amber-200 hover:bg-amber-50/70'
                              }`}
                            >
                              {isTogglingWishlist ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                              ) : isMarkedWishlist ? (
                                <BookmarkCheck className="w-3.5 h-3.5 text-amber-700" />
                              ) : (
                                <BookmarkPlus className="w-3.5 h-3.5 text-amber-700" />
                              )}
                              <span>{isMarkedWishlist ? 'Listemde' : 'Gitmek İstiyorum'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDetailPlace(place)}
                            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                          >
                            {isWishlist ? 'Detay / Puanla' : `Yorumlar (${place.reviewCount})`}
                          </button>
                          {actor && isMarkedWishlist && (
                            <button
                              type="button"
                              onClick={() => void handleToggleHiddenWishlist(place.id, !isHidden)}
                              aria-label={
                                isHidden ? `${place.name} kaydını göster` : `${place.name} kaydını gizle`
                              }
                              className={`min-h-[38px] inline-flex items-center gap-1 px-2.5 rounded-lg text-xs font-medium border transition-colors ${
                                isHidden
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              {isHidden ? (
                                <>
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Göster</span>
                                </>
                              ) : (
                                <>
                                  <EyeOff className="w-3.5 h-3.5" />
                                  <span>Gizle</span>
                                </>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleSharePlace(place)}
                            aria-label={`${place.name} mekânını paylaş`}
                            className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:text-emerald-700 hover:border-emerald-200 hover:bg-emerald-50/70 transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Paylaş</span>
                          </button>
                          {canDeletePlace && (
                            <button
                              type="button"
                              onClick={() => void removePlace(actor, place.id, isWishlist)}
                              aria-label={`${place.name} kaydını sil`}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      {showAddModal && (
        <AddPlaceModal
          actor={actor}
          defaultVisitStatus={
            actor && (statusFilter === 'wishlist' || statusFilter === 'hidden')
              ? 'wishlist'
              : 'visited'
          }
          knownRegions={knownRegions}
          existingPlaces={allPlaces}
          myWishlistPlaceIds={myWishlistPlaceIds}
          myReviewedPlaceIds={myReviewedPlaceIds}
          onSelectExistingPlace={(existing, options) => {
            setShowAddModal(false);
            setDetailDraftOptions(options || null);
            setDetailPlace(existing);
          }}
          onAddExistingToWishlist={async (existing) => {
            await handleTogglePlaceWishlist(existing);
            if (actor) {
              setShowAddModal(false);
            }
          }}
          onRequestSignIn={() => void handleSignIn()}
          onClose={() => setShowAddModal(false)}
          onCreated={(createdId, createdStatus, hideInWishlist) => {
            setShowAddModal(false);
            if (actor && createdStatus === 'wishlist' && hideInWishlist) {
              void handleToggleHiddenWishlist(createdId, true);
              setStatusFilter('hidden');
              return;
            }
            if (actor) {
              if (createdStatus === 'visited') {
                setStatusFilter('visited');
                if (visitedOwnerFilter === 'others') {
                  setVisitedOwnerFilter('mine');
                }
              } else {
                setStatusFilter('wishlist');
              }
            }
          }}
        />
      )}

      {liveDetailPlace && (
        <PlaceDetailSheet
          key={liveDetailPlace.id}
          actor={actor}
          place={liveDetailPlace}
          isHiddenInWishlist={
            actor ? myWishlistPlaceIds.has(liveDetailPlace.id) && hiddenWishlistSet.has(liveDetailPlace.id) : false
          }
          isInUserWishlist={actor ? myWishlistPlaceIds.has(liveDetailPlace.id) : false}
          initialShowReviewForm={Boolean(detailDraftOptions?.openReviewForm)}
          initialReviewRating={detailDraftOptions?.rating ?? 5}
          initialReviewPriceRating={detailDraftOptions?.priceRating ?? 3}
          initialReviewComment={detailDraftOptions?.comment ?? ''}
          onToggleHiddenWishlist={actor ? handleToggleHiddenWishlist : undefined}
          onToggleUserWishlist={actor ? handleTogglePlaceWishlist : undefined}
          onRequestSignIn={() => void handleSignIn()}
          onClose={handleCloseDetailPlace}
          onDeleted={handleCloseDetailPlace}
        />
      )}

      {/* Thumb-friendly Mobile Bottom App Bar (iPhone & Mobile Web) */}
      <nav
        aria-label="Mobil hızlı işlemler"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="h-14 px-3 flex items-center justify-around gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-100 transition-colors"
          >
            <Download className="w-4 h-4 text-emerald-700" />
            <span>Yedekle</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="min-h-[44px] flex-[1.5] inline-flex items-center justify-center gap-1.5 px-4 rounded-xl bg-emerald-700 text-white text-sm font-semibold shadow-sm hover:bg-emerald-800 active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Yeni Ekle</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-100 transition-colors"
          >
            <Upload className="w-4 h-4 text-emerald-700" />
            <span>Yükle</span>
          </button>
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
