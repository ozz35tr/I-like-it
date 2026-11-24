import React, { useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, X } from 'lucide-react';
import { compressImageFile } from '../lib/imageUtils';
import { STORAGE_LIMITS } from '../types/place';

interface PhotoUploaderProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  maxPhotos?: number;
}

export const PhotoUploader: React.FC<PhotoUploaderProps> = ({
  photos,
  onChange,
  maxPhotos = STORAGE_LIMITS.MAX_PHOTOS,
}) => {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setIsProcessing(true);

    try {
      const remaining = maxPhotos - photos.length;
      const selected = Array.from(files).slice(0, remaining);
      const compressed: string[] = [];

      for (const file of selected) {
        const dataUrl = await compressImageFile(file);
        compressed.push(dataUrl);
      }

      onChange([...photos, ...compressed].slice(0, maxPhotos));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf yüklenirken hata oluştu.');
    } finally {
      setIsProcessing(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const removePhoto = (index: number) => {
    onChange(photos.filter((_, idx) => idx !== index));
  };

  const canAddMore = photos.length < maxPhotos;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">
          Fotoğraflar (en fazla {maxPhotos})
        </span>
        <span className="font-mono text-xs text-slate-400 tabular-nums">
          {photos.length}/{maxPhotos}
        </span>
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          {photos.map((src, idx) => (
            <div
              key={idx}
              className="relative aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-100"
            >
              <img
                src={src}
                alt={`Yüklenen fotoğraf ${idx + 1}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(idx)}
                aria-label="Fotoğrafı kaldır"
                className="absolute top-1.5 right-1.5 w-8 h-8 rounded-full bg-slate-900/75 text-white flex items-center justify-center hover:bg-slate-900 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {canAddMore && (
        <div className="grid grid-cols-2 gap-2.5">
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => galleryInputRef.current?.click()}
            className="min-h-[44px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-700 text-xs sm:text-sm font-medium hover:border-emerald-600 hover:bg-emerald-50/50 transition-colors disabled:opacity-50"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ImagePlus className="w-4 h-4 text-emerald-700" />
            )}
            <span>Galeriden Seç</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => cameraInputRef.current?.click()}
            className="min-h-[44px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-700 text-xs sm:text-sm font-medium hover:border-emerald-600 hover:bg-emerald-50/50 transition-colors disabled:opacity-50"
          >
            <Camera className="w-4 h-4 text-emerald-700" />
            <span>Kamera ile Çek</span>
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-600 font-medium" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
