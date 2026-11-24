import { STORAGE_LIMITS } from '../types/place';

/**
 * Compresses an uploaded image file to a JPEG Data URL safely below IndexedDB/backup limits.
 */
export async function compressImageFile(
  file: File,
  maxDimension = 960,
  maxChars = STORAGE_LIMITS.MAX_IMAGE_CHARS
): Promise<string> {
  const isImageByType = file.type.startsWith('image/');
  const isImageByExt = /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
  if (!isImageByType && !isImageByExt) {
    throw new Error('Lütfen yalnızca görsel dosyası (JPG, PNG, WebP) seçin.');
  }

  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(
          new Error(
            'Görsel okunamadı. iPhone’da farklı bir fotoğraf seçmeyi veya Kamera ayarlarından "En Uyumlu" (JPG) formatını deneyin.'
          )
        );
      element.src = bitmapUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Görsel işleme bağlamı oluşturulamadı.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.8;
    let result = canvas.toDataURL('image/jpeg', quality);

    while (result.length > maxChars && quality > 0.35) {
      quality -= 0.1;
      result = canvas.toDataURL('image/jpeg', quality);
    }

    if (result.length > maxChars) {
      // Fallback smaller resize if still too large
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = Math.round(width * 0.65);
      smallCanvas.height = Math.round(height * 0.65);
      const sCtx = smallCanvas.getContext('2d');
      if (sCtx) {
        sCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
        result = smallCanvas.toDataURL('image/jpeg', 0.65);
      }
    }

    if (result.length > maxChars) {
      throw new Error('Görsel boyutu sıkıştırma sonrası bile çok büyük.');
    }

    return result;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}
