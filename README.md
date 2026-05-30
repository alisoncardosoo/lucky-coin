# Lucky Coin

Site simples de cara ou coroa com:
- animação de giro aleatória
- resultado 50/50 (`cara` ou `coroa`)
- som sintético via Web Audio API durante o giro + som de queda ao finalizar

## Estrutura

- `index.html` — interface
- `styles.css` — visual minimalista e responsivo
- `app.js` — lógica do jogo, animação e áudio
- `assets/cara.png` e `assets/coroa.png` — imagens reais dos lados da moeda

## Trocar imagens da moeda

1. Substitua os arquivos em `assets/` (`cara.png` e `coroa.png`).
2. Se mudar os nomes dos arquivos, atualize os `src` em `index.html`.

## Rodar localmente

```bash
python3 -m http.server 4173
```

Abra `http://127.0.0.1:4173`.

## Testes

```bash
npm install
npm test
npm run test:e2e
```
