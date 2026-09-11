// Runs in a disposable sandboxed document, which owns the decoder's worker.
let started = false;
addEventListener('message', async event => {
  if (event.source !== parent || started || event.data?.type !== 'decode') return;
  started = true;
  try {
    const result = await heic2any({ blob: event.data.file, toType: 'image/jpeg', quality: 0.85 });
    const blob = Array.isArray(result) ? result[0] : result;
    parent.postMessage({ type: 'decoded', blob }, '*');
  } catch (_) { parent.postMessage({ type: 'decode-error' }, '*'); }
});
