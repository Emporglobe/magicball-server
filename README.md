MagicBall Server (Patched)

- GET  /health
- POST /magicball  { question, lang }
- POST /astro      { birthChart, lang, question? }

This patch removes the too-aggressive 25s abort and provides stable /astro for older index.html versions.
