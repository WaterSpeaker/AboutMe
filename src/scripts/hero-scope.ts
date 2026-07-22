const DEFAULT_X = 0.72;
const DEFAULT_Y = 0.62;
const ZONE_X0 = 0.42;
const ZONE_X1 = 0.96;
const ZONE_Y0 = 0.12;
const ZONE_Y1 = 0.9;
const REST_LAT = 48;
const REST_LON = 12;
const LAT_SPAN = 30;
const LON_SPAN = 42;
const FOLLOW_LERP = 0.16;
const FOLLOW_LABEL_LERP = 0.22;
const RETURN_DURATION_MS = 980;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function easeOutQuint(t: number) {
	return 1 - (1 - t) ** 5;
}

function formatLatitude(lat: number) {
	const rounded = Math.round(lat);
	const abs = Math.abs(rounded);
	return `${abs}°${rounded >= 0 ? "N" : "S"}`;
}

function formatLongitude(lon: number) {
	const rounded = Math.round(lon);
	const abs = Math.abs(rounded);
	return `${abs}°${rounded >= 0 ? "E" : "W"}`;
}

function latLonFromFocus(x: number, y: number) {
	const restNx = (DEFAULT_X - ZONE_X0) / (ZONE_X1 - ZONE_X0);
	const restNy = (DEFAULT_Y - ZONE_Y0) / (ZONE_Y1 - ZONE_Y0);
	const nx = clamp((x - ZONE_X0) / (ZONE_X1 - ZONE_X0), 0, 1);
	const ny = clamp((y - ZONE_Y0) / (ZONE_Y1 - ZONE_Y0), 0, 1);

	return {
		lat: REST_LAT - (ny - restNy) * LAT_SPAN,
		lon: REST_LON + (nx - restNx) * LON_SPAN,
	};
}

export function initHeroScope(root: HTMLElement): () => void {
	const prefersReducedMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	const canHover = window.matchMedia("(hover: hover)").matches;

	const northLabel = root.querySelector<HTMLElement>("[data-hero-lat]");
	const eastLabel = root.querySelector<HTMLElement>("[data-hero-lon]");

	if (!northLabel || !eastLabel || prefersReducedMotion || !canHover) {
		return () => {};
	}

	let targetX = DEFAULT_X;
	let targetY = DEFAULT_Y;
	let currentX = DEFAULT_X;
	let currentY = DEFAULT_Y;
	let displayLat = REST_LAT;
	let displayLon = REST_LON;
	let active = false;
	let returning = false;
	let returnStart = 0;
	let returnFromX = DEFAULT_X;
	let returnFromY = DEFAULT_Y;
	let returnFromLat = REST_LAT;
	let returnFromLon = REST_LON;
	let frameId: number | null = null;

	const apply = () => {
		root.style.setProperty("--focus-x", `${(currentX * 100).toFixed(2)}%`);
		root.style.setProperty("--focus-y", `${(currentY * 100).toFixed(2)}%`);
		northLabel.textContent = formatLatitude(displayLat);
		eastLabel.textContent = formatLongitude(displayLon);
	};

	const startReturn = () => {
		active = false;
		returning = true;
		returnStart = performance.now();
		returnFromX = currentX;
		returnFromY = currentY;
		returnFromLat = displayLat;
		returnFromLon = displayLon;
		targetX = DEFAULT_X;
		targetY = DEFAULT_Y;
		root.classList.remove("is-tracking");
		ensureTick();
	};

	const tick = (time: number) => {
		if (returning) {
			const progress = clamp((time - returnStart) / RETURN_DURATION_MS, 0, 1);
			const eased = easeOutQuint(progress);

			currentX = returnFromX + (DEFAULT_X - returnFromX) * eased;
			currentY = returnFromY + (DEFAULT_Y - returnFromY) * eased;
			displayLat = returnFromLat + (REST_LAT - returnFromLat) * eased;
			displayLon = returnFromLon + (REST_LON - returnFromLon) * eased;
			apply();

			if (progress < 1) {
				frameId = requestAnimationFrame(tick);
				return;
			}

			returning = false;
			currentX = DEFAULT_X;
			currentY = DEFAULT_Y;
			displayLat = REST_LAT;
			displayLon = REST_LON;
			apply();
			frameId = null;
			return;
		}

		currentX += (targetX - currentX) * FOLLOW_LERP;
		currentY += (targetY - currentY) * FOLLOW_LERP;

		const { lat, lon } = latLonFromFocus(currentX, currentY);
		displayLat += (lat - displayLat) * FOLLOW_LABEL_LERP;
		displayLon += (lon - displayLon) * FOLLOW_LABEL_LERP;

		apply();

		const settled =
			Math.abs(targetX - currentX) < 0.0004 &&
			Math.abs(targetY - currentY) < 0.0004 &&
			Math.abs(lat - displayLat) < 0.04 &&
			Math.abs(lon - displayLon) < 0.04;

		if (!settled || active) {
			frameId = requestAnimationFrame(tick);
			return;
		}

		currentX = targetX;
		currentY = targetY;
		displayLat = lat;
		displayLon = lon;
		apply();
		frameId = null;
	};

	const ensureTick = () => {
		if (frameId === null) {
			frameId = requestAnimationFrame(tick);
		}
	};

	const onPointerMove = (event: PointerEvent) => {
		const rect = root.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;

		const x = clamp((event.clientX - rect.left) / rect.width, 0.08, 0.96);
		const y = clamp((event.clientY - rect.top) / rect.height, 0.12, 0.9);

		if (x < ZONE_X0) {
			if (active || returning) {
				if (!returning) startReturn();
			}
			return;
		}

		returning = false;
		active = true;
		root.classList.add("is-tracking");
		targetX = x;
		targetY = y;
		ensureTick();
	};

	const onPointerLeave = () => {
		if (!active && !returning) return;
		if (returning) return;
		startReturn();
	};

	root.classList.add("is-ready");
	apply();

	root.addEventListener("pointermove", onPointerMove);
	root.addEventListener("pointerleave", onPointerLeave);

	return () => {
		root.removeEventListener("pointermove", onPointerMove);
		root.removeEventListener("pointerleave", onPointerLeave);
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
		}
		root.classList.remove("is-ready", "is-tracking");
	};
}
