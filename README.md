# Emergency Medical Voice-Intake Web Application (Sarvam AI Multilingual Voice Support)

A lightweight, privacy-focused emergency voice intake application designed for Emergency Medical Services (EMS). Powered by **Sarvam AI API**, patients can speak their medical complaints naturally in Indian languages. Speech is converted to text via Sarvam Speech-to-Text (`saaras:v4`), displayed clearly on screen, and saved locally as structured JSON and text files.

---

## 1. Virtual Environment Setup

Create and activate a virtual environment in the project directory:

### On Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### On macOS / Linux:
```bash
python3 -m venv venv
source venv/bin/activate
```

---

## 2. Install Dependencies

Install the required Python packages from `requirements.txt`:
```bash
pip install -r requirements.txt
```

---

## 3. Environment Configuration (`.env`)

Create a `.env` file in the root directory (or copy from `.env.example`):

```bash
cp .env.example .env
```

Open `.env` and set your Sarvam API key:
```env
SARVAM_API_KEY=your_actual_sarvam_api_key_here
```

> **Security Note:** The Sarvam API key is loaded only on the Python backend via `python-dotenv` and is **never** exposed to the browser or client-side JavaScript. `.env` is listed in `.gitignore`.

---

## 4. How to Start the Python Backend

Run the Flask server:
```bash
python app.py
```
The backend server will start on `http://127.0.0.1:5000`.

---

## 5. How to Open the Webpage

1. Open your web browser (Google Chrome, Microsoft Edge, or Safari).
2. Go to `http://127.0.0.1:5000`.
3. Allow microphone permission when requested.

---

## 6. Supported Languages

The application supports 6 Indian languages out-of-the-box:

1. **English** (`en-IN`) - "How can I help you?"
2. **Hindi / हिन्दी** (`hi-IN`) - "मैं आपकी कैसे मदद कर सकता हूँ?"
3. **Bengali / বাংলা** (`bn-IN`) - "আমি আপনাকে কীভাবে সাহায্য করতে পারি?"
4. **Marathi / मराठी** (`mr-IN`) - "मी तुम्हाला कशी मदत करू शकतो?"
5. **Tamil / தமிழ்** (`ta-IN`) - "நான் உங்களுக்கு எவ்வாறு உதவ முடியும்?"
6. **Telugu / తెలుగు** (`te-IN`) - "నేను మీకు ఎలా సహాయపడగలను?"

---

## 7. How the Voice Pipeline Works

1. **Language Selection**: Patient/EMS worker selects a language from the dropdown menu.
2. **Sarvam TTS Greeting**: Python backend calls Sarvam Text-to-Speech (`bulbul:v3`) to synthesize a natural localized greeting in the selected language.
3. **Microphone Activation**: Once the assistant finishes speaking, the microphone activates.
4. **3-Second Silence Timeout**:
   - If no voice input is detected for ~3 seconds after greeting ends, listening pauses, the greeting is spoken again, and listening resumes.
   - Once voice activity is detected, the 3-second timer is immediately cancelled, allowing the patient to speak their full concern continuously without interruption.
5. **Sarvam Speech-to-Text**: Recorded audio is uploaded securely to Python backend `/api/transcribe`, which calls Sarvam Speech-to-Text (`saaras:v4`).
6. **Display & Local Save**: Recognized text is displayed on screen and saved locally to disk in the `data/` folder.

---

## 8. Where Transcripts are Stored

Each completed interaction is saved locally in the `data/` directory without requiring a database.

Example JSON record (`data/patient_20260904_224500.json`):
```json
{
  "timestamp": "2026-09-04T22:45:00",
  "language_code": "hi-IN",
  "language": "Hindi",
  "transcript": "मरीज को सुबह से सीने में तेज दर्द हो रहा है और सांस लेने में तकलीफ है।"
}
```

An accompanying `.txt` file is also created automatically.

---

## 9. How to Export Transcripts

- **Download JSON**: Click "Download JSON" to save the individual JSON intake file.
- **Download TXT**: Click "Download TXT" to save the plain-text intake record.
- **Download All (ZIP)**: Click "Download All (ZIP)" to download a compressed archive of all saved intake files.

---

## 10. How to Add Another Language

To add a new language (e.g. Gujarati `gu-IN` or Kannada `kn-IN`):

1. **Update `sarvam_service.py`**:
   Add the language entry to `LANGUAGES`:
   ```python
   "gu-IN": {
       "name": "Gujarati",
       "native_name": "ગુજરાતી",
       "greeting": "હું તમારી શું મદદ કરી શકું?",
       "speaker": "shubh"
   }
   ```

2. **Update `static/script.js`**:
   Add the language entry to `LANGUAGES`:
   ```javascript
   'gu-IN': {
       name: 'Gujarati',
       nativeName: 'ગુજરાતી',
       greeting: 'હું તમારી શું મદદ કરી શકું?'
   }
   ```

3. **Update `templates/index.html`**:
   Add an `<option>` to the `<select id="language-select">` dropdown:
   ```html
   <option value="gu-IN">ગુજરાતી</option>
   ```

---

## 11. Medical Safety Boundary & Privacy

> **STRICT MEDICAL DISCLAIMER**
>
> This application is strictly an emergency voice intake collection system (`Speech -> Text -> Display -> Save`).
> It does **NOT** diagnose symptoms, suggest diseases, recommend medications, give treatment advice, or provide clinical decision-making.
> No patient audio or API keys are logged or exposed to client-side scripts.
