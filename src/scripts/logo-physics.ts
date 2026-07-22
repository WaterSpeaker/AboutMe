/**
 * Hero logo: idle counter-spin + pointer torque (wheel physics).
 */

const IDLE_OUTER = 360 / 28; // deg/s clockwise
const IDLE_INNER = -360 / 38; // deg/s counter-clockwise
const MAX_SPEED = 2200; // deg/s
const TORQUE = 1.15;
const FRICTION = 0; // no idle pull while pointer is inside
const RETURN = 0.55; // slow settle after leave
const LEAVE_DAMP = 0;

function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function initLogoPhysics(root: HTMLElement) {
	const inner = root.querySelector("span");
	if (!inner || prefersReducedMotion()) return;

	let angleOuter = 0;
	let angleInner = 0;
	let velOuter = IDLE_OUTER;
	let velInner = IDLE_INNER;

	let pointerInside = false;
	let prevX = 0;
	let prevY = 0;
	let hasPrev = false;
	let lastT = performance.now();
	let raf = 0;

	const clamp = (v: number) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));

	const apply = () => {
		root.style.transform = `rotate(${angleOuter}deg)`;
		inner.style.transform = `rotate(${angleInner}deg)`;
	};

	const tick = (now: number) => {
		const dt = Math.min(0.048, (now - lastT) / 1000);
		lastT = now;

		if (!pointerInside) {
			velOuter += (IDLE_OUTER - velOuter) * Math.min(1, RETURN * dt);
			velInner += (IDLE_INNER - velInner) * Math.min(1, RETURN * dt);
		} else if (FRICTION > 0) {
			velOuter += (IDLE_OUTER - velOuter) * Math.min(1, FRICTION * dt);
			velInner += (IDLE_INNER - velInner) * Math.min(1, FRICTION * dt);
		}

		angleOuter = (angleOuter + velOuter * dt) % 360;
		angleInner = (angleInner + velInner * dt) % 360;
		apply();
		raf = requestAnimationFrame(tick);
	};

	const onMove = (e: PointerEvent) => {
		const rect = root.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const x = e.clientX;
		const y = e.clientY;

		if (!hasPrev) {
			prevX = x;
			prevY = y;
			hasPrev = true;
			return;
		}

		const dx = x - prevX;
		const dy = y - prevY;
		prevX = x;
		prevY = y;

		const rx = x - cx;
		const ry = y - cy;
		const r = Math.hypot(rx, ry) || 1;
		// Tangential impulse: r × v (2D cross), boosted for snappy feel
		const tangential = (rx * dy - ry * dx) / r;
		const speed = Math.hypot(dx, dy);
		const torque = (tangential + Math.sign(tangential || dx) * speed * 0.35) * TORQUE;

		velOuter = clamp(velOuter + torque * 1.6);
		velInner = clamp(velInner - torque * 2.2);
	};

	const onEnter = (e: PointerEvent) => {
		pointerInside = true;
		hasPrev = false;
		prevX = e.clientX;
		prevY = e.clientY;
	};

	const onLeave = () => {
		pointerInside = false;
		hasPrev = false;
		// Soft coast: keep some of the imparted velocity
		velOuter *= 1 - LEAVE_DAMP;
		velInner *= 1 - LEAVE_DAMP;
	};

	root.addEventListener("pointerenter", onEnter);
	root.addEventListener("pointermove", onMove);
	root.addEventListener("pointerleave", onLeave);
	root.addEventListener("pointercancel", onLeave);

	apply();
	raf = requestAnimationFrame(tick);

	return () => {
		cancelAnimationFrame(raf);
		root.removeEventListener("pointerenter", onEnter);
		root.removeEventListener("pointermove", onMove);
		root.removeEventListener("pointerleave", onLeave);
		root.removeEventListener("pointercancel", onLeave);
		root.style.transform = "";
		inner.style.transform = "";
	};
}

export function initAllLogoPhysics() {
	const cleanups: Array<() => void> = [];
	document.querySelectorAll<HTMLElement>("[data-logo-physics]").forEach((el) => {
		const cleanup = initLogoPhysics(el);
		if (cleanup) cleanups.push(cleanup);
	});
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}