# SLM RAG — Local AI Assistant & Transcription Suite

Sistema RAG (Retrieval-Augmented Generation) local acelerado por GPU NVIDIA CUDA. Permite la ingestión y transcripción de audios, videos de YouTube y documentos, además de generación de resúmenes inteligentes, búsqueda semántica y chat contextual utilizando LLMs locales vía Ollama.

---

## 🛠️ Requisitos Previos

Antes de comenzar, asegúrate de contar con los siguientes elementos instalados en tu sistema (Linux / Ubuntu recomendado con GPU NVIDIA):

1. **Python 3.12** y **`uv`** (Gestor rápido de paquetes de Python):
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
2. **Node.js (v20+)** y **`pnpm`**:
   ```bash
   npm install -g pnpm
   ```
3. **FFmpeg**: Necesario para el procesamiento de audio/video.
   ```bash
   sudo apt update && sudo apt install -y ffmpeg
   ```
4. **Ollama**: Servidor local de Modelos de Lenguaje.
   - Instalar desde [ollama.com](https://ollama.com).
   - Descargar el modelo LLM configurado (por defecto `gemma4:12b`):
     ```bash
     ollama pull gemma4:12b
     ```
5. **Drivers NVIDIA y CUDA**: Recomendado para aceleración por GPU.

---

## 🚀 Instalación y Configuración

### 1. Clonar el Repositorio
```bash
git clone <URL_DEL_REPOSITORIO>
cd Proyecto-slm
```

### 2. Configurar Variables de Entorno (`.env`)
Copia la plantilla de configuración `.env.template` a `.env`:
```bash
cp .env.template .env
```
Edita `.env` según tus necesidades (puerto, modelo Whisper, token de Hugging Face para diarización PyAnnote, etc.):
```env
# Configuración del Servidor FastAPI
HOST=0.0.0.0
PORT=8001
UPLOAD_DIR=uploads
DB_PATH=data/database.db

# Configuración del Motor Whisper/WhisperX
DEVICE=cuda
WHISPER_MODEL=large-v3
COMPUTE_TYPE=float16
BATCH_SIZE=8

# Token opcional de Hugging Face para Diarización de Voces (Pyannote)
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Ollama y RAG
OLLAMA_URL=http://localhost:11434
LLM_MODEL=gemma4:12b
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DEVICE=cuda
```

### 3. Instalar Dependencias del Backend (Python)
Utiliza `uv` para sincronizar el entorno virtual y descargar las dependencias necesarias de PyTorch / CUDA:
```bash
uv sync
```

### 4. Instalar Dependencias del Frontend (React + Vite)
Navega a la carpeta del frontend e instala los paquetes de Node:
```bash
cd frontend
pnpm install
cd ..
```

---

## 🏃 Modo de Ejecución Local

### Paso 1: Iniciar el Servidor Ollama
Asegúrate de que Ollama esté ejecutándose en segundo plano:
```bash
ollama serve
```

### Paso 2: Iniciar el Backend FastAPI
En la raíz del proyecto, ejecuta el servidor API con `uv`:
```bash
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
```
*El servidor backend estará disponible en `http://localhost:8001`.*

Por seguridad, el servidor escucha en `127.0.0.1` de forma predeterminada. No lo expongas a la red sin añadir autenticación y configurar explícitamente `ALLOWED_ORIGINS`.

### Paso 3: Iniciar el Frontend (Servidor de Desarrollo)
En otra terminal, ejecuta el frontend en modo de desarrollo:
```bash
cd frontend
pnpm run dev
```
*La interfaz web se abrirá en `http://localhost:5173`.*

> **Nota para Producción**: Puedes compilar el frontend ejecutando `pnpm run build` en el directorio `frontend/`. El backend servirá los archivos estáticos compilados directamente.

### Comprobaciones antes de ejecutar

```bash
# Backend: migraciones aisladas, límites de archivos y protección SSRF
PYTHONPATH=backend uv run python -m unittest discover -s tests -v
uv run ruff check backend tests

# Frontend: tipos, lint y compilación de producción
pnpm --dir frontend run check
```

---

## 💡 Características Principales

- **Ingestión Multi-fuente**:
  - **Transcripción de Archivos**: Subida individual, ruta local o concatenación multimarca vía FFmpeg.
  - **Ingestión por YouTube**: Transcripción individual o procesamiento en lote (*batch*) pegando múltiples URLs.
  - **Archivos y Documentos**: Análisis e ingestión de PDFs (incluyendo escaneados/manuscritos vía OCR multimodal con Gemma 4 / Docling), TXT, etc.
- **Motor WhisperX / OpenAI Whisper**:
  - Transcripción acelerada por GPU con alineación fonética de palabras (`Wav2Vec2`).
  - Diarización de hablantes (`PyAnnote Audio 3.1`).
  - Reproductor interactivo sincronizado con resaltado de texto palabra por palabra.
- **Resúmenes Inteligentes con LLM**:
  - **Modo Reunión**: Extrae puntos clave, compromisos/acuerdos y participación por locutor.
  - **Modo Video Ensayo**: Genera un índice de contenidos por timestamps (`[HH:MM:SS]`), ideas clave y reflexión crítica.
- **RAG & Chat Contextual**:
  - Embeddings locales con `BAAI/bge-m3`.
  - Chat con la transcripción/documento conservando historial de conversación.
  - Búsqueda semántica de conceptos clave en la base de datos de fragmentos.
