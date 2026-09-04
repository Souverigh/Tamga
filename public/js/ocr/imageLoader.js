// Загрузка обычных изображений (JPG/PNG) и преобразование кадра (Image или Canvas) в base64.
// Не знает ни про PDF, ни про то, какой движок распознавания будет использован дальше.

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve([img]);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function pageImageToBase64(pageImage) {
  let canvas;
  if (pageImage instanceof HTMLCanvasElement) {
    canvas = pageImage;
  } else {
    canvas = document.createElement('canvas');
    canvas.width = pageImage.naturalWidth || pageImage.width;
    canvas.height = pageImage.naturalHeight || pageImage.height;
    canvas.getContext('2d').drawImage(pageImage, 0, 0);
  }
  return canvas.toDataURL('image/png').split(',')[1];
}
