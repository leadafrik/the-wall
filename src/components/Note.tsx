'use client';

import { memo } from 'react';

import type { Note as NoteData } from '@/types';

interface Props {
  note: NoteData;
  faded?: boolean;
  appear?: boolean;
  onClick?: (note: NoteData) => void;
}

function NoteImpl({ note, faded, appear, onClick }: Props) {
  return (
    <div
      className={`note${faded ? ' note--faded' : ''}${appear ? ' note--appear' : ''}`}
      style={{
        left: note.x,
        top: note.y,
        zIndex: note.z_index,
        background: note.color,
        transform: `rotate(${note.rotation}deg)`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(note);
      }}
    >
      <div className="note__tape" aria-hidden />
      <div className="note__section">· {note.section}</div>
      <div className="note__text">{note.text}</div>
    </div>
  );
}

export const Note = memo(NoteImpl);
