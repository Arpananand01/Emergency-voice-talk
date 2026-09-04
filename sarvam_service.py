import os
import requests
import base64
import logging

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Configurable language map supporting extensibility for additional languages
LANGUAGES = {
    "en-IN": {
        "name": "English",
        "native_name": "English",
        "greeting": "How can I help you?",
        "speaker": "ritu"
    },
    "hi-IN": {
        "name": "Hindi",
        "native_name": "हिन्दी",
        "greeting": "मैं आपकी कैसे मदद कर सकता हूँ?",
        "speaker": "shubh"
    },
    "bn-IN": {
        "name": "Bengali",
        "native_name": "বাংলা",
        "greeting": "আমি আপনাকে কীভাবে সাহায্য করতে পারি?",
        "speaker": "shubh"
    },
    "mr-IN": {
        "name": "Marathi",
        "native_name": "मराठी",
        "greeting": "मी तुम्हाला कशी मदत करू शकतो?",
        "speaker": "shubh"
    },
    "ta-IN": {
        "name": "Tamil",
        "native_name": "தமிழ்",
        "greeting": "நான் உங்களுக்கு எவ்வாறு உதவ முடியும்?",
        "speaker": "shubh"
    },
    "te-IN": {
        "name": "Telugu",
        "native_name": "తెలుగు",
        "greeting": "నేను మీకు ఎలా సహాయపడగలను?",
        "speaker": "shubh"
    }
}

SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"
SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
SARVAM_TRANSLATE_URL = "https://api.sarvam.ai/translate"


def get_sarvam_api_key():
    """Retrieves the Sarvam API key from environment variables, dynamically reloading .env."""
    load_dotenv(override=True)
    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key or api_key.strip() == "" or api_key.strip() == "your_api_key_here":
        return None
    return api_key.strip()



def get_supported_languages():
    """Returns the dictionary of supported languages and metadata."""
    return LANGUAGES


