export type Section =
  | 'venting'
  | 'ideas'
  | 'memory'
  | 'things unsaid'
  | 'confessions';

export interface Note {
  id: string;
  // Human-readable URL segment ("first-words-of-the-note-1a2b3c4d").
  // Null only for rows created before the slug migration ran.
  slug: string | null;
  text: string;
  section: Section;
  color: string;
  x: number;
  y: number;
  rotation: number;
  z_index: number;
  created_at: string;
  is_visible: boolean;
}

export interface AdminNote extends Note {
  ip_hash: string | null;
  flagged: boolean;
}
