import ipaddress
import re
import socket
from pathlib import Path
from urllib.parse import urlparse
from urllib.parse import urljoin

from fastapi import HTTPException, UploadFile
import requests

from config import settings


_SAFE_FILENAME_CHARS = re.compile(r"[^\w. -]+", re.UNICODE)


def safe_filename(filename: str | None, fallback: str = "archivo") -> str:
    """Return a display-safe basename; generated prefixes prevent collisions."""
    basename = Path(filename or fallback).name.replace("\x00", "").strip()
    cleaned = _SAFE_FILENAME_CHARS.sub("_", basename).strip(" .")
    return cleaned[:180] or fallback


def max_upload_bytes() -> int:
    return max(1, settings.max_upload_size_mb) * 1024 * 1024


def copy_upload_limited(upload: UploadFile, destination: Path) -> int:
    """Stream an UploadFile to disk with an explicit upper bound."""
    limit = max_upload_bytes()
    total = 0
    try:
        with destination.open("wb") as target:
            while chunk := upload.file.read(1024 * 1024):
                total += len(chunk)
                if total > limit:
                    raise HTTPException(
                        status_code=413,
                        detail=f"El archivo supera el límite de {settings.max_upload_size_mb} MB.",
                    )
                target.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return total


def validate_public_http_url(url: str) -> str:
    """Reject non-HTTP and local/private network targets before web ingestion."""
    normalized = url.strip()
    if not normalized.startswith(("http://", "https://")):
        normalized = "https://" + normalized

    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Sólo se permiten URLs HTTP o HTTPS válidas.")
    if parsed.username or parsed.password:
        raise ValueError("No se permiten credenciales dentro de la URL.")
    if parsed.hostname.lower() == "localhost" or parsed.hostname.lower().endswith(".localhost"):
        raise ValueError("La URL apunta a localhost.")

    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except socket.gaierror as exc:
        raise ValueError("No se pudo resolver el dominio solicitado.") from exc

    for raw_address in addresses:
        address = ipaddress.ip_address(raw_address.split("%", 1)[0])
        if any((
            address.is_private,
            address.is_loopback,
            address.is_link_local,
            address.is_multicast,
            address.is_reserved,
            address.is_unspecified,
        )):
            raise ValueError("La URL apunta a una red local, privada o reservada.")

    return normalized


def fetch_public_http(url: str, *, headers: dict[str, str], timeout: int = 25) -> requests.Response:
    """Fetch a public URL while validating every redirect target."""
    current = validate_public_http_url(url)
    for _ in range(6):
        response = requests.get(
            current,
            headers=headers,
            timeout=timeout,
            allow_redirects=False,
            stream=True,
        )
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("location")
            if not location:
                response.raise_for_status()
            current = validate_public_http_url(urljoin(current, location))
            response.close()
            continue
        response.raise_for_status()
        limit = max(1, settings.max_web_download_mb) * 1024 * 1024
        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > limit:
            response.close()
            raise ValueError(f"La respuesta web supera el límite de {settings.max_web_download_mb} MB.")
        body = bytearray()
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            body.extend(chunk)
            if len(body) > limit:
                response.close()
                raise ValueError(f"La respuesta web supera el límite de {settings.max_web_download_mb} MB.")
        response._content = bytes(body)
        response._content_consumed = True
        return response
    raise ValueError("La URL excede el máximo permitido de redirecciones.")
