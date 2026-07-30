import os
import sys
import shutil
import imageio_ffmpeg
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"


def ensure_ffmpeg_executable() -> None:
    """Install the bundled FFmpeg next to Python during explicit app startup."""
    try:
        ffmpeg_src = Path(imageio_ffmpeg.get_ffmpeg_exe())
        scripts_dir = Path(sys.executable).parent
        ffmpeg_dst = scripts_dir / "ffmpeg"
        if not ffmpeg_dst.exists() and ffmpeg_src.exists():
            shutil.copy2(ffmpeg_src, ffmpeg_dst)
            print(f"FFmpeg desplegado en: {ffmpeg_dst}")
    except (OSError, RuntimeError) as exc:
        print(f"Error al configurar FFmpeg: {exc}")

ROOT_DIR = Path(__file__).parent.parent

class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8001
    upload_dir: str = str(ROOT_DIR / "uploads")
    db_path: str = str(ROOT_DIR / "data" / "database.db")
    allowed_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    max_upload_size_mb: int = 2048
    max_web_download_mb: int = 50
    allow_local_file_paths: bool = True
    auto_start_ollama: bool = True
    prune_orphaned_on_startup: bool = False
    
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

UPLOAD_DIR = Path(settings.upload_dir).expanduser()
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = ROOT_DIR / UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.upload_dir = str(UPLOAD_DIR.resolve())

DB_FILE = Path(settings.db_path).expanduser()
if not DB_FILE.is_absolute():
    DB_FILE = ROOT_DIR / DB_FILE
DB_FILE.parent.mkdir(parents=True, exist_ok=True)
settings.db_path = str(DB_FILE.resolve())
