'use client';

import { useEffect, useState } from 'react';

import type { AdminNote } from '@/types';

export function AdminPanel() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/notes', { cache: 'no-store' });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const body = await res.json();
      setNotes(body.notes ?? []);
      setAuthed(true);
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
        <button type="button" onClick={logout}>
          log out
        </button>
      </div>

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
