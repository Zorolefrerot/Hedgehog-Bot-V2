// 🏆 vs.js (v4.0 - Local Edition Clean)
const fs = require("fs");
const path = require("path");

// === FICHIERS ===
const dataFile = path.join(__dirname, "vs-users.json");
const matchesFile = path.join(__dirname, "vs-matches.json");
const teamsFile = path.join(__dirname, "teams-vs.json");

// Création des fichiers si absents
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({}));
if (!fs.existsSync(matchesFile)) fs.writeFileSync(matchesFile, JSON.stringify([]));
if (!fs.existsSync(teamsFile)) throw new Error("Fichier teams.json introuvable !");

// === CONSTANTES ===
const teams = JSON.parse(fs.readFileSync(teamsFile));
const MIN_BET = 20;
const DAILY_AMOUNT = 200;
const MATCH_COUNT = 5;
const RESOLVE_TIME = 30 * 1000;
const WELCOME_IMAGE = "http://goatbiin.onrender.com/GBhPN2QYD.png";
const OWNER_UID = "100065927401614"; // Ton ID

// === GESTION FICHIERS ===
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(dataFile));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2));
}

function loadMatches() {
  try {
    return JSON.parse(fs.readFileSync(matchesFile));
  } catch {
    return [];
  }
}

function saveMatches(matches) {
  fs.writeFileSync(matchesFile, JSON.stringify(matches, null, 2));
}

function randomInt(max) {
  return Math.floor(Math.random() * (max + 1));
}

function pickTwoDistinct(arr) {
  const i = randomInt(arr.length - 1);
  let j;
  do j = randomInt(arr.length - 1);
  while (j === i);
  return [arr[i], arr[j]];
}

function computeOdds(A, B) {
  const drawProb = 0.15;
  const total = A.strength + B.strength;
  const probA = (A.strength / total) * (1 - drawProb);
  const probB = (B.strength / total) * (1 - drawProb);
  const probN = drawProb;
  const randomizer = () => 0.9 + Math.random() * 0.3;
  return {
    A: Number((1 / probA * randomizer()).toFixed(2)),
    N: Number((1 / probN * randomizer()).toFixed(2)),
    B: Number((1 / probB * randomizer()).toFixed(2))
  };
}

// === MATCHES ===
let matches = loadMatches();
let nextMatchId = matches.reduce((max, m) => Math.max(max, m.id), 0) + 1;

function createMatches(threadID, count = MATCH_COUNT) {
  const newMatches = [];
  for (let i = 0; i < count; i++) {
    const [teamA, teamB] = pickTwoDistinct(teams);
    const odds = computeOdds(teamA, teamB);
    const match = {
      id: nextMatchId++,
      teamA,
      teamB,
      odds,
      status: "open",
      createdAt: Date.now(),
      createdInThread: threadID,
      bets: []
    };
    matches.push(match);
    newMatches.push(match);
  }
  saveMatches(matches);
  return newMatches;
}

function closeMatchAndScheduleResolve(match) {
  if (match.status !== "open") return;
  match.status = "closed";
  saveMatches(matches);
  setTimeout(() => resolveMatch(match.id), RESOLVE_TIME);
}

async function resolveMatch(matchId) {
  const match = matches.find(m => m.id === matchId);
  if (!match || match.status === "finished") return;

  const goalsA = randomInt(5);
  const goalsB = randomInt(5);
  const score = `${goalsA}-${goalsB}`;
  match.score = score;
  match.status = "finished";

  const result = goalsA > goalsB ? "A" : goalsB > goalsA ? "B" : "N";
  match.result = result;

  let recap = `🏁 Résultat du Duel ${match.id}\n⚽ ${match.teamA.name} ${score} ${match.teamB.name}\n`;
  recap += result === "N"
    ? "⚖️ Match nul\n\n"
    : `🏆 ${(result === "A" ? match.teamA.name : match.teamB.name)} a gagné !\n\n`;

  let gainsText = "";
  const users = loadUsers();
  let ownerGain = 0;

  for (const bet of match.bets) {
    const user = users[bet.user];
    if (!user) continue;

    if (bet.choice === result) {
      const gain = Math.floor(bet.amount * bet.odds);
      user.money += gain;
      bet.status = "win";
      gainsText += `✅ ${user.name} a gagné ${gain}$\n`;
    } else {
      ownerGain += bet.amount; // Argent perdu pour le créateur
      bet.status = "lose";
      gainsText += `❌ ${user.name} a perdu (${bet.amount}$)\n`;
    }
  }

  if (ownerGain > 0) {
    if (!users[OWNER_UID]) users[OWNER_UID] = { uid: OWNER_UID, name: "Merdi", money: 0 };
    users[OWNER_UID].money += ownerGain;
  }

  saveUsers(users);
  saveMatches(matches);

  if (match.createdInThread) {
    try {
      global.api.sendMessage(`${recap}${gainsText || "Aucun pari enregistré."}`, match.createdInThread);
    } catch (e) {
      console.error("Erreur d'envoi :", e);
    }
  }
}

