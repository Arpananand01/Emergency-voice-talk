import os
import json
import io
import zipfile
import logging
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
import sarvam_service

# Load environment variables from .env
load_dotenv()

# Configure simple technical logger
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Ensure data directory exists
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DATA_DIR, exist_ok=True)


@app.route('/')
def index():
    """Serves the main emergency voice intake page."""
    return render_template('index.html')


@app.route('/api/languages', methods=['GET'])
def get_languages():
    """Returns supported languages configuration for frontend selector."""
    return jsonify({
        'status': 'success',
        'languages': sarvam_service.get_supported_languages()
    })


@app.route('/api/greeting', methods=['POST'])
def get_greeting_tts():
    """
    Generates TTS audio for the assistant's greeting in the requested language.
    Does not expose API key to frontend. Returns base64 audio data.
    """
    try:
        data = request.get_json() or {}
        language_code = data.get('language_code', 'en-IN')
        
        logger.info(f"Generating TTS greeting for language: {language_code}")
        
        success, audio_or_err, greeting_text = sarvam_service.generate_tts_greeting(language_code)
        
        if success:
            return jsonify({
                'status': 'success',
                'language_code': language_code,
                'greeting_text': greeting_text,
                'audio_base64': audio_or_err
            }), 200
        else:
            return jsonify({
                'status': 'error',
                'message': audio_or_err,
                'greeting_text': greeting_text
            }), 200 # return 200 so frontend can fallback smoothly to text display / speech synthesis
            
    except Exception as e:
        logger.error(f"Error generating TTS greeting: {e}")
        return jsonify({
            'status': 'error',
            'message': 'Voice service is temporarily unavailable. Please try again.',
            'greeting_text': 'How can I help you?'
        }), 500


@app.route('/api/transcribe', methods=['POST'])
def transcribe_audio_endpoint():
    """
    Receives recorded patient audio file from frontend and calls Sarvam Speech-to-Text.
    """
    try:
        if 'audio' not in request.files and 'file' not in request.files:
            return jsonify({
                'status': 'error',
                'message': 'No audio file was received from the microphone.'
            }), 400

        audio_file = request.files.get('audio') or request.files.get('file')
        language_code = request.form.get('language_code', 'hi-IN')
        
        filename = audio_file.filename or 'patient_recording.webm'
        raw_content_type = audio_file.content_type or 'audio/webm'
        content_type = raw_content_type.split(';')[0].strip().lower()
        audio_bytes = audio_file.read()

        logger.info(f"Transcribing audio [lang={language_code}, size={len(audio_bytes)} bytes]")

        stt_res = sarvam_service.transcribe_audio(
            audio_bytes=audio_bytes,
            filename=filename,
            language_code=language_code,
            content_type=content_type
        )

        if isinstance(stt_res, tuple) and len(stt_res) == 3:
            success, result, detected_language_code = stt_res
        else:
            success, result = stt_res[0], stt_res[1]
            detected_language_code = language_code

        if success:
            logger.info(f"Speech recognition succeeded [detected_lang={detected_language_code}]. Translating to English for export...")
            transcript_english = sarvam_service.translate_text(
                text=result,
                source_language_code=detected_language_code,
                target_language_code="en-IN"
            )
            return jsonify({
                'status': 'success',
                'transcript': result,
                'transcript_english': transcript_english,
                'language_code': detected_language_code,
                'detected_language_code': detected_language_code
            }), 200
        else:
            logger.warning(f"Speech recognition returned error: {result}")
            return jsonify({
                'status': 'error',
                'message': result,
                'detected_language_code': detected_language_code
            }), 400

    except Exception as e:
        logger.error(f"Error in transcription endpoint: {e}")
        return jsonify({
            'status': 'error',
            'message': 'Voice service is temporarily unavailable. Please try again.'
        }), 500


