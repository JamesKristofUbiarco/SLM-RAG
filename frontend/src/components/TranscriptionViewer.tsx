import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import { Transcription } from '../types';

interface TranscriptionViewerProps {
  transcriptionId: number | null;
  onDeleted?: (id: number) => void;
}

export default function TranscriptionViewer({ transcriptionId, onDeleted }: TranscriptionViewerProps) {
  const [data, setData] = useState<Transcription | null>(null);
  const [autoscroll, setAutoscroll] = useState<boolean>(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const cascadeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptionId) {
      loadTranscription(transcriptionId);
    } else {
      setData(null);
    }
  }, [transcriptionId]);

  const loadTranscription = async (id: number) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/transcriptions/${id}`);
      if (!res.ok) throw new Error('No se pudo cargar la transcripción.');
      const json = await res.json();
      setData(json);
      
      // Load audio
      if (audioRef.current) {
        audioRef.current.playbackRate = playbackRate;
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !cascadeRef.current) return;
    const time = audio.currentTime;

    const wordSpans = cascadeRef.current.querySelectorAll('.word-span');
    let activeSpan: HTMLSpanElement | null = null;

    wordSpans.forEach((node) => {
      const span = node as HTMLSpanElement;
      const startAttr = span.getAttribute('data-start');
      const endAttr = span.getAttribute('data-end');
      if (!startAttr || !endAttr) return;

      const start = parseFloat(startAttr);
      const end = parseFloat(endAttr);

      if (time >= start && time <= end) {
        span.classList.add('highlight');
        activeSpan = span;
      } else {
        span.classList.remove('highlight');
      }
    });

    if (activeSpan && autoscroll) {
      const cascadeContainer = cascadeRef.current;
      const scrollOffset = activeSpan.getBoundingClientRect().top - cascadeContainer.getBoundingClientRect().top + cascadeContainer.scrollTop - 80;
      cascadeContainer.scrollTo({
        top: scrollOffset,
        behavior: 'smooth'
      });
    }
  };

  const handleRateChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const rate = parseFloat(e.target.value);
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const formatTime = (seconds?: number) => {
    if (seconds === undefined) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleWordClick = (start: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = start;
      audioRef.current.play();
    }
  };

  const handleDelete = async () => {
    if (!data) return;
    const confirmDelete = confirm(`¿Estás seguro de que deseas eliminar permanentemente la grabación "${data.filename}" y todo su historial de RAG y chat?`);
    if (!confirmDelete) return;

    try {
      const res = await fetch(`/api/transcriptions/${data.id}/delete`, {
        method: 'POST'
      });
      if (res.ok) {
        setData(null);
        if (onDeleted) onDeleted(data.id);
      } else {
        alert('Error al borrar la transcripción.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al borrar la transcripción.');
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center rounded-xl bg-[#17171c]/75 border border-white/10 mt-4">
        <i className="fa-solid fa-spinner fa-spin text-2xl text-amber-500 mb-2"></i>
        <p className="text-sm text-zinc-400">Cargando grabador interactivo...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full min-w-0 mt-4" id="transcription-viewer-card">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-white/10">
        <h3 id="transcribed-filename" className="text-base font-semibold text-white break-all">
          {data.filename}
        </h3>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span>Velocidad:</span>
            <select 
              id="speed-rate" 
              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500" 
              value={playbackRate} 
              onChange={handleRateChange}
            >
              <option value="0.75">0.75x</option>
              <option value="1">1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2.0x</option>
            </select>
          </div>
          
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
            <input 
              type="checkbox" 
              className="w-4 h-4 accent-amber-500 rounded border-white/10 bg-white/5 cursor-pointer"
              checked={autoscroll} 
              onChange={(e) => setAutoscroll(e.target.checked)} 
            />
            <span>Auto-scroll</span>
          </label>

          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors flex items-center gap-1.5 cursor-pointer"
            onClick={handleDelete}
          >
            <i className="fa-solid fa-trash"></i> Eliminar
          </button>
        </div>
      </div>
      
      {data.filepath && (
        <div className="my-2">
          <audio 
            ref={audioRef} 
            controls 
            onTimeUpdate={handleTimeUpdate}
            src={`/api/media?path=${encodeURIComponent(data.filepath)}`} 
            className="w-full h-10 rounded-lg outline-none"
          />
        </div>
      )}
      
      <div 
        className="max-h-80 overflow-y-auto p-4 bg-black/30 rounded-xl border border-white/10 flex flex-col gap-4" 
        ref={cascadeRef} 
        id="text-cascade-container"
      >
        {data.segments?.map((seg, segIdx) => {
          let speakerText = "Locutor";
          let speakerColor = "bg-indigo-500/20 text-indigo-300 border-indigo-500/30";
          if (seg.speaker) {
            speakerText = seg.speaker;
            const spkNum = parseInt(seg.speaker.replace(/\D/g, '')) || 0;
            const colors = [
              "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
              "bg-purple-500/20 text-purple-300 border-purple-500/30",
              "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
              "bg-amber-500/20 text-amber-300 border-amber-500/30",
              "bg-rose-500/20 text-rose-300 border-rose-500/30"
            ];
            speakerColor = colors[spkNum % colors.length];
          }

          // Build words list
          let words: { word: string; start: number; end: number }[] = [];
          if (seg.words && seg.words.length > 0) {
            words = seg.words;
          } else {
            // fallback interpolation
            const segWords = seg.text.split(' ');
            const duration = seg.end - seg.start;
            const wordDuration = duration / Math.max(1, segWords.length);
            words = segWords.map((word, idx) => {
              const start = seg.start + (idx * wordDuration);
              return {
                word: word + ' ',
                start: start,
                end: start + wordDuration
              };
            });
          }

          return (
            <div key={segIdx} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold flex items-center gap-1 ${speakerColor}`}>
                  <i className="fa-solid fa-user"></i> {speakerText}
                </span>
                <span className="text-zinc-500 font-mono text-[11px]">
                  {formatTime(seg.start)} - {formatTime(seg.end)}
                </span>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">
                {words.map((w, wIdx) => (
                  <span
                    key={wIdx}
                    className="word-span hover:text-white hover:bg-white/10 rounded px-0.5 cursor-pointer transition-colors duration-150 inline-block"
                    data-start={w.start}
                    data-end={w.end}
                    onClick={() => handleWordClick(w.start)}
                  >
                    {w.word}{' '}
                  </span>
                ))}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
