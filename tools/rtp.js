'use strict';
// Calcula o RTP EXATO do Tigrinho enumerando as 32^3 combinações possíveis.
const T = require('../src/games/tiger');
const N = T.STRIP_LEN;
let sum = 0, hits = 0, max = 0;
const total = N ** 3;
for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) {
  const { sumMult } = T.evaluate(T.gridFromStops([a, b, c]));
  const m = sumMult / T.LINES.length;
  sum += m; if (sumMult > 0) hits++; if (m > max) max = m;
}
console.log(`combinações: ${total}`);
console.log(`RTP exato: ${(sum / total * 100).toFixed(3)}%`);
console.log(`taxa de acerto: ${(hits / total * 100).toFixed(2)}%`);
console.log(`maior pagamento (x aposta): ${max}`);
