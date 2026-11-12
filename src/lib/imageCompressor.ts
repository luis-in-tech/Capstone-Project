export async function compressImage(file: File, maxWidth = 1280, maxHeight = 720, quality = 0.8): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        if (!img.width || !img.height) {
          reject(new Error('Invalid or empty image dimensions.'));
          return;
        }
        const canvas = document.createElement('canvas');
        const safeMaxWidth = Math.max(1, maxWidth);
        const safeMaxHeight = Math.max(1, maxHeight);
        const scale = Math.min(safeMaxWidth / img.width, safeMaxHeight / img.height, 1);
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context not available.'));
          return;
        }

        // Fill white backdrop before JPEG encoding so transparent PNGs/WebPs don't turn black
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
        const safeQuality = Math.min(1, Math.max(0.1, quality));
        canvas.toBlob(
          blob => {
            if (blob) {
              const compressedFile = new File([blob], `${baseName}.jpg`, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              reject(new Error('Canvas toBlob returned null.'));
            }
          },
          'image/jpeg',
          safeQuality
        );
      };
      img.onerror = error => reject(error);
    };
    reader.onerror = error => reject(error);
  });
}
