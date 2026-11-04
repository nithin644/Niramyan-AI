#!/usr/bin/env bash
# ==============================================================================
# Niramyan-AI — Neural Voice Engine Installer for Kali Linux & Ubuntu
# Sets up Piper TTS with high-quality feminine anime voice models
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "🌸 Installing Niramyan-AI Neural Voice Engine (Piper TTS)"
echo "=========================================================="

PIPER_DIR="$SCRIPT_DIR/piper"
VOICES_DIR="$SCRIPT_DIR/voices"
mkdir -p "$PIPER_DIR" "$VOICES_DIR"

ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
    echo "⚠️ Warning: Piper prebuilt binaries are optimized for x86_64 Linux."
    echo "Your architecture is: $ARCH"
fi

# 1. Download Piper standalone binary if not present
if [ ! -f "$PIPER_DIR/piper" ]; then
    echo "📥 [1/3] Downloading Piper TTS Standalone (v2023.11.14-2)..."
    PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
    curl -L --progress-bar -o "$PIPER_DIR/piper.tar.gz" "$PIPER_URL"
    tar -xzf "$PIPER_DIR/piper.tar.gz" -C "$PIPER_DIR" --strip-components=1
    rm -f "$PIPER_DIR/piper.tar.gz"
    chmod +x "$PIPER_DIR/piper"
    echo "✅ Piper binary installed successfully."
else
    echo "✅ [1/3] Piper binary already installed."
fi

# 2. Download Primary Voice: en_US-hfc_female-medium (Soft Anime Assistant)
HFC_ONNX="$VOICES_DIR/en_US-hfc_female-medium.onnx"
HFC_JSON="$VOICES_DIR/en_US-hfc_female-medium.onnx.json"
if [ ! -f "$HFC_ONNX" ] || [ ! -f "$HFC_JSON" ]; then
    echo "📥 [2/3] Downloading Primary Anime Voice (HFC Female - Soft, Clear, Youthful)..."
    curl -L --progress-bar -o "$HFC_ONNX" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx"
    curl -L --progress-bar -o "$HFC_JSON" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json"
    echo "✅ HFC Female anime voice installed."
else
    echo "✅ [2/3] Primary anime voice (HFC Female) already present."
fi

# 3. Download Secondary Voice: en_US-amy-medium (Siri-like Natural Clarity)
AMY_ONNX="$VOICES_DIR/en_US-amy-medium.onnx"
AMY_JSON="$VOICES_DIR/en_US-amy-medium.onnx.json"
if [ ! -f "$AMY_ONNX" ] || [ ! -f "$AMY_JSON" ]; then
    echo "📥 [3/3] Downloading Secondary Voice (Amy - Warm, Siri-like Clarity)..."
    curl -L --progress-bar -o "$AMY_ONNX" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx"
    curl -L --progress-bar -o "$AMY_JSON" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"
    echo "✅ Amy Siri-style voice installed."
else
    echo "✅ [3/3] Secondary voice (Amy) already present."
fi

# 4. Quick Verification Test
echo "🔍 Running audio synthesis test..."
TEST_WAV="/tmp/niramyan_test.wav"
echo "Hello, I am Niramyan! Your anime assistant voice is now active." | \
    "$PIPER_DIR/piper" --model "$HFC_ONNX" --config "$HFC_JSON" --output_file "$TEST_WAV" -q

if [ -f "$TEST_WAV" ] && [ -s "$TEST_WAV" ]; then
    echo "✨ Test audio generated successfully ($(du -h "$TEST_WAV" | cut -f1))!"
    rm -f "$TEST_WAV"
else
    echo "❌ Warning: Test generation failed. Please check permissions."
    exit 1
fi

echo "=========================================================="
echo "🎉 Setup Complete! You can now launch Niramyan-AI with:"
echo "   ./run.sh"
echo "=========================================================="

