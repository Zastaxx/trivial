// public/client.js
const socket           = io();
const userLabel        = document.getElementById('userLabel');
const lobbyListDiv     = document.getElementById('lobbyList');
const lobbyGrid        = lobbyListDiv.querySelector('.row');
const createLobbyBtn   = document.getElementById('createLobbyBtn');
const lobbyRoomDiv     = document.getElementById('lobbyRoom');
const hostPanel        = document.getElementById('hostPanel');
const roundsInput      = document.getElementById('roundsInput');
const difficultySelect = document.getElementById('difficultySelect');
const timeInput        = document.getElementById('timeInput');
const passwordInput    = document.getElementById('passwordInput');
const startBtn         = document.getElementById('startBtn');
const destroyBtn       = document.getElementById('destroyBtn');
const playersList      = document.getElementById('playersList');
const leaveBtn         = document.getElementById('leaveBtn');
const toastContainer   = document.getElementById('toastContainer');
const shareContainer   = document.getElementById('shareContainer');
const shareInput       = document.getElementById('shareInput');
const copyBtn          = document.getElementById('copyBtn');

const catAllCheckbox   = document.getElementById('cat_tout');
const catCheckboxes    = Array.from(
  document.querySelectorAll('#categoriesContainer .form-check-input')
).filter(cb => cb.id !== 'cat_tout');

const passwordModalEl    = document.getElementById('passwordModal');
const passwordModal      = new bootstrap.Modal(passwordModalEl);
const passwordInputJoin  = document.getElementById('passwordInputJoin');
const passwordError      = document.getElementById('passwordError');
const passwordSubmitBtn  = document.getElementById('passwordSubmitBtn');

const countdownOverlay   = document.getElementById('countdownOverlay');
const countdownText      = document.getElementById('countdownText');

const gameView          = document.getElementById('gameView');
const questionHeader    = document.getElementById('questionHeader');
const questionText      = document.getElementById('questionText');
const progressBar       = document.getElementById('questionProgress');
const timerCount        = document.getElementById('timerCount');
const choicesContainer  = document.getElementById('choicesContainer');
const scoreList         = document.getElementById('scoreList');

const resultView        = document.getElementById('resultView');
const finalScoreList    = document.getElementById('finalScoreList');
const returnBtn         = document.getElementById('returnBtn');
const waitingText       = document.getElementById('waitingText');

let pendingLobbyId      = null;
let amIHost             = false;
let codeParam           = new URLSearchParams(window.location.search).get('lobby');
let autoJoined          = false;
let playerNames         = {};
let codeToId            = {};
let currentLobbyId      = null;
let qTimer              = null;

