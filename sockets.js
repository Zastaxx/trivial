// sockets.js
const fs   = require('fs');
const path = require('path');

module.exports = io => {
  // --- Constantes ---
  const ALL_CATEGORIES = [
    'Films/Séries','Géographie','Histoire','Jeux-vidéos',
    'Logique','Musique','Science','Sport','Littérature'
  ];
  const DIFF_FOLDER = {
    easy:   'facile',
    medium: 'moyen',
    hard:   'difficile'
  };

  // --- Stockage en mémoire ---
  let nextLobbyId       = 1;
  const lobbies         = new Map();   // lobbyId -> lobby object
  const pendingDestruct = new Map();   // lobbyId -> timeoutID

  // --- Helper : compte les questions par catégorie pour une difficulté donnée ---
  function getCategoryCounts(diffKey) {
    const folderName = DIFF_FOLDER[diffKey] || diffKey;
    const folder     = path.join(__dirname, 'data', 'questions', folderName);
    const counts     = {};

    if (!fs.existsSync(folder)) {
      console.error(`❌ Dossier introuvable pour stats : ${folder}`);
      ALL_CATEGORIES.forEach(cat => counts[cat] = 0);
      return counts;
    }

    // lit chaque JSON et compte
    fs.readdirSync(folder).forEach(file => {
      if (!file.endsWith('.json')) return;
      let arr;
      try {
        arr = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
      } catch {
        arr = [];
      }
      // normalise le nom du fichier pour matcher la catégorie
      const key = file.replace(/\.json$/, '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase(); // ex. 'films_series'
      // cherche la cat correspondante
      ALL_CATEGORIES.forEach(cat => {
        const catKey = cat.normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()         // ex. 'films/series'
          .replace(/\//g, '_');  // 'films_series'
        if (catKey === key) {
          counts[cat] = arr.length;
        }
      });
    });

    // assure qu’il y a une entrée pour chaque catégorie
    ALL_CATEGORIES.forEach(cat => {
      if (counts[cat] === undefined) counts[cat] = 0;
    });
    return counts;
  }

  // --- Diffuse la liste des lobbies à tous ---
  function broadcastLobbyList() {
    const list = Array.from(lobbies.values()).map(l => ({
      id:           l.id,
      code:         l.code,
      playersCount: l.players.length,
      hostName:     l.players.find(p=>p.userId===l.hostUserId)?.name || '',
      hasPassword:  !!l.settings.password
    }));
    io.emit('lobbyList', list);
  }

  // --- Envoie l'état d'un lobby à chacun de ses participants ---
  function emitLobbyUpdate(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;
    const counts = getCategoryCounts(lobby.settings.difficulty);
    lobby.players.forEach(p => {
      const isHost = p.userId === lobby.hostUserId;
      io.to(p.socketId).emit('lobbyUpdated', {
        players: lobby.players.map(pl=>({
          id:     pl.socketId,
          userId: pl.userId,
          name:   pl.name
        })),
        settings: {
          rounds:          lobby.settings.rounds,
          difficulty:      lobby.settings.difficulty,
          timePerQuestion: lobby.settings.timePerQuestion,
          hasPassword:     !!lobby.settings.password,
          password:        isHost ? lobby.settings.password || '' : undefined,
          categories:      lobby.settings.categories
        },
        hostId: lobby.hostUserId,
        code:   lobby.code,
        isHost,
        counts            // <-- j’ajoute les stats
      });
    });
  }

  // --- Sélectionne aléatoirement les questions selon settings ---
  function pickQuestions(lobby) {
    const diffKey   = lobby.settings.difficulty;             
    const folderName= DIFF_FOLDER[diffKey] || diffKey;        
    const folder    = path.join(__dirname, 'data','questions', folderName);

    if (!fs.existsSync(folder)) {
      console.error(`❌ Dossier introuvable : ${folder}`);
      return [];
    }

    let pool = [];
    const chosenCats = lobby.settings.categories
      .map(c => c.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());

    fs.readdirSync(folder).forEach(file => {
      if (!file.endsWith('.json')) return;
      let arr;
      try {
        arr = JSON.parse(
          fs.readFileSync(path.join(folder, file), 'utf8')
        );
      } catch (e) {
        console.warn(`⚠️ JSON invalide, j’ignore ${file}`);
        return;
      }
      // normalise le nom du fichier (sans extension)
      const catName = file.replace(/\.json$/,'')
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .toLowerCase();

      if (chosenCats.includes(catName)) {
        pool = pool.concat(arr);
      }
    });

    // mélange et extrait le nombre de manches
    pool.sort(()=>Math.random() - 0.5);
    return pool.slice(0, lobby.settings.rounds);
  }

  // --- Envoie une question (avec shuffle des choix) ---
  function emitQuestion(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;
    const qIdx = lobby.quiz.current;
    const qObj = lobby.quiz.questions[qIdx];
    const choices = [...qObj.options].sort(()=>Math.random()-0.5);

    io.in(`lobby-${lobbyId}`).emit('quizQuestion', {
      lobbyId: lobbyId,
      index:    qIdx + 1,
      total:    lobby.settings.rounds,
      question: qObj.question,
      choices
    });

    // réinitialise les réponses
    lobby.quiz.responses = {};
    // timer avant évaluation
    setTimeout(()=> finishQuestion(lobbyId), lobby.settings.timePerQuestion*1000);
  }

  // --- Termine la question, calcule scores, et passe à la suivante ---
  function finishQuestion(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;
    const qIdx = lobby.quiz.current;
    const qObj = lobby.quiz.questions[qIdx];

    // attribution des points
    lobby.players.forEach(p => {
      const resp = lobby.quiz.responses[p.userId];
      if (resp === qObj.correctAnswer) {
        lobby.quiz.scores[p.userId]++;
      }
    });

    // diffusion du résultat
    io.in(`lobby-${lobbyId}`).emit('questionResult', {
      correctAnswer: qObj.correctAnswer,
      scores:        lobby.quiz.scores
    });

    // passage à la suivante ou fin
    lobby.quiz.current++;
    if (lobby.quiz.current < lobby.settings.rounds) {
      setTimeout(()=> emitQuestion(lobbyId), 3000);
    } else {
      setTimeout(()=> {
        // j’envoie aussi la liste des joueurs pour corriger l’issue host
        const playersList = lobby.players.map(p=>({
          userId: p.userId,
          name:   p.name
        }));
        io.in(`lobby-${lobbyId}`).emit('quizEnded', {
          scores:  lobby.quiz.scores,
          players: playersList
        });
      }, 3000);
    }
  }

  // --- Gestion des connexions Socket.IO ---
  io.on('connection', socket => {
    const sess     = socket.request.session;
    if (!sess.user) return socket.disconnect(true);

    const userId   = sess.user.id;
    const username = sess.user.username;

    // 1) Reconnexion hôte possible dans les 60s
    for (let [id,lobby] of lobbies) {
      if (lobby.hostUserId === userId) {
        clearTimeout(pendingDestruct.get(id));
        pendingDestruct.delete(id);
        lobby.hostSocketId = socket.id;
        lobby.players = lobby.players.map(p =>
          p.userId===userId ? { ...p, socketId: socket.id } : p
        );
        socket.join(`lobby-${id}`);
        // idem, on inclut les counts ici
        const counts = getCategoryCounts(lobby.settings.difficulty);
        socket.emit('lobbyJoined', {
          players: lobby.players.map(pl=>({
            id:     pl.socketId,
            userId: pl.userId,
            name:   pl.name
          })),
          settings: {
            rounds:          lobby.settings.rounds,
            difficulty:      lobby.settings.difficulty,
            timePerQuestion: lobby.settings.timePerQuestion,
            hasPassword:     !!lobby.settings.password,
            password:        lobby.settings.password||'',
            categories:      lobby.settings.categories
          },
          hostId: lobby.hostUserId,
          code:   lobby.code,
          isHost: true,
          counts        // <-- et ici !
        });
        broadcastLobbyList();
        emitLobbyUpdate(id);
        break;
      }
    }

    // 2) CRUD lobby & players
    socket.on('getLobbyList', () => broadcastLobbyList());

    socket.on('createLobby', () => {
      const id   = nextLobbyId++;
      const code = generateLobbyCode(username);
      const lobby = {
        id,
        code,
        hostUserId:   userId,
        hostSocketId: socket.id,
        settings: {
          rounds:          5,
          difficulty:      'easy',
          timePerQuestion: 15,
          password:        '',
          categories:      [...ALL_CATEGORIES]
        },
        players: [{ socketId:socket.id, userId, name:username }],
        banned:  new Set()
      };
      lobbies.set(id, lobby);
      socket.join(`lobby-${id}`);
      // on inclut counts dès la création
      const counts = getCategoryCounts(lobby.settings.difficulty);
      socket.emit('lobbyJoined', {
        players: lobby.players.map(pl=>({
          id:pl.socketId,userId:pl.userId,name:pl.name
        })),
        settings: {
          rounds:5,
          difficulty:'easy',
          timePerQuestion:15,
          hasPassword:false,
          password:'',
          categories:[...ALL_CATEGORIES]
        },
        hostId:userId,
        code,
        isHost:true,
        counts      // <-- counts là aussi
      });
      broadcastLobbyList();
    });

    socket.on('joinLobby', ({ lobbyId, password }) => {
      const lobby = lobbies.get(lobbyId);
      if (!lobby) return socket.emit('errorMessage','Lobby introuvable.');
      if (lobby.banned.has(userId))
        return socket.emit('errorMessage','Vous êtes banni.');
      const pwd = lobby.settings.password||'';
      if (pwd && pwd !== (password||''))
        return socket.emit('errorMessage','Mot de passe incorrect.');

      const existing = lobby.players.find(p=>p.userId===userId);
      if (existing) {
        existing.socketId = socket.id;
      } else {
        lobby.players.push({ socketId:socket.id, userId, name:username });
        socket.to(`lobby-${lobbyId}`).emit('playerJoined', username);
      }
      socket.join(`lobby-${lobbyId}`);
      // idem : on renvoie counts
      const counts = getCategoryCounts(lobby.settings.difficulty);
      socket.emit('lobbyJoined', {
        players: lobby.players.map(pl=>({
          id:pl.socketId,userId:pl.userId,name:pl.name
        })),
        settings: {
          rounds:          lobby.settings.rounds,
          difficulty:      lobby.settings.difficulty,
          timePerQuestion: lobby.settings.timePerQuestion,
          hasPassword:     !!lobby.settings.password,
          categories:      lobby.settings.categories
        },
        hostId:lobby.hostUserId,
        code:lobby.code,
        isHost:userId===lobby.hostUserId,
        counts      // <-- counts ici aussi
      });
      broadcastLobbyList();
      emitLobbyUpdate(lobbyId);
    });

    socket.on('leaveLobby', () => {
      // si host → détruit
      for (let [id,lobby] of lobbies) {
        if (lobby.hostSocketId===socket.id) {
          io.in(`lobby-${id}`).emit('lobbyDestroyed');
          lobbies.delete(id);
          clearTimeout(pendingDestruct.get(id));
          pendingDestruct.delete(id);
          broadcastLobbyList();
          return;
        }
      }
      // sinon → part
      for (let [id,lobby] of lobbies) {
        const idx = lobby.players.findIndex(p=>p.socketId===socket.id);
        if (idx!==-1) {
          const name = lobby.players[idx].name;
          lobby.players.splice(idx,1);
          socket.leave(`lobby-${id}`);
          socket.emit('lobbyLeft');
          io.in(`lobby-${id}`).emit('playerLeft', name);
          broadcastLobbyList();
          emitLobbyUpdate(id);
          return;
        }
      }
    });

    socket.on('kickPlayer', targetId => {
      for (let [id,lobby] of lobbies) {
        if (lobby.hostSocketId===socket.id) {
          const t = lobby.players.find(p=>p.socketId===targetId);
          if (t) {
            io.sockets.sockets.get(targetId)?.leave(`lobby-${id}`);
            lobby.players = lobby.players.filter(p=>p.socketId!==targetId);
            io.in(`lobby-${id}`).emit('playerLeft', t.name);
            io.to(targetId).emit('kicked','Vous avez été expulsé.');
            broadcastLobbyList();
            emitLobbyUpdate(id);
          }
          break;
        }
      }
    });

    socket.on('banPlayer', targetId => {
      for (let [id,lobby] of lobbies) {
        if (lobby.hostSocketId===socket.id) {
          const t = lobby.players.find(p=>p.socketId===targetId);
          if (t) {
            lobby.banned.add(t.userId);
            io.sockets.sockets.get(targetId)?.leave(`lobby-${id}`);
            lobby.players = lobby.players.filter(p=>p.socketId!==targetId);
            io.in(`lobby-${id}`).emit('playerLeft', t.name);
            io.to(targetId).emit('kicked','Vous avez été banni.');
            broadcastLobbyList();
            emitLobbyUpdate(id);
          }
          break;
        }
      }
    });

    socket.on('updateSettings', settings => {
      for (let [id,lobby] of lobbies) {
        if (lobby.hostSocketId===socket.id) {
          lobby.settings.rounds          = settings.rounds;
          lobby.settings.difficulty      = settings.difficulty;
          lobby.settings.timePerQuestion = settings.timePerQuestion;
          lobby.settings.password        = settings.password||'';
          lobby.settings.categories      = settings.categories;
          emitLobbyUpdate(id);
          broadcastLobbyList();
          break;
        }
      }
    });

    socket.on('destroyLobby', () => {
      for (let [id,lobby] of lobbies) {
        if (lobby.hostSocketId===socket.id) {
          io.in(`lobby-${id}`).emit('lobbyDestroyed');
          lobbies.delete(id);
          clearTimeout(pendingDestruct.get(id));
          pendingDestruct.delete(id);
          broadcastLobbyList();
          break;
        }
      }
    });

    // --- Lancement du quiz ---
    socket.on('startQuiz', () => {
      for (let [id,lobby] of lobbies) {
        if (lobby.hostSocketId===socket.id) {
          const room = `lobby-${id}`;
          [5,4,3,2,1].forEach((n,i) => {
            setTimeout(()=> io.in(room).emit('quizCountdown', n), i*1000);
          });
          setTimeout(()=>{
            const questions = pickQuestions(lobby);
            lobby.quiz = {
              questions,
              current:0,
              scores: lobby.players.reduce((a,p)=>{ a[p.userId]=0; return a; }, {}),
              responses: {}
            };
            emitQuestion(id);
          }, 5000);
          break;
        }
      }
    });

    // Réception d'une réponse
    socket.on('submitAnswer', ({ lobbyId, answer }) => {
      const lobby = lobbies.get(lobbyId);
      if (!lobby || !lobby.quiz) return;
      if (lobby.quiz.responses[userId] !== undefined) return;
      lobby.quiz.responses[userId] = answer;
    });

    // --- Retour au lobby (host) ---
    socket.on('returnToLobby', () => {
      for (let [id,lobby] of lobbies) {
        if (lobby.hostSocketId === socket.id) {
          io.in(`lobby-${id}`).emit('returnToLobby');
          break;
        }
      }
    });

    // --- Déconnexion ---
    socket.on('disconnect', () => {
      for (let [id,lobby] of lobbies) {
        if (lobby.hostSocketId===socket.id) {
          const to = setTimeout(()=>{
            if (lobbies.has(id)) {
              io.in(`lobby-${id}`).emit('lobbyDestroyed');
              lobbies.delete(id);
              broadcastLobbyList();
            }
            pendingDestruct.delete(id);
          }, 60000);
          pendingDestruct.set(id, to);
        } else {
          const idx = lobby.players.findIndex(p=>p.socketId===socket.id);
          if (idx!==-1) {
            const name = lobby.players[idx].name;
            lobby.players.splice(idx,1);
            socket.to(`lobby-${id}`).emit('playerLeft', name);
            broadcastLobbyList();
            emitLobbyUpdate(id);
          }
        }
      }
    });
  });

  // --- utilitaire de génération de code ---
  function generateLobbyCode(hostName) {
    return `${hostName}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
  }
};
