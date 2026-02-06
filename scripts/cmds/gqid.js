const axios = require("axios");

const activeSessions = {};

/* ================= GEMINI API KEYS (ROTATION) ================= */
const GEMINI_KEYS = [
  "AIzaSyBFrL8G8AxErKikGqUEGiMXnf4ntBc5hDo",
  "AIzaSyCiBWeok8eWxq2C2dKWGgwyS-tHSoyEJ4M",
  "AIzaSyAqzuy7IvpOgJvkm_hSQswwNNqHkBFeSZA",
  "AIzaSyAMiBew_-GeFe7z2ESh6yU9Eu9ZOq8Kjy8",
  "AIzaSyDb1gOcJTcVTtMvfJxPKB5aC0spLD9p0Js",
  "AIzaSyCIKInvO4gipyraTm8pP3qkCxMULH9_uOg"
];

let geminiIndex = 0;

function getGeminiKey() {
  return GEMINI_KEYS[geminiIndex % GEMINI_KEYS.length];
}

function rotateGeminiKey() {
  geminiIndex++;
}

/* ================= GEMINI CHECK FUNCTION ================= */
async function isSameCharacter(userAnswer, correctName) {
  const prompt = `
Tu es un vérificateur strict.
Détermine si "${userAnswer}" et "${correctName}" désignent le MÊME personnage de manga.

Règles :
- Accepte prénom seul ou nom complet
- Accepte traduction ou romanisation
- Ignore accents, majuscules, ordre des mots
- Refuse si ce n'est pas la même personne

Répond UNIQUEMENT par TRUE ou FALSE.
`;

  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
        {
          contents: [{ parts: [{ text: prompt }] }]
        }
      );

      const text =
        res.data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return text.toUpperCase().includes("TRUE");
    } catch (err) {
      if (err.response && [403, 429].includes(err.response.status)) {
        rotateGeminiKey();
      } else {
        console.error("Gemini error:", err.message);
        break;
      }
    }
  }
  return false;
}

/* ================= COMMAND ================= */
module.exports = {
  config: {
    name: "gqid",
    aliases: ["quizid", "generalquizzid"],
    version: "3.0",
    author: "Merdi Madimba",
    role: 0,
    category: "🎮 Jeu",
    description: "Quiz personnages manga (Jikan + Gemini 2.5 Flash)"
  },

  onStart: async ({ event, message }) => {
    const threadID = event.threadID;
    if (activeSessions[threadID])
      return message.reply("⚠️ Un quiz est déjà en cours.");

    activeSessions[threadID] = { step: "manga" };

    message.reply(
      "🎌 **QUIZ PERSONNAGES MANGA**\n\n" +
      "👉 Écris le **nom du manga**\n" +
      "👉 Ou **Multivers**\n\n" +
      "🛑 `!stop` pour annuler"
    );
  },

  onChat: async ({ event, message, usersData }) => {
    const threadID = event.threadID;
    const session = activeSessions[threadID];
    if (!session) return;

    const body = event.body?.trim();
    if (!body) return;

    if (body.toLowerCase() === "!stop") {
      clearTimeout(session.timeout);
      delete activeSessions[threadID];
      return message.reply("🛑 Quiz arrêté.");
    }

    /* ===== CHOIX MANGA ===== */
    if (session.step === "manga") {
      session.manga = body.toLowerCase() === "multivers" ? "multivers" : body;
      session.step = "number";
      return message.reply("🔢 Nombre d’images (1 à 50) ?");
    }

    /* ===== CHOIX NOMBRE ===== */
    if (session.step === "number" && !isNaN(body)) {
      const total = Math.min(50, Math.max(1, parseInt(body)));
      session.total = total;
      session.index = 0;
      session.scores = {};
      session.characters = [];
      session.step = "play";

      await message.reply("⏳ Chargement des personnages...");

      try {
        if (session.manga === "multivers") {
          const r = await axios.get("https://api.jikan.moe/v4/top/characters");
          session.characters = r.data.data
            .filter(c => c.images?.jpg?.image_url)
            .sort(() => Math.random() - 0.5)
            .slice(0, total)
            .map(c => ({
              name: c.name,
              image: c.images.jpg.image_url,
              source: "Multivers"
            }));
        } else {
          const m = await axios.get("https://api.jikan.moe/v4/manga", {
            params: { q: session.manga, limit: 1 }
          });
          const manga = m.data.data[0];
          if (!manga) throw new Error("Manga introuvable");

          const c = await axios.get(
            `https://api.jikan.moe/v4/manga/${manga.mal_id}/characters`
          );

          session.characters = c.data.data
            .filter(x => x.character.images?.jpg?.image_url)
            .sort(() => Math.random() - 0.5)
            .slice(0, total)
            .map(x => ({
              name: x.character.name,
              image: x.character.images.jpg.image_url,
              source: manga.title
            }));
        }
      } catch {
        delete activeSessions[threadID];
        return message.reply("❌ Erreur Jikan.");
      }

      message.reply(`✅ Quiz lancé (${session.characters.length} images)`);
      return sendQuestion();
    }

    /* ===== JEU ===== */
    if (session.step === "play" && !session.answered) {
      const current = session.characters[session.index];
      const ok = await isSameCharacter(body, current.name);

      if (ok) {
        session.answered = true;
        clearTimeout(session.timeout);

        const name = await usersData.getName(event.senderID);
        session.scores[name] = (session.scores[name] || 0) + 10;

        let score = "📊 **Scores**\n";
        for (let [n, s] of Object.entries(session.scores))
          score += `🏅 ${n} : ${s} pts\n`;

        await message.reply(
          `✅ **Correct !**\n👤 ${current.name}\n\n${score}`
        );

        session.index++;
        setTimeout(sendQuestion, 1200);
      }
    }

    /* ===== SEND QUESTION ===== */
    async function sendQuestion() {
      if (session.index >= session.characters.length) {
        let end = "🏁 **FIN DU QUIZ**\n\n";
        const sorted = Object.entries(session.scores).sort((a, b) => b[1] - a[1]);
        for (let [n, s] of sorted) end += `🏆 ${n} : ${s} pts\n`;
        delete activeSessions[threadID];
        return message.reply(end);
      }

      session.answered = false;
      const c = session.characters[session.index];

      await message.send({
        body: `🖼️ ${session.index + 1}/${session.total}\n📚 ${c.source}\n❓ Qui est-ce ?`,
        attachment: await global.utils.getStreamFromURL(c.image)
      });

      session.timeout = setTimeout(async () => {
        if (!session.answered) {
          await message.reply(`⏰ Temps écoulé ! Réponse : **${c.name}**`);
          session.index++;
          sendQuestion();
        }
      }, 10000);
    }
  }
};
