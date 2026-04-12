/* ============================================
   VALORANT TOURNAMENT FIXTURE BUILDER
   Knockout bracket generation with drag-and-drop
   team reordering, PDF export, and clipboard.
   ============================================ */

// ——— DOM References ———
const eventNameInput  = document.getElementById('event-name');
const teamCountInput  = document.getElementById('team-count');
const setCountBtn     = document.getElementById('btn-set-count');
const teamFieldsDiv   = document.getElementById('team-fields');
const generateBtn     = document.getElementById('btn-generate');
const resetBtn        = document.getElementById('btn-reset');
const downloadFixturesBtn = document.getElementById('btn-download-fixtures');
const downloadBracketBtn  = document.getElementById('btn-download-bracket');
const shareBtn            = document.getElementById('btn-share');
const copyBtn             = document.getElementById('btn-copy');
const bracketWrapper  = document.getElementById('bracket-wrapper');
const bracketDiv      = document.getElementById('bracket');
const errorBox        = document.getElementById('error-msg');
const toast           = document.getElementById('toast');
const teamInputCard   = document.getElementById('team-input-card');
const uploadBtn       = document.getElementById('btn-upload-excel');
const excelUpload     = document.getElementById('excel-upload');
const masterResetBtn  = document.getElementById('btn-master-reset');

let currentMatches = [];   // first-round matches for clipboard/PDF
let bracketRounds  = [];   // all rounds for bracket rendering
let orderedTeams = [];

/* ================================================
   UTILITIES
   ================================================ */

function showError(msg) {
  errorBox.innerHTML = `<span class="icon">⚠</span> ${msg}`;
  errorBox.classList.add('visible');
  setTimeout(() => errorBox.classList.remove('visible'), 4000);
}

function clearError() {
  errorBox.classList.remove('visible');
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fisher-Yates Shuffle
function fisherYatesShuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/* ================================================
/* ================================================
   FIREBASE REAL-TIME SYNC
   ================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, deleteDoc }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDLgPSmyw3GFcCCePDmFNNzc0AR77KF8oA",
  authDomain: "valohaiyaar.firebaseapp.com",
  projectId: "valohaiyaar",
  storageBucket: "valohaiyaar.firebasestorage.app",
  messagingSenderId: "523837926192",
  appId: "1:523837926192:web:216b35b3754baa9c7ef6f5",
  measurementId: "G-N7TYCPW4G3"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const STATE_DOC = doc(db, 'tournament', 'state');

// Debounce so rapid bracket clicks don't spam Firestore
let _saveTimer = null;
function saveState() {
  if (bracketRounds.length === 0) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    const state = {
      eventName: eventNameInput ? eventNameInput.value : '',
      count: teamCountInput ? teamCountInput.value : '',
      rounds: bracketRounds,
      matches: currentMatches,
      orderedTeams: orderedTeams,
      updatedAt: Date.now()
    };
    try {
      await setDoc(STATE_DOC, state);
    } catch (err) {
      console.error('Firestore save failed:', err);
      localStorage.setItem('valTournamentState', JSON.stringify(state));
    }
  }, 400);
}

function applyState(state) {
  if (!state) return;
  if (state.eventName) {
    if (eventNameInput) eventNameInput.value = state.eventName;
    const pubTitle = document.getElementById('public-title');
    if (pubTitle) pubTitle.textContent = state.eventName;
  }
  if (teamCountInput && state.count) teamCountInput.value = state.count;
  bracketRounds  = state.rounds       || [];
  currentMatches = state.matches      || [];
  orderedTeams   = state.orderedTeams || [];
  if (teamInputCard) teamInputCard.style.display = 'none';
  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'none';
  renderBracket();
}

// Real-time listener — fires instantly on every device when Firestore updates
function startRealtimeSync() {
  onSnapshot(STATE_DOC, (snapshot) => {
    if (snapshot.exists()) {
      applyState(snapshot.data());
    } else {
      const emptyState = document.getElementById('empty-state');
      if (emptyState) emptyState.style.display = 'block';
      hideBracket();
    }
  }, (err) => {
    console.error('Firestore listener error:', err);
    showToast('Live sync unavailable — using local fallback.');
    const saved = localStorage.getItem('valTournamentState');
    if (saved) { try { applyState(JSON.parse(saved)); } catch(e) {} }
  });
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#state=')) {
    try {
      const state = JSON.parse(decodeURIComponent(atob(hash.substring(7))));
      applyState(state);
      showToast('Loaded shared tournament bracket!');
      window.history.replaceState(null, null, window.location.pathname);
    } catch(err) {
      showError('Failed to load share link.');
    }
  }
  startRealtimeSync();
});


/* ================================================
   STEP 1 — SET TEAM COUNT & GENERATE INPUTS
   ================================================ */

setCountBtn?.addEventListener('click', () => {
  clearError();
  const count = parseInt(teamCountInput.value, 10);

  if (isNaN(count) || count < 2) {
    showError('Please enter a valid number (minimum 2 teams).');
    return;
  }
  if (count > 128) {
    showError('Maximum 128 teams supported.');
    return;
  }


  teamFieldsDiv.innerHTML = '';
  hideBracket();

  for (let i = 1; i <= count; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'team-input-wrapper';
    wrapper.setAttribute('draggable', 'true');
    wrapper.setAttribute('data-index', i);

    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.textContent = '⠿';

    const numLabel = document.createElement('span');
    numLabel.className = 'team-number';
    numLabel.textContent = String(i).padStart(2, '0');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input-field team-name-input';
    input.placeholder = `Team ${i} name`;
    input.maxLength = 30;

    wrapper.appendChild(dragHandle);
    wrapper.appendChild(numLabel);
    wrapper.appendChild(input);
    teamFieldsDiv.appendChild(wrapper);
  }

  // Initialise drag-and-drop
  initDragAndDrop();

  teamInputCard.style.display = 'block';
  teamInputCard.style.animation = 'none';
  void teamInputCard.offsetWidth;
  teamInputCard.style.animation = 'fadeSlideUp 0.6s ease-out';
});

teamCountInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') setCountBtn.click();
});

