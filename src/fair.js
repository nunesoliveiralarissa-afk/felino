'use strict';
// Provably fair: o servidor publica SHA-256(serverSeed) ANTES de jogar.
// Cada resultado sai de HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`).
// Ao rotacionar, o serverSeed antigo é revelado e qualquer um pode reconferir.
const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newServerSeed = () => crypto.randomBytes(32).toString('hex');
const newClientSeed = () => crypto.randomBytes(8).toString('hex');

function hmac(serverSeed, clientSeed, nonce, cursor = 0) {
  return crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${cursor}`).digest();
}

function newSeedPair(clientSeed) {
  const serverSeed = newServerSeed();
  return { serverSeed, serverSeedHash: sha256(serverSeed), clientSeed: clientSeed || newClientSeed(), nonce: 0 };
}

// Float uniforme em [0,1) com 52 bits de precisão.
function floatFromBytes(buf) {
  const hi = buf.readUInt32BE(0) & 0x000fffff; // 20 bits
  const lo = buf.readUInt32BE(4);              // 32 bits
  return (hi * 2 ** 32 + lo) / 2 ** 52;
}

module.exports = { sha256, newServerSeed, newClientSeed, hmac, newSeedPair, floatFromBytes };