@app.route('/save-transcript', methods=['POST'])
def save_transcript():
    """
    Receives transcript and metadata from client,
    saves as timestamped JSON and plain text files in data/ directory.
    JSON and TXT exports store the transcript in English while retaining original spoken text metadata.
    """
    try:
        data = request.get_json() or {}
        transcript_original = data.get('transcript', '').strip()
        transcript_english = data.get('transcript_english', '').strip()
        language = data.get('language', 'Hindi')
        language_code = data.get('language_code', 'hi-IN')
        
        if not transcript_original and not transcript_english:
            return jsonify({
                'status': 'error',
                'message': 'Empty transcript cannot be saved.'
            }), 400

        # Fallback: if transcript_english not provided, translate original text to English
        if not transcript_english:
            transcript_english = sarvam_service.translate_text(transcript_original, language_code, "en-IN")

        # Generate unique timestamp-based filename
        now = datetime.now()
        timestamp_str = now.strftime('%Y%m%d_%H%M%S')
        base_filename = f"patient_{timestamp_str}"
        
        # Check for collisions within the same second
        counter = 1
        json_path = os.path.join(DATA_DIR, f"{base_filename}.json")
        txt_path = os.path.join(DATA_DIR, f"{base_filename}.txt")
        
        while os.path.exists(json_path) or os.path.exists(txt_path):
            base_filename = f"patient_{timestamp_str}_{counter}"
            json_path = os.path.join(DATA_DIR, f"{base_filename}.json")
            txt_path = os.path.join(DATA_DIR, f"{base_filename}.txt")
            counter += 1

        iso_timestamp = now.isoformat()

        # JSON record structure: Export transcript in English with original spoken text metadata
        record = {
            "timestamp": iso_timestamp,
            "language_code": language_code,
            "language": language,
            "transcript": transcript_english,
            "transcript_original": transcript_original
        }

        # Write JSON file
        with open(json_path, 'w', encoding='utf-8') as f_json:
            json.dump(record, f_json, indent=2, ensure_ascii=False)

        # Write TXT file
        with open(txt_path, 'w', encoding='utf-8') as f_txt:
            f_txt.write("==================================================\n")
            f_txt.write("      EMERGENCY MEDICAL INTAKE TRANSCRIPT          \n")
            f_txt.write("==================================================\n")
            f_txt.write(f"Timestamp          : {iso_timestamp}\n")
            f_txt.write(f"Spoken Language    : {language} ({language_code})\n")
            f_txt.write("--------------------------------------------------\n")
            f_txt.write("EXPORT TRANSCRIPT (ENGLISH):\n")
            f_txt.write(f"{transcript_english}\n")
            f_txt.write("--------------------------------------------------\n")
            f_txt.write(f"PATIENT SPOKEN TRANSCRIPT ({language.upper()}):\n")
            f_txt.write(f"{transcript_original}\n")
            f_txt.write("==================================================\n")

        logger.info(f"Saved transcript to {base_filename}.json")

        return jsonify({
            'status': 'success',
            'message': 'Transcript saved successfully.',
            'json_file': f"{base_filename}.json",
            'txt_file': f"{base_filename}.txt",
            'timestamp': iso_timestamp
        }), 200

    except Exception as e:
        logger.error(f"Server error saving transcript: {e}")
        return jsonify({
            'status': 'error',
            'message': 'Server error while saving transcript.'
        }), 500


@app.route('/transcripts', methods=['GET'])
def list_transcripts():
    """Returns a list of all saved transcript records in data/."""
    try:
        files = os.listdir(DATA_DIR)
        json_files = [f for f in files if f.endswith('.json')]
        json_files.sort(reverse=True)
        
        records = []
        for file in json_files:
            file_path = os.path.join(DATA_DIR, file)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = json.load(f)
                    content['filename'] = file
                    records.append(content)
            except Exception:
                continue

        return jsonify({
            'status': 'success',
            'count': len(records),
            'transcripts': records
        })
    except Exception as e:
        logger.error(f"Failed to retrieve transcripts: {e}")
        return jsonify({
            'status': 'error',
            'message': 'Failed to retrieve transcripts.'
        }), 500


@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    """Allows downloading an individual JSON or TXT transcript file."""
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(DATA_DIR, safe_filename)
    
    if not os.path.isfile(file_path):
        return jsonify({'status': 'error', 'message': 'File not found'}), 404
        
    return send_from_directory(DATA_DIR, safe_filename, as_attachment=True)


@app.route('/download-all', methods=['GET'])
def download_all():
    """Generates a ZIP archive of all stored transcripts and serves it."""
    try:
        files = os.listdir(DATA_DIR)
        transcript_files = [f for f in files if f.endswith('.json') or f.endswith('.txt')]
        
        if not transcript_files:
            return jsonify({'status': 'error', 'message': 'No transcripts available to export.'}), 404

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for filename in transcript_files:
                file_path = os.path.join(DATA_DIR, filename)
                zip_file.write(file_path, arcname=filename)
        
        zip_buffer.seek(0)
        timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
        zip_name = f"medical_transcripts_{timestamp_str}.zip"
        
        return send_file(
            zip_buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name=zip_name
        )
    except Exception as e:
        logger.error(f"Failed to create zip archive: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to create export zip.'}), 500


if __name__ == '__main__':
    print("Starting Emergency Medical Voice Intake Server on http://127.0.0.1:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
