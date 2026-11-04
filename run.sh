#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Ensure Ollama daemon is running
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "Starting Ollama service..."
    (ollama serve >/tmp/niramyan-ollama.log 2>&1 &)
    sleep 3
fi

# Detect installed models
AVAILABLE_MODELS=$(ollama list 2>/dev/null | awk 'NR>1 {print $1}' || true)

if [ -z "$OLLAMA_MODEL" ]; then
    if echo "$AVAILABLE_MODELS" | grep -Fxq "Niramyan-AI-3B:latest"; then
        export OLLAMA_MODEL="Niramyan-AI-3B:latest"
    elif [ -n "$AVAILABLE_MODELS" ]; then
        FIRST_MODEL=$(echo "$AVAILABLE_MODELS" | head -n1)
        export OLLAMA_MODEL="$FIRST_MODEL"
        echo "Note: 'Niramyan-AI-3B:latest' not found. Auto-selecting detected model: $OLLAMA_MODEL"
    else
        echo "⚠️ No Ollama models found installed."
        echo "To pull a fast model, run: ollama pull llama3:latest"
        echo "Starting server anyway (you can load a model at any time)..."
        export OLLAMA_MODEL="Niramyan-AI-3B:latest"
    fi
else
    echo "Using specified OLLAMA_MODEL: $OLLAMA_MODEL"
fi

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

echo "=========================================================="
echo "✨ Niramyan-AI Local Avatar Assistant is ready!"
echo "   Model: $OLLAMA_MODEL"
if [ -x "./piper/piper" ] && [ -f "./voices/en_US-hfc_female-medium.onnx" ]; then
    echo "   Voice: 🌸 Piper Neural TTS (HFC Anime Female Active)"
else
    echo "   Voice: 🌐 Browser Web Speech API (Run ./install_piper.sh for Neural Voice)"
fi
echo "   URL:   http://127.0.0.1:7860"
echo "=========================================================="

python app.py