/* ================================================
   DRAG-AND-DROP TEAM REORDERING
   ================================================ */

function initDragAndDrop() {
  let dragSrc = null;

  teamFieldsDiv.querySelectorAll('.team-input-wrapper').forEach(wrapper => {
    wrapper.addEventListener('dragstart', (e) => {
      dragSrc = wrapper;
      wrapper.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ''); // required for FF
    });

    wrapper.addEventListener('dragend', () => {
      wrapper.classList.remove('dragging');
      teamFieldsDiv.querySelectorAll('.team-input-wrapper').forEach(w =>
        w.classList.remove('drag-over')
      );
      renumberTeams();
    });

    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (wrapper !== dragSrc) {
        wrapper.classList.add('drag-over');
      }
    });

    wrapper.addEventListener('dragleave', () => {
      wrapper.classList.remove('drag-over');
    });

    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('drag-over');
      if (dragSrc && dragSrc !== wrapper) {
        // Determine position and swap in DOM
        const allWrappers = [...teamFieldsDiv.querySelectorAll('.team-input-wrapper')];
        const fromIdx = allWrappers.indexOf(dragSrc);
        const toIdx   = allWrappers.indexOf(wrapper);

        if (fromIdx < toIdx) {
          teamFieldsDiv.insertBefore(dragSrc, wrapper.nextSibling);
        } else {
          teamFieldsDiv.insertBefore(dragSrc, wrapper);
        }
      }
    });
  });
}

// Re-number team labels after reorder
function renumberTeams() {
  teamFieldsDiv.querySelectorAll('.team-input-wrapper').forEach((w, i) => {
    const num = w.querySelector('.team-number');
    if (num) num.textContent = String(i + 1).padStart(2, '0');
  });
}

/* ================================================
   EXCEL FILE UPLOAD
   ================================================ */

uploadBtn?.addEventListener('click', () => excelUpload.click());

excelUpload?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      if (typeof XLSX === 'undefined') {
        showError('Excel processing library failed to load.');
        return;
      }
      const workbook = XLSX.read(data, {type: 'array'});
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON array of arrays
      const rawData = XLSX.utils.sheet_to_json(worksheet, {header: 1});
      
      let names = [];
      rawData.forEach((row, rIdx) => {
        if (!row || row.length === 0) return;
        const val = row[row.length - 1]; // naive assumption: name is the last full column
        if (val) {
          const text = String(val).trim();
          // skip header if "team" is in the first row
          if (rIdx === 0 && text.toLowerCase().includes('team')) return;
          if (text.length > 0) names.push(text);
        }
      });

      if (names.length < 2) {
        showError('Could not find enough teams in the Excel file.');
        return;
      }
      if (names.length > 128) {
        showError('Maximum 128 teams supported.');
        return;
      }

      // Configure the team inputs automatically
      teamCountInput.value = names.length;
      setCountBtn.click();

      // Populate names instantly
      const inputs = teamFieldsDiv.querySelectorAll('.team-name-input');
      names.forEach((name, idx) => {
        if (inputs[idx]) inputs[idx].value = name;
      });

      showToast(`Successfully loaded ${names.length} teams from Excel!`);
    } catch (err) {
      showError('Failed to parse Excel file. Please check format.');
      console.error(err);
    }
    excelUpload.value = ''; // reset file input
  };
  reader.readAsArrayBuffer(file);
});

/* ================================================
   EXCEL BULK PASTE
   ================================================ */

teamFieldsDiv?.addEventListener('paste', (e) => {
  if (!e.target.classList.contains('team-name-input')) return;

  const pasteData = (e.clipboardData || window.clipboardData).getData('text');
  if (!pasteData) return;

  // Split into lines
  const lines = pasteData.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  
  // If it's a multi-line paste (like from Excel)
  if (lines.length > 1) {
    e.preventDefault(); 

    const allInputs = Array.from(teamFieldsDiv.querySelectorAll('.team-name-input'));
    const startIndex = allInputs.indexOf(e.target);
    
    let lineIdx = 0;
    for (let i = startIndex; i < allInputs.length; i++) {
      if (lineIdx < lines.length) {
        // If user copied "Number \t Name" from Excel, grab the last part (the name)
        const parts = lines[lineIdx].split('\t');
        const namePart = parts[parts.length - 1].trim(); 
        
        allInputs[i].value = namePart;
        lineIdx++;
      } else {
        break;
      }
    }
    showToast(`Pasted ${lineIdx} team names!`);
  }
});

/* ================================================
   STEP 2 — GENERATE BRACKET
   ================================================ */

