const fs = require("fs");

// Charger les questions de culture générale
const cultureQuestions = JSON.parse(
  fs.readFileSync(__dirname + "cg.json", "utf8")
);

const activeQuizzes = new Set();

module.exports = {
  config: {
    name: "quizz",
    aliases: ["quiz", "cg"],
    version: "3.0",
    author: "Merdi Madimba",
    role: 1
  },

  onStart: async function ({ api, event }) {
    const threadID = event.threadID;
    const starterID = event.senderID;

    // admin only
    if (starterID !== "100065927401614") {
      return api.sendMessage(
        "❌ Seul l'administrateur peut lancer le quizz.",
        threadID
      );
    }

    if (activeQuizzes.has(threadID)) {
      return api.sendMessage(
        "❌ Un quizz est déjà en cours dans ce groupe.",
        threadID
      );
    }

    activeQuizzes.add(threadID);

    let step = 0;
    let duelMode = false;
    let players = [];
    let nbQuestions = 10;
    let scores = new Map();
    let answered = false;

    api.sendMessage(
      "⚔️ Mode de jeu :\n1️⃣ Duel\n2️⃣ Quizz général\n➡️ Répondez par 1 ou 2",
      threadID
    );

    const handleChoice = (msg) => {
      if (msg.senderID !== starterID) return;
      const choice = msg.body.trim();

      if (step === 0) {
        if (choice === "1") {
          duelMode = true;
          step = 1;
          api.sendMessage(
            "👥 Entrez les UID des deux joueurs séparés par une virgule :",
            threadID
          );
        } else if (choice === "2") {
          duelMode = false;
          step = 2;
          api.sendMessage(
            "🔢 Nombre de questions ? (10 / 20 / 30 / 50)",
            threadID
          );
        }
      }

      else if (step === 1) {
        players = choice.split(",").map(id => id.trim());
        step = 2;
        api.sendMessage(
          "🔢 Nombre de questions ? (10 / 20 / 30 / 50)",
          threadID
        );
      }

      else if (step === 2) {
        const n = parseInt(choice);
        if (![10, 20, 30, 50].includes(n)) {
          return api.sendMessage("❌ Choix invalide.", threadID);
        }
        nbQuestions = n;
        api.removeListener("message", handleChoice);
        startQuiz();
      }
    };

    const startQuiz = async () => {
      const questions = cultureQuestions
        .sort(() => 0.5 - Math.random())
        .slice(0, nbQuestions);

      for (const q of questions) {
        answered = false;

        api.sendMessage(`❓ ${q.question}`, threadID);

        const collector = (msg) => {
          if (answered) return;
          if (duelMode && !players.includes(msg.senderID)) return;

          const userAnswer = msg.body.trim().toLowerCase();
          if (userAnswer === q.answer.toLowerCase()) {
            answered = true;
            const name = msg.senderName;
            scores.set(name, (scores.get(name) || 0) + 10);

            api.sendMessage(
              `✅ Bonne réponse de ${name} !\n\n🏆 Scores :\n${[...scores.entries()]
                .map(([n, s]) => `• ${n} : ${s} pts`)
                .join("\n")}`,
              threadID
            );
          }
        };

        api.listen(collector);
        await new Promise(res => setTimeout(res, 10000));

        if (!answered) {
          api.sendMessage(
            `❌𝗦𝗧𝗢𝗣𝗣𝗘𝗭 \n✅ 𝗥é𝗽𝗼𝗻𝘀𝗲 : ${q.answer}`,
            threadID
          );
        }
      }

      const winner = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];

      api.sendMessage(
        `🏁 𝗤𝗨𝗜𝗭𝗭 𝗧𝗘𝗥𝗠𝗜𝗡É !\n🥇 𝗟𝗲 𝗩𝗮𝗶𝗻𝗾𝘂𝗲𝘂𝗿 𝗲𝘀𝘁 : ${
          winner ? `${winner[0]} (${winner[1]} pts)` : "Personne"
        }`,
        threadID
      );

      activeQuizzes.delete(threadID);
    };

    api.listen(handleChoice);
  }
};
