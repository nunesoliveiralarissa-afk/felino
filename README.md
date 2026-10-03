# Tigrinho da Sorte (demo com fichas virtuais)

Backend em Node.js **sem dependências** (só módulos nativos) + front em HTML/CSS/JS puro.
Não há dinheiro real, depósito, saque nem pagamento. Tudo é ficha virtual.

## Rodar
```bash
node server.js          # http://localhost:3000
node tools/test.js      # testes de integração
node tools/rtp.js       # RTP exato do Tigrinho (enumera as 32.768 combinações)
node tools/crash-sim.js 2   # simula 2M rodadas do Aviãozinho com cashout em 2x
```
Requer Node 18+ (testado no 22).

## Estrutura
```
server.js            rotas da API, sessão, CSRF/rate limit
src/config.js        limites, RTP, tempos
src/db.js            persistência JSON atômica
src/auth.js          scrypt + sessões (hash do token no banco)
src/wallet.js        débito/crédito em inteiros + extrato
src/fair.js          HMAC-SHA256, seeds, provably fair
src/games/tiger.js   3x3, 5 linhas, tigre coringa, RTP 96,34%
src/games/aviator.js loop de rodadas, crash point, cashout, SSE
public/              páginas e scripts (o front só desenha)
```

## API
| Método | Rota | O que faz |
|---|---|---|
| POST | /api/auth/register, /login, /logout | conta e sessão (cookie HttpOnly) |
| GET | /api/me, /api/config | usuário e parâmetros dos jogos |
| POST | /api/tiger/spin `{bet}` | gira; aposta múltipla de 5 |
| POST | /api/aviator/bet `{amount, autoCashout?}` | aposta na janela aberta |
| POST | /api/aviator/cashout | retira no multiplicador do relógio do servidor |
| GET | /api/aviator/stream | SSE em tempo real |
| GET | /api/fair · POST /api/fair/rotate | hash atual / revela seed e troca |
| POST | /api/wallet/refill | recarga grátis com saldo baixo |

## Decisões de backend
- **Dinheiro em inteiros** (centavos de ficha), nunca float. Débito antes do sorteio.
- **Provably fair**: hash do seed publicado antes; `HMAC(seed, "cliente:nonce:0")` define o resultado; seed revelado ao rotacionar.
- **Aviãozinho**: ponto de queda fixado antes da rodada (seed por rodada, hash publicado); cashout e auto-cashout calculados no servidor.
- **RTP**: Tigrinho 96,34% (exato, por enumeração); Aviãozinho 96% (margem 4%, confirmado por simulação).
- **Segurança**: scrypt, comparação em tempo constante, cookie HttpOnly + SameSite=Strict, CSP, rate limit, limite de corpo, proteção contra path traversal.

## Antes de pensar em produção
Este projeto é uma demo. Apostas com dinheiro real no Brasil exigem autorização da SPA/Ministério da Fazenda (Lei 14.790/2023), KYC, jogo responsável, e infraestrutura de pagamentos e auditoria que não estão aqui. Para escalar, troque o JSON por PostgreSQL com transações e rode atrás de HTTPS.