generateBtn?.addEventListener('click', () => {
  clearError();

  const inputs = document.querySelectorAll('.team-name-input');
  if (inputs.length === 0) {
    showError('Set the number of teams first.');
    return;
  }

  const names = [];
  let hasEmpty = false;

  inputs.forEach(input => {
    const name = input.value.trim();
    if (!name) hasEmpty = true;
    else names.push(name);
  });

  if (hasEmpty) {
    showError('All team name fields must be filled in.');
    return;
  }

  const lowerNames = names.map(n => n.toLowerCase());
  const uniqueSet = new Set(lowerNames);
  if (uniqueSet.size !== lowerNames.length) {
    showError('Duplicate team names detected. Each team must have a unique name.');
    return;
  }



orderedTeams = fisherYatesShuffle(names);
buildBracket(orderedTeams);
  renderBracket();
  saveState();
});

/* ================================================
   BUILD & RENDER BRACKET
   ================================================ */

function buildBracket(teams) {
  bracketRounds = [];
  currentMatches = [];

  const n = teams.length;

  // Calculate next power of 2
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
  const byes = bracketSize - n;
  const totalMatches = bracketSize / 2;

  // Spread BYEs
  const isBye = new Array(totalMatches).fill(false);
  if (byes > 0) {
    for (let i = 0; i < byes; i++) {
      isBye[Math.floor(i * totalMatches / byes)] = true;
    }
  }

  // Round 1
  const round1 = [];
  let teamIdx = 0;

  for (let i = 0; i < totalMatches; i++) {
    const teamA = teams[teamIdx++];
    const teamB = isBye[i] ? null : teams[teamIdx++];

    const match = {
      num: i + 1,
      teamA: teamA,
      teamB: teamB
    };

    round1.push(match);
    currentMatches.push(match);
  }

  bracketRounds.push(round1);

  // Next rounds
  let prevRound = round1;
  let matchesInRound = totalMatches;

  while (matchesInRound > 1) {
    matchesInRound = matchesInRound / 2;
    const nextRound = [];

    for (let i = 0; i < matchesInRound; i++) {
      const feedMatch1 = prevRound[i * 2];
      const feedMatch2 = prevRound[i * 2 + 1];

      let nextTeamA = 'TBD';
      if (feedMatch1 && feedMatch1.teamB === null) {
        nextTeamA = feedMatch1.teamA;
      }

      let nextTeamB = 'TBD';
      if (feedMatch2 && feedMatch2.teamB === null) {
        nextTeamB = feedMatch2.teamA;
      }

      nextRound.push({
        num: nextRound.length + 1,
        teamA: nextTeamA,
        teamB: nextTeamB
      });
    }

    bracketRounds.push(nextRound);
    prevRound = nextRound;
  }
}

function getRoundName(roundIdx, totalRounds) {
  const remaining = totalRounds - roundIdx;
  if (remaining === 1) return 'Finals';
  if (remaining === 2) return 'Semi-Finals';
  if (remaining === 3) return 'Quarter-Finals';
  return `Round of ${Math.pow(2, remaining)}`;
}


function renderBracket() {
  bracketDiv.innerHTML = '';
  const totalRounds = bracketRounds.length;
  const isAdmin = !!document.getElementById('team-input-card');

  bracketRounds.forEach((round, rIdx) => {
    const roundCol = document.createElement('div');
    roundCol.className = 'bracket-round';

    const roundTitle = document.createElement('div');
    roundTitle.className = 'round-title';
    roundTitle.textContent = getRoundName(rIdx, totalRounds);
    roundCol.appendChild(roundTitle);

    const matchesContainer = document.createElement('div');
    matchesContainer.className = 'round-matches';

    round.forEach((match, mIdx) => {
      const matchEl = document.createElement('div');
      matchEl.className = 'bracket-match';
      if (rIdx === 0 && isAdmin) {
        matchEl.setAttribute('draggable', 'true');
      }
      matchEl.setAttribute('data-round', rIdx);
      matchEl.setAttribute('data-match', mIdx);
      matchEl.matchData = match;
      // Reduced delay so it doesn't animate endlessly on re-renders, or rely on CSS class
      matchEl.style.animation = 'none'; // We'll keep it fast for interactivity

      const isTBD = (rIdx > 0);
      let teamAClass = match.teamA === 'TBD' ? 'bracket-team tbd' : 'bracket-team';
      let teamBClass = match.teamB === 'TBD' ? 'bracket-team tbd' : 'bracket-team';
      
      if (match.teamA === 'BYE') teamAClass += ' bye';
      if (match.teamB === 'BYE') teamBClass += ' bye';

      // Visual States
      if (match.winner === 'teamA') {
        teamAClass += ' winner';
        if (match.teamB !== null && match.teamB !== 'TBD') teamBClass += ' eliminated';
      } else if (match.winner === 'teamB') {
        teamBClass += ' winner';
        if (match.teamA !== null && match.teamA !== 'TBD') teamAClass += ' eliminated';
      }

      const teamAHTML = `
        <div class="${teamAClass}" ${isAdmin ? 'draggable="true"' : ''} data-round="${rIdx}" data-match="${mIdx}" data-teampos="teamA">
          <span class="seed">${rIdx === 0 ? (mIdx * 2 + 1) : ''}</span>
          <span class="bracket-team-name" data-name="${escapeHtml(match.teamA)}">
  ${escapeHtml(match.teamA)}
</span>
        </div>`;

      let teamBHTML = '';
      if (match.teamB !== null) {
        teamBHTML = `
        <div class="${teamBClass}" ${isAdmin ? 'draggable="true"' : ''} data-round="${rIdx}" data-match="${mIdx}" data-teampos="teamB">
          <span class="seed">${rIdx === 0 ? (mIdx * 2 + 2) : ''}</span>
          <span class="bracket-team-name" data-name="${escapeHtml(match.teamB)}">
  ${escapeHtml(match.teamB)}
</span>
        </div>`;
      } else {
        teamBHTML = `<div class="bracket-team bye"><span class="bracket-team-name">BYE</span></div>`;
      }

      let infoHTML = '';
      if (match.info) {
        infoHTML = `<div class="match-info-text">${escapeHtml(match.info)}</div>`;
      }

      matchEl.innerHTML = infoHTML + teamAHTML + `<div class="bracket-vs">VS<span class="match-info-btn" title="Edit Match Info (Time/Lobby)">🗓️</span></div>` + teamBHTML;
      matchesContainer.appendChild(matchEl);
    });

    roundCol.appendChild(matchesContainer);
    bracketDiv.appendChild(roundCol);

    // Add connector column between rounds (except after last)
    if (rIdx < totalRounds - 1) {
      const connCol = document.createElement('div');
      connCol.className = 'bracket-connectors';
      // One connector per pair of matches feeding into next round
      for (let c = 0; c < round.length; c += 2) {
        const conn = document.createElement('div');
        conn.className = 'connector-pair';
        conn.innerHTML = `
          <div class="conn-line conn-top"></div>
          <div class="conn-line conn-bot"></div>
          <div class="conn-line conn-mid"></div>
        `;
        connCol.appendChild(conn);
      }
      bracketDiv.appendChild(connCol);
    }
  });

  bracketWrapper.style.display = 'block';

  if (!bracketWrapper.classList.contains('loaded')) {
    bracketWrapper.style.animation = 'fadeSlideUp 0.6s ease-out';
    bracketWrapper.classList.add('loaded');
  }

  // Only initialise drag systems on the admin panel
  if (isAdmin) {
    initMatchDragAndDrop();
    initTeamDragAndDrop();
  }

  if (!bracketWrapper.classList.contains('initialized')) {
    bracketWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    bracketWrapper.classList.add('initialized');
  }
}

