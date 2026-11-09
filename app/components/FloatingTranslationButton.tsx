'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../utils/i18n';
import { IconTranslate } from './glass/icons';
import { DEFAULT_FLOATING_STATE, LONG_PRESS_MS, MOVE_TOLERANCE, TRANSLATION_GUIDE_KEY, canDockTranslation, clampPoint, dockTranslation, floatTranslation, getFloatingTranslation, hydrateFloatingTranslation, positionFromRatio, positionToRatio, subscribeFloatingTranslation, translationApproach, translationGuidePosition, translationGuideSeen, translationHomeDistance, updateFloatingTranslation, type Bounds, type GuidePlacement, type Orientation, type Point } from '../utils/floatingTranslation';
import './FloatingTranslationButton.css';

const subscribeMount = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;
const GUIDE_SIZE = { width: 260, height: 92 };
const GUIDE_VISIBLE_MS = 9000;
const INITIAL_GUIDE_PLACEMENT: GuidePlacement = { x: -9999, y: -9999, side: 'above', arrowX: 130 };
let guideShownThisSession = false;

export function useFloatingTranslation() {
  const state = useSyncExternalStore(subscribeFloatingTranslation, getFloatingTranslation, () => DEFAULT_FLOATING_STATE);
  useEffect(() => { hydrateFloatingTranslation(); }, []);
  return { ...state, float: floatTranslation, dock: dockTranslation };
}

/** Read once on the first reader visit; showing the hint counts as seeing it. */
function useTranslationGuide(enabled: boolean) {
  const [visible, setVisible] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const complete = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
    setVisible(false);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    if (guideShownThisSession) return;
    try { if (translationGuideSeen(window.localStorage.getItem(TRANSLATION_GUIDE_KEY))) return; } catch { /* Fall through to the session flag. */ }
    // Wait for the toolbar to settle before measuring the button.
    const show = setTimeout(() => {
      guideShownThisSession = true;
      try { window.localStorage.setItem(TRANSLATION_GUIDE_KEY, 'seen'); } catch { /* The session flag still prevents repeats. */ }
      setVisible(true);
      dismissTimer.current = setTimeout(() => { dismissTimer.current = null; setVisible(false); }, GUIDE_VISIBLE_MS);
    }, 700);
    return () => {
      clearTimeout(show);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    };
  }, [enabled]);
  return { visible, complete };
}

function TranslationGuide({ placement, t, onDismiss, guideRef }: { placement: GuidePlacement; t: Translations; onDismiss: () => void; guideRef: React.RefObject<HTMLDivElement | null> }) {
  return <div
    ref={guideRef}
    role="group"
    aria-label={t.readerTranslationGuide}
    data-testid="reader-translation-guide"
    data-side={placement.side}
    className="ft-guide"
    style={{ left: placement.x, top: placement.y, visibility: 'hidden', ['--ft-arrow-x' as string]: `${placement.arrowX}px` }}
    onPointerDown={event => event.stopPropagation()}
  >
    <p>{t.readerTranslationGuide}</p>
    <button type="button" aria-label={t.readerTranslationGuideDismiss} onClick={onDismiss}>{t.readerTranslationGuideDismiss}</button>
  </div>;
}

export interface FloatingTranslationButtonProps {
  enabled: boolean;
  onToggle: () => void;
  locale?: string;
  t: Translations;
  /** Reader HUD visibility; the hint waits for the capsule to be on screen. */
  hudVisible?: boolean;
  hidden?: boolean;
  onFloatingChange?: (floating: boolean) => void;
  onDragActiveChange?: (active: boolean) => void;
}
export interface FloatingTranslationButtonHandle { float: () => void; dock: () => void }
type Geometry = { bounds: Bounds; orientation: Orientation };
type Gesture = { id: number; start: Point; origin: Point; active: boolean; moved: boolean; armed: boolean; floating: boolean };
type Flight = { start: number; duration: number; from: Point; progress: number; toDock: boolean };

