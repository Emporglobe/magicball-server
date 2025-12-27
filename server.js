const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: true }));

app.get("/health", (req, res) => res.json({ ok: true }));

function pickLang(lang) {
  const L = String(lang || "ro").toLowerCase();
  return L.startsWith("en") ? "en" : "ro";
}

async function callOpenAI({ system, user, model, max_tokens, temperature }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("Missing OPENAI_API_KEY");
    err.statusCode = 500;
    throw err;
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens,
        temperature,
      }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || `OpenAI HTTP ${r.status}`;
      const err = new Error(msg);
      err.statusCode = 500;
      throw err;
    }

    return String(j?.choices?.[0]?.message?.content || "").trim();
  } finally {
    clearTimeout(t);
  }
}

// 1) ORACLE ONLY (no natal astrology)
app.post("/magicball", async (req, res) => {
  try {
    const { question, lang } = req.body || {};
    if (!question) return res.status(400).json({ ok: false, error: "Missing question" });

    const L = pickLang(lang);
    const model = process.env.OPENAI_MODEL_CHAT || "gpt-4.1";

    const system =
      L === "en"
        ? `You are Sanctuary MagicBall — a symbolic oracle.\n\nRules:\n- You do NOT do natal astrology, planet/houses interpretations, or birth charts.\n- You can use symbolism, archetypes, numerology, runes, metaphors, and practical guidance.\n- Keep it detailed and helpful: at least 10-18 short paragraphs or bullets.\n\nReturn the exact structure:\n1) Core message\n2) Interpretation\n3) Practical guidance (5-8 concrete steps)\n4) Caution\n5) Affirmation (one line)`
        : `Ești Sanctuary MagicBall — un oracol simbolic.\n\nReguli:\n- NU faci astrologie natală (planete/case/ASC, interpretări de hartă natală).\n- Folosești simboluri, arhetipuri, numerologie, rune, metafore, și îndrumare practică.\n- Fii detaliat(ă) și util(ă): minim 10-18 paragrafe scurte / bullets.\n\nReturnează exact structura:\n1) Mesajul central\n2) Interpretare\n3) Ghidare practică (5-8 pași concreți)\n4) Atenționare\n5) Afirmație (un rând)`;

    const text = await callOpenAI({
      system,
      user: String(question).trim(),
      model,
      max_tokens: 1400,
      temperature: 0.85,
    });

    return res.json({ ok: true, text });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 2) NATAL CHART INTERPRETATION (allowed)
app.post("/astro", async (req, res) => {
  try {
    const { question, lang, birthChart } = req.body || {};
    if (!birthChart || !Array.isArray(birthChart?.planets)) {
      return res.status(400).json({ ok: false, error: "Missing birthChart.planets" });
    }

    const L = pickLang(lang);
    const model = process.env.OPENAI_MODEL_ASTRO || process.env.OPENAI_MODEL_CHAT || "gpt-4.1";

    // Keep payload small/stable
    const planets = birthChart.planets
      .map((p) => ({
        name: p.name,
        sign: p.sign,
        degree: p.degree,
        longitude: p.longitude,
        meaning: p.meaning,
      }))
      .slice(0, 20);

    const userQuestion = String(question || "").trim() || (L === "en"
      ? "Give a clear, planet-by-planet natal chart interpretation."
      : "Oferă o interpretare clară, planetă cu planetă, a hărții natale.");

    const system =
      L === "en"
        ? `You are Sanctuary Astro Interpreter.\n\nTask:\n- Provide a REAL natal astrology interpretation based on provided planets (sign + degree).\n- Write a detailed, structured, warm but precise reading.\n- Include: overview, planet-by-planet (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto), then 3 themes, then actionable advice.\n- Do not mention policies. Do not refuse.\n- No generic fluff; tie every point to the given planets.\n\nOutput format:\nA) Overview (6-10 lines)\nB) Planet-by-planet (10 sections)\nC) 3 Key themes\nD) Practical steps (6-10 bullets)\nE) Closing (2 lines)`
        : `Ești Sanctuary Astro Interpreter.\n\nSarcină:\n- Oferi o interpretare REALĂ de astrologie natală pe baza planetelor primite (semn + grad).\n- Text detaliat, structurat, cald dar precis.\n- Include: sinteză generală, planetă cu planetă (Soare, Lună, Mercur, Venus, Marte, Jupiter, Saturn, Uranus, Neptun, Pluto), apoi 3 teme majore, apoi pași concreți.\n- Nu fi vag. Leagă fiecare idee de planetele date.\n\nFormat:\nA) Sinteză (6-10 rânduri)\nB) Planetă cu planetă (10 secțiuni)\nC) 3 teme cheie\nD) Pași practici (6-10 bullets)\nE) Încheiere (2 rânduri)`;

    const user =
      `${userQuestion}\n\nHere is the computed chart data (planets):\n` +
      JSON.stringify({ place: birthChart.place, date: birthChart.date, time: birthChart.time, planets }, null, 2);

    const text = await callOpenAI({
      system,
      user,
      model,
      max_tokens: 1800,
      temperature: 0.65,
    });

    return res.json({ ok: true, text });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("MagicBall server running on port", port));