/* ================================================
   INTERACTIVE BRACKET (CLICK-TO-ADVANCE)
   ================================================ */

bracketDiv?.addEventListener('click', (e) => {
  // Only allow interactiveness if we are on Admin panel
  if (!document.getElementById('team-input-card')) return;
  
  // Guarantee e.target is an Element (TextNodes do not have .closest() and will crash!)
  const tgt = e.target instanceof Element ? e.target : e.target.parentElement;
  if (!tgt) return;

  const infoBtn = tgt.closest('.match-info-btn');
  if (infoBtn) {
    e.stopPropagation();
    const matchEl = infoBtn.closest('.bracket-match');
    const rIdx = parseInt(matchEl.getAttribute('data-round'), 10);
    const mIdx = parseInt(matchEl.getAttribute('data-match'), 10);
    const match = bracketRounds[rIdx][mIdx];
    
    const newInfo = prompt('Enter Match Info (e.g. "14:00 - Main Stage"):', match.info || '');
    if (newInfo !== null) {
      match.info = newInfo.trim();
      
      // Update the 1st round match in currentMatches if we edited Round 1
      if (rIdx === 0 && currentMatches[mIdx]) {
        currentMatches[mIdx].info = match.info;
      }
      
      renderBracket();
      saveState();
    }
    return;
  }

  // Handle VS click (Reset match)
  const vsArea = tgt.closest('.match-vs') || tgt.closest('.reset-vs-btn');
  if (vsArea && vsArea.textContent.includes('VS')) {
    e.stopPropagation();
    const matchEl = vsArea.closest('.bracket-match');
    if (matchEl) {
      const rIdx = parseInt(matchEl.getAttribute('data-round'), 10);
      const mIdx = parseInt(matchEl.getAttribute('data-match'), 10);
      resetMatch(rIdx, mIdx);
    }
    return;
  }

  const teamEl = tgt.closest('.bracket-team');
  if (!teamEl) return;

  // Ignore clicks on TBD, BYE, or eliminated teams
  if (teamEl.classList.contains('tbd') || teamEl.classList.contains('bye') || teamEl.classList.contains('eliminated')) {
    return;
  }

  const rIdx = parseInt(teamEl.getAttribute('data-round'), 10);
  const mIdx = parseInt(teamEl.getAttribute('data-match'), 10);
  const teamPos = teamEl.getAttribute('data-teampos'); // 'teamA' or 'teamB'

  // Cannot advance finals
  if (rIdx >= bracketRounds.length - 1) return;

  const match = bracketRounds[rIdx][mIdx];
  const advancingTeam = match[teamPos];

  // If same team clicked again → UNDO
if (match.winner === teamPos) {
  match.winner = null;
  resetMatch(rIdx, mIdx);
  return;
}

// If switching winner → clear previous
if (match.winner && match.winner !== teamPos) {
  resetMatch(rIdx, mIdx);
}

// Set winner
match.winner = teamPos;

// Advance normally
advanceTeam(rIdx, mIdx, advancingTeam, teamPos);
});