def generate_tts_greeting(language_code: str):
    """
    Calls Sarvam Text-to-Speech API to generate localized audio for the greeting.
    Returns tuple: (success: bool, audio_base64_or_error_message: str, greeting_text: str)
    """
    lang_info = LANGUAGES.get(language_code)
    if not lang_info:
        # Fallback to English if code is unknown
        lang_info = LANGUAGES["en-IN"]
        language_code = "en-IN"

    greeting_text = lang_info["greeting"]
    speaker = lang_info.get("speaker", "shubh")

    api_key = get_sarvam_api_key()
    if not api_key:
        return False, "Sarvam API key is not configured in environment (.env).", greeting_text

    headers = {
        "api-subscription-key": api_key,
        "Content-Type": "application/json"
    }

    payload = {
        "text": greeting_text,
        "language_code": language_code,
        "model": "bulbul:v3",
        "speaker": speaker
    }

    try:
        response = requests.post(SARVAM_TTS_URL, json=payload, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            audios = data.get("audios", [])
            if audios and len(audios) > 0:
                return True, audios[0], greeting_text
            else:
                logger.error("Sarvam TTS returned empty audios array")
                return False, "Empty audio returned from Sarvam TTS service.", greeting_text
        else:
            logger.error(f"Sarvam TTS API Error [{response.status_code}]: {response.text}")
            return False, "Voice service is temporarily unavailable. Please try again.", greeting_text

    except requests.exceptions.RequestException as e:
        logger.error(f"Sarvam TTS network error: {e}")
        return False, "Voice service is temporarily unavailable. Please check your network connection.", greeting_text


def transcribe_audio(audio_bytes: bytes, filename: str, language_code: str = "auto", content_type: str = "audio/webm"):
    """
    Calls Sarvam Speech-to-Text API to convert patient audio to text.
    Automatically detects spoken language if language_code is 'auto', 'unknown', or empty.
    Returns tuple: (success: bool, transcript_or_error_message: str, detected_language_code: str)
    """
    api_key = get_sarvam_api_key()
    if not api_key:
        return False, "Sarvam API key is not configured in environment (.env).", language_code or "hi-IN"

    if not audio_bytes or len(audio_bytes) == 0:
        return False, "Empty audio file received. Please speak clearly into the microphone.", language_code or "hi-IN"

    headers = {
        "api-subscription-key": api_key
    }

    # Clean content_type (strip ;codecs=opus parameters which cause 400 from Sarvam API)
    clean_content_type = (content_type or "audio/webm").split(';')[0].strip().lower()

    # Prepare multipart form files
    files = {
        "file": (filename or "audio.webm", audio_bytes, clean_content_type)
    }

    data = {
        "model": "saaras:v4",
        "mode": "transcribe"
    }

    # If language_code is auto/unknown or empty, pass "unknown" so Sarvam STT auto-detects language
    if not language_code or language_code.lower() in ["auto", "unknown"]:
        data["language_code"] = "unknown"
    elif language_code in LANGUAGES:
        data["language_code"] = language_code
    else:
        data["language_code"] = "unknown"

    try:
        response = requests.post(SARVAM_STT_URL, headers=headers, files=files, data=data, timeout=30)

        if response.status_code == 200:
            res_json = response.json()
            transcript = res_json.get("transcript", "").strip()
            detected_lang = res_json.get("language_code") or (language_code if language_code != "auto" else "hi-IN")
            
            if not transcript:
                return False, "Sorry, I couldn't understand your response. Please speak again.", detected_lang
            
            return True, transcript, detected_lang
        else:
            logger.error(f"Sarvam STT API Error [{response.status_code}]: {response.text}")
            # If saaras:v4 endpoint returns format error, try fallback with saaras:v3
            if response.status_code == 400 or response.status_code == 422:
                data["model"] = "saaras:v3"
                retry_resp = requests.post(SARVAM_STT_URL, headers=headers, files={"file": (filename or "audio.webm", audio_bytes, content_type or "audio/webm")}, data=data, timeout=30)
                if retry_resp.status_code == 200:
                    retry_json = retry_resp.json()
                    retry_transcript = retry_json.get("transcript", "").strip()
                    retry_lang = retry_json.get("language_code") or (language_code if language_code != "auto" else "hi-IN")
                    if retry_transcript:
                        return True, retry_transcript, retry_lang
            
            return False, "Sorry, speech recognition failed. Please try speaking again.", language_code or "hi-IN"

    except requests.exceptions.RequestException as e:
        logger.error(f"Sarvam STT network error: {e}")
        return False, "Voice service is temporarily unavailable. Please try again.", language_code or "hi-IN"


def translate_text(text: str, source_language_code: str = "hi-IN", target_language_code: str = "en-IN"):
    """
    Translates transcript from source language into target language (default English en-IN)
    using Sarvam AI Translation API.
    Returns: translated text string (or original text as fallback on failure/same lang).
    """
    if not text or not text.strip():
        return ""

    text = text.strip()

    # If source language is already English, no translation needed
    if source_language_code and source_language_code.lower().startswith("en"):
        return text

    api_key = get_sarvam_api_key()
    if not api_key:
        logger.warning("Sarvam API key missing during translation request. Returning original text.")
        return text

    headers = {
        "api-subscription-key": api_key,
        "Content-Type": "application/json"
    }

    payload = {
        "input": text,
        "source_language_code": source_language_code,
        "target_language_code": target_language_code,
        "model": "mayura:v1"
    }

    try:
        response = requests.post(SARVAM_TRANSLATE_URL, headers=headers, json=payload, timeout=15)
        if response.status_code == 200:
            res_json = response.json()
            translated = res_json.get("translated_text", "").strip()
            if translated:
                logger.info(f"Successfully translated text [{source_language_code} -> {target_language_code}]")
                return translated
        else:
            logger.error(f"Sarvam Translate API Error [{response.status_code}]: {response.text}")
    except Exception as e:
        logger.error(f"Sarvam Translate network error: {e}")

    # Fallback to original text if translation fails
    return text
