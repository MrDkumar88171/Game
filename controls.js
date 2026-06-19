// controls.js — touch input layer. Exposes a single InputState object that
// game.js polls every frame, plus a swipe tracker reused by the lobby's
// character preview and the in-game camera orbit.

export const InputState = {
  moveX: 0, moveY: 0,     // -1..1 from joystick
  firing: false,
  aiming: false,
  jumpPressed: false,
  crouching: false,
  reloadPressed: false,
  weaponSwitchPressed: false,
  grenadePressed: false,
  medkitPressed: false,
};

function consumePulse(key) {
  const v = InputState[key];
  InputState[key] = false;
  return v;
}
export const consumeJump = () => consumePulse('jumpPressed');
export const consumeReload = () => consumePulse('reloadPressed');
export const consumeWeaponSwitch = () => consumePulse('weaponSwitchPressed');
export const consumeGrenade = () => consumePulse('grenadePressed');
export const consumeMedkit = () => consumePulse('medkitPressed');

export function initJoystick() {
  const zone = document.getElementById('joystick-zone');
  const knob = document.getElementById('joystick-knob');
  const base = zone.querySelector('.joystick-base');
  let activeId = null;
  const radius = 40;

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function handleMove(clientX, clientY) {
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) { dx = (dx / dist) * radius; dy = (dy / dist) * radius; }
    setKnob(dx, dy);
    InputState.moveX = dx / radius;
    InputState.moveY = dy / radius;
  }

  zone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    activeId = t.identifier;
    handleMove(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  zone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === activeId) handleMove(t.clientX, t.clientY);
    }
    e.preventDefault();
  }, { passive: false });

  function end(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === activeId) {
        activeId = null;
        setKnob(0, 0);
        InputState.moveX = 0;
        InputState.moveY = 0;
      }
    }
  }
  zone.addEventListener('touchend', end);
  zone.addEventListener('touchcancel', end);

  // Mouse fallback for desktop testing
  let mouseDown = false;
  zone.addEventListener('mousedown', (e) => { mouseDown = true; handleMove(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (mouseDown) handleMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { mouseDown = false; setKnob(0, 0); InputState.moveX = 0; InputState.moveY = 0; });
}

export function initActionButtons() {
  const bind = (id, onDown, onUp) => {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => { onDown(); e.preventDefault(); };
    const up = (e) => { if (onUp) onUp(); e.preventDefault(); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('mouseup', up);
    el.addEventListener('touchcancel', up);
    el.addEventListener('mouseleave', up);
  };

  bind('btn-fire', () => { InputState.firing = true; }, () => { InputState.firing = false; });
  bind('btn-aim', () => {
    InputState.aiming = true;
    document.getElementById('btn-aim').classList.add('active');
  }, () => {
    InputState.aiming = false;
    document.getElementById('btn-aim').classList.remove('active');
  });
  bind('btn-jump', () => { InputState.jumpPressed = true; });
  bind('btn-crouch', () => { InputState.crouching = !InputState.crouching; });
  bind('btn-reload', () => { InputState.reloadPressed = true; });
  bind('btn-weapon-switch', () => { InputState.weaponSwitchPressed = true; });
  bind('btn-grenade', () => { InputState.grenadePressed = true; });
  bind('btn-medkit', () => { InputState.medkitPressed = true; });
}

// ---------------------------------------------------------------------------
// Generic swipe/drag tracker used for camera orbit (game) and character
// rotation + pinch zoom (lobby preview).
// ---------------------------------------------------------------------------
export function attachSwipeRotate(el, { onDrag, onPinch } = {}) {
  let dragging = false;
  let lastX = 0, lastY = 0;
  let pinchStartDist = null;

  function dist(touches) {
    const [a, b] = touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      dragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2 && onPinch) {
      pinchStartDist = dist(e.touches);
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && dragging && onDrag) {
      const dx = e.touches[0].clientX - lastX;
      const dy = e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      onDrag(dx, dy);
    } else if (e.touches.length === 2 && pinchStartDist != null && onPinch) {
      const d = dist(e.touches);
      onPinch(d - pinchStartDist);
      pinchStartDist = d;
    }
  }, { passive: true });

  const stop = () => { dragging = false; pinchStartDist = null; };
  el.addEventListener('touchend', stop);
  el.addEventListener('touchcancel', stop);

  // Desktop mouse fallback
  let mouseDown = false;
  el.addEventListener('mousedown', (e) => { mouseDown = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener('mousemove', (e) => {
    if (mouseDown && onDrag) { onDrag(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; }
  });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  el.addEventListener('wheel', (e) => { if (onPinch) onPinch(-e.deltaY * 0.3); }, { passive: true });
}