function advanceTeam(rIdx, mIdx, teamName, teamPos) {
  const nextRoundIdx = rIdx + 1;
  if (nextRoundIdx >= bracketRounds.length) return;

  const nextMatchIdx = Math.floor(mIdx / 2);
  const isTeamA = mIdx % 2 === 0;

  if (isTeamA) {
    bracketRounds[nextRoundIdx][nextMatchIdx].teamA = teamName;
  } else {
    bracketRounds[nextRoundIdx][nextMatchIdx].teamB = teamName;
  }
  
  saveState();
  renderBracket();
}

function resetMatch(rIdx, mIdx) {
  const nextRIdx = rIdx + 1;
  if (nextRIdx >= bracketRounds.length) {
    showToast('Cannot reset the final match.');
    return;
  }

  const nextMIdx = Math.floor(mIdx / 2);
  const isTeamA = mIdx % 2 === 0;

  const nextMatch = bracketRounds[nextRIdx][nextMIdx];
  const advancedTeam = isTeamA ? nextMatch.teamA : nextMatch.teamB;

  // Clear immediate next slot
  if (isTeamA) {
    nextMatch.teamA = null;
  } else {
    nextMatch.teamB = null;
  }

  // Cascade the deletion down the bracket if they advanced multiple rounds before the reset
  if (advancedTeam) {
    let currentTeamToClear = advancedTeam;
    for (let r = nextRIdx + 1; r < bracketRounds.length; r++) {
      let foundAndCleared = false;
      for (let m = 0; m < bracketRounds[r].length; m++) {
        if (bracketRounds[r][m].teamA === currentTeamToClear) {
          bracketRounds[r][m].teamA = null;
          foundAndCleared = true;
        }
        if (bracketRounds[r][m].teamB === currentTeamToClear) {
          bracketRounds[r][m].teamB = null;
          foundAndCleared = true;
        }
      }
      if (!foundAndCleared) break;
    }
  }

  saveState();
  renderBracket();
  showToast('Match properly reset!');
}

function hideBracket() {
  bracketWrapper.style.display = 'none';
  bracketDiv.innerHTML = '';
  currentMatches = [];
  bracketRounds = [];
}

masterResetBtn?.addEventListener('click', () => {
  if (!confirm('Are you sure you want to permanently clear the current active tournament bracket? This cannot be undone.')) return;
  deleteDoc(STATE_DOC).catch(() => {});
  localStorage.removeItem('valTournamentState');
  location.reload();
});

/* ================================================
   RESET
   ================================================ */

resetBtn?.addEventListener('click', () => {
  if (!confirm('Are you sure you want to reset everything? This will wipe the tournament.')) return;

  teamCountInput.value = '16';
  teamFieldsDiv.innerHTML = '';
  teamInputCard.style.display = 'none';
  hideBracket();
  clearError();
  deleteDoc(STATE_DOC).catch(() => {});
  localStorage.removeItem('valTournamentState');
  showToast('Tournament wiped — ready for new teams!');
});

/* ================================================
   COPY TO CLIPBOARD
   ================================================ */

copyBtn?.addEventListener('click', () => {
  if (currentMatches.length === 0) return;

  const text = currentMatches
    .map(m => `Match ${m.num}: ${m.teamA} vs ${m.teamB}`)
    .join('\n');

  navigator.clipboard.writeText(text).then(() => {
    showToast('Matches copied to clipboard!');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Matches copied to clipboard!');
  });
});

/* ================================================
   SHAREABLE VIEWER LINK
   ================================================ */

shareBtn?.addEventListener('click', () => {
  if (bracketRounds.length === 0) return;
  const state = {
    count: teamCountInput.value,
    rounds: bracketRounds,
    matches: currentMatches
  };
  try {
    const jsonStr = JSON.stringify(state);
    const base64 = btoa(encodeURIComponent(jsonStr));
    const shareUrl = window.location.origin + window.location.pathname + '#state=' + base64;
    
    // Check if the URL is too massive for a browser (usually ~2000 chars limit is safe, though modern browsers handle more)
    // If it's a huge 128 team bracket, it might be extremely long. 
    
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Shareable Link copied to clipboard!');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Shareable Link copied to clipboard!');
    });
  } catch (err) {
    showError('Bracket is too large to encode into a URL.');
  }
});

/* ================================================
   PDF DOWNLOAD: MATCH FIXTURES (List View)
   ================================================ */

