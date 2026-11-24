import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
  CloudUpload,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { AddPlaceModal } from './components/AddPlaceModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PlaceDetailSheet } from './components/PlaceDetailSheet';
import { PWAInstallButton } from './components/PWAInstallButton';
import { auth, googleProvider } from './lib/firebase';
import {
  clearLegacyLocalDatabase,
  exportDatabaseBackup as exportLocalBackup,
  listPlaces as listLocalIndexedDbPlaces,
} from './lib/localDb';
import {
  exportBackup,
  importBackup,
  removePlace,
  subscribeUserOrLocalPlaces,
} from './lib/placeRepository';
import { importBackupToFirestore } from './lib/placesService';
import {
  CATEGORY_LABELS,
  type PlaceItem,
  type SortDirection,
  type SortField,
} from './types/place';

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [allPlaces, setAllPlaces] = useState<PlaceItem[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');

  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const [detailPlace, setDetailPlace] = useState<PlaceItem | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localLegacyCount, setLocalLegacyCount] = useState(0);
  const [migratingLocal, setMigratingLocal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void getRedirectResult(auth).catch((err) => {
      if (err instanceof Error && err.message) {
        setAuthError(`Giriş tamamlanamadı: ${err.message}`);
      }
    });

    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    setLoadingPlaces(true);
    setSyncError(null);

    const activeUid = authReady && user ? user.uid : null;
    const unsub = subscribeUserOrLocalPlaces(
      activeUid,
      (places) => {
        setAllPlaces(places);
        setLoadingPlaces(false);
      },
      (err) => {
        setLoadingPlaces(false);
        if (err.message.includes('Quota exceeded')) {
          setSyncError(
            'Ücretsiz günlük Firestore kullanım kotası doldu. Kota yarın sıfırlanır.'
          );
        } else {
          setSyncError('Veriler yüklenirken bir hata oluştu.');
        }
      }
    );

    if (activeUid) {
      void listLocalIndexedDbPlaces()
        .then((localItems) => {
          setLocalLegacyCount(localItems.length);
        })
        .catch(() => {
          setLocalLegacyCount(0);
        });
    } else {
      setLocalLegacyCount(0);
    }

    return () => unsub();
  }, [authReady, user]);

  const liveDetailPlace = useMemo(() => {
    if (!detailPlace) return null;
    return allPlaces.find((p) => p.id === detailPlace.id) || null;
  }, [allPlaces, detailPlace]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code || '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          setAuthError(
            redirectErr instanceof Error
              ? `Giriş yapılamadı: ${redirectErr.message}`
              : 'Google ile giriş yapılamadı.'
          );
        }
      } else if (code === 'auth/popup-closed-by-user') {
        setAuthError('Giriş penceresi kapatıldı. Devam etmek için tekrar deneyin.');
      } else {
        setAuthError(
          err instanceof Error
            ? `Giriş yapılamadı: ${err.message}`
            : 'Google ile giriş yapılamadı.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setDetailPlace(null);
  };

  const handleMigrateLocalToCloud = async () => {
    if (!user) return;
    setMigratingLocal(true);
    try {
      const localPayload = await exportLocalBackup();
      const imported = await importBackupToFirestore(user.uid, JSON.stringify(localPayload));
      await clearLegacyLocalDatabase();
      setLocalLegacyCount(0);
      setNotice(`${imported} yerel kayıt bulut hesabınıza aktarıldı.`);
      window.setTimeout(() => setNotice(null), 3500);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Yerel kayıtlar aktarılamadı.');
    } finally {
      setMigratingLocal(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'rating' || field === 'date' ? 'desc' : 'asc');
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

  const sortedAndFilteredPlaces = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const filtered = q
      ? allPlaces.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.latestComment || '').toLowerCase().includes(q) ||
            CATEGORY_LABELS[p.category].toLowerCase().includes(q)
        )
      : allPlaces;

    const factor = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case 'name':
          return a.name.localeCompare(b.name, 'tr') * factor;
        case 'rating':
          return (a.avgRating - b.avgRating || a.reviewCount - b.reviewCount) * factor;
        case 'location':
          return (a.mapsUrl || '').localeCompare(b.mapsUrl || '', 'tr') * factor;
        case 'comment':
          return (a.latestComment || '').localeCompare(b.latestComment || '', 'tr') * factor;
        case 'date':
        default:
          return (a.updatedAt - b.updatedAt) * factor;
      }
    });
  }, [allPlaces, searchText, sortField, sortDir]);

  const handleExport = async () => {
    const payload = await exportBackup(user?.uid);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mekannotu-yedek-${new Date().toISOString().slice(0, 10)}.json`;
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
      const count = await importBackup(user?.uid, text);
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
            <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap">
              MekanNotu
            </span>
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
                title="İsteğe bağlı: Cihazlar arası eşitleme için Google ile bağlan"
                className="min-h-[40px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {signingIn ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                ) : (
                  <LogIn className="w-3.5 h-3.5 text-emerald-700" />
                )}
                <span className="hidden sm:inline">Bulut Eşitle</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4 pb-24 md:pb-12">
        {notice && (
          <div
            role="status"
            className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs font-medium text-emerald-800"
          >
            {notice}
          </div>
        )}

        {(syncError || authError) && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-700"
          >
            {syncError || authError}
          </div>
        )}

        {localLegacyCount > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-amber-950">
              Bu cihazda daha önce yerel olarak kaydedilmiş{' '}
              <span className="font-mono font-semibold">{localLegacyCount}</span> mekan bulundu.
              Mobilde de görmek için buluta aktarabilirsiniz.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleMigrateLocalToCloud()}
                disabled={migratingLocal}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 disabled:opacity-50"
              >
                {migratingLocal ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" />
                )}
                <span>Buluta Aktar</span>
              </button>
              <button
                type="button"
                onClick={() => setLocalLegacyCount(0)}
                className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                Gizle
              </button>
            </div>
          </div>
        )}

        {/* Search & Count */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Restoran adı veya yorumlarda ara..."
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <p className="text-xs text-slate-500 tabular-nums shrink-0">
            Toplam{' '}
            <span className="font-mono font-semibold text-slate-900">
              {sortedAndFilteredPlaces.length}
            </span>{' '}
            mekan · {user ? 'Bulut senkronize' : 'Bu cihazda kayıtlı'}
          </p>
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
                ? 'Gittiğiniz Mekanları Listeye Ekleyin'
                : 'Aramanızla Eşleşen Mekan Yok'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {allPlaces.length === 0
                ? 'Giriş veya izin gerekmeden hemen mekan ekleyebilirsiniz. İsterseniz üstteki Bulut Eşitle seçeneğiyle cihazlar arası da eşitleyebilirsiniz.'
                : 'Farklı bir kelime deneyebilir veya arama kutusunu temizleyebilirsiniz.'}
            </p>
            <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Yeni Mekan Ekle</span>
              </button>
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
                      <th scope="col" className="py-3 px-4 w-[24%]">
                        <button
                          type="button"
                          onClick={() => handleSort('name')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1"
                        >
                          <span>Restoran / Mekan Adı</span>
                          {renderSortIcon('name')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-4 w-[16%]">
                        <button
                          type="button"
                          onClick={() => handleSort('rating')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1"
                        >
                          <span>Puan</span>
                          {renderSortIcon('rating')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-4 w-[18%]">
                        <button
                          type="button"
                          onClick={() => handleSort('location')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1"
                        >
                          <span>Lokasyon</span>
                          {renderSortIcon('location')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => handleSort('comment')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 py-1"
                        >
                          <span>Yorumlar</span>
                          {renderSortIcon('comment')}
                        </button>
                      </th>
                      <th scope="col" className="py-3 px-4 w-[92px] text-right">
                        <button
                          type="button"
                          onClick={() => handleSort('date')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 py-1"
                        >
                          <span>Tarih</span>
                          {renderSortIcon('date')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {sortedAndFilteredPlaces.map((place) => {
                      const hasLink = Boolean(place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl));
                      return (
                        <tr
                          key={place.id}
                          className="hover:bg-slate-50/80 transition-colors align-top"
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
                                </div>
                              </div>
                            </button>
                          </td>

                          <td className="py-3.5 px-4">
                            {renderStars(place.avgRating)}
                            {place.reviewCount > 1 && (
                              <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                                {place.reviewCount} yorum
                              </p>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            {hasLink ? (
                              <a
                                href={place.mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline py-1"
                              >
                                <span>Haritada Aç</span>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDetailPlace(place)}
                                className="text-xs text-slate-400 hover:text-emerald-700 py-1"
                              >
                                Link eklenmedi
                              </button>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => setDetailPlace(place)}
                              className="text-left w-full group focus-visible:outline-none"
                            >
                              <p className="text-sm text-slate-700 line-clamp-2 group-hover:text-slate-900">
                                {place.latestComment || 'Yorum eklemek için dokunun'}
                              </p>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 group-hover:text-emerald-700 mt-1">
                                {place.coverImage && <ImageIcon className="w-3 h-3" />}
                                <span>Detay / Yorum Ekle</span>
                              </span>
                            </button>
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1">
                              <span className="font-mono text-xs text-slate-400 tabular-nums">
                                {new Date(place.updatedAt).toLocaleDateString('tr-TR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                })}
                              </span>
                              <button
                                type="button"
                                onClick={() => void removePlace(user?.uid, place.id)}
                                aria-label={`${place.name} kaydını sil`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
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
                    ['name', 'Mekan Adı'],
                    ['rating', 'Puan'],
                    ['comment', 'Yorumlar'],
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
                {sortedAndFilteredPlaces.map((place) => {
                  const hasLink = Boolean(place.mapsUrl && /^https?:\/\//i.test(place.mapsUrl));
                  return (
                    <div key={place.id} className="p-3.5 space-y-2">
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
                            <p className="text-[11px] text-slate-500">
                              {CATEGORY_LABELS[place.category]}
                            </p>
                          </div>
                        </button>

                        <div className="shrink-0 pt-0.5">{renderStars(place.avgRating)}</div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setDetailPlace(place)}
                        className="w-full text-left"
                      >
                        <p className="text-xs text-slate-700 leading-relaxed line-clamp-2">
                          {place.latestComment || 'Yorum eklemek için dokunun'}
                        </p>
                      </button>

                      <div className="flex items-center justify-between gap-2 pt-1">
                        {hasLink ? (
                          <a
                            href={place.mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                          >
                            <span>Lokasyonu Aç</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDetailPlace(place)}
                            className="min-h-[36px] text-xs text-slate-400 hover:text-emerald-700"
                          >
                            Link eklenmedi
                          </button>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailPlace(place)}
                            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                          >
                            Yorumlar ({place.reviewCount})
                          </button>
                          <button
                            type="button"
                            onClick={() => void removePlace(user?.uid, place.id)}
                            aria-label={`${place.name} kaydını sil`}
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
          userId={user?.uid}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
          }}
        />
      )}

      {liveDetailPlace && (
        <PlaceDetailSheet
          userId={user?.uid}
          place={liveDetailPlace}
          onClose={() => setDetailPlace(null)}
          onDeleted={() => setDetailPlace(null)}
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
