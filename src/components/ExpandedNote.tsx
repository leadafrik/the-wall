'use client';

import { useEffect, useState } from 'react';

import type { Note } from '@/types';

interface Props {
  note: Note;
  onClose: () => void;
}

export function ExpandedNote({ note, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // One tap to send this note somewhere. On phones that opens the native share
  // sheet; everywhere else it copies the link. The share preview is the note's
  // own OG card (see note/[id]/opengraph-image.tsx), so what lands is the note,
  // not a bare URL.
  async function share() {
    const url = `${window.location.origin}/note/${note.id}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'the wall', text: note.text, url });
        return;
      } catch (err) {
        // User dismissed the share sheet — don't fall through to copying.
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (rare) — nothing else to do gracefully.
    }
  }

  return (
    <div className="expanded-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="expanded"
        style={{ background: note.color, transform: `rotate(${note.rotation}deg)` }}
        onClick={(e) => e.stopPropagation()}
        onCopy={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <div className="expanded__tape" aria-hidden />
        <div className="expanded__section">· {note.section}</div>
        <div className="expanded__text">{note.text}</div>
        <div className="expanded__meta">
          <span>{relativeTime(note.created_at)}</span>
          <span className="expanded__actions">
            <button type="button" className="expanded__share" onClick={share}>
              {copied ? 'link copied ✓' : 'share'}
            </button>
            <a className="expanded__permalink" href={`/note/${note.id}`}>
              permalink
            </a>
          </span>
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
