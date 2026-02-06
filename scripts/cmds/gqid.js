const axios = require("axios");
const activeSessions = {};

/* ================= UTIL ================= */
function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize("NFD") // enlever accents
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/* ================= COMMAND ================= */
module.exports = {
  config: {
    name: "gqid",
    aliases: ["quizid", "generalquizzid"],
    version: "5.0",
    author: "Merdi Madimba",
    role: 0,
    category: "🎮 Jeu",
    description: "Quiz personnages manga (Jikan) - accepte prénom ou nom complet"
  },

  onStart: async ({ event, message }) => {
    if (activeSessions[event.threadID])
      return message.reply("⚠️ Un quiz est déjà en cours.");

    activeSessions[event.threadID] = { step: "manga" };
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

    const text = event.body?.trim();
    if (!text) return;

    /* ===== STOP ===== */
    if (text.toLowerCase() === "!stop") {
      clearTimeout(session.timeout);
      delete activeSessions[threadID];
      return message.reply("🛑 Quiz arrêté.");
    }

    /* ===== CHOIX MANGA ===== */
    if (session.step === "manga") {
      session.manga = text.toLowerCase() === "multivers" ? "multivers" : text;
      session.step = "number";
      return message.reply("🔢 Nombre d’images (1–50) ?");
    }

    /* ===== CHOIX NOMBRE ===== */
    if (session.step === "number" && !isNaN(text)) {
      session.total = Math.min(50, Math.max(1, parseInt(text)));
      session.index = 0;
      session.scores = {};
      session.characters = [];
      session.step = "play";
      session.firstAnswered = false;

      await message.reply("⏳ Chargement des personnages...");

      try {
        if (session.manga === "multivers") {
          const r = await axios.get("https://api.jikan.moe/v4/top/characters");
          session.characters = r.data.data
            .filter(c => c.images?.jpg?.image_url)
            .sort(() => Math.random() - 0.5)
            .slice(0, session.total)
            .map(c => ({ name: c.name, image: c.images.jpg.image_url, source: "Multivers" }));
        } else {
          const m = await axios.get("https://api.jikan.moe/v4/manga", { params: { q: session.manga, limit: 1 } });
          const manga = m.data.data[0];
          if (!manga) throw new Error();
          const c = await axios.get(`https://api.jikan.moe/v4/manga/${manga.mal_id}/characters`);
          session.characters = c.data.data
            .filter(x => x.character.images?.jpg?.image_url)
            .sort(() => Math.random() - 0.5)
            .slice(0, session.total)
            .map(x => ({ name: x.character.name, image: x.character.images.jpg.image_url, source: manga.title }));
        }
      } catch {
        delete activeSessions[threadID];
        return message.reply("❌ Erreur Jikan.");
      }

      message.reply(`✅ Quiz lancé (${session.characters.length} images)`);
      return sendQuestion();
    }

    /* ===== JEU : PREMIÈRE BONNE RÉPONSE SEULE ===== */
    if (session.step === "play") {
      if (session.firstAnswered) return; // ignore toutes les autres réponses

      const current = session.characters[session.index];
      const normalizedUser = normalizeName(text);
      const normalizedName = normalizeName(current.name);

      // Accepte si prénom ou nom complet
      const correct =
        normalizedUser === normalizedName ||
        normalizedName.split(" ").some(p => p === normalizedUser);

      if (!correct) return;

      // Première bonne réponse validée
      session.firstAnswered = true;
      clearTimeout(session.timeout);

      const userName = await usersData.getName(event.senderID);
      session.scores[userName] = (session.scores[userName] || 0) + 10;

      let board = "📊 **Scores**\n";
      for (const [n, s] of Object.entries(session.scores)) board += `🏅 ${n} : ${s} pts\n`;

      await message.reply(`✅ **Bonne réponse !**\n👤 ${current.name}\n\n${board}`);

      session.index++;
      setTimeout(() => {
        session.firstAnswered = false; // reset pour prochaine image
        sendQuestion();
      }, 1200);
    }

    /* ===== ENVOI QUESTION ===== */
    async function sendQuestion() {
      if (session.index >= session.characters.length) {
        let end = "🏁 **FIN DU QUIZ**\n\n";
        const sorted = Object.entries(session.scores).sort((a, b) => b[1] - a[1]);
        for (const [n, s] of sorted) end += `🏆 ${n} : ${s} pts\n`;
        delete activeSessions[threadID];
        return message.reply(end);
      }

      const c = session.characters[session.index];
      session.firstAnswered = false;

      await message.send({
        body: `🖼️ ${session.index + 1}/${session.total}\n📚 ${c.source}\n❓ Qui est-ce ?`,
        attachment: await global.utils.getStreamFromURL(c.image)
      });

      session.timeout = setTimeout(async () => {
        if (!session.firstAnswered) {
          await message.reply(`⏰ Temps écoulé ! Réponse : **${c.name}**`);
          session.index++;
          sendQuestion();
        }
      }, 10000);
    }
  }
};
