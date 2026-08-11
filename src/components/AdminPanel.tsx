'use client';

import { useEffect, useState } from 'react';

import type { AdminNote } from '@/types';

interface Stats {
  notes_visible: number;
  notes_last_24h: number;
  visitors_24h: number | null;
  visitors_7d: number | null;
}

export function AdminPanel() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [repositioning, setRepositioning] = useState(false);
  const [repoMsg, setRepoMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [notesRes, statsRes] = await Promise.all([
        fetch('/api/admin/notes', { cache: 'no-store' }),
        fetch('/api/admin/stats', { cache: 'no-store' }),
      ]);
      if (notesRes.status === 401) {
        setAuthed(false);
        return;
      }
      const notesBody = await notesRes.json();
      setNotes(notesBody.notes ?? []);
      setAuthed(true);
      if (statsRes.ok) {
        setStats((await statsRes.json()) as Stats);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? 'wrong password');
      return;
    }
    setPassword('');
    await load();
  }

  async function logout() {
    await fetch('/api/admin/login', { method: 'DELETE' });
    setAuthed(false);
    setNotes([]);
  }

  // Re-space every visible note so none overlap — the one-click equivalent of
  // scripts/reposition.mjs. Needed once after the note box grew; safe to run
  // again anytime (idempotent, just re-tidies).
  async function reposition() {
    if (repositioning) return;
    if (
      !window.confirm(
        're-tidy the whole wall?\n\nthis re-spaces every note so no two overlap. it rewrites their positions and cannot be undone.',
      )
    ) {
      return;
    }
    setRepositioning(true);
    setRepoMsg(null);
    try {
      const res = await fetch('/api/admin/reposition', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRepoMsg(body?.error ?? 'reposition failed');
        return;
      }
      setRepoMsg(
        `re-tidied ${body.repositioned}/${body.total} notes` +
          (body.failed ? ` — ${body.failed} failed, try again` : ' ✓'),
      );
      await load();
    } finally {
      setRepositioning(false);
    }
  }

  async function toggleVisibility(id: string, next: boolean) {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, is_visible: next } : n)));
    await fetch('/api/admin/notes', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, is_visible: next }),
    });
  }

  async function toggleFlag(id: string, next: boolean) {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, flagged: next } : n)));
    await fetch('/api/admin/notes', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, flagged: next }),
    });
  }

  if (!authed) {
    return (
      <form className="admin-login" onSubmit={login}>
        <h1>admin</h1>
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <button type="submit">unlock</button>
        {error && <p className="admin-login__error">{error}</p>}
      </form>
    );
  }

  return (
    <div className="admin">
      <div className="admin__bar">
        <h1>admin · {notes.length} notes</h1>
        <button type="button" onClick={load} disabled={loading}>
          {loading ? 'loading…' : 'refresh'}
        </button>
        <button
          type="button"
          onClick={reposition}
          disabled={repositioning}
          title="re-space every note so none overlap"
        >
          {repositioning ? 're-tidying…' : 're-tidy layout'}
        </button>
        <button type="button" onClick={logout}>
          log out
        </button>
      </div>

      {repoMsg && <p className="admin__repo-msg">{repoMsg}</p>}

      {stats && (
        <dl
          className="admin__stats"
          title="distinct hashed IPs from rate-limit data — overcounts when the same person uses multiple networks, undercounts the reverse"
        >
          <div className="admin__stat">
            <dt>notes</dt>
            <dd>{stats.notes_visible.toLocaleString()}</dd>
          </div>
          <div className="admin__stat">
            <dt>posted · 24h</dt>
            <dd>{stats.notes_last_24h.toLocaleString()}</dd>
          </div>
          <div className="admin__stat">
            <dt>visitors · 24h</dt>
            <dd>
              {stats.visitors_24h === null
                ? '—'
                : stats.visitors_24h.toLocaleString()}
            </dd>
          </div>
          <div className="admin__stat">
            <dt>visitors · 7d</dt>
            <dd>
              {stats.visitors_7d === null
                ? '—'
                : stats.visitors_7d.toLocaleString()}
            </dd>
          </div>
        </dl>
      )}

      <ul className="admin__list">
        {notes.map((n) => (
          <li
            key={n.id}
            className={`admin__row${n.is_visible ? '' : ' admin__row--hidden'}`}
          >
            <div className="admin__row-meta">
              <span className="admin__section">{n.section}</span>
              <span className="admin__time">{new Date(n.created_at).toLocaleString()}</span>
              <span className="admin__ip">ip {n.ip_hash ?? '—'}</span>
              {n.flagged && <span className="admin__flagged">flagged</span>}
            </div>
            <div className="admin__row-text">{n.text}</div>
            <div className="admin__row-actions">
              <button
                type="button"
                onClick={() => toggleVisibility(n.id, !n.is_visible)}
              >
                {n.is_visible ? 'hide' : 'restore'}
              </button>
              <button type="button" onClick={() => toggleFlag(n.id, !n.flagged)}>
                {n.flagged ? 'unflag' : 'flag'}
              </button>
              <a href={`/note/${n.id}`} target="_blank" rel="noreferrer">
                view
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
