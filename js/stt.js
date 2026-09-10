// ============================================================
// SPEECH-TO-TEXT — voice reactions (native, no API)
// ============================================================
// Built on the browser's own SpeechRecognition: the transcript is produced
// locally by the platform, so there is no speech service and no upload.
// The transcript is written straight into the reaction composer (js/composer.js);
// this file owns only the microphone and the recording state.

'use strict';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

let recognition = null;

// ---------- recording ----------
function toggleListening() {
  if (!recognition) return;
  if (state.listening) {
    recognition.stop();
    endListening();
    return;
  }
  if (state.busyEval || !state.pending) return;
  state.recBase = els.reactText.value.trim();
  state.listening = true;
  els.btnMic.classList.add('listening'); // icon turns into icon + “Recording”
  els.btnMic.title = 'Recording — click to stop';
  setStatus('Listening… speak your reaction (native speech-to-text)');
  try { recognition.start(); }
  catch { endListening(); setStatus('Mic is already busy — try again', 'error'); }
}

function endListening() {
  state.listening = false;
  els.btnMic.classList.remove('listening');
  els.btnMic.title = 'Native speech-to-text';
}

// Stop recording if it is running — safe to call at any time.
function stopListening() {
  if (recognition && state.listening) {
    recognition.stop();
    endListening();
  }
}

// ---------- wiring ----------
function initSTT() {
  if (!SR) {
    state.sttSupported = false;
    els.btnMic.disabled = true;
    els.btnMic.title = 'Speech recognition is not supported in this browser';
    return;
  }
  state.sttSupported = true;
  recognition = new SR();
  recognition.lang = (navigator.language || 'en-US').replace('_', '-');
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    let t = '';
    for (let i = 0; i < event.results.length; i++) t += event.results[i][0].transcript;
    state.voiceTyped = true;
    els.reactText.value = (state.recBase ? state.recBase + ' ' : '') + t.trim();
    autoGrowComposer();
    updateControls();
  };
  recognition.onend = () => { if (state.listening) endListening(); };
  recognition.onerror = (e) => {
    endListening();
    setStatus('Mic error: ' + (e.error || 'unknown'), 'error');
  };
  els.btnMic.addEventListener('click', toggleListening);
}
