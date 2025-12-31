// magicball-server — patched for stable Astro AI interpretation
// Endpoints:
//   GET  /health
//   GET  /               (small landing, prevents "Cannot GET /" confusion)
//   POST /magicball      (general oracle)
//   POST /astro          (natal interpretation from a precomputed birthChart payload)

const express = require("express");
const cors = require("cors");

const app = express();

// keep generous limit (birthChart payload can be > 1mb in some cases)
app.use(express.json({ limit: "4mb" }));

// allow calls from Netlify dev/prod, localhost, etc.
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", (req, res) => {
  res
    .status(200)
    .type("text/plain")
    .send("magicball-server is running. Use /health, POST /magicball, POST /astro");
});

app.get("/health", (req, res) => res.json({ ok: true, service: "magicball-server", ts: new Date().toISOString() }));

function pickLang(lang) {
  const L = String(lang || "").toLowerCase();
  return L.startsWith("en") ? "en" : "ro";
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function openaiChat({ system, user, model, maxTokens, temperature, timeoutMs }) {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const usedModel = model || process.env.OPENAI_MODEL_CHAT || "gpt-4o";

  // IMPORTANT: the previous 25s abort was too aggressive for long answers.
  // We keep an abort, but with a safer default.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(10_000, timeoutMs || 75_000));

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: usedModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens ?? 1800,
        temperature: temperature ?? 0.85,
      }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || ("OpenAI HTTP " + r.status);
      throw new Error(msg);
    }

    const text = String(j?.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("Empty OpenAI response");
    return text;
  } finally {
    clearTimeout(t);
  }
}

function systemMagicBall(L) {
  if (L === "en") {
    return `You are Sanctuary MagicBall — a symbolic oracle.
Be warm, detailed, and practical. Do NOT do natal astrology.

Return EXACT structure:
1) Core message (3–6 lines)
2) Interpretation (8–14 lines)
3) Practical guidance (5–8 bullet steps)
4) Caution / boundaries (3–6 lines)
5) Affirmation (one powerful line)

Tone: modern, grounded, confident.`;
  }
  return `Ești Sanctuary MagicBall — un oracol simbolic.
Fii cald(ă), detaliat(ă) și practic(ă). NU faci astrologie natală.

Returnează EXACT structura:
1) Mesajul central (3–6 rânduri)
2) Interpretare (8–14 rânduri)
3) Ghidare practică (5–8 pași bullet)
4) Atenționare / limite (3–6 rânduri)
5) Afirmație (un rând puternic)

Ton: modern, ancorat, sigur pe tine.`;
}

function systemAstroAI(L) {
  if (L === "en") {
    return `You are Sanctuary AstroAI — a professional natal astrology interpreter.

Input: a precomputed birthChart object (planets with sign+degree; houses with ascendant/mc and cusps).
Task: produce a LONG, high-quality interpretation.

Rules:
- Use the provided placements only. Do NOT invent missing planets/houses.
- Interpret planet-by-planet, then synthesize.
- Explain Ascendant + MC specifically if provided.
- Give strengths, challenges, and actionable guidance.
- Use a calm, expert tone (no fluff).
- Do not mention Swiss Ephemeris or "backend".

Output format (STRICT):
A) Summary (6–10 lines)
B) Core personality (bullets)
C) Planet-by-planet (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto) — only those present
D) Angles & houses (Asc/MC + notable house cusps if present)
E) Practical life guidance (Career, Love, Money, Health) — 4 sections
F) Key patterns (3–5)
G) 30-day focus plan (7 bullets)`;
  }

  return `Ești Sanctuary AstroAI — interpret profesionist de astrologie natală.

Input: un obiect birthChart deja calculat (planete cu zodie+grad; case cu ascendent/mc și cuspide).
Sarcină: oferă o interpretare LUNGĂ, de calitate.

Reguli:
- Folosești doar datele primite. NU inventezi planete/case lipsă.
- Interpretezi planetă cu planetă, apoi sintezi.
- Explici explicit Ascendent + MC dacă există.
- Dai puncte forte, provocări și ghidare aplicată.
- Ton calm, expert (fără umplutură).
- Nu menționa Swiss Ephemeris sau „backend”.

Format output (STRICT):
A) Sinteză (6–10 rânduri)
B) Personalitate de bază (bullets)
C) Planetă cu planetă (Soare, Lună, Mercur, Venus, Marte, Jupiter, Saturn, Uranus, Neptun, Pluto) — doar ce există
D) Unghiuri & case (Asc/MC + cuspide notabile dacă există)
E) Ghidare practică (Carieră, Iubire, Bani, Sănătate) — 4 secțiuni
F) Tipare cheie (3–5)
G) Plan de focus 30 zile (7 bullets)`;
}

app.post("/magicball", async (req, res) => {
  try {
    const { question, lang } = req.body || {};
    if (!question) return res.status(400).json({ ok: false, error: "Missing question" });

    const L = pickLang(lang);
    const text = await openaiChat({
      system: systemMagicBall(L),
      user: String(question).trim(),
      maxTokens: 1400,
      temperature: 0.85,
      timeoutMs: 65_000,
    });

    return res.json({ ok: true, text });
  } catch (e) {
    // If an AbortError happens, return a stable message so UI doesn't "panic".
    const msg = String(e?.message || e);
    const isAbort = /aborted|AbortError/i.test(msg);
    return res.status(500).json({
      ok: false,
      error: isAbort ? "Upstream timeout (OpenAI). Try again." : msg,
    });
  }
});

// Astro AI interpretation endpoint (kept as /astro to match older index.html)
// Request body example:
// {
//   "birthChart": { "planets":[{name,sign,degree,longitude?}, ...], "houses": {...} },
//   "lang": "ro"
// }
app.post("/astro", async (req, res) => {
  try {
    const { birthChart, lang, question } = req.body || {};
    const planets = birthChart?.planets;

    if (!Array.isArray(planets) || planets.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing birthChart.planets" });
    }

    const L = pickLang(lang);

    // allow an optional user question that guides focus (career/love etc.)
    const focus = question ? String(question).trim() : "";

    const payload = {
      planets: planets.map(p => ({
        name: p?.name,
        sign: p?.sign,
        degree: p?.degree,
        longitude: p?.longitude,
      })),
      houses: birthChart?.houses || null,
      focus: focus || null,
    };

    const user = (L === "en")
      ? `Here is the birthChart JSON:\n${JSON.stringify(payload, null, 2)}\n\nIf focus is provided, prioritize it.`
      : `Iată JSON-ul birthChart:\n${JSON.stringify(payload, null, 2)}\n\nDacă există focus, prioritizează-l.`;

    const text = await openaiChat({
      system: systemAstroAI(L),
      user,
      maxTokens: 2200,
      temperature: 0.78,
      timeoutMs: 90_000,
    });

    return res.json({ ok: true, text });
  } catch (e) {
    const msg = String(e?.message || e);
    const isAbort = /aborted|AbortError/i.test(msg);
    return res.status(500).json({
      ok: false,
      error: isAbort ? "Upstream timeout (OpenAI). Try again." : msg,
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log("MagicBall server running on port", port));
