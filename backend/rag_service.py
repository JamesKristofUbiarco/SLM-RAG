import numpy as np
import requests
import json
import pickle
from typing import List, Dict, Any, Tuple
from sentence_transformers import SentenceTransformer
from database import get_db
from config import settings

class RAGService:
    def __init__(self):
        self.model = None

    def _load_model(self):
        if self.model is None:
            print(f"Loading embedding model '{settings.embedding_model}' on device '{settings.embedding_device}'...")
            self.model = SentenceTransformer(settings.embedding_model, device=settings.embedding_device)
            print("Embedding model loaded successfully.")

    def unload_embedding_model(self):
        if self.model is not None:
            print(f"Unloading embedding model '{settings.embedding_model}' from device '{settings.embedding_device}'...")
            self.model = None
            import gc
            import torch
            gc.collect()
            if torch.cuda.is_available():
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
            print("Embedding model unloaded successfully.")
        
    def chunk_text(self, text: str, size: int = settings.chunk_size, overlap: int = settings.chunk_overlap) -> List[str]:
        """Divide the text into overlapping chunks of characters."""
        if not text or not text.strip():
            return []
            
        # We split by space to avoid cutting in the middle of words
        words = text.split()
        if len(text) <= size:
            return [text]
            
        chunks = []
        current_words = []
        current_length = 0
        
        # Word-based chunking with word-based overlap to keep sentences clean
        overlap_words_count = max(1, int(overlap / 6)) # estimate 6 chars per word
        step = max(1, int(size / 6) - overlap_words_count)
        
        i = 0
        while i < len(words):
            chunk_words = words[i:i + int(size / 6)]
            chunk_text = " ".join(chunk_words)
            if chunk_text.strip():
                chunks.append(chunk_text)
            i += step
            
        return chunks

    def generate_embeddings(self, texts: List[str]) -> List[np.ndarray]:
        """Generate vector embeddings for a list of texts."""
        if not texts:
            return []
        self._load_model()
        from gpu_lock import gpu_lock
        with gpu_lock.acquire("Generar Embeddings"):
            return self.model.encode(texts, convert_to_numpy=True)

    def store_chunks(self, transcription_id: int, text: str):
        """Chunk text, generate embeddings, and save to SQLite database."""
        chunks = self.chunk_text(text)
        if not chunks:
            return
            
        embeddings = self.generate_embeddings(chunks)
        
        with get_db() as conn:
            for chunk_text, emb in zip(chunks, embeddings):
                emb_blob = pickle.dumps(emb)
                conn.execute(
                    "INSERT INTO chunks (transcription_id, text, embedding) VALUES (?, ?, ?)",
                    (transcription_id, chunk_text, emb_blob)
                )
            conn.commit()
        # Unload model from VRAM immediately to free memory!
        self.unload_embedding_model()

    def get_context_with_citations(self, query: str, transcription_ids: Any, top_k: int = 6) -> Dict[str, Any]:
        """
        Search for top_k semantically similar chunks and return structured context with citation IDs.
        Returns dict with: 'context_text', 'citations' list.
        """
        if isinstance(transcription_ids, (int, str)):
            try:
                ids = [int(transcription_ids)]
            except ValueError:
                ids = []
        elif isinstance(transcription_ids, list):
            ids = [int(x) for x in transcription_ids if str(x).isdigit()]
        else:
            ids = []

        if not ids:
            return {"context_text": "", "citations": []}

        self._load_model()
        from gpu_lock import gpu_lock
        with gpu_lock.acquire("Codificar Consulta (RAG)"):
            query_vector = self.model.encode(query, convert_to_numpy=True)
        self.unload_embedding_model()
        
        placeholders = ",".join(["?"] * len(ids))
        sql = f"""
            SELECT c.id, c.text, c.embedding, c.transcription_id, t.filename 
            FROM chunks c
            JOIN transcriptions t ON c.transcription_id = t.id
            WHERE c.transcription_id IN ({placeholders})
        """
        with get_db() as conn:
            rows = conn.execute(sql, ids).fetchall()
            
        if not rows:
            return {"context_text": "", "citations": []}
            
        similarities = []
        for row in rows:
            emb = pickle.loads(row["embedding"])
            dot_product = np.dot(query_vector, emb)
            norm_q = np.linalg.norm(query_vector)
            norm_emb = np.linalg.norm(emb)
            similarity = dot_product / (norm_q * norm_emb) if norm_q > 0 and norm_emb > 0 else 0.0
            similarities.append((
                similarity,
                row["id"],
                row["transcription_id"],
                row["filename"],
                row["text"]
            ))
            
        # Sort descending by similarity
        similarities.sort(key=lambda x: x[0], reverse=True)
        top_matches = similarities[:top_k]

        citations = []
        context_parts = []

        for idx, item in enumerate(top_matches, start=1):
            sim, chunk_id, source_id, filename, text = item
            citations.append({
                "num": idx,
                "source_id": source_id,
                "filename": filename,
                "chunk_id": chunk_id,
                "snippet": text[:350] + ("..." if len(text) > 350 else ""),
                "full_text": text
            })
            context_parts.append(f"[Fuente Cita [{idx}] | Archivo: {filename}]\n{text}")

        return {
            "context_text": "\n\n---\n\n".join(context_parts),
            "citations": citations
        }

    def get_context(self, query: str, transcription_ids: Any, top_k: int = 6) -> str:
        """Search for the most semantically similar chunks across one or multiple transcriptions/sources."""
        res = self.get_context_with_citations(query, transcription_ids, top_k=top_k)
        return res["context_text"]

    def call_ollama_generate(self, prompt: str, temperature: float = 0.3) -> str:
        """Query Ollama generate API endpoint."""
        payload = {
            "model": settings.llm_model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_ctx": settings.ollama_context_length
            }
        }
        from gpu_lock import gpu_lock
        with gpu_lock.acquire("Ollama Generación"):
            try:
                response = requests.post(f"{settings.ollama_url}/api/generate", json=payload, timeout=180)
                if response.status_code == 200:
                    return response.json().get("response", "").strip()
            except Exception as e:
                return f"[Error Ollama connection]: {str(e)}"
            return "[Error]: No response from Ollama."

    def unload_model(self) -> bool:
        """Tell Ollama to unload the LLM model from VRAM to free GPU memory."""
        try:
            payload = {
                "model": settings.llm_model,
                "prompt": "",
                "keep_alive": 0
            }
            response = requests.post(f"{settings.ollama_url}/api/generate", json=payload, timeout=10)
            if response.status_code == 200:
                print(f"Successfully requested Ollama to unload model '{settings.llm_model}' from VRAM.")
                return True
        except Exception as e:
            print(f"Failed to unload Ollama model: {str(e)}")
        return False

    def generate_summary(self, title: str, text: str) -> str:
        """Generate a Meeting Minutes summary for audio/video recordings of meetings, calls, or discussions."""
        words = text.split()
        
        # Estimate context window capability (Spanish tokenization safety estimation: 1 word ~ 1.5 tokens)
        # Save ~4000 tokens for prompt instructions, context tags, and LLM generation output
        context_window = settings.ollama_context_length
        safe_generation_buffer = 4000
        
        # Maximum words that safely fit into the remaining context window
        max_transcript_words = int((context_window - safe_generation_buffer) / 1.5)
        max_transcript_words = max(max_transcript_words, 2000) # Safeguard minimum
        
        if len(words) <= max_transcript_words:
            print(f"Transcript size ({len(words)} words) fits within the model context window ({context_window} tokens). Using single prompt summary.")
            prompt = f"""Analiza la siguiente transcripción de una reunión o llamada grabada del archivo '{title}'.
Genera una **Minuta de Reunión** ejecutiva, estructurada y profesional en Markdown con la siguiente estructura:

# 📋 Minuta de Reunión: {title}

## 👥 Participantes
Lista los participantes o locutores identificados en la conversación (si están disponibles).

## 📌 Agenda y Temas Tratados
Lista numerada de los temas principales discutidos durante la reunión.

## 🗣️ Desarrollo de la Reunión
Para cada tema tratado, un breve resumen de los puntos debatidos, posturas y argumentos clave.

## ✅ Acuerdos y Decisiones
Lista de decisiones concretas tomadas durante la reunión. Si no hay ninguna, indicarlo.

## 📝 Compromisos y Tareas Asignadas
Lista de tareas o compromisos adquiridos, indicando el responsable y el plazo si se mencionaron.

## 🔜 Próximos Pasos
Acciones inmediatas o siguientes reuniones planificadas.

Transcripción de la reunión:
{text}"""
            return self.call_ollama_generate(prompt)
        
        # Map-Reduce flow fallback for extremely long transcripts
        print(f"Transcript is extremely long ({len(words)} words) and exceeds safe single-prompt context threshold ({max_transcript_words} words). Initializing Map-Reduce summary flow...")
        chunk_word_size = max(max_transcript_words // 3, 2000)
        partial_summaries = []
        
        # Map Phase
        for i in range(0, len(words), chunk_word_size):
            sub_text = " ".join(words[i:i + chunk_word_size])
            part_number = (i // chunk_word_size) + 1
            total_parts = (len(words) - 1) // chunk_word_size + 1
            print(f"Map phase: Summarizing chunk {part_number} of {total_parts}...")
            
            prompt_map = f"""A continuación se presenta la parte {part_number} de {total_parts} de la transcripción de la reunión '{title}'.
Extrae y resume: los temas tratados, los acuerdos alcanzados, las decisiones tomadas y los compromisos adquiridos en esta parte. Sé preciso y mantén nombres, datos y hechos clave.

Fragmento de Transcripción:
{sub_text}"""
            
            summary_part = self.call_ollama_generate(prompt_map)
            partial_summaries.append(f"--- RESUMEN PARCIAL PARTE {part_number} ---\n{summary_part}")

        # Reduce Phase
        print("Reduce phase: Synthesizing final meeting minutes from all partial summaries...")
        combined_partials = "\n\n".join(partial_summaries)
        prompt_reduce = f"""A continuación se presentan los resúmenes parciales de las distintas partes de la reunión '{title}'.
Tu objetivo es sintetizar todos estos resúmenes en una **Minuta de Reunión Ejecutiva Final** completa y estructurada.

Formato requerido en Markdown:

# 📋 Minuta de Reunión: {title}

## 👥 Participantes
Lista los participantes o locutores identificados.

## 📌 Agenda y Temas Tratados
Lista numerada consolidada de todos los temas tratados en la reunión.

## 🗣️ Desarrollo de la Reunión
Resumen del debate y puntos clave por tema.

## ✅ Acuerdos y Decisiones
Lista consolidada de todas las decisiones tomadas.

## 📝 Compromisos y Tareas Asignadas
Lista de compromisos, responsables y plazos.

## 🔜 Próximos Pasos
Acciones inmediatas acordadas.

Resúmenes parciales a consolidar:
{combined_partials}"""
        
        final_summary = self.call_ollama_generate(prompt_reduce, temperature=0.2)
        print("Meeting Minutes generated successfully via Map-Reduce.")
        return final_summary


    def generate_essay_summary(self, title: str, segments: List[Dict[str, Any]], text: str = "") -> str:
        """
        Generate a Video Essay / Conference / Podcast summary with a timestamped index and detailed topic summaries.
        """
        def format_timestamp(seconds: float) -> str:
            sec = int(seconds)
            h = sec // 3600
            m = (sec % 3600) // 60
            s = sec % 60
            if h > 0:
                return f"{h:02d}:{m:02d}:{s:02d}"
            return f"{m:02d}:{s:02d}"

        # Reconstruct timestamped transcript lines
        timestamped_lines = []
        if segments:
            for seg in segments:
                start_sec = seg.get("start", 0)
                time_str = format_timestamp(start_sec)
                t = seg.get("text", "").strip()
                if t:
                    timestamped_lines.append(f"[{time_str}] {t}")
        
        full_timestamped_text = "\n".join(timestamped_lines) if timestamped_lines else text

        words = full_timestamped_text.split()
        context_window = settings.ollama_context_length
        max_transcript_words = int((context_window - 4000) / 1.5)
        max_transcript_words = max(max_transcript_words, 2500)

        if len(words) > max_transcript_words:
            # Smart sampling to fit into context window
            step = (len(words) // max_transcript_words) + 1
            words_sampled = words[::step]
            full_timestamped_text = " ".join(words_sampled)

        prompt = f"""Analiza la siguiente transcripción con marcas de tiempo del archivo '{title}'.
Crea un documento estructurado en el estilo de un "Video Ensayo / Conferencia / Podcast" siguiendo ESTRICTAMENTE la siguiente estructura en Markdown:

## 📌 Índice de Tiempos por Tema
Genera una lista VERTICAL de viñetas (CADA LÍNEA DEBE COMENZAR CON '- ') con las marcas de tiempo exactas [HH:MM:SS] o [MM:SS] extraídas de la transcripción y el título de cada tema, capítulo o sección principal tratada.
Formato OBLIGATORIO de cada línea del índice:
- [HH:MM:SS] Título del Tema o Sección

Ejemplo:
- [00:00:10] Introducción al tema
- [00:04:25] El problema con la arquitectura tradicional
- [00:12:40] Análisis de resultados y conclusiones

## 📝 Resumen Detallado por Tema / Capítulo
Para cada uno de los temas listados en el índice anterior, redacta una sección estructurada:
### [HH:MM:SS] Título del Tema
- **Resumen**: Explicación clara y detallada de los temas discutidos en este lapso de tiempo.
- **Ideas y Hechos Clave**: Argumentos principales, datos o conceptos expuestos.

Transcripción con marcas de tiempo:
{full_timestamped_text}"""

        print(f"Generating Video Essay timestamped summary for '{title}'...")
        return self.call_ollama_generate(prompt)

    def generate_recipe_summary(self, title: str, segments: List[Dict[str, Any]], text: str = "") -> str:
        """
        Generate a Recipe Video summary divided by recipes (sections) and sub-sections:
        Ingredients, Step Index (timestamps), and Detailed Steps per recipe.
        """
        def format_timestamp(seconds: float) -> str:
            sec = int(seconds)
            h = sec // 3600
            m = (sec % 3600) // 60
            s = sec % 60
            if h > 0:
                return f"{h:02d}:{m:02d}:{s:02d}"
            return f"{m:02d}:{s:02d}"

        timestamped_lines = []
        if segments:
            for seg in segments:
                start_sec = seg.get("start", 0)
                time_str = format_timestamp(start_sec)
                t = seg.get("text", "").strip()
                if t:
                    timestamped_lines.append(f"[{time_str}] {t}")
        
        full_timestamped_text = "\n".join(timestamped_lines) if timestamped_lines else text

        words = full_timestamped_text.split()
        context_window = settings.ollama_context_length
        max_transcript_words = int((context_window - 4000) / 1.5)
        max_transcript_words = max(max_transcript_words, 2500)

        if len(words) > max_transcript_words:
            step = (len(words) // max_transcript_words) + 1
            words_sampled = words[::step]
            full_timestamped_text = " ".join(words_sampled)

        prompt = f"""Analiza minuciosamente la siguiente transcripción con marcas de tiempo del video de cocina '{title}'.
Identifica todas las recetas explicadas o preparadas a lo largo del video (pueden ser 1 o varias recetas independientes).

REGLAS DE ORO OBLIGATORIAS:
1. SÉ EXTREMADAMENTE DETALLADO Y EXHAUSTIVO. NO RESUMAS EN UNA SOLA FRASE CORTA. Explica cada paso minuciosamente.
2. CONSERVA TODAS LAS CANTIDADES Y PESOS EXACTOS: Incluye todos los números, gramos, cucharadas, temperaturas, tiempos y piezas mencionadas (ej: "350g de tira New York", "43g o 3 cucharadas de mantequilla sin sal", "12g o 3 a 4 dientes de ajo machacados", "2 ramitas de tomillo", "2 ramitas de romero", "95°C de horno", "45-50°C internos", "refrigerar destapado de 2 a 24 horas", "bañar de 1 a 2 minutos", "reposar de 5 a 10 minutos con los aromáticos encima").
3. DESCRIBE LAS TÉCNICAS Y GESTOS CULINARIOS: Explica cómo realizar cada acción (ej: "secar el corte", "sellar primero la grasa lateral", "ladear el sartén para juntar la mantequilla derretida y bañar la carne continuamente con una cuchara", "verter los jugos de cocción sobre el corte al reposar").

Para CADA receta identificada en el video, genera ESTRICTAMENTE la siguiente estructura en Markdown:

# 🍳 Receta: [Nombre de la Receta]

## 🛒 Ingredientes Completo
Lista detallada de TODOS los ingredientes e insumos necesarios para esta receta específica, con sus cantidades y pesos exactos (ej: gramos, cucharadas, piezas, especias, tipo de corte):
- **[Ingrediente]**: Cantidad exacta, peso o especificación mencionada.

## ⏱️ Índice de Pasos (Marcas de Tiempo)
Lista VERTICAL de viñetas (CADA LÍNEA DEBE COMENZAR CON '- ') con las marcas de tiempo exactas [HH:MM:SS] o [MM:SS] extraídas de la transcripción y el nombre o acción de cada paso de preparación:
- [HH:MM:SS] Nombre del Paso 1
- [HH:MM:SS] Nombre del Paso 2

## 📝 Pasos Explicados al Detalle
Para cada uno de los pasos listados en el índice de esta receta:
### [HH:MM:SS] Nombre del Paso
- **Preparación Explicada**: Descripción rica, detallada y paso a paso del procedimiento, técnicas de cocina, utensilios usados, temperaturas y combinaciones aplicadas en este paso exacto.
- **Cantidades, Tiempos y Consejos**: Cantidades específicas de insumos usados en este paso, tiempos exactos de cocción o reposo, temperaturas clave y trucos/razones dadas por el cocinero (ej: por qué refrigerar destapado o por qué ladear el sartén).

---

IMPORTANTE: Si el video contiene 1 sola receta, genera las subsecciones (Ingredientes Completo, Índice de Pasos, Pasos Explicados al Detalle) 1 sola vez. Si contiene N recetas distintas (por ejemplo 3 platillos diferentes), repite esta estructura completa para cada una de las recetas (Receta 1, Receta 2, ..., Receta N).

Transcripción con marcas de tiempo:
{full_timestamped_text}"""

        print(f"Generating Cooking Recipe summary for '{title}'...")
        return self.call_ollama_generate(prompt)

    def generate_speaker_analysis(self, title: str, segments: List[Dict[str, Any]]) -> str:
        """
        Generate an analysis of each speaker's participation throughout the call.
        """
        # 1. Check if segments have speaker info
        speakers = set(seg.get("speaker") for seg in segments if seg.get("speaker"))
        if not speakers:
            return ""
            
        print(f"Generating speaker participation analysis for {len(speakers)} speakers...")
        
        # 2. Reconstruct a structured speaker timeline text
        dialog_lines = []
        for seg in segments:
            spk = seg.get("speaker", "Desconocido")
            text = seg.get("text", "").strip()
            if text:
                dialog_lines.append(f"{spk}: {text}")
                
        dialog_text = "\n".join(dialog_lines)
        
        # Guard clause: Truncate dialogue if extremely long to fit nicely within LLM context
        words = dialog_text.split()
        if len(words) > 12000:
            dialog_text = " ".join(words[:6000]) + "\n\n... [FRAGMENTO OMITIDO POR ESPACIO] ...\n\n" + " ".join(words[-6000:])
            
        prompt = f"""Analiza la siguiente transcripción de una reunión grabada del archivo '{title}'.
En ella participan distintos locutores identificados como SPEAKER_00, SPEAKER_01, etc.

Tu tarea es:
1. Identificar a cada uno de los locutores que participan activamente.
2. Describir de forma clara, objetiva y detallada el rol o la participación de cada miembro a lo largo de la llamada (qué temas defendió, cuáles fueron sus aportes principales, su postura o tono general y qué decisiones o compromisos asumió).
3. Estructurar el análisis con subtítulos independientes para cada locutor en formato Markdown (por ejemplo, `### SPEAKER_00`, `### SPEAKER_01`, etc.).

Transcripción diarizada:
{dialog_text}"""

        return self.call_ollama_generate(prompt)

    def generate_commitments(self, title: str, text: str) -> str:
        """
        Generate a list of commitments, agreements, and decisions from the transcript.
        """
        print(f"Generating meeting commitments for '{title}'...")
        
        # Guard clause: Truncate transcript if extremely long to fit nicely within LLM context
        words = text.split()
        if len(words) > 12000:
            text = " ".join(words[:6000]) + "\n\n... [FRAGMENTO OMITIDO POR ESPACIO] ...\n\n" + " ".join(words[-6000:])
            
        prompt = f"""Analiza la siguiente transcripción de una reunión grabada del archivo '{title}'.
Identifica todos los compromisos, acuerdos, decisiones y tareas asignadas que se mencionan en la conversación.

Tu tarea es:
1. Extraer y listar detalladamente cada compromiso asumido o tarea asignada.
2. Identificar claramente quién es la persona o locutor responsable de cada compromiso o tarea (si se especifica).
3. Detallar las fechas límite o plazos acordados para las entregas (si se mencionan).
4. Estructurar la respuesta en un formato de lista Markdown clara y fácil de leer.

Si no se mencionan compromisos, acuerdos o tareas específicas en la llamada, indícalo amablemente de forma breve.

Transcripción:
{text}"""

        return self.call_ollama_generate(prompt)

    def generate_doc_executive_summary(self, title: str, text: str) -> str:
        """
        Generate an Executive Document Synthesis for PDFs, DOCX, TXT, MD files.
        """
        words = text.split()
        context_window = settings.ollama_context_length
        max_transcript_words = int((context_window - 4000) / 1.5)
        max_transcript_words = max(max_transcript_words, 2500)

        if len(words) > max_transcript_words:
            step = (len(words) // max_transcript_words) + 1
            text = " ".join(words[::step])

        prompt = f"""Analiza detenidamente el siguiente documento o archivo '{title}'.
Genera una **Síntesis Ejecutiva de Documento** profesional y completa en Markdown con la siguiente estructura:

# 📄 Síntesis Ejecutiva: {title}

## 🎯 Objetivo General y Propósito
Resumen claro y directo sobre el propósito central, contexto y meta del documento.

## 📌 Hallazgos y Puntos Clave
Lista detallada y numerada con los hallazgos, propuestas o ideas principales desarrolladas en el texto.

## 💡 Implicaciones y Conclusiones
Conclusiones clave, recomendaciones o pasos a seguir derivados del documento.

Documento:
{text}"""
        print(f"Generating Executive Document Summary for '{title}'...")
        return self.call_ollama_generate(prompt)

    def generate_doc_analysis_summary(self, title: str, text: str) -> str:
        """
        Generate a Deep Technical Analysis and Section Breakdown.
        """
        words = text.split()
        context_window = settings.ollama_context_length
        max_transcript_words = int((context_window - 4000) / 1.5)
        max_transcript_words = max(max_transcript_words, 2500)

        if len(words) > max_transcript_words:
            step = (len(words) // max_transcript_words) + 1
            text = " ".join(words[::step])

        prompt = f"""Realiza un **Análisis Técnico y Desglose Estructurado** del documento '{title}'.
Responde siguiendo ESTRICTAMENTE esta estructura en Markdown:

# 🔬 Análisis Técnico y Desglose: {title}

## 🔍 Resumen del Contenido
Una visión analítica sobre los temas técnicos o metodológicos tratados.

## 🧩 Desglose por Secciones o Bloques
Estructura el documento por sus secciones principales con breves explicaciones de cada una:
- **Sección / Tema 1**: Explicación y aspectos clave.
- **Sección / Tema 2**: Explicación y aspectos clave.

## 📊 Conceptos, Datos y Términos Clave
Extrae definiciones, cifras, métricas o términos técnicos relevantes.

Documento:
{text}"""
        print(f"Generating Technical Analysis Summary for '{title}'...")
        return self.call_ollama_generate(prompt)

    def generate_web_digest_summary(self, title: str, text: str) -> str:
        """
        Generate a Web Article Digest summary.
        """
        words = text.split()
        context_window = settings.ollama_context_length
        max_transcript_words = int((context_window - 4000) / 1.5)
        max_transcript_words = max(max_transcript_words, 2500)

        if len(words) > max_transcript_words:
            step = (len(words) // max_transcript_words) + 1
            text = " ".join(words[::step])

        prompt = f"""Analiza la siguiente página web o artículo ingerido '{title}'.
Crea un **Resumen Digest Web** ágil y estructurado en Markdown con el siguiente formato:

# 🌐 Resumen Digest Web: {title}

## ⚡ Idea Central en una Frase
Una oración contundente que resuma el núcleo de la publicación.

## 📰 Resumen del Artículo / Contenido
Explicación clara de la tesis del autor, contexto y antecedentes expuestos.

## 🔑 5 Puntos Clave de Lectura Rápida (Takeaways)
1. Punto clave 1
2. Punto clave 2
3. Punto clave 3
4. Punto clave 4
5. Punto clave 5

Contenido Web:
{text}"""
        print(f"Generating Web Digest Summary for '{title}'...")
        return self.call_ollama_generate(prompt)

    def query_llm(self, query: str, context: str, history: List[Dict[str, str]] = None) -> str:
        """Call Ollama chat API injecting retrieved RAG context and rolling conversation history."""
        import datetime
        now_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")
        has_real_context = bool(context and context.strip() and "No hay contexto de documentos" not in context)
        
        if has_real_context:
            system_prompt = f"""Eres un asistente experto de inteligencia artificial RAG. [Fecha/Hora Sistema: {now_str}]
Responde la pregunta del usuario utilizando la información provista en el 'Contexto' a continuación. 
REGLA OBLIGATORIA DE CITAS: Cada vez que afirmes un hecho, dato, cifra o concepto obtenido del contexto, coloca la etiqueta de cita correspondiente al final de la frase entre corchetes, por ejemplo [1] o [2]. Utiliza únicamente los números de cita provistos en los encabezados del contexto [Fuente Cita [1]...].

Contexto de la Información:
{context}
"""
        else:
            system_prompt = f"""Eres un asistente experto de inteligencia artificial conversacional. [Fecha/Hora Sistema: {now_str}]
Responde a las preguntas del usuario utilizando tu conocimiento general preentrenado y el historial de la conversación. Sé atento, fluido, preciso y mantén coherencia conversacional."""

        messages = [{"role": "system", "content": system_prompt}]
        
        # Sliding Window chat history: keep up to 40 messages (20 turns) to preserve conversation memory safely in 32k window
        if history:
            limited_history = history[-40:]
            for msg in limited_history:
                messages.append({"role": msg["role"], "content": msg["content"]})
                
        messages.append({"role": "user", "content": query})
        
        payload = {
            "model": settings.llm_model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.5,
                "num_ctx": settings.ollama_context_length
            }
        }
        from gpu_lock import gpu_lock
        with gpu_lock.acquire("Ollama Chat"):
            try:
                response = requests.post(f"{settings.ollama_url}/api/chat", json=payload, timeout=90)
                if response.status_code == 200:
                    return response.json().get("message", {}).get("content", "Error al procesar la consulta.")
            except Exception as e:
                return f"Error al consultar al modelo de lenguaje: {str(e)}"
            return "No se pudo obtener respuesta."

rag_service = RAGService()
