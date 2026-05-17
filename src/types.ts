export type Section =
  | 'venting'
  | 'ideas'
  | 'memory'
  | 'things unsaid'
  | 'confessions';

export interface Note {
  id: string;
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
