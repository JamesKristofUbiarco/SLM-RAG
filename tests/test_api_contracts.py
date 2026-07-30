import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ApiContractTests(unittest.TestCase):
    def test_core_routes_and_source_free_chat_import(self):
        script = textwrap.dedent(
            """
            import asyncio
            import inspect
            import main
            import whisper_service as whisper_module

            paths = {route.path for route in main.app.routes}
            required = {
                '/api/status', '/api/transcribe', '/api/chat', '/api/projects',
                '/api/studio/generate', '/api/jobs/{job_id}',
                '/api/chat/sessions/{session_id}/branch/{message_id}'
            }
            assert required <= paths
            transcribe_parameters = inspect.signature(main.transcribe).parameters
            assert 'model_name' in transcribe_parameters
            assert 'model' in transcribe_parameters
            assert main.ChatPayload(search_depth='crawler').search_depth == 'crawler'

            service = main.whisper_service
            original_loader = whisper_module.whisperx.load_model
            original_clear_memory = service._clear_memory
            loaded_models = []
            try:
                service._transcribe_models.clear()
                service._clear_memory = lambda: None
                def fake_load_model(*args, **kwargs):
                    loaded_models.append((args, kwargs))
                    return object()
                whisper_module.whisperx.load_model = fake_load_model

                spanish_model = service.get_transcribe_model('small', 'es')
                assert loaded_models[-1][1]['language'] == 'es'
                assert service.get_transcribe_model('small', 'es') is spanish_model
                assert len(loaded_models) == 1

                service.get_transcribe_model('small', None)
                assert loaded_models[-1][1]['language'] is None
                assert len(loaded_models) == 2
            finally:
                whisper_module.whisperx.load_model = original_loader
                service._clear_memory = original_clear_memory
                service._transcribe_models.clear()

            created = asyncio.run(main.create_project(
                main.CreateProjectPayload(name='Contrato', description='test')
            ))
            assert created['name'] == 'Contrato'
            projects = asyncio.run(main.get_projects())
            assert projects['projects'][0]['name'] == 'Contrato'

            imported = asyncio.run(main.import_chat_session(
                main.ImportChatSessionPayload(
                    title='Sin fuentes',
                    context_sources='no_sources',
                    messages=[{'role': 'user', 'content': 'hola'}],
                )
            ))
            session = asyncio.run(main.get_chat_session_details(imported['session_id']))
            assert session['messages'][0]['content'] == 'hola'

            stale_import = asyncio.run(main.import_chat_session(
                main.ImportChatSessionPayload(
                    title='Fuente inexistente',
                    context_sources='999999',
                    messages=[{'role': 'assistant', 'content': 'contenido conservado'}],
                )
            ))
            stale_session = asyncio.run(main.get_chat_session_details(stale_import['session_id']))
            assert stale_session['messages'][0]['content'] == 'contenido conservado'

            linear_import = asyncio.run(main.import_chat_session(
                main.ImportChatSessionPayload(
                    title='Conversación lineal',
                    context_sources='no_sources',
                    messages=[
                        {'role': 'user', 'content': 'pregunta inicial'},
                        {'role': 'assistant', 'content': 'respuesta inicial'},
                        {'role': 'user', 'content': 'pregunta a editar'},
                        {'role': 'assistant', 'content': 'respuesta que quedará en la original'},
                    ],
                )
            ))
            original_before = asyncio.run(main.get_chat_session_details(linear_import['session_id']))
            target_message_id = original_before['messages'][2]['id']
            branch = asyncio.run(main.branch_chat_session(
                linear_import['session_id'],
                target_message_id,
                main.BranchChatSessionPayload(edited_message='pregunta corregida'),
            ))
            assert [message['content'] for message in branch['messages']] == [
                'pregunta inicial', 'respuesta inicial'
            ]
            assert branch['branched_from'] == linear_import['session_id']

            captured_history = []
            original_query_llm = main.rag_service.query_llm
            original_run_in_threadpool = main.run_in_threadpool
            try:
                def fake_query_llm(query, context, history):
                    captured_history.extend(history)
                    return 'respuesta de la rama'
                async def immediate_run(function, **kwargs):
                    return function(**kwargs)
                main.rag_service.query_llm = fake_query_llm
                main.run_in_threadpool = immediate_run
                branch_response = asyncio.run(main.chat_interaction(main.ChatPayload(
                    session_id=branch['id'],
                    query='pregunta corregida',
                    search_mode='local',
                )))
            finally:
                main.rag_service.query_llm = original_query_llm
                main.run_in_threadpool = original_run_in_threadpool

            assert [message['content'] for message in captured_history] == [
                'pregunta inicial', 'respuesta inicial'
            ]
            assert branch_response['user_message_id']
            assert branch_response['assistant_message_id']
            branch_after = asyncio.run(main.get_chat_session_details(branch['id']))
            assert [message['content'] for message in branch_after['messages']] == [
                'pregunta inicial', 'respuesta inicial', 'pregunta corregida', 'respuesta de la rama'
            ]
            assert branch_after['messages'][2]['request_options']['search_mode'] == 'local'
            original_after = asyncio.run(main.get_chat_session_details(linear_import['session_id']))
            assert [message['content'] for message in original_after['messages']] == [
                'pregunta inicial', 'respuesta inicial',
                'pregunta a editar', 'respuesta que quedará en la original'
            ]

            with main.get_db() as connection:
                cursor = connection.execute(
                    "INSERT INTO transcriptions (filename, text, segments_json) VALUES (?, ?, ?)",
                    ('meeting.mp3', 'contenido', '[]'),
                )
                transcription_id = cursor.lastrowid
                connection.commit()
            main.rag_service.generate_summary = lambda _filename, _text: '# Resumen controlado'
            main.rag_service.generate_commitments = lambda _filename, _text: ''
            job_id = main.create_job('summary', transcription_id, payload={'mode': 'meeting'})
            main.process_summary_background(
                transcription_id,
                'meeting.mp3',
                'contenido',
                job_id=job_id,
            )
            assert main.get_job(job_id)['status'] == 'completed'
            summary = asyncio.run(main.get_transcription_summary(transcription_id))
            assert summary['summary'] == '# Resumen controlado'
            """
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            environment = os.environ.copy()
            environment["DB_PATH"] = str(Path(temp_dir) / "api.db")
            environment["UPLOAD_DIR"] = str(Path(temp_dir) / "uploads")
            environment["PYTHONPATH"] = str(ROOT / "backend")
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
                timeout=20,
            )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
