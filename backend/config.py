import os
import sys
import shutil
import imageio_ffmpeg
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

# Desplegar FFmpeg automáticamente en el .venv local
try:
    ffmpeg_src = Path(imageio_ffmpeg.get_ffmpeg_exe())
    scripts_dir = Path(sys.executable).parent
    ffmpeg_dst = scripts_dir / "ffmpeg"
    if not ffmpeg_dst.exists() and ffmpeg_src.exists():
        shutil.copy2(ffmpeg_src, ffmpeg_dst)
        print(f"FFmpeg desplegado en: {ffmpeg_dst}")
except Exception as e:
    print(f"Error al configurar FFmpeg: {e}")

class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8001
    upload_dir: str = "uploads"
    db_path: str = "data/database.db"
    
    # Whisper Configuration
    device: str = "cuda"
    whisper_model: str = "large-v3"
    compute_type: str = "float16"
    batch_size: int = 16
    hf_token: str = ""
    
    # Ollama Configuration
    ollama_url: str = "http://localhost:11434"
    llm_model: str = "gemma4:12b"
    ollama_context_length: int = 32768
    
    # RAG Settings
    embedding_model: str = "BAAI/bge-m3"
    embedding_device: str = "cuda"
    chunk_size: int = 800
    chunk_overlap: int = 150

    model_config = SettingsConfigDict(
        env_file=[".env", "../.env"],
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
Path("data").mkdir(exist_ok=True)
