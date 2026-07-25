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
      <div className="card glass-card" style={{ textAlign: 'center', padding: '2rem', marginTop: '1rem' }}>
        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'hsl(var(--primary))' }}></i>
        <p>Cargando grabador interactivo...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="card glass-card transcription-viewer-card" id="transcription-viewer-card" style={{ marginTop: '1.5rem' }}>
      <div className="viewer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
        <h3 id="transcribed-filename" style={{ margin: 0, fontSize: '1rem', wordBreak: 'break-all' }}>
          {data.filename}
        </h3>
        <div className="viewer-controls" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="control-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor="speed-rate" style={{ fontSize: '0.8125rem' }}>Velocidad:</label>
            <select 
              id="speed-rate" 
              className="small-control" 
              value={playbackRate} 
              onChange={handleRateChange}
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '0.25rem', color: '#fff', fontSize: '0.8125rem', padding: '0.25rem' }}
            >
              <option value="0.75">0.75x</option>
              <option value="1">1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2.0x</option>
            </select>
          </div>
          
          <label className="checkbox-container small-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={autoscroll} 
              onChange={(e) => setAutoscroll(e.target.checked)} 
            />
            <span className="checkmark"></span>
            <span>Auto-scroll</span>
          </label>

          <button
            type="button"
            className="btn"
            onClick={handleDelete}
            style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: 'white', padding: '0.25rem 0.75rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <i className="fa-solid fa-trash"></i> Eliminar
          </button>
        </div>
      </div>
      
      {data.filepath && (
        <div className="audio-player-container" style={{ margin: '1rem 0' }}>
          <audio 
            ref={audioRef} 
            controls 
            onTimeUpdate={handleTimeUpdate}
            src={`/api/media?path=${encodeURIComponent(data.filepath)}`} 
            style={{ width: '100%' }}
          />
        </div>
      )}
      
      <div 
        className="text-cascade-container" 
        ref={cascadeRef} 
        id="text-cascade-container"
        style={{ maxHeight: '300px', overflowY: 'auto', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem', border: '1px solid var(--border-glass)' }}
      >
        {data.segments?.map((seg, segIdx) => {
          let speakerText = "Locutor";
          let speakerClass = "spk-other";
          if (seg.speaker) {
            speakerText = seg.speaker;
            const spkNum = parseInt(seg.speaker.replace(/\D/g, '')) || 0;
            speakerClass = `spk-${(spkNum % 5) + 1}`;
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
            <div key={segIdx} className="transcript-segment" style={{ marginBottom: '1.25rem' }}>
              <div className="segment-meta" style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.375rem', fontSize: '0.75rem' }}>
                <span className={`speaker-tag ${speakerClass}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.125rem 0.5rem', borderRadius: '1rem', fontWeight: 600 }}>
                  <i className="fa-solid fa-user"></i> {speakerText}
                </span>
                <span className="timestamp-tag" style={{ color: 'hsl(var(--text-muted))' }}>
                  {formatTime(seg.start)} - {formatTime(seg.end)}
                </span>
              </div>
              <p className="transcription-paragraph" style={{ margin: 0 }}>
                {words.map((w, wIdx) => (
                  <span
                    key={wIdx}
                    className="word-span"
                    data-start={w.start}
                    data-end={w.end}
                    onClick={() => handleWordClick(w.start)}
                    style={{ cursor: 'pointer', margin: '0 0.125rem', transition: 'background-color 0.2s ease, color 0.2s ease' }}
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
