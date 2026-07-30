import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DatabaseBootstrapTests(unittest.TestCase):
    def test_fresh_database_supports_current_schema_and_jobs(self):
        script = textwrap.dedent(
            """
            import os
            import sqlite3

            import database
            import job_service

            database.init_db()
            with database.get_db() as connection:
                chat_columns = {row['name'] for row in connection.execute('PRAGMA table_info(chat_history)')}
                chunk_columns = {row['name'] for row in connection.execute('PRAGMA table_info(chunks)')}
                assert 'context_sources' in chat_columns
                assert {'embedding_model', 'embedding_dimension', 'index_version'} <= chunk_columns
                assert connection.execute('PRAGMA foreign_keys').fetchone()[0] == 1

            job_id = job_service.create_job('test', resource_id=42)
            job_service.update_job(job_id, 'completed', progress=100)
            assert job_service.get_job(job_id)['status'] == 'completed'

            def execute(*, job_id, value):
                job_service.update_job(job_id, 'running', progress=10)
                job_service.update_job(job_id, 'completed', progress=value)

            queued_id = job_service.create_job('queued-test', resource_id=43, payload={'value': 100})
            job_service.submit_job(queued_id, execute, value=100).result(timeout=5)
            assert job_service.get_job(queued_id)['status'] == 'completed'
            """
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            environment = os.environ.copy()
            environment["DB_PATH"] = str(Path(temp_dir) / "fresh.db")
            environment["PYTHONPATH"] = str(ROOT / "backend")
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