downloadFixturesBtn?.addEventListener('click', () => {
  if (currentMatches.length === 0) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Background
  doc.setFillColor(15, 25, 35);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Red accent top
  doc.setFillColor(255, 70, 85);
  doc.rect(0, 0, pageW, 3, 'F');

  let y = 28;
  const titleText = eventNameInput.value.trim().toUpperCase() || 'MATCH FIXTURES';
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(255, 70, 85);
  doc.text(titleText, pageW / 2, y, { align: 'center' });

  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(139, 151, 143);
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  doc.text(`Generated on ${dateStr}  •  ${currentMatches.length} matches`, pageW / 2, y, { align: 'center' });

  y += 8;
  doc.setDrawColor(255, 70, 85);
  doc.setLineWidth(0.4);
  doc.line(20, y, pageW - 20, y);
  y += 10;

  const rowH = 14;
  const marginX = 20;
  const cardW = pageW - marginX * 2;

  currentMatches.forEach((match, i) => {
    if (y + rowH > pageH - 15) {
      doc.addPage();
      doc.setFillColor(15, 25, 35);
      doc.rect(0, 0, pageW, pageH, 'F');
      doc.setFillColor(255, 70, 85);
      doc.rect(0, 0, pageW, 3, 'F');
      y = 20;
    }

    const bgShade = i % 2 === 0 ? 22 : 28;
    doc.setFillColor(bgShade, bgShade + 10, bgShade + 16);
    doc.roundedRect(marginX, y, cardW, rowH, 2, 2, 'F');

    doc.setFillColor(255, 70, 85);
    doc.rect(marginX, y, 2.5, rowH, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 70, 85);
    doc.text(`MATCH ${match.num}`, marginX + 8, y + rowH / 2 + 1, { baseline: 'middle' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(236, 232, 225);
    const matchText = `${match.teamA}   vs   ${match.teamB}`;
    doc.text(matchText, marginX + 45, y + rowH / 2 + 1, { baseline: 'middle' });

    if (match.info) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(164, 177, 169);
      doc.text(match.info, pageW - marginX - 10, y + rowH / 2 + 1, { align: 'right', baseline: 'middle' });
    }

    y += rowH + 3;
  });

  doc.setFontSize(8);
  doc.setTextColor(80, 90, 85);
  doc.text('VALORANT Tournament Fixture Builder', pageW / 2, pageH - 8, { align: 'center' });

  doc.save('match_fixtures.pdf');
  showToast('Fixtures PDF downloaded!');
});

/* ================================================
   PDF DOWNLOAD: KNOCKOUT BRACKET (Tree View)
   ================================================ */

downloadBracketBtn?.addEventListener('click', () => {
  if (currentMatches.length === 0) return;

  const { jsPDF } = window.jspdf;

  const matchCountRound1 = bracketRounds[0].length;
  const totalRounds = bracketRounds.length;
  const MAX_PER_PAGE = 16; 

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = 297;
  const pageH = 210;

  function renderPage(title, rMin, rMax, matchFilterFn) {
    doc.setFillColor(15, 25, 35);
    doc.rect(0, 0, pageW, pageH, 'F');
    doc.setFillColor(255, 70, 85);
    doc.rect(0, 0, pageW, 3, 'F');

    // Title
    let y = 18;
    const globalTitle = eventNameInput.value.trim().toUpperCase() || 'KNOCKOUT BRACKET';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(255, 70, 85);
    doc.text(globalTitle, pageW / 2, y, { align: 'center' });

    y += 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(236, 232, 225);
    doc.text(title, pageW / 2, y, { align: 'center' });

    y += 10;
    const totalRoundsOnPage = rMax - rMin + 1;
    const roundWidth  = (pageW - 20) / totalRoundsOnPage;
    let matchCoords = [];

    for (let rIdx = rMin; rIdx <= rMax; rIdx++) {
      if (rIdx >= totalRounds) break;
      const pageRoundIdx = rIdx - rMin;
      matchCoords[pageRoundIdx] = {}; // Map to handle sparse arrays
      
      const colX = 10 + pageRoundIdx * roundWidth;
      const colCenterX = colX + roundWidth / 2;

      // Round title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 70, 85);
      doc.text(getRoundName(rIdx, totalRounds).toUpperCase(), colCenterX, y, { align: 'center' });

      // Filter matches
      const allMatches = bracketRounds[rIdx];
      const pageMatches = [];
      for (let m = 0; m < allMatches.length; m++) {
        if (matchFilterFn(rIdx, m)) {
          pageMatches.push({ matchObj: allMatches[m], originalMIdx: m });
        }
      }

      const matchCount = pageMatches.length;
      const availH = pageH - y - 10;
      // Allow it to scale proportionally so 16 matches always strictly fit in availH without bleeding off page
      const matchH = Math.min(18, (availH / Math.max(1, matchCount)) * 0.75); 
      const gap = (availH - matchCount * matchH) / (matchCount + 1);

      pageMatches.forEach((pm, localIdx) => {
        const matchY = y + gap + (matchH + gap) * localIdx;
        const boxW = Math.min(55, roundWidth - 10);
        const match = pm.matchObj;
        
        // Save coordinate
        matchCoords[pageRoundIdx][pm.originalMIdx] = { x: colX + 2, y: matchY + matchH / 2, boxW: boxW };

        const isTBD = (rIdx > 0);
        doc.setFillColor(isTBD ? 20 : 26, isTBD ? 28 : 36, isTBD ? 35 : 44);
        doc.roundedRect(colX + 2, matchY, boxW, matchH, 1.5, 1.5, 'F');

        doc.setFillColor(255, 70, 85);
        doc.rect(colX + 2, matchY, 1.5, matchH, 'F');

        const teamAName = match.teamA !== null ? match.teamA : 'BYE';
        doc.setFont('helvetica', isTBD ? 'italic' : (!match.teamA ? 'italic' : 'normal'));
        doc.setFontSize(8);
        doc.setTextColor(isTBD ? 100 : 236, isTBD ? 110 : 232, isTBD ? 105 : 225);
        doc.text(teamAName, colX + 6, matchY + matchH * 0.4);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        doc.setTextColor(255, 70, 85);
        doc.text('vs', colX + boxW / 2 + 2, matchY + matchH / 2 + 1, { align: 'center' });

        doc.setFont('helvetica', isTBD ? 'italic' : 'normal');
        doc.setFontSize(8);
        doc.setTextColor(isTBD ? 100 : 236, isTBD ? 110 : 232, isTBD ? 105 : 225);
        const teamBName = match.teamB !== null ? match.teamB : 'BYE';
        doc.text(teamBName, colX + 6, matchY + matchH * 0.85);
        
        if (match.info) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(5);
          doc.setTextColor(164, 177, 169);
          doc.text(match.info, colCenterX, matchY - 1, { align: 'center' });
        }
      });
    }

    // Draw connector lines
    doc.setDrawColor(255, 70, 85);
    doc.setLineWidth(0.4);
    for (let prIdx = 1; prIdx < totalRoundsOnPage; prIdx++) {
      const currentRoundMap = matchCoords[prIdx];
      const prevRoundMap = matchCoords[prIdx - 1];
      
      Object.keys(currentRoundMap).forEach(key => {
        const mIdx = parseInt(key, 10);
        const currentBox = currentRoundMap[mIdx];
        
        const prev1 = prevRoundMap[mIdx * 2];
        const prev2 = prevRoundMap[mIdx * 2 + 1];
        if (!prev1 || !prev2) return;
        
        const startX = prev1.x + prev1.boxW;
        const endX = currentBox.x;
        const midX = startX + (endX - startX) / 2;
        
        doc.line(startX, prev1.y, midX, prev1.y);
        doc.line(startX, prev2.y, midX, prev2.y);
        doc.line(midX, prev1.y, midX, prev2.y);
        doc.line(midX, currentBox.y, endX, currentBox.y);
      });
    }

    doc.setFontSize(6);
    doc.setTextColor(80, 90, 85);
    doc.text('VALORANT Tournament Fixture Builder', pageW / 2, pageH - 4, { align: 'center' });
  }

  // Execution Flow
  if (matchCountRound1 <= MAX_PER_PAGE) {
    // 32 teams or fewer fits perfectly on one page
    renderPage('FULL EVENT BRACKET', 0, totalRounds - 1, () => true);
  } else {
    // Multipage Split (64 to 128+ teams)
    const numPools = Math.ceil(matchCountRound1 / MAX_PER_PAGE);
    const poolRounds = Math.log2(MAX_PER_PAGE); // E.g., 4 rounds for 16 matches

    for (let p = 0; p < numPools; p++) {
      if (p > 0) doc.addPage();
      const poolName = `POOL ${String.fromCharCode(65 + p)} STAGE`;
      
      renderPage(poolName, 0, poolRounds, (rIdx, mIdx) => {
        // Matches in pool P:
        const startIdx = (p * MAX_PER_PAGE) / Math.pow(2, rIdx);
        const count = MAX_PER_PAGE / Math.pow(2, rIdx);
        return mIdx >= startIdx && mIdx < startIdx + count;
      });
    }

    // Championship Bracket
    if (totalRounds > poolRounds) {
      doc.addPage();
      renderPage('CHAMPIONSHIP BRACKET', poolRounds, totalRounds - 1, () => true);
    }
  }

  doc.save('knockout_bracket.pdf');
  showToast('Bracket PDF downloaded!');
});
/* ================================================
   DRAG & DROP MATCH REORDER (ROUND 1 ONLY)
   ================================================ */

