const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

// IPv4 only: fail closed for IPv6, including mapped/transition addresses.
function isPublicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function validateWebhookUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('Webhook requires public HTTPS on port 443');
  if (url.hostname.includes(':') || (net.isIP(url.hostname) && !isPublicIPv4(url.hostname))) throw new Error('Webhook address is not public');
  return url;
}

async function postWebhook(value, body, headers, signal) {
  const url = validateWebhookUrl(value);
  // Resolve once and pin the socket to the checked address. TLS still verifies hostname.
  const records = await Promise.race([
    dns.lookup(url.hostname, { all: true, family: 4 }),
    new Promise((_, reject) => {
      if (signal.aborted) reject(new Error('Webhook timeout'));
      else signal.addEventListener('abort', () => reject(new Error('Webhook timeout')), { once: true });
    })
  ]);
  if (!records.length || records.some(r => !isPublicIPv4(r.address))) throw new Error('Webhook DNS address is not public');
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST', headers, signal,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [{ address: records[0].address, family: 4 }])
        : callback(null, records[0].address, 4)
    }, response => {
      const status = response.statusCode;
      response.destroy();
      // No redirect following, including to a second public URL.
      resolve({ ok: status >= 200 && status < 300, status });
    });
    request.on('error', reject);
    request.end(body);
  });
}
module.exports = { isPublicIPv4, validateWebhookUrl, postWebhook };