// Toast helper
function showToast(type, msg) {
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0`;
  el.role      = 'alert';
  el.ariaLive  = 'assertive';
  el.ariaAtomic= 'true';
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${msg}</div>
      <button type="button"
              class="btn-close btn-close-white me-2 m-auto"
              data-bs-dismiss="toast"
              aria-label="Close"></button>
    </div>`;
  toastContainer.appendChild(el);
  new bootstrap.Toast(el, { delay:3000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

// View controls
function showLobbyRoom() {
  lobbyListDiv.classList.add('d-none');
  lobbyRoomDiv.classList.remove('d-none');
  gameView.classList.add('d-none');
  resultView.classList.add('d-none');
}
function showLobbyList() {
  lobbyRoomDiv.classList.add('d-none');
  gameView.classList.add('d-none');
  resultView.classList.add('d-none');
  lobbyListDiv.classList.remove('d-none');
}
function showGameView() {
  lobbyListDiv.classList.add('d-none');
  lobbyRoomDiv.classList.add('d-none');
  resultView.classList.add('d-none');
  gameView.classList.remove('d-none');
}
function showResultView(scores) {
  lobbyListDiv.classList.add('d-none');
  lobbyRoomDiv.classList.add('d-none');
  gameView.classList.add('d-none');
  resultView.classList.remove('d-none');

  finalScoreList.innerHTML = '';
  Object.entries(scores).forEach(([uId, sc]) => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between';
    li.textContent = playerNames[uId] || 'Inconnu';
    const badge = document.createElement('span');
    badge.className = 'badge bg-light text-dark rounded-pill';
    badge.textContent = sc;
    li.appendChild(badge);
    finalScoreList.appendChild(li);
  });

  if (amIHost) {
    returnBtn.classList.remove('d-none');
    waitingText.classList.add('d-none');
  } else {
    returnBtn.classList.add('d-none');
    waitingText.classList.remove('d-none');
  }
}

// Fetch current user
fetch('/api/me')
  .then(r => r.json())
  .then(u => userLabel.textContent = u.username);

// Lobby creation
createLobbyBtn.onclick = () => socket.emit('createLobby');

// Receive lobby list
socket.on('lobbyList', lobbies => {
  lobbyGrid.innerHTML = '';
  codeToId = {};
  lobbies.forEach(l => {
    codeToId[l.code] = l.id;
    const col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = `
      <div class="card text-dark h-100"
           data-id="${l.id}"
           data-code="${l.code}"
           data-haspass="${l.hasPassword}">
        <div class="card-body d-flex flex-column justify-content-center align-items-center">
          <h5 class="card-title">
            Lobby : ${l.code}${l.hasPassword?' 🔒':''}
          </h5>
          <p class="card-text">${l.playersCount} joueur(s)</p>
        </div>
      </div>`;
    const card = col.querySelector('.card');
    card.onclick = () => {
      if (l.hasPassword) {
        pendingLobbyId = l.id;
        passwordError.classList.add('d-none');
        passwordInputJoin.value = '';
        passwordModal.show();
      } else {
        socket.emit('joinLobby',{ lobbyId:l.id });
      }
    };
    lobbyGrid.appendChild(col);
  });

  if (codeParam && !autoJoined) {
    const foundId = codeToId[codeParam];
    if (foundId) {
      autoJoined = true;
      socket.emit('joinLobby',{ lobbyId:foundId });
      showToast('info',`Tentative de rejoindre ${codeParam}…`);
    }
  }
});

// Handle join/kick/destroy events
socket.on('lobbyJoined', payload => {
  passwordModal.hide();
  currentLobbyId = codeToId[payload.code];
  history.replaceState(null,'',`?lobby=${payload.code}`);
  updateUI(payload);
  showToast('success',`Bienvenue dans ${payload.code}`);
});
socket.on('errorMessage', msg => {
  if (passwordModalEl.classList.contains('show')) {
    passwordError.textContent = msg;
    passwordError.classList.remove('d-none');
  } else {
    showToast('warning', msg);
  }
});
socket.on('lobbyLeft',     () => { showToast('info','Vous avez quitté le lobby.'); showLobbyList(); });
socket.on('lobbyDestroyed',() => { showToast('info','Le lobby a été détruit.'); showLobbyList(); });
socket.on('kicked',        msg=>{ showToast('danger',msg); showLobbyList(); });
socket.on('playerJoined',  name=> showToast('success',`${name} a rejoint.`));
socket.on('playerLeft',    name=> showToast('info',   `${name} a quitté.`));

// Countdown
socket.on('quizCountdown', n => {
  countdownText.textContent = n;
  countdownOverlay.classList.remove('d-none');
});

// Question event
socket.on("quizQuestion", (data) => {
  currentLobbyId = data.lobbyId; // Assurez-vous de récupérer le lobbyId
  showGameView();
  countdownOverlay.classList.add("d-none");

  questionHeader.textContent = `Question ${data.index}/${data.total}`;
  questionText.textContent = data.question;

  // Smooth progress bar + decimal timer
  const totalMs = +timeInput.value * 1000;
  let elapsedMs = 0;
  timerCount.textContent = (totalMs / 1000).toFixed(2);
  progressBar.style.width = "100%";
  if (qTimer) clearInterval(qTimer);
  qTimer = setInterval(() => {
      elapsedMs += 100;
      const perc = Math.max(0, 100 - (elapsedMs * 100) / totalMs);
      progressBar.style.width = perc + "%";
      const secsLeft = Math.max(0, (totalMs - elapsedMs) / 1000);
      timerCount.textContent = secsLeft.toFixed(2);
      if (elapsedMs >= totalMs) clearInterval(qTimer);
  }, 100);

  choicesContainer.innerHTML = "";
  data.choices.forEach((choice) => {
      const btn = document.createElement("button");
      btn.className = "list-group-item list-group-item-action";
      btn.textContent = choice;
      btn.onclick = () => {
          socket.emit("submitAnswer", { lobbyId: currentLobbyId, answer: choice });
          Array.from(choicesContainer.children).forEach((c) => (c.disabled = true));
      };
      choicesContainer.appendChild(btn);
  });
});

// After each question (no scoreboard view here)
socket.on('questionResult', ({ correctAnswer, scores }) => {
  Array.from(choicesContainer.children).forEach(btn => {
    btn.classList.add(
      btn.textContent === correctAnswer
        ? 'list-group-item-success'
        : 'list-group-item-secondary'
    );
    btn.disabled = true;
  });
});

// Quiz end
socket.on('quizEnded', ({ scores, players }) => {
  // rebuild playerNames for host
  playerNames = {};
  players.forEach(p => playerNames[p.userId] = p.name);
  showResultView(scores);
});

// Return to lobby
socket.on('returnToLobby', () => showLobbyRoom());

// Update lobby UI (includes category counts)
socket.on('lobbyUpdated', updateUI);
function updateUI({ players, settings, hostId, code, isHost, counts }) {
  amIHost = isHost;
  showLobbyRoom();

  playerNames = {};
  players.forEach(p => playerNames[p.userId] = p.name);

  roundsInput.value      = settings.rounds;
  difficultySelect.value = settings.difficulty;
  timeInput.value        = settings.timePerQuestion;
  passwordInput.value    = settings.password || '';

  catCheckboxes.forEach(cb => {
    cb.checked = settings.categories.includes(cb.value);
    cb.disabled = !isHost;
  });
  catAllCheckbox.checked = catCheckboxes.every(cb=>cb.checked);
  catAllCheckbox.disabled = !isHost;

  // Update labels with counts
  Object.entries(counts).forEach(([cat, cnt]) => {
    const cb = document.querySelector(`input[value="${cat}"]`);
    const lbl = document.querySelector(`label[for="${cb.id}"]`);
    lbl.textContent = `${cat} (${cnt})`;
  });

  hostPanel.querySelectorAll('input,select')
           .forEach(el => el.disabled = !isHost);
  startBtn.style.display   = isHost?'block':'none';
  destroyBtn.style.display = isHost?'block':'none';

  shareInput.value     = `${window.location.origin}/?lobby=${code}`;
  shareContainer.classList.remove('d-none');

  playersList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex align-items-center';
    const span = document.createElement('span');
    span.textContent = p.name + (p.userId===hostId?' (Hôte)':'');
    li.appendChild(span);
    if (isHost && p.id !== socket.id) {
      const grp = document.createElement('div');
      grp.className = 'ms-auto d-flex gap-2';
      const k = document.createElement('button');
      k.className='btn btn-sm btn-danger'; k.textContent='Kick';
      k.onclick = ()=>socket.emit('kickPlayer',p.id);
      const b = document.createElement('button');
      b.className='btn btn-sm btn-warning'; b.textContent='Ban';
      b.onclick = ()=>socket.emit('banPlayer',p.id);
      grp.append(k,b);
      li.appendChild(grp);
    }
    playersList.appendChild(li);
  });
}