// === COMMANDE ===
module.exports = {
  config: {
    name: "versus",
    aliases: ["vs"],
    version: "4.0",
    author: "Merdi Madimba",
    role: 0,
    description: "Paris sur des duels des Quizzeurs (argent perdu caché au créateur)",
    category: "🎮 Jeux"
  },

  onStart: async function ({ api, event, args }) {
    global.api = api;
    const { threadID, senderID, messageID } = event;

    // Initialisation du joueur
    let users = loadUsers();
    if (!users[senderID]) {
      let fbName = `Joueur-${senderID}`;
      try {
        const info = await api.getUserInfo(senderID);
        if (info && info[senderID]?.name) fbName = info[senderID].name;
      } catch {}
      users[senderID] = { uid: senderID, name: fbName, money: 0, lastDaily: 0 };
      saveUsers(users);
    }

    const user = users[senderID];
    const cmd = (args[0] || "").toLowerCase();

    if (!cmd) {
      const body = `🎌🔥 QUIZZEUR DUEL 🔥🎌

⚽ /vs matches → Voir les matchs
🎰 /vs bet [ID] [A|N|B] [montant]
💵 /vs solde → Ton solde
💳 /vs daily → Bonus +${DAILY_AMOUNT}$
🏆 /vs top → Top 10 meilleurs parieus`;

      try {
        const stream = await global.utils.getStreamFromURL(WELCOME_IMAGE);
        return api.sendMessage({ body, attachment: stream }, threadID, messageID);
      } catch {
        return api.sendMessage(body, threadID, messageID);
      }
    }

    switch (cmd) {
      case "matches": {
        let open = matches.filter(m => m.status === "open" && m.createdInThread === threadID);
        if (!open.length) open = createMatches(threadID, MATCH_COUNT);
        const list = open.map(m =>
          `📍 Duel ${m.id}\n⚽ ${m.teamA.name} 🆚 ${m.teamB.name}\n📈 Cotes → 🅰️ ${m.odds.A} | 🟰 ${m.odds.N} | 🅱️ ${m.odds.B}`
        ).join("\n\n");
        return api.sendMessage(`📋 DUELS DISPONIBLES :\n\n${list}`, threadID, messageID);
      }

      case "solde":
        return api.sendMessage(`💰 ${user.name}, ton solde est de ${user.money}$`, threadID, messageID);

      case "daily": {
        const now = Date.now();
        if (now - (user.lastDaily || 0) < 24 * 60 * 60 * 1000)
          return api.sendMessage("🕒 Reviens dans 24h pour ton bonus.", threadID, messageID);
        user.money += DAILY_AMOUNT;
        user.lastDaily = now;
        saveUsers(users);
        return api.sendMessage(`✅ +${DAILY_AMOUNT}$ ajoutés à ton solde !`, threadID, messageID);
      }

      case "top": {
        const sorted = Object.values(loadUsers()).sort((a, b) => b.money - a.money).slice(0, 10);
        if (!sorted.length) return api.sendMessage("📭 Aucun joueur enregistré.", threadID, messageID);
        const medals = ["🥇", "🥈", "🥉"];
        const topList = sorted.map((p, i) => `${medals[i] || "🏅"} ${p.name} — ${p.money}$`).join("\n");
        return api.sendMessage(`🏆 TOP 10 PARIEURS 🏆\n\n${topList}`, threadID, messageID);
      }

      case "bet": {
        const [idArg, choiceArg, amountArg] = args.slice(1);
        const matchID = Number(idArg);
        const choice = (choiceArg || "").toUpperCase();
        const amount = Number(amountArg);

        if (!matchID || !choice || !amount)
          return api.sendMessage("❌ Usage : /vs bet [ID] [A|N|B] [montant]", threadID, messageID);
        if (!["A", "N", "B"].includes(choice))
          return api.sendMessage("❌ Choix invalide. Utilise A, N ou B.", threadID, messageID);
        if (amount < MIN_BET)
          return api.sendMessage(`❌ Mise minimum : ${MIN_BET}$`, threadID, messageID);
        if (amount > user.money)
          return api.sendMessage("❌ Solde insuffisant.", threadID, messageID);

        const match = matches.find(m => m.id === matchID);
        if (!match) return api.sendMessage("❌ Match introuvable.", threadID, messageID);
        if (match.status !== "open") return api.sendMessage("🚫 Match fermé aux paris.", threadID, messageID);

        user.money -= amount;
        match.bets.push({ user: senderID, choice, amount, odds: match.odds[choice], threadID });
        saveUsers(users);
        saveMatches(matches);
        closeMatchAndScheduleResolve(match);

        return api.sendMessage(
          `🎯 Pari accepté : Match ${match.id}\nChoix : ${choice} | Mise : ${amount}$ | Cote : ${match.odds[choice]}\n⌛ Résultat dans ~${RESOLVE_TIME / 1000}s.`,
          threadID,
          messageID
        );
      }

      default:
        return api.sendMessage("❓ Commande inconnue. Tape /vs pour le menu.", threadID, messageID);
    }
  }
};