function initMatchDragAndDrop() {
  let dragSrc = null;

  const matches = document.querySelectorAll('.bracket-match[data-round="0"]');

  matches.forEach(match => {

    match.addEventListener('dragstart', (e) => {
      // If the drag originated from a child team element, let the team handler own it
      if (e.target.closest('.bracket-team')) return;

      dragSrc = match;
      match.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'match');
    });

    match.addEventListener('dragend', () => {
      match.classList.remove('dragging');
      document.querySelectorAll('.bracket-match').forEach(m => m.classList.remove('drag-over'));
      dragSrc = null;
    });

    match.addEventListener('dragover', (e) => {
      // Only accept match-level drags (not team drags)
      if (!dragSrc) return;
      e.preventDefault();
      if (match !== dragSrc) {
        match.classList.add('drag-over');
      }
    });

    match.addEventListener('dragleave', () => {
      match.classList.remove('drag-over');
    });

    match.addEventListener('drop', (e) => {
      e.preventDefault();
      match.classList.remove('drag-over');

      // Only handle if a match (not a team) is being dragged
      if (!dragSrc || dragSrc === match) return;

      const parent = match.parentNode;
      const all = [...parent.querySelectorAll('.bracket-match[data-round="0"]')];

      const fromIdx = all.indexOf(dragSrc);
      const toIdx = all.indexOf(match);

      if (fromIdx < toIdx) {
        parent.insertBefore(dragSrc, match.nextSibling);
      } else {
        parent.insertBefore(dragSrc, match);
      }
      updateMatchOrder();
    });

  });
}
function updateMatchOrder() {
  const matchElements = document.querySelectorAll('.bracket-match[data-round="0"]');

  const newRound = [];

  matchElements.forEach(matchEl => {
    const matchData = matchEl.matchData;
    newRound.push({
      num: newRound.length + 1,
      teamA: matchData.teamA,
      teamB: matchData.teamB
    });
  });

  // ✅ Update round 1
  bracketRounds[0] = newRound;

  // ✅ Recalculate next rounds WITHOUT reshuffling
  for (let r = 1; r < bracketRounds.length; r++) {
    for (let m = 0; m < bracketRounds[r].length; m++) {
      const prevMatch1 = bracketRounds[r - 1][m * 2];
      const prevMatch2 = bracketRounds[r - 1][m * 2 + 1];

      let teamA = 'TBD';
      let teamB = 'TBD';

      // ✅ Handle BYE properly
      if (prevMatch1 && prevMatch1.teamB === null) {
        teamA = prevMatch1.teamA;
      }

      if (prevMatch2 && prevMatch2.teamB === null) {
        teamB = prevMatch2.teamA;
      }

      bracketRounds[r][m].teamA = teamA;
      bracketRounds[r][m].teamB = teamB;

      // ❗ Reset winner since structure changed
      bracketRounds[r][m].winner = null;
    }
  }

  saveState();
  renderBracket();
}
/* ================================================
   TEAM DRAG & DROP (SWAP SYSTEM)
   ================================================ */

