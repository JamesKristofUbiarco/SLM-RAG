import threading
import contextlib
import time
import logging

logger = logging.getLogger("uvicorn")

class GPULock:
    def __init__(self):
        self._lock = threading.Lock()
        
    @contextlib.contextmanager
    def acquire(self, task_name: str = "GPU Task"):
        logger.info(f"[GPU Lock] Solicitando acceso exclusivo a la GPU para: '{task_name}'...")
        start_time = time.time()
        with self._lock:
            wait_time = time.time() - start_time
            if wait_time > 0.1:
                logger.info(f"[GPU Lock] Acceso exclusivo a la GPU otorgado para '{task_name}' después de esperar {wait_time:.2f}s.")
            else:
                logger.info(f"[GPU Lock] Acceso exclusivo a la GPU otorgado para '{task_name}' de inmediato.")
            try:
                yield
            finally:
                logger.info(f"[GPU Lock] Acceso exclusivo a la GPU liberado por: '{task_name}'")

gpu_lock = GPULock()
