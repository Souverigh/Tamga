const Busboy = require('busboy');

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 }
      });
    } catch (error) {
      reject(Object.assign(new Error('Некорректный multipart-запрос'), { status: 400 }));
      return;
    }

    const fields = {};
    const chunks = [];
    let fileMimeType = null;
    let fileTooLarge = false;
    let fileSeen = false;

    parser.on('field', (name, value) => { fields[name] = value; });
    parser.on('file', (name, stream, info) => {
      if (name !== 'image' && name !== 'file') {
        stream.resume();
        return;
      }
      fileSeen = true;
      fileMimeType = info.mimeType;
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('limit', () => { fileTooLarge = true; });
    });
    parser.on('error', reject);
    parser.on('finish', () => {
      if (fileTooLarge) {
        reject(Object.assign(new Error('Файл слишком большой (лимит 20MiB)'), { status: 413 }));
        return;
      }
      if (!fileSeen) {
        reject(Object.assign(new Error('Поле "image" (файл) обязательно'), { status: 400 }));
        return;
      }
      resolve({
        ...fields,
        ...(fields.includeText === 'true' || fields.includeText === 'false'
          ? { includeText: fields.includeText === 'true' }
          : {}),
        image: Buffer.concat(chunks).toString('base64'),
        mimeType: fields.mimeType || fileMimeType
      });
    });
    req.pipe(parser);
  });
}

async function readRequestBody(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.startsWith('multipart/form-data')) return readMultipart(req);
  return req.body || {};
}

module.exports = { readRequestBody, MAX_UPLOAD_BYTES };