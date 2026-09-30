import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, Pause, Trash2, Send, Volume2, AlertCircle } from 'lucide-react';

interface VoiceRecorderProps {
  onRecordingComplete: (audioUrl: string, duration: number) => void;
  onCancel?: () => void;
  compact?: boolean;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onRecordingComplete,
  onCancel,
  compact = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          setAudioUrl(base64Audio);
        };

        // Stop all tracks on the stream to release mic
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone error:', err);
      setError('Microphone access denied or unavailable.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const cancelRecording = () => {
    if (isRecording) {
      stopRecording();
    }
    setAudioUrl(null);
    setRecordingTime(0);
    if (onCancel) onCancel();
  };

  const handleSend = () => {
    if (audioUrl) {
      onRecordingComplete(audioUrl, recordingTime);
      setAudioUrl(null);
      setRecordingTime(0);
    }
  };

  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600 bg-red-50 p-2 rounded-lg text-xs">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{error}</span>
        <button onClick={() => setError(null)} className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Dismiss</button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${compact ? 'p-1.5' : 'p-3 bg-[var(--bg-surface-inset)]/60 border border-amber-200/80 rounded-xl'}`}>
      {!audioUrl && !isRecording && (
        <button
          type="button"
          onClick={startRecording}
          className="flex items-center gap-2 px-3 py-2 bg-amber-800 hover:bg-amber-900 text-amber-50 rounded-lg font-medium text-xs shadow-sm transition-all"
        >
          <Mic className="w-4 h-4 text-amber-200 animate-pulse" />
          <span>Record Voice Note</span>
        </button>
      )}

      {isRecording && (
        <div className="flex items-center gap-3 w-full animate-fade-in">
          <div className="flex items-center gap-2 bg-red-100 text-red-700 px-3 py-1.5 rounded-full text-xs font-semibold animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
            <span>Recording {formatTime(recordingTime)}</span>
          </div>
          <div className="flex-1 h-1.5 bg-amber-200 rounded-full overflow-hidden">
            <div className="h-full bg-amber-700 animate-pulse w-2/3" />
          </div>
          <button
            type="button"
            onClick={stopRecording}
            className="p-2 bg-red-600 text-white hover:bg-red-700 rounded-full transition-colors shadow-sm"
            title="Stop Recording"
          >
            <Square className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={cancelRecording}
            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-amber-100 rounded-full"
            title="Cancel"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {audioUrl && !isRecording && (
        <div className="flex items-center gap-3 w-full bg-[var(--bg-surface)] p-2 rounded-lg border border-amber-200/80 shadow-xs">
          <audio
            ref={audioRef}
            src={audioUrl}
            onEnded={() => setIsPlaying(false)}
            onTimeUpdate={() => {
              if (audioRef.current) setPlaybackTime(Math.floor(audioRef.current.currentTime));
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={togglePlayback}
            className="p-2 bg-amber-800 text-amber-50 rounded-full hover:bg-amber-900 shadow-xs"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 pl-0.5" />}
          </button>

          <div className="flex-1 flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-2xs text-[var(--text-muted)] font-medium">
              <span className="flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-amber-700" />
                Voice Message
              </span>
              <span>{formatTime(isPlaying ? playbackTime : recordingTime)}</span>
            </div>
            <div className="w-full bg-amber-100 h-1 rounded-full overflow-hidden">
              <div
                className="bg-amber-700 h-full transition-all duration-200"
                style={{
                  width: `${recordingTime > 0 ? (playbackTime / recordingTime) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={cancelRecording}
            className="p-1.5 text-[var(--text-muted)] hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
            title="Discard Voice Note"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleSend}
            className="px-3 py-1.5 bg-emerald-700 text-emerald-50 rounded-lg font-medium text-xs flex items-center gap-1.5 hover:bg-emerald-800 shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Attach</span>
          </button>
        </div>
      )}
    </div>
  );
};
