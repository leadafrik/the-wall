'use client';

import { useEffect } from 'react';

import type { Note } from '@/types';

interface Props {
  note: Note;
  onClose: () => void;
}

export function ExpandedNote({ note, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="expanded-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="expanded"
        style={{ background: note.color, transform: `rotate(${note.rotation}deg)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="expanded__tape" aria-hidden />
        <div className="expanded__section">· {note.section}</div>
        <div className="expanded__text">{note.text}</div>
        <div className="expanded__meta">
          <span>{relativeTime(note.created_at)}</span>
          <a className="expanded__permalink" href={`/note/${note.id}`}>
            permalink
          </a>
        </div>
        <button type="button" className="expanded__close" onClick={onClose}>
          close
        </button>
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
