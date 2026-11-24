import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

function formatFriendlyError(rawMessage: string): string {
  if (!rawMessage) return 'Beklenmeyen bir hata oluştu.';
  if (rawMessage.includes('Quota exceeded')) {
    return 'Ücretsiz günlük Firestore kullanım kotası aşıldı. Kota ertesi gün sıfırlanır.';
  }
  try {
    const parsed = JSON.parse(rawMessage) as { error?: string };
    if (parsed?.error) {
      if (parsed.error.includes('Quota exceeded')) {
        return 'Ücretsiz günlük Firestore kullanım kotası aşıldı. Kota ertesi gün sıfırlanır.';
      }
      if (parsed.error.includes('Missing or insufficient permissions')) {
        return 'Veritabanı erişim yetkisi doğrulanamadı. Lütfen Google hesabınızla tekrar giriş yapın.';
      }
      return parsed.error;
    }
  } catch {
    // Plain error string
  }
  return rawMessage;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: formatFriendlyError(error.message),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uygulama Hatası:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Bir sorun oluştu</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Sayfayı Yenile
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
