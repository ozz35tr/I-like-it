import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, isInAppBrowser, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-xl border border-emerald-700/20 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{compact ? 'Yükle' : 'Uygulamayı Yükle'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Share className="w-3.5 h-3.5 shrink-0 text-emerald-700" />
          <span>Ana Ekrana Ekle</span>
        </button>

        {showIOSGuide &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ios-install-title"
              onClick={() => setShowIOSGuide(false)}
            >
              <div
                className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl bg-white p-6 pb-safe shadow-2xl border border-slate-200"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sm:hidden pb-3 -mt-2 flex justify-center">
                  <div className="w-10 h-1.5 rounded-full bg-slate-300" />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <h3 id="ios-install-title" className="text-lg font-semibold text-slate-900">
                    iPhone’a Uygulama Olarak Ekle
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowIOSGuide(false)}
                    className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                    aria-label="Kapat"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {isInAppBrowser && (
                  <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950 leading-relaxed">
                    Şu an uygulama içi tarayıcıdasınız. Bu adresi kopyalayıp doğrudan{' '}
                    <strong>Safari</strong>’de açtıktan sonra aşağıdaki adımları uygulayın.
                  </div>
                )}

                <ol className="mt-3.5 space-y-2.5 text-sm text-slate-600 list-decimal list-inside leading-relaxed">
                  <li>
                    Sayfayı <strong>Safari</strong> ile açtığınızdan emin olun.
                  </li>
                  <li>
                    Alt (veya üst) araç çubuğundaki <strong>Paylaş</strong> simgesine (yukarı ok
                    çıkan kare) dokunun.
                  </li>
                  <li>
                    Açılan menüyü yukarı kaydırıp <strong>Ana Ekrana Ekle</strong> seçeneğine
                    dokunun.
                  </li>
                  <li>
                    Sağ üstten <strong>Ekle</strong> deyin. Ana ekranınızdaki{' '}
                    <strong>MekanNotu</strong> ikonuyla tam ekran açılacaktır.
                  </li>
                </ol>

                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="mt-5 w-full min-h-[46px] rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 transition-colors"
                >
                  Anladım
                </button>
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }

  return null;
};