/* ================================================
   TEAM DRAG & DROP (SWAP SYSTEM)
   ================================================ */

function initTeamDragAndDrop() {
  let dragSrc = null;

  const teams = document.querySelectorAll('.bracket-team');

  teams.forEach(team => {
    // Skip TBD / BYE slots — they have no real team to drag
    if (team.classList.contains('tbd') || team.classList.contains('bye')) return;

    team.setAttribute('draggable', 'true');

    team.addEventListener('dragstart', (e) => {
      dragSrc = team;
      team.classList.add('dragging');
      e.dataTransfer.setData('text/plain', '');
      e.stopPropagation(); // prevent match-level drag from firing
    });

    team.addEventListener('dragend', () => {
      team.classList.remove('dragging');
      document.querySelectorAll('.bracket-team').forEach(t => t.classList.remove('drag-over'));
      dragSrc = null;
    });

    team.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (team !== dragSrc && !team.classList.contains('tbd') && !team.classList.contains('bye')) {
        team.classList.add('drag-over');
      }
    });

    team.addEventListener('dragleave', () => {
      team.classList.remove('drag-over');
    });

    team.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      team.classList.remove('drag-over');

      if (!dragSrc || dragSrc === team) return;

      const source = dragSrc;
      const target = team;

      // Both must be in the same round
      const srcRound  = parseInt(source.getAttribute('data-round'), 10);
      const tgtRound  = parseInt(target.getAttribute('data-round'), 10);
      if (srcRound !== tgtRound) {
        showToast('⚠ Teams can only be swapped within the same round.');
        return;
      }

      swapTeams(source, target);
    });
  });
}

function swapTeams(teamEl1, teamEl2) {
  const srcRound  = parseInt(teamEl1.getAttribute('data-round'), 10);
  const srcMatch  = parseInt(teamEl1.getAttribute('data-match'), 10);
  const srcPos    = teamEl1.getAttribute('data-teampos'); // 'teamA' | 'teamB'

  const tgtRound  = parseInt(teamEl2.getAttribute('data-round'), 10);
  const tgtMatch  = parseInt(teamEl2.getAttribute('data-match'), 10);
  const tgtPos    = teamEl2.getAttribute('data-teampos');

  if (srcRound !== tgtRound) {
    showToast('⚠ Teams can only be swapped within the same round.');
    return;
  }

  // Same position in the same match → nothing to do
  if (srcMatch === tgtMatch && srcPos === tgtPos) return;

  const round = bracketRounds[srcRound];
  const matchA = round[srcMatch];
  const matchB = round[tgtMatch];

  // Grab the names before mutating
  const nameA = matchA[srcPos];
  const nameB = matchB[tgtPos];

  // Swap directly in the data model
  matchA[srcPos] = nameB;
  matchB[tgtPos] = nameA;

  // Also keep orderedTeams in sync so a full rebuild later is consistent
  const idxA = orderedTeams.indexOf(nameA);
  const idxB = orderedTeams.indexOf(nameB);
  if (idxA !== -1 && idxB !== -1) {
    [orderedTeams[idxA], orderedTeams[idxB]] = [orderedTeams[idxB], orderedTeams[idxA]];
  }

  // Propagate BYE-advancement changes to later rounds
  recalcLaterRounds();

  saveState();
  renderBracket();
  showToast('✔ Teams swapped!');
}

/** After any round-0 mutation, re-derive TBD/auto-advance states for rounds 1+
 *  without touching any winner selections already made by the admin.
 */
function recalcLaterRounds() {
  for (let r = 1; r < bracketRounds.length; r++) {
    for (let m = 0; m < bracketRounds[r].length; m++) {
      const prevMatch1 = bracketRounds[r - 1][m * 2];
      const prevMatch2 = bracketRounds[r - 1][m * 2 + 1];

      // Only overwrite slots that were auto-TBD/auto-BYE (i.e. no winner set yet)
      if (!bracketRounds[r - 1 === 0 ? 0 : r - 1][m * 2]?.winner) {
        let teamA = 'TBD';
        if (prevMatch1 && prevMatch1.teamB === null) teamA = prevMatch1.teamA; // BYE → auto advance
        bracketRounds[r][m].teamA = teamA;
      }

      if (!bracketRounds[r - 1 === 0 ? 0 : r - 1][m * 2 + 1]?.winner) {
        let teamB = 'TBD';
        if (prevMatch2 && prevMatch2.teamB === null) teamB = prevMatch2.teamA;
        bracketRounds[r][m].teamB = teamB;
      }
    }
  }
}