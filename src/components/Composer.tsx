'use client';

import { useEffect, useRef, useState } from 'react';

import { SECTIONS, SECTION_COLORS } from '@/lib/sections';
import type { Note, Section } from '@/types';

interface Props {
  defaultSection?: Section | null;
  onPosted: (note: Note) => void;
}

const SESSION_KEY = 'wall_posted_at';
const SOFT_LIMIT_MS = 60 * 60 * 1000; // 1 hour
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
const TURNSTILE_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileAPI {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      theme?: 'light' | 'dark' | 'auto';
      appearance?: 'always' | 'execute' | 'interaction-only';
    },
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

export function Composer({ defaultSection, onPosted }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [section, setSection] = useState<Section>(defaultSection ?? 'venting');
  const [color, setColor] = useState<string>(SECTION_COLORS[section][0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);
  // Honeypot: bots filling every input land here; humans never see it.
  const [hp, setHp] = useState('');
  // Time the composer opened — server rejects submits faster than 2s.
  const openedAtRef = useRef<number>(0);
  // Cloudflare Turnstile state.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileSlotRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (defaultSection) {
      setSection(defaultSection);
      setColor(SECTION_COLORS[defaultSection][0]);
    }
  }, [defaultSection]);

  useEffect(() => {
    if (!open) return;
    openedAtRef.current = Date.now();
    setHp('');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Turnstile widget lifecycle. Only runs when the composer is open AND a
  // site key is configured — without a key we skip entirely and the server
  // also fails open, so dev without env vars still works.
  useEffect(() => {
    if (!open || !TURNSTILE_SITE_KEY) return;

    // Load the script once per page.
    if (!document.getElementById(TURNSTILE_SCRIPT_ID)) {
      const s = document.createElement('script');
      s.id = TURNSTILE_SCRIPT_ID;
      s.src = TURNSTILE_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }

    let cancelled = false;
    let attempts = 0;
    const tryRender = () => {
      if (cancelled) return;
      const api = window.turnstile;
      if (!api || !turnstileSlotRef.current) {
        if (attempts++ > 60) return; // ~6s
        setTimeout(tryRender, 100);
        return;
      }
      if (turnstileWidgetIdRef.current) return;
      turnstileWidgetIdRef.current = api.render(turnstileSlotRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(null),
        'error-callback': () => setTurnstileToken(null),
        theme: 'light',
        // Stay out of the way unless CF decides a challenge is needed.
        appearance: 'interaction-only',
      });
    };
    tryRender();

    return () => {
      cancelled = true;
      const api = window.turnstile;
      const id = turnstileWidgetIdRef.current;
      if (api && id) {
        try {
          api.remove(id);
        } catch {
          // Widget already removed; ignore.
        }
      }
      turnstileWidgetIdRef.current = null;
      setTurnstileToken(null);
    };
  }, [open]);

  function handleSectionChange(next: Section) {
    setSection(next);
    setColor(SECTION_COLORS[next][0]);
  }

  function softLimitWarning(): string | null {
    if (typeof window === 'undefined') return null;
    const last = Number(window.localStorage.getItem(SESSION_KEY));
    if (!last) return null;
    const elapsed = Date.now() - last;
    if (elapsed < SOFT_LIMIT_MS) {
      const mins = Math.ceil((SOFT_LIMIT_MS - elapsed) / 60000);
      return `you already left a note this hour — come back in ~${mins} min`;
    }
    return null;
  }

  async function submit() {
    setError(null);
    setConfirm(null);
    setCrisis(false);

    const trimmed = text.trim();
    if (trimmed.length < 20) {
      setError("that's a bit short for the wall — say a little more.");
      return;
    }
    if (trimmed.length > 280) {
      setError('too long — keep it under 280 characters');
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError('still verifying — give it a second and try again');
      return;
    }

    setSubmitting(true);
    try {
      const elapsedMs = Date.now() - openedAtRef.current;
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          section,
          color,
          _h: hp,
          _t: elapsedMs,
          turnstileToken,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? 'something went wrong');
        return;
      }
      onPosted(body.note as Note);
      window.localStorage.setItem(SESSION_KEY, String(Date.now()));
      // Show the crisis nudge first if present, then drift back to the wall.
      const showCrisis = Boolean(body.crisisDetected);
      setConfirm('your note is on the wall');
      setCrisis(showCrisis);
      setText('');
      setTimeout(() => {
        setOpen(false);
        setConfirm(null);
        setCrisis(false);
      }, showCrisis ? 6000 : 1800);
    } catch {
      setError('network hiccup — try again');
    } finally {
      setSubmitting(false);
    }
  }

  const soft = open ? softLimitWarning() : null;

  return (
    <>
      <button
        type="button"
        className="composer-trigger"
        onClick={() => setOpen(true)}
      >
        leave a note
      </button>

      {open && (
        <div
          className="composer-backdrop"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="composer"
            style={{ background: color }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="composer__tape" aria-hidden />

            <div className="composer__sections">
              {SECTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`composer__section${section === s ? ' is-active' : ''}`}
                  onClick={() => handleSectionChange(s)}
                >
                  {s}
                </button>
              ))}
            </div>

            <textarea
              className="composer__text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 280))}
              onPaste={(e) => {
                e.preventDefault();
                setError('paste is off — type it yourself.');
                setTimeout(() => setError(null), 2000);
              }}
              onDrop={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="write something..."
              autoFocus
              maxLength={280}
              rows={5}
            />

            {/* Honeypot — hidden from humans, irresistible to dumb bots. */}
            <label
              className="composer__hp"
              aria-hidden="true"
              tabIndex={-1}
            >
              website
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={hp}
                onChange={(e) => setHp(e.target.value)}
              />
            </label>

            <div className="composer__row">
              <div className="composer__colors">
                {SECTION_COLORS[section].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`composer__swatch${color === c ? ' is-active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={`color ${c}`}
                  />
                ))}
              </div>
              <div className="composer__count">{text.length}/280</div>
            </div>

            {TURNSTILE_SITE_KEY && (
              <div ref={turnstileSlotRef} className="composer__captcha" />
            )}

            {soft && <p className="composer__hint">{soft}</p>}
            {error && <p className="composer__error">{error}</p>}
            {confirm && <p className="composer__confirm">{confirm}</p>}
            {crisis && (
              <p className="composer__crisis">
                if you’re carrying something heavy, you don’t have to carry it alone.
                <br />
                <span className="composer__crisis-line">
                  Crisis Text Line: text HOME to 741741 (US) · Samaritans: 116 123 (UK)
                </span>
              </p>
            )}

            <div className="composer__actions">
              <button
                type="button"
                className="composer__cancel"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                close
              </button>
              <button
                type="button"
                className="composer__submit"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? 'pinning…' : 'pin it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
