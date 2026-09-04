/**
 * Emergency Medical Voice Intake Engine
 * Powered by Sarvam AI Multilingual Voice API (STT & TTS)
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const langSelect = document.getElementById('language-select');
    const micContainer = document.getElementById('mic-container');
    const statusBadge = document.getElementById('status-badge');
    const statusText = document.getElementById('status-text');
    const subStatus = document.getElementById('sub-status');
    const transcriptBox = document.getElementById('transcript-box');
    const translationCard = document.getElementById('translation-card');
    const translationBox = document.getElementById('translation-box');
    const liveIndicator = document.getElementById('live-indicator');
    const notificationBox = document.getElementById('notification-box');

    const btnToggleRec = document.getElementById('btn-toggle-rec');
    const toggleRecText = document.getElementById('toggle-rec-text');
    const btnStartAgain = document.getElementById('btn-start-again');
    const btnDownloadJson = document.getElementById('btn-download-json');
    const btnDownloadTxt = document.getElementById('btn-download-txt');
    const btnDownloadAll = document.getElementById('btn-download-all');
    const savedFilesList = document.getElementById('saved-files-list');

    // --- Language Definitions & Localized Greetings ---
    const LANGUAGES = {
        'auto': {
            name: 'Auto-Detect',
            nativeName: '✨ Auto-Detect',
            greeting: 'How can I help you?'
        },
        'en-IN': {
            name: 'English',
            nativeName: 'English',
            greeting: 'How can I help you?'
        },
        'hi-IN': {
            name: 'Hindi',
            nativeName: 'हिन्दी',
            greeting: 'मैं आपकी कैसे मदद कर सकता हूँ?'
        },
        'bn-IN': {
            name: 'Bengali',
            nativeName: 'বাংলা',
            greeting: 'আমি আপনাকে কীভাবে সাহায্য করতে পারি?'
        },
        'mr-IN': {
            name: 'Marathi',
            nativeName: 'मराठी',
            greeting: 'मी तुम्हाला कशी मदत करू शकतो?'
        },
        'ta-IN': {
            name: 'Tamil',
            nativeName: 'தமிழ்',
            greeting: 'நான் உங்களுக்கு எவ்வாறு உதவ முடியும்?'
        },
        'te-IN': {
            name: 'Telugu',
            nativeName: 'తెలుగు',
            greeting: 'నేను మీకు ఎలా సహాయపడగలను?'
        }
    };

    // --- State Variables ---
    let mediaRecorder = null;
    let audioChunks = [];
    let audioStream = null;
    let audioContext = null;
    let analyser = null;
    let animFrameId = null;

    let isSpeakingGreeting = false;
    let isRecording = false;
    let hasSpoken = false;
    let silenceTimer = null;
    let postSpeechSilenceTimer = null;
    let currentAudioPlayer = null;

    let currentSavedJson = null;
    let currentSavedTxt = null;
    let currentEnglishTranscript = '';

    const SILENCE_TIMEOUT_MS = 3200; // ~3 seconds timeout for initial voice input
    const POST_SPEECH_SILENCE_TIMEOUT_MS = 5000; // 5 seconds gap auto-save after patient speaks
    const VAD_VOLUME_THRESHOLD = 0.015; // Voice activity detection sensitivity threshold

    // --- Voice Flow Entry Point ---

    /**
     * Starts the full voice intake flow:
     * 1. Plays localized greeting (via Sarvam TTS)
     * 2. Activates microphone listening after greeting finishes
     */
    async function startRecordingFlow() {
        stopAllVoiceProcesses();
        clearNotification();

        const selectedLangKey = langSelect.value;
        const langConfig = LANGUAGES[selectedLangKey] || LANGUAGES['en-IN'];

        updateStatus('speaking', 'Assistant Speaking...', `"${langConfig.greeting}"`);
        micContainer.classList.add('speaking');
        isSpeakingGreeting = true;

        try {
            // Request Sarvam TTS greeting audio from Python backend
            const response = await fetch('/api/greeting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language_code: selectedLangKey })
            });

            const data = await response.json();

            if (data.status === 'success' && data.audio_base64) {
                playBase64Audio(data.audio_base64, () => {
                    isSpeakingGreeting = false;
                    micContainer.classList.remove('speaking');
                    startListeningEngine();
                });
            } else {
                // If Sarvam TTS is not available or key missing, use Web SpeechSynthesis as smooth fallback
                if (data.message && data.message.includes('API key')) {
                    showNotification(data.message, 'warning');
                }
                fallbackBrowserTTS(langConfig.greeting, selectedLangKey, () => {
                    isSpeakingGreeting = false;
                    micContainer.classList.remove('speaking');
                    startListeningEngine();
                });
            }
        } catch (err) {
            console.warn('Error fetching greeting audio:', err);
            fallbackBrowserTTS(langConfig.greeting, selectedLangKey, () => {
                isSpeakingGreeting = false;
                micContainer.classList.remove('speaking');
                startListeningEngine();
            });
        }
    }

    /**
     * Plays base64 audio returned by Sarvam TTS
     */
    function playBase64Audio(base64Str, onEndedCallback) {
        if (currentAudioPlayer) {
            currentAudioPlayer.pause();
            currentAudioPlayer = null;
        }

        const audioSrc = 'data:audio/wav;base64,' + base64Str;
        currentAudioPlayer = new Audio(audioSrc);

        currentAudioPlayer.onended = () => {
            currentAudioPlayer = null;
            if (onEndedCallback) onEndedCallback();
        };

        currentAudioPlayer.onerror = (err) => {
            console.warn('Audio playback error:', err);
            currentAudioPlayer = null;
            if (onEndedCallback) onEndedCallback();
        };

        currentAudioPlayer.play().catch(e => {
            console.warn('Autoplay prevented or failed:', e);
            if (onEndedCallback) onEndedCallback();
        });
    }

    /**
     * Fallback browser SpeechSynthesis TTS if backend API key is missing or network fails
     */
    function fallbackBrowserTTS(text, langCode, onEndedCallback) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = langCode;
            utterance.rate = 0.95;

            utterance.onend = () => {
                if (onEndedCallback) onEndedCallback();
            };

            utterance.onerror = () => {
                if (onEndedCallback) onEndedCallback();
            };

            window.speechSynthesis.speak(utterance);
        } else {
            setTimeout(() => {
                if (onEndedCallback) onEndedCallback();
            }, 1500);
        }
    }

    // --- Speech Recognition & Audio Recording Engine ---

    async function startListeningEngine() {
        if (isRecording) return;
        hasSpoken = false;

        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.error('Microphone access error:', err);
            micContainer.classList.remove('speaking', 'listening');
            updateMicButtonState(false);
            
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                updateStatus('idle', 'Microphone Access Denied', 'Please allow microphone access in browser header.');
                showNotification('Microphone access is required.', 'error');
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                updateStatus('idle', 'No Microphone Found', 'Please connect a microphone to your system.');
                showNotification('No microphone available.', 'error');
            } else {
                updateStatus('idle', 'Microphone Error', 'Failed to initialize microphone.');
                showNotification('Voice service is temporarily unavailable. Please try again.', 'error');
            }
            return;
        }

        // Determine best supported MIME type
        let mimeType = 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
            mimeType = 'audio/ogg';
        }

        audioChunks = [];
        mediaRecorder = new MediaRecorder(audioStream, { mimeType });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstart = () => {
            isRecording = true;
            micContainer.classList.add('listening');
            liveIndicator.classList.remove('hidden');
            updateMicButtonState(true);

            const selectedLangKey = langSelect.value;
            const langName = LANGUAGES[selectedLangKey] ? LANGUAGES[selectedLangKey].name : 'Selected Language';

            updateStatus('listening', 'Listening... Speak now', `Speak your emergency medical concern in ${langName}.`);
            
            // Setup Voice Activity Detector (VAD) to monitor silence & voice input
            setupVAD(audioStream);
            
            // Start 3-second silence timeout
            startSilenceTimeout();
        };

        mediaRecorder.onstop = async () => {
            isRecording = false;
            micContainer.classList.remove('listening');
            liveIndicator.classList.add('hidden');
            updateMicButtonState(false);
            cleanupVAD();

            const audioBlob = new Blob(audioChunks, { type: mimeType });

            if (audioBlob.size > 200) {
                updateStatus('saving', 'Transcribing...', 'Processing audio with Sarvam AI Speech-to-Text...');
                const cleanMime = mimeType.split(';')[0].trim();
                await sendAudioToSarvam(audioBlob, cleanMime);
            } else {
                updateStatus('idle', 'No Speech Recorded', 'Please click microphone and speak clearly.');
            }
        };

        try {
            mediaRecorder.start(250); // Collect data chunks every 250ms
        } catch (e) {
            console.error('MediaRecorder start failed:', e);
            updateStatus('idle', 'Recording Error', 'Could not start microphone recording.');
            showNotification('Voice service is temporarily unavailable. Please try again.', 'error');
        }
    }

    // --- Voice Activity Detection (VAD) & 5-Second Silence Auto-Save ---

    let silenceDurationMs = 0;
    const POST_SPEECH_SILENCE_LIMIT_MS = 5000; // 5 seconds silence threshold

    function setupVAD(stream) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let lastCheckTime = Date.now();
            silenceDurationMs = 0;

            function checkVolume() {
                if (!isRecording || !analyser) return;

                const now = Date.now();
                const elapsed = now - lastCheckTime;
                lastCheckTime = now;

                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const averageVolume = sum / (dataArray.length * 255.0);

                if (averageVolume > VAD_VOLUME_THRESHOLD) {
                    if (!hasSpoken) {
                        hasSpoken = true;
                        cancelSilenceTimeout(); // Cancel initial 3s no-speech timeout when patient speaks
                        updateStatus('listening', 'Listening... (Voice detected)', 'Keep speaking your medical concern naturally.');
                    }
                    // Reset silence accumulator while patient is actively speaking
                    silenceDurationMs = 0;
                } else if (hasSpoken) {
                    // Patient has spoken and is now silent: accumulate silence duration
                    silenceDurationMs += elapsed;

                    if (silenceDurationMs >= POST_SPEECH_SILENCE_LIMIT_MS) {
                        console.log('5 seconds of silence detected after speaking. Auto-stopping and saving...');
                        updateStatus('saving', 'Silence detected (5s gap)', 'Auto-saving patient intake response...');
                        stopAllVoiceProcesses(); // Stops recording -> triggers onstop -> Sarvam STT -> Save
                        return;
                    }
                }

                animFrameId = requestAnimationFrame(checkVolume);
            }

            lastCheckTime = Date.now();
            checkVolume();
        } catch (err) {
            console.warn('VAD setup failed, falling back to manual stop:', err);
        }
    }

    function cleanupVAD() {
        silenceDurationMs = 0;
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        if (audioContext) {
            try { audioContext.close(); } catch (e) {}
            audioContext = null;
        }
        analyser = null;
    }

    function startSilenceTimeout() {
        cancelSilenceTimeout();
        silenceTimer = setTimeout(() => {
            if (!hasSpoken && isRecording) {
                console.log('No voice input detected for ~3s. Repeating greeting...');
                stopAllVoiceProcesses();
                updateStatus('speaking', 'No voice input detected', 'Repeating assistant greeting...');
                setTimeout(startRecordingFlow, 500);
            }
        }, SILENCE_TIMEOUT_MS);
    }

    function cancelSilenceTimeout() {
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }
    }

    function stopAllVoiceProcesses() {
        cancelSilenceTimeout();
        cleanupVAD();

        isSpeakingGreeting = false;
        isRecording = false;

        if (currentAudioPlayer) {
            currentAudioPlayer.pause();
            currentAudioPlayer = null;
        }

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try {
                mediaRecorder.stop();
            } catch (e) {}
        }

        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }

        micContainer.classList.remove('listening', 'speaking');
        liveIndicator.classList.add('hidden');
        updateMicButtonState(false);
    }

    // --- Backend API Integration ---

    /**
     * Sends recorded audio blob to Python Flask backend -> Sarvam STT
     */
    async function sendAudioToSarvam(audioBlob, mimeType) {
        const selectedLangKey = langSelect.value;
        const langConfig = LANGUAGES[selectedLangKey] || LANGUAGES['en-IN'];

        const formData = new FormData();
        const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        formData.append('audio', audioBlob, `speech_input.${extension}`);
        formData.append('language_code', selectedLangKey);

        try {
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (response.ok && data.status === 'success' && data.transcript) {
                const recognizedText = data.transcript.trim();
                const englishText = (data.transcript_english || recognizedText).trim();
                const detectedCode = data.detected_language_code || data.language_code || selectedLangKey;
                const detectedLangConfig = LANGUAGES[detectedCode] || LANGUAGES['en-IN'];

                // Automatically update dropdown UI to the patient's spoken language!
                if (detectedCode && detectedCode !== 'auto' && langSelect.querySelector(`option[value="${detectedCode}"]`)) {
                    langSelect.value = detectedCode;
                }

                // 1. Display patient's spoken language in main transcript box on screen
                transcriptBox.innerText = recognizedText;
                
                // 2. Display real-time English export preview card
                if (translationCard && translationBox) {
                    translationBox.innerText = englishText;
                    translationCard.classList.remove('hidden');
                }

                currentEnglishTranscript = englishText;
                
                // 3. Automatically save transcript locally (English for export, original retained)
                await saveTranscriptToServer(recognizedText, englishText, detectedLangConfig.name, detectedCode);
            } else {
                const errorMsg = data.message || "Sorry, I couldn't understand your response. Please speak again.";
                updateStatus('idle', 'Recognition Failed', errorMsg);
                showNotification(errorMsg, 'error');
            }
        } catch (err) {
            console.error('Transcription network error:', err);
            updateStatus('idle', 'Service Error', 'Voice service is temporarily unavailable. Please try again.');
            showNotification('Voice service is temporarily unavailable. Please try again.', 'error');
        }
    }

    /**
     * Saves transcript JSON and TXT records to local server
     */
    async function saveTranscriptToServer(transcriptOriginalText, transcriptEnglishText, languageName, languageCode) {
        const spokenText = (transcriptOriginalText || transcriptBox.innerText || '').trim();
        const engText = (transcriptEnglishText || (translationBox ? translationBox.innerText : '') || spokenText).trim();

        if (!spokenText && !engText) {
            showNotification('Empty transcript cannot be saved.', 'error');
            return;
        }

        try {
            const response = await fetch('/save-transcript', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    transcript: spokenText,
                    transcript_english: engText,
                    language: languageName,
                    language_code: languageCode
                })
            });

            const data = await response.json();

            if (data.status === 'success') {
                currentSavedJson = data.json_file;
                currentSavedTxt = data.txt_file;

                btnDownloadJson.disabled = false;
                btnDownloadTxt.disabled = false;

                savedFilesList.classList.remove('hidden');
                savedFilesList.innerHTML = `
                    <div><strong>✅ Response Saved Successfully:</strong></div>
                    <div>• JSON: <a href="/download/${data.json_file}" download>${data.json_file}</a></div>
                    <div>• TXT: <a href="/download/${data.txt_file}" download>${data.txt_file}</a></div>
                `;

                updateStatus('success', 'Saved Successfully', `Stored in data/${data.json_file}`);
                micContainer.classList.add('saved');
                showNotification('Your emergency intake response was saved locally.', 'success');
            } else {
                updateStatus('idle', 'Save Failed', data.message || 'Error writing transcript file');
                showNotification(data.message || 'Response could not be saved. Please try again.', 'error');
            }
        } catch (err) {
            console.error('Save error:', err);
            updateStatus('idle', 'Server Error', 'Failed to reach server');
            showNotification('Server communication failure. Please check connection.', 'error');
        }
    }

    // --- UI Helper Functions ---

    function updateStatus(stateClass, mainText, subText) {
        statusBadge.className = `status-badge status-${stateClass}`;
        statusText.innerText = mainText;
        if (subText) {
            subStatus.innerText = subText;
        }
    }

    function updateMicButtonState(recordingActive) {
        if (recordingActive) {
            btnToggleRec.className = 'btn btn-primary btn-recording-active';
            toggleRecText.innerText = 'Stop & Save Response';
        } else {
            btnToggleRec.className = 'btn btn-primary';
            toggleRecText.innerText = 'Start Recording';
        }
    }

    function showNotification(msg, type = 'error') {
        notificationBox.className = `notification-box ${type}`;
        notificationBox.innerText = msg;
        notificationBox.classList.remove('hidden');
    }

    function clearNotification() {
        notificationBox.innerText = '';
        notificationBox.classList.add('hidden');
    }

    // --- User Event Handlers ---

    // Click on Mic Container or Start/Stop button
    function handleToggleRecording() {
        if (isRecording || isSpeakingGreeting) {
            // Patient clicks to finish speaking and submit audio
            if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
                hasSpoken = true; // ensure audio is processed
                mediaRecorder.stop();
            } else {
                stopAllVoiceProcesses();
                updateStatus('idle', 'Cancelled', 'Click microphone to start again.');
            }
        } else {
            // Start new voice interaction flow
            transcriptBox.innerText = '';
            if (translationBox) translationBox.innerText = '';
            if (translationCard) translationCard.classList.add('hidden');
            micContainer.classList.remove('saved');
            savedFilesList.classList.add('hidden');
            startRecordingFlow();
        }
    }

    micContainer.addEventListener('click', handleToggleRecording);
    btnToggleRec.addEventListener('click', handleToggleRecording);

    // Language Dropdown Selector Change:
    // Update selected language on frontend, tell backend, speak greeting, and set language configuration
    langSelect.addEventListener('change', () => {
        stopAllVoiceProcesses();
        clearNotification();

        const selectedLangKey = langSelect.value;
        const langConfig = LANGUAGES[selectedLangKey] || LANGUAGES['en-IN'];

        updateStatus('idle', `Language: ${langConfig.nativeName} (${langConfig.name})`, 'Click microphone or "Start Recording" to begin.');
        
        // Auto-speak greeting when changing language
        setTimeout(() => {
            startRecordingFlow();
        }, 300);
    });

    // Clear / Start Again
    btnStartAgain.addEventListener('click', () => {
        stopAllVoiceProcesses();
        transcriptBox.innerText = '';
        if (translationBox) translationBox.innerText = '';
        if (translationCard) translationCard.classList.add('hidden');
        currentSavedJson = null;
        currentSavedTxt = null;
        currentEnglishTranscript = '';
        btnDownloadJson.disabled = true;
        btnDownloadTxt.disabled = true;
        savedFilesList.classList.add('hidden');
        micContainer.classList.remove('saved');
        clearNotification();
        updateStatus('idle', 'Ready to Record', 'Click microphone or "Start Recording" button to begin.');
    });

    // Download JSON
    btnDownloadJson.addEventListener('click', () => {
        if (currentSavedJson) {
            window.location.href = `/download/${currentSavedJson}`;
        }
    });

    // Download TXT
    btnDownloadTxt.addEventListener('click', () => {
        if (currentSavedTxt) {
            window.location.href = `/download/${currentSavedTxt}`;
        }
    });

    // Download All (ZIP)
    btnDownloadAll.addEventListener('click', () => {
        window.location.href = '/download-all';
    });
});
