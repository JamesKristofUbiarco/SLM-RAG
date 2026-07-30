import datetime
import json
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from collections.abc import Callable
from typing import Any, Optional

from database import get_db


TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="persistent-job-worker")
_futures: dict[str, Future[Any]] = {}


def create_job(
    kind: str,
    resource_id: Optional[int] = None,
    message: str = "Pendiente",
    payload: Optional[dict[str, Any]] = None,
) -> str:
    job_id = f"job_{uuid.uuid4().hex}"
    with get_db() as conn:
        conn.execute(
            """INSERT INTO jobs
               (id, kind, resource_id, status, progress, message, payload_json)
               VALUES (?, ?, ?, 'pending', 0, ?, ?)""",
            (job_id, kind, resource_id, message, json.dumps(payload or {}, ensure_ascii=False)),
        )
        conn.commit()
    return job_id


def update_job(
    job_id: str,
    status: str,
    *,
    progress: Optional[int] = None,
    message: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    fields = ["status = ?"]
    values: list[Any] = [status]
    if progress is not None:
        fields.append("progress = ?")
        values.append(max(0, min(100, progress)))
    if message is not None:
        fields.append("message = ?")
        values.append(message)
    if error is not None:
        fields.append("error = ?")
        values.append(error)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if status == "running":
        fields.append("started_at = COALESCE(started_at, ?)")
        values.append(now)
    if status in TERMINAL_STATUSES:
        fields.append("finished_at = ?")
        values.append(now)
    values.append(job_id)
    with get_db() as conn:
        conn.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return dict(row) if row else None


def list_unfinished_jobs() -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs WHERE status IN ('pending', 'running') ORDER BY created_at ASC"
        ).fetchall()
    return [dict(row) for row in rows]


def submit_job(job_id: str, function: Callable[..., Any], /, **kwargs: Any) -> Future[Any]:
    """Submit to the single local worker used for GPU-heavy background jobs."""
    future = _executor.submit(function, job_id=job_id, **kwargs)
    _futures[job_id] = future
    future.add_done_callback(lambda _future: _futures.pop(job_id, None))
    return future


def mark_interrupted_jobs(exclude_ids: Optional[set[str]] = None) -> int:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    excluded = sorted(exclude_ids or set())
    where_clause = "status IN ('pending', 'running')"
    parameters: list[Any] = [now]
    if excluded:
        placeholders = ",".join("?" for _ in excluded)
        where_clause += f" AND id NOT IN ({placeholders})"
        parameters.extend(excluded)
    with get_db() as conn:
        cursor = conn.execute(
            f"""UPDATE jobs
                SET status = 'interrupted', error = 'El servidor se reinició durante la ejecución', finished_at = ?
                WHERE {where_clause}""",
            parameters,
        )
        conn.commit()
        return cursor.rowcount
