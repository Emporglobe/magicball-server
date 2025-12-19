const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Permite apel din Netlify (UI)
app.use(cors({ origin: true }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/magicball", async (req, res) => {
  try {
    const { question, lang } = req.body || {};
    if (!question) {
      return res.status(400).json({ ok: false, error: "Missing question" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
    }

    const model = process.env.OPENAI_MODEL_CHAT || "gpt-4o";
    const L = String(lang).toLowerCase().startsWith("en") ? "en" : "ro";

    const system =
      L === "en"
        ? `You are Sanctuary MagicBall — a symbolic oracle. You do NOT do natal astrology.
Return structure:
1) Core message
2) Interpretation
3) Practical guidance (3–5 steps)
4) Caution
5) Affirmation (one line)`
        : `Ești Sanctuary MagicBall — un oracol simbolic. NU faci astrologie natală.
Structură:
1) Mesajul central
2) Interpretare
3) Ghidare practică (3–5 pași)
4) Atenționare
5) Afirmație (un rând)`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 25000);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: String(question).trim() }
        ],
        max_tokens: 1100,
        temperature: 0.8
      })
    }).finally(() => clearTimeout(t));

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: j?.error?.message || ("OpenAI HTTP " + r.status)
      });
    }

    const text = String(j?.choices?.[0]?.message?.content || "").trim();
    return res.json({ ok: true, text });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log("MagicBall server running on port", port)
);
