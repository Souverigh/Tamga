import { iteratePdfPages } from './pdfLoader.js';
import { loadImageFile } from './imageLoader.js';

export function releasePageImage(image) {
  if (!image) return;
  if (typeof image.getContext === 'function') {
    image.width = 0;
    image.height = 0;
  } else {
    image.src = '';
  }
}

// Produces pages in source order without retaining decoded images in a file array.
export async function* iterateFilePages(file, { signal, onPageCount = () => {} } = {}) {
  if (signal?.aborted) return;
  if (!file.__group && file.type === 'application/pdf') {
    yield* iteratePdfPages(file, { signal, onPageCount });
    return;
  }
  const files = file.__group ? file.files : [file];
  onPageCount(files.length);
  for (let pageIndex = 0; pageIndex < files.length && !signal?.aborted; pageIndex++) {
    let image;
    try {
      [image] = await loadImageFile(files[pageIndex]);
    } catch (error) {
      if (signal?.aborted) return;
      yield { pageIndex, error };
      continue;
    }
    if (signal?.aborted) { releasePageImage(image); return; }
    yield { pageIndex, image };
  }
}