// Copy link
copyBtn.onclick = () => {
  navigator.clipboard.writeText(shareInput.value)
    .then(()=>showToast('success','Lien copié !'));
};

// Password modal submit
passwordSubmitBtn.onclick = () => {
  socket.emit('joinLobby',{ lobbyId:pendingLobbyId, password:passwordInputJoin.value });
};

// Host return
returnBtn.onclick = () => socket.emit('returnToLobby');

// Send settings
function sendSettings() {
  if (!amIHost) return;
  const cats = catAllCheckbox.checked
    ? catCheckboxes.map(cb=>cb.value)
    : catCheckboxes.filter(cb=>cb.checked).map(cb=>cb.value);
  socket.emit('updateSettings',{
    rounds:          +roundsInput.value,
    difficulty:       difficultySelect.value,
    timePerQuestion:+timeInput.value,
    password:         passwordInput.value.trim(),
    categories:       cats
  });
}
roundsInput.addEventListener('change', sendSettings);
difficultySelect.addEventListener('change', sendSettings);
timeInput.addEventListener('change', sendSettings);
passwordInput.addEventListener('change', sendSettings);
catAllCheckbox.addEventListener('change', () => {
  catCheckboxes.forEach(cb=>cb.checked=catAllCheckbox.checked);
  sendSettings();
});
catCheckboxes.forEach(cb=>cb.addEventListener('change', () => {
  catAllCheckbox.checked = catCheckboxes.every(c=>c.checked);
  sendSettings();
}));

startBtn.onclick   = ()=>socket.emit('startQuiz');
destroyBtn.onclick = ()=>socket.emit('destroyLobby');
leaveBtn.onclick   = ()=>socket.emit('leaveLobby');

// Initial request
socket.emit('getLobbyList');