/** One portal button owns pointer capture before, during and after detachment. */
export const FloatingTranslationButton = forwardRef<FloatingTranslationButtonHandle, FloatingTranslationButtonProps>(function FloatingTranslationButton(
  { enabled, onToggle, locale = 'zh-CN', t, hudVisible = true, hidden = false, onFloatingChange, onDragActiveChange }, ref,
) {
  const state = useFloatingTranslation();
  const mounted = useSyncExternalStore(subscribeMount, clientMounted, serverMounted);
  const guideEnabled = mounted && !hidden && hudVisible;
  const guide = useTranslationGuide(guideEnabled);
  const guideRef = useRef<HTMLDivElement>(null);
  const [lifted, setLifted] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const slot = useRef<HTMLSpanElement>(null);
  const safe = useRef<HTMLDivElement>(null);
  const geometry = useRef<Geometry | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flight = useRef<Flight | null>(null);
  const current = useRef<Point>({ x: 0, y: 0 });
  const progress = useRef(1);
  const liftStart = useRef(0);
  const consumedKey = useRef<string | null>(null);
  const keyboardMoving = useRef(false);
  const suppressClick = useRef(false);
  const committed = useRef(state.floating);
  const latest = useRef({ state, hidden, onDragActiveChange });
  useEffect(() => { latest.current = { state, hidden, onDragActiveChange }; });
  const latestGuide = useRef({ complete: guide.complete });
  useEffect(() => { latest.current = { state, hidden, onDragActiveChange }; latestGuide.current = { complete: guide.complete }; });
  useImperativeHandle(ref, () => ({ float: state.float, dock: state.dock }), [state.float, state.dock]);
  useEffect(() => { onFloatingChange?.(state.floating); }, [state.floating, onFloatingChange]);
  const en = locale.startsWith('en');
  const home = useCallback((): Point => {
    // The trailing Aa button never moves horizontally as the slot closes.
    const aa = slot.current?.closest('.reader-tools-right')?.querySelector('button:last-child')?.getBoundingClientRect();
    return aa ? { x: aa.left - 20, y: aa.top + aa.height / 2 } : { x: 22, y: 22 };
  }, []);
  const saved = useCallback(() => {
    const g = geometry.current;
    return g ? positionFromRatio(getFloatingTranslation().positions[g.orientation] ?? { x: .85, y: .65 }, g.bounds) : current.current;
  }, []);
  const clearTimer = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const release = useCallback(() => {
    clearTimer();
    const g = gesture.current;
    gesture.current = null;
    if (g && button.current?.hasPointerCapture(g.id)) button.current.releasePointerCapture(g.id);
    latest.current.onDragActiveChange?.(false);
  }, [clearTimer]);
  useEffect(() => {
    if (!guide.visible || !guideEnabled) return;
    let frame = 0;
    // The capsule can hide while scrolling; follow the button so the hint never floats alone.
    const tick = () => {
      const el = button.current, hint = guideRef.current, g = geometry.current;
      if (el && hint && g) {
        const rect = el.getBoundingClientRect();
        const available = el.style.visibility !== 'hidden' && !latest.current.hidden && !latest.current.state.floating;
        if (available) {
          const size = { width: Math.min(GUIDE_SIZE.width, window.innerWidth - 32), height: hint.offsetHeight || GUIDE_SIZE.height };
          const p = translationGuidePosition({ x: rect.left, y: rect.top }, g.bounds, size);
          hint.style.left = `${p.x}px`; hint.style.top = `${p.y}px`;
          hint.dataset.side = p.side;
          hint.style.setProperty('--ft-arrow-x', `${p.arrowX}px`);
        }
        hint.style.visibility = available ? 'visible' : 'hidden';
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [guide.visible, guideEnabled]);
  const cancel = useCallback(() => {
    release(); flight.current = null; keyboardMoving.current = false;
    committed.current = getFloatingTranslation().floating;
    progress.current = committed.current ? 0 : 1;
    current.current = committed.current ? saved() : { x: home().x - 22, y: home().y - 22 };
    setLifted(committed.current);
  }, [home, release, saved]);
  const save = (p: Point) => {
    const g = geometry.current;
    if (!g) return;
    committed.current = true;
    updateFloatingTranslation({ floating: true, positions: { ...getFloatingTranslation().positions, [g.orientation]: positionToRatio(p, g.bounds) } });
  };
  const startFlight = useCallback((toDock: boolean) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    flight.current = { start: performance.now(), duration: reduced ? 200 : toDock ? 360 : 300, from: { ...current.current }, progress: progress.current, toDock };
    setLifted(true);
    latest.current.onDragActiveChange?.(true);
  }, []);
  useEffect(() => {
    if (state.floating === committed.current) return;
    committed.current = state.floating;
    startFlight(!state.floating);
  }, [state.floating, startFlight]);
  useEffect(() => {
    if (hidden) cancel();
  }, [hidden, cancel]);
  useEffect(() => {
    const measure = () => {
      cancel();
      const css = safe.current ? getComputedStyle(safe.current) : null;
      const inset = (key: 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom') => parseFloat(css?.[key] || '0') || 0;
      const v = window.visualViewport;
      const left = (v?.offsetLeft ?? 0) + inset('paddingLeft') + 12;
      const top = (v?.offsetTop ?? 0) + inset('paddingTop') + 12;
      geometry.current = { bounds: { left, top, right: Math.max(left, (v?.offsetLeft ?? 0) + (v?.width ?? window.innerWidth) - inset('paddingRight') - 56), bottom: Math.max(top, (v?.offsetTop ?? 0) + (v?.height ?? window.innerHeight) - inset('paddingBottom') - 56) }, orientation: window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait' };
      if (getFloatingTranslation().floating) current.current = saved();
    };
    measure();
    let frame = 0;
    const tick = (now: number) => {
      const el = button.current, s = slot.current;
      if (el && s) {
        const f = flight.current;
        if (gesture.current?.active && !gesture.current.armed) {
          const t = Math.min(1, (now - liftStart.current) / 300);
          progress.current = 1 - t * t * (3 - 2 * t);
        }
        let material = 1 - .65 * progress.current;
        if (f) {
          const t = Math.min(1, (now - f.start) / f.duration);
          const ease = t * t * (3 - 2 * t);
          const h = home();
          const target = f.toDock ? { x: h.x - 22, y: h.y - 22 } : saved();
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const travel = reduced ? (t < .5 ? 0 : 1) : ease;
          current.current = { x: f.from.x + (target.x - f.from.x) * travel, y: f.from.y + (target.y - f.from.y) * travel };
          progress.current = f.progress + ((f.toDock ? 1 : 0) - f.progress) * (reduced ? travel : ease);
          const floatMaterial = f.progress === 1 ? 0 : 1 - .65 * f.progress;
          material = f.toDock ? (1 - .65 * f.progress) * (1 - ease) : floatMaterial + (1 - floatMaterial) * ease;
          if (reduced) el.style.opacity = String(Math.abs(2 * t - 1));
          if (t === 1) {
            flight.current = null; committed.current = !f.toDock;
            if (f.toDock) dockTranslation();
            setLifted(!f.toDock); latest.current.onDragActiveChange?.(false);
            el.style.opacity = '1';
          }
        } else if (!gesture.current?.active && !keyboardMoving.current) {
          if (!getFloatingTranslation().floating) {
            const h = home(); current.current = { x: h.x - 22, y: h.y - 22 }; progress.current = 1;
          }
        }
        const cap = s.closest<HTMLElement>('.reader-capsule');
        s.style.width = `${36 * progress.current}px`;
        s.dataset.progress = progress.current.toFixed(3);
        if (cap) {
          const r = cap.getBoundingClientRect();
          const left = cap.querySelector('.reader-tools-left')?.getBoundingClientRect();
          const right = cap.querySelector('.reader-tools-right')?.getBoundingClientRect();
          if (left && right) {
            const center = r.left + r.width / 2;
            const dockedMax = 2 * Math.min(center - left.right - 8, right.left - 36 * (1 - progress.current) - center - 8);
            cap.style.setProperty('--reader-title-max', `${Math.max(0, dockedMax + 36 * (1 - progress.current))}px`);
          }
          const docked = !getFloatingTranslation().floating && !gesture.current?.active && !flight.current;
          el.style.visibility = latest.current.hidden || (docked && (getComputedStyle(cap).opacity === '0' || r.top > window.innerHeight - 10)) ? 'hidden' : 'visible';
        }
        el.style.left = `${current.current.x}px`; el.style.top = `${current.current.y}px`;
        const face = el.querySelector<HTMLElement>('.ft-face');
        if (face) face.style.opacity = String(material * Math.min(1, (now - liftStart.current) / 280));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', measure); window.addEventListener('blur', cancel);
    window.visualViewport?.addEventListener('resize', measure);
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { cancelAnimationFrame(frame); release(); window.removeEventListener('resize', measure); window.removeEventListener('blur', cancel); window.visualViewport?.removeEventListener('resize', measure); document.removeEventListener('visibilitychange', visibility); };
  }, [cancel, home, release, saved]);
  const moveTo = (x: number, y: number) => {
    const g = gesture.current, geo = geometry.current;
    if (!g || !geo) return;
    const dx = x - g.start.x, dy = y - g.start.y;
    if (!g.active) {
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE) { clearTimer(); suppressClick.current = true; }
      return;
    }
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE) g.moved = true;
    current.current = clampPoint({ x: g.origin.x + dx, y: g.origin.y + dy }, geo.bounds);
    const distance = translationHomeDistance(current.current, home());
    if (distance > 52) g.armed = true;
    if (g.armed) progress.current = translationApproach(distance);
  };
  const down = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !geometry.current) return;
    clearTimer(); suppressClick.current = false;
    // Freeze a flight at the actually rendered point before giving control to the finger.
    const r = event.currentTarget.getBoundingClientRect(); flight.current = null;
    current.current = { x: r.left, y: r.top };
    const g: Gesture = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { ...current.current }, active: false, moved: false, armed: state.floating, floating: state.floating };
    gesture.current = g;
    event.currentTarget.setPointerCapture(event.pointerId);
    timer.current = setTimeout(() => {
      timer.current = null; g.active = true; suppressClick.current = true;
      liftStart.current = g.floating ? 0 : performance.now();
      setLifted(true); onDragActiveChange?.(true); latestGuide.current.complete();
      setAnnouncement(en ? 'Drag near the original toolbar position and release to return.' : '拖近工具栏原位置，松手即可放回');
    }, LONG_PRESS_MS);
  };
  const up = (event: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    moveTo(event.clientX, event.clientY);
    const p = { ...current.current };
    release();
    if (g.active && g.moved) {
      if (canDockTranslation(translationHomeDistance(p, home()), g.armed)) startFlight(true);
      else { save(p); if (progress.current > 0) startFlight(false); else setLifted(true); }
    } else if (g.active) cancel();
  };
  const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (consumedKey.current === event.key) { event.preventDefault(); return; }
    consumedKey.current = null;
    if (event.key === 'Escape') { if (keyboardMoving.current || gesture.current) { event.preventDefault(); cancel(); } return; }
    if (state.floating && event.altKey && event.key.toLowerCase() === 'm') {
      event.preventDefault(); keyboardMoving.current = true; current.current = saved();
      setAnnouncement(en ? 'Arrow keys to move, Enter to save, Escape to cancel.' : '方向键移动，回车保存，Esc取消'); return;
    }
    if (!keyboardMoving.current || !geometry.current) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); consumedKey.current = event.key; save(current.current); keyboardMoving.current = false; return; }
    const delta: Record<string, Point> = { ArrowLeft: { x: -10, y: 0 }, ArrowRight: { x: 10, y: 0 }, ArrowUp: { x: 0, y: -10 }, ArrowDown: { x: 0, y: 10 } };
    const d = delta[event.key];
    if (d) { event.preventDefault(); current.current = clampPoint({ x: current.current.x + d.x, y: current.current.y + d.y }, geometry.current.bounds); }
  };
  const label = en ? 'Bilingual translation' : '双语翻译';
  return <>
    <span ref={slot} className="ft-slot" aria-hidden="true" />
    <div ref={safe} className="ft-safe" aria-hidden="true" />
    {mounted && createPortal(<>
      <button ref={button} type="button" className={`ft-button ${lifted || state.floating ? 'ft-floating' : 'ft-docked'}`} style={{ touchAction: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', width: 44, height: 44, padding: 4, border: 0, background: 'transparent', boxShadow: 'none', borderRadius: '50%' }} disabled={hidden} aria-label={label} aria-pressed={enabled} title={en ? 'Hold to drag; return near the original toolbar position. Alt+M to move.' : '长按拖动，拖近工具栏原位置放回；Alt+M用方向键移动'} aria-keyshortcuts="Alt+m"
        onPointerDown={down} onPointerMove={event => { if (gesture.current?.active) event.preventDefault(); moveTo(event.clientX, event.clientY); }} onPointerUp={up}
        onPointerCancel={() => { suppressClick.current = true; cancel(); }} onLostPointerCapture={() => { if (gesture.current) { suppressClick.current = true; cancel(); } }}
        onContextMenu={event => event.preventDefault()} onKeyDown={keyDown} onKeyUp={event => { if (consumedKey.current === event.key) { event.preventDefault(); setTimeout(() => { consumedKey.current = null; }, 0); } }}
        onClick={event => { event.stopPropagation(); if (consumedKey.current || flight.current) return; if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; } if (event.detail > 0) event.currentTarget.blur(); if (!keyboardMoving.current) onToggle(); }}>
        <span className="ft-face" aria-hidden="true" />
        <span className="ft-icon" style={{ opacity: enabled ? 1 : .45 }}><IconTranslate size={20} /></span>
      </button>
      <span role="status" className="ft-status">{announcement}</span>
      {guide.visible && guideEnabled && <TranslationGuide placement={INITIAL_GUIDE_PLACEMENT} t={t} onDismiss={guide.complete} guideRef={guideRef} />}
    </>, document.body)}
  </>;
});
