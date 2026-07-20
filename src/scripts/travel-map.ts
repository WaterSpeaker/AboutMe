import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type TravelCity = {
	id: string;
	city: string;
	country: string;
	lng: number;
	lat: number;
	description: string;
	link?: string;
	attachmentUrl?: string;
};

function withBase(path: string): string {
	if (
		!path ||
		/^([a-z]+:)?\/\//i.test(path) ||
		path.startsWith("data:") ||
		path.startsWith("#")
	) {
		return path;
	}

	const base = import.meta.env.BASE_URL;
	const normalized = path.startsWith("/") ? path.slice(1) : path;
	return `${base}${normalized}`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function parseLink(raw: string): { href: string; label: string } | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const markdown = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
	if (markdown) {
		return { label: markdown[1], href: markdown[2] };
	}

	if (/^https?:\/\//.test(trimmed)) {
		return { href: trimmed, label: trimmed };
	}

	return null;
}

function buildCityCardHtml(city: TravelCity): string {
	const title = [city.city, city.country].filter(Boolean).join("，");
	const link = city.link ? parseLink(city.link) : null;

	const parts = [
		`<article class="travel-city-card">`,
	];

	if (city.attachmentUrl) {
		parts.push(
			`<div class="travel-city-card__visual">`,
			`<img class="travel-city-card__image" src="${escapeHtml(withBase(city.attachmentUrl))}" alt="" loading="lazy" />`,
			`</div>`,
		);
	}

	parts.push(`<div class="travel-city-card__copy">`);
	parts.push(`<h3 class="travel-city-card__title">${escapeHtml(title)}</h3>`);

	if (city.description) {
		parts.push(
			`<p class="travel-city-card__desc">${escapeHtml(city.description)}</p>`,
		);
	}

	if (link) {
		parts.push(
			`<a class="travel-city-card__link" href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">`,
			`<span class="travel-city-card__link-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10"/></svg></span>`,
			`<span class="travel-city-card__link-text">${escapeHtml(link.label)}</span>`,
			`</a>`,
		);
	}

	parts.push(`</div></article>`);
	return parts.join("");
}

function citiesToGeoJSON(cities: TravelCity[]): GeoJSON.FeatureCollection {
	return {
		type: "FeatureCollection",
		features: cities.map((city) => ({
			type: "Feature",
			geometry: {
				type: "Point",
				coordinates: [city.lng, city.lat],
			},
			properties: {
				id: city.id,
				city: city.city,
				country: city.country,
				description: city.description,
				link: city.link ?? "",
				attachmentUrl: city.attachmentUrl ?? "",
				breathPhase: breathPhaseForId(city.id),
			},
		})),
	};
}

/** Stable per-city phase offset in [0, 2π). */
function breathPhaseForId(id: string): number {
	let hash = 2166136261;
	for (let index = 0; index < id.length; index += 1) {
		hash ^= id.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return ((hash >>> 0) % 10000) / 10000 * Math.PI * 2;
}

const POPUP_GAP = 20;
const POPUP_EDGE_PADDING = 12;
const POPUP_ESTIMATED_WIDTH = 320;
const POPUP_ESTIMATED_HEIGHT = 280;
const POPUP_ATTRIB_HEIGHT = 32;
const POPUP_HIDE_DELAY_MS = 180;
const POPUP_EXIT_MS = 400;
const MAX_IDLE_CARDS = 3;
const IDLE_PEAK_ENTER = 0.95;
const IDLE_PEAK_EXIT = 0.2;
const IDLE_MIN_VISIBLE_MS = 3000;
const IDLE_STAGGER_MS = 2000;
const POPUP_AVOID_PADDING = 16;

type PopupSide = "left" | "right";

type ScreenRect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

function overlapArea(a: ScreenRect, b: ScreenRect, padding = POPUP_AVOID_PADDING): number {
	const left = Math.max(a.left - padding, b.left);
	const right = Math.min(a.right + padding, b.right);
	const top = Math.max(a.top - padding, b.top);
	const bottom = Math.min(a.bottom + padding, b.bottom);
	const width = right - left;
	const height = bottom - top;
	if (width <= 0 || height <= 0) return 0;
	return width * height;
}

function getPopupScreenRect(
	map: maplibregl.Map,
	lngLat: [number, number],
	side: PopupSide,
	offsetY: number,
	popupWidth: number,
	popupHeight: number,
): ScreenRect {
	const point = map.project(lngLat);
	const top = point.y + offsetY - popupHeight / 2;
	const bottom = point.y + offsetY + popupHeight / 2;

	if (side === "left") {
		const left = point.x + POPUP_GAP;
		return { left, top, right: left + popupWidth, bottom };
	}

	const right = point.x - POPUP_GAP;
	return { left: right - popupWidth, top, right, bottom };
}

function getPopupSide(
	map: maplibregl.Map,
	lngLat: [number, number],
	popupWidth = POPUP_ESTIMATED_WIDTH,
): PopupSide {
	const point = map.project(lngLat);
	const mapWidth = map.getContainer().clientWidth;
	const spaceRight = mapWidth - point.x - POPUP_EDGE_PADDING;
	const spaceLeft = point.x - POPUP_EDGE_PADDING;
	const needed = popupWidth + POPUP_GAP;

	if (spaceRight >= needed) return "left";
	if (spaceLeft >= needed) return "right";
	return spaceRight >= spaceLeft ? "left" : "right";
}

function clampVerticalOffset(
	map: maplibregl.Map,
	lngLat: [number, number],
	popupHeight: number,
	offsetY: number,
): number {
	const point = map.project(lngLat);
	const mapHeight = map.getContainer().clientHeight;
	const topPad = POPUP_EDGE_PADDING;
	const bottomPad = POPUP_EDGE_PADDING + POPUP_ATTRIB_HEIGHT;

	let next = offsetY;
	const top = point.y + next - popupHeight / 2;
	const bottom = point.y + next + popupHeight / 2;

	if (top < topPad) {
		next += topPad - top;
	}

	const adjustedBottom = point.y + next + popupHeight / 2;
	if (adjustedBottom > mapHeight - bottomPad) {
		next -= adjustedBottom - (mapHeight - bottomPad);
	}

	return Math.round(next);
}

function scorePopupPlacement(
	rect: ScreenRect,
	avoidRects: ScreenRect[],
	mapWidth: number,
	mapHeight: number,
): number {
	let score = 0;

	for (const other of avoidRects) {
		score += overlapArea(rect, other);
	}

	const width = rect.right - rect.left;
	const height = rect.bottom - rect.top;

	if (rect.left < POPUP_EDGE_PADDING) {
		score += (POPUP_EDGE_PADDING - rect.left) * height;
	}
	if (rect.right > mapWidth - POPUP_EDGE_PADDING) {
		score += (rect.right - (mapWidth - POPUP_EDGE_PADDING)) * height;
	}
	if (rect.top < POPUP_EDGE_PADDING) {
		score += (POPUP_EDGE_PADDING - rect.top) * width;
	}
	if (rect.bottom > mapHeight - POPUP_EDGE_PADDING - POPUP_ATTRIB_HEIGHT) {
		score +=
			(rect.bottom - (mapHeight - POPUP_EDGE_PADDING - POPUP_ATTRIB_HEIGHT)) * width;
	}

	return score;
}

function findBestPopupPlacement(
	map: maplibregl.Map,
	lngLat: [number, number],
	popupWidth: number,
	popupHeight: number,
	avoidRects: ScreenRect[] = [],
): { side: PopupSide; offsetY: number } {
	const preferredSide = getPopupSide(map, lngLat, popupWidth);
	const sides: PopupSide[] =
		preferredSide === "left" ? ["left", "right"] : ["right", "left"];
	const offsetCandidates = [0, -96, 96, -180, 180, -260, 260, -340, 340];
	const mapWidth = map.getContainer().clientWidth;
	const mapHeight = map.getContainer().clientHeight;

	let bestSide = preferredSide;
	let bestOffsetY = clampVerticalOffset(map, lngLat, popupHeight, 0);
	let bestScore = Number.POSITIVE_INFINITY;

	for (const side of sides) {
		for (const rawOffset of offsetCandidates) {
			const offsetY = clampVerticalOffset(map, lngLat, popupHeight, rawOffset);
			const rect = getPopupScreenRect(
				map,
				lngLat,
				side,
				offsetY,
				popupWidth,
				popupHeight,
			);
			const score = scorePopupPlacement(rect, avoidRects, mapWidth, mapHeight);

			if (score < bestScore) {
				bestScore = score;
				bestSide = side;
				bestOffsetY = offsetY;
			}

			if (score === 0) {
				return { side: bestSide, offsetY: bestOffsetY };
			}
		}
	}

	return { side: bestSide, offsetY: bestOffsetY };
}

function applyPopupPlacement(
	popup: maplibregl.Popup,
	map: maplibregl.Map,
	lngLat: [number, number],
	shell?: HTMLElement | null,
	avoidRects: ScreenRect[] = [],
) {
	const popupRoot = popup.getElement();
	if (!popupRoot) return;

	if (shell) {
		shell.appendChild(popupRoot);
	}

	const popupWidth = popupRoot.offsetWidth || POPUP_ESTIMATED_WIDTH;
	const popupHeight = popupRoot.offsetHeight || POPUP_ESTIMATED_HEIGHT;
	const { side, offsetY } = findBestPopupPlacement(
		map,
		lngLat,
		popupWidth,
		popupHeight,
		avoidRects,
	);
	const maxHeight = Math.max(
		240,
		map.getContainer().clientHeight - POPUP_EDGE_PADDING * 2 - POPUP_ATTRIB_HEIGHT,
	);

	shell?.style.setProperty("--travel-popup-max-height", `${maxHeight}px`);

	popup.options.anchor = side;
	popup.setOffset({
		left: [POPUP_GAP, offsetY],
		right: [-POPUP_GAP, offsetY],
		top: [0, POPUP_GAP],
		bottom: [0, -POPUP_GAP],
		center: [0, offsetY],
		"top-left": [POPUP_GAP, POPUP_GAP],
		"top-right": [-POPUP_GAP, POPUP_GAP],
		"bottom-left": [POPUP_GAP, -POPUP_GAP],
		"bottom-right": [-POPUP_GAP, -POPUP_GAP],
	});
	popup.setLngLat(lngLat);

	popupRoot.classList.toggle("travel-city-popup--side-right", side === "left");
	popupRoot.classList.toggle("travel-city-popup--side-left", side === "right");
}

function readPopupScreenRect(
	popup: maplibregl.Popup,
	map: maplibregl.Map,
): ScreenRect | null {
	const popupRoot = popup.getElement();
	if (!popupRoot) return null;

	const popupBox = popupRoot.getBoundingClientRect();
	const mapBox = map.getContainer().getBoundingClientRect();
	if (popupBox.width <= 0 || popupBox.height <= 0) return null;

	return {
		left: popupBox.left - mapBox.left,
		top: popupBox.top - mapBox.top,
		right: popupBox.right - mapBox.left,
		bottom: popupBox.bottom - mapBox.top,
	};
}

function cityFromFeature(feature: GeoJSON.Feature): TravelCity | null {
	if (feature.geometry.type !== "Point") return null;

	const props = feature.properties as {
		id: string;
		city: string;
		country: string;
		description: string;
		link: string;
		attachmentUrl: string;
	};

	return {
		id: props.id,
		city: props.city,
		country: props.country,
		lng: feature.geometry.coordinates[0],
		lat: feature.geometry.coordinates[1],
		description: props.description,
		...(props.link ? { link: props.link } : {}),
		...(props.attachmentUrl ? { attachmentUrl: props.attachmentUrl } : {}),
	};
}

export function initTravelMap(
	containerId: string,
	cities: TravelCity[],
): () => void {
	const container = document.getElementById(containerId);
	if (!container) return () => {};

	const shell = container.parentElement;

	const prefersReducedMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;

	const map = new maplibregl.Map({
		container: containerId,
		style: withBase("/styles/travel-map.json"),
		center: [10, 20],
		zoom: 1.4,
		minZoom: 1,
		maxZoom: 10,
		scrollZoom: true,
		dragPan: true,
		dragRotate: false,
		pitchWithRotate: false,
		touchZoomRotate: true,
		fadeDuration: prefersReducedMotion ? 0 : 300,
		attributionControl: false,
	});

	map.addControl(
		new maplibregl.NavigationControl({ showCompass: false }),
		"top-right",
	);

	map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

	const popup = new maplibregl.Popup({
		closeButton: false,
		closeOnClick: false,
		maxWidth: "320px",
		className: "travel-city-popup",
	});

	let activeFeatureId: string | null = null;
	let hoveredFeatureId: string | number | null = null;
	let dotHovered = false;
	let popupHovered = false;
	let idleCardHovered = false;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let popupDismissGeneration = 0;
	let breathFrameId: number | null = null;
	let activeLngLat: [number, number] | null = null;
	let idleCardsEnabled = true;
	let lastIdleOpenAt = Number.NEGATIVE_INFINITY;
	let lastIdleCloseAt = Number.NEGATIVE_INFINITY;

	const citiesById = new Map(cities.map((city) => [city.id, city]));
	const breathPhases = new Map(
		cities.map((city) => [city.id, breathPhaseForId(city.id)]),
	);
	const prevWaves = new Map<string, number>();
	const idlePopups = new Map<string, maplibregl.Popup>();
	const idleOrder: string[] = [];
	const idleLngLats = new Map<string, [number, number]>();
	const idleOpenedAt = new Map<string, number>();
	const pendingOpens: string[] = [];
	const pendingCloses = new Set<string>();

	const stopBreathAnimation = () => {
		if (breathFrameId !== null) {
			cancelAnimationFrame(breathFrameId);
			breathFrameId = null;
		}
	};

	const animatePopupElement = (popupRoot: HTMLElement | undefined) => {
		if (!popupRoot) return;
		popupRoot.classList.remove("is-leaving");
		if (prefersReducedMotion) {
			popupRoot.classList.add("is-visible");
			return;
		}
		popupRoot.classList.remove("is-visible");
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				popupRoot.classList.add("is-visible");
			});
		});
	};

	const dismissPopupElement = (
		popupRoot: HTMLElement | null | undefined,
		onDone: () => void,
	) => {
		if (!popupRoot || prefersReducedMotion || !popupRoot.classList.contains("is-visible")) {
			onDone();
			return;
		}

		popupRoot.classList.add("is-leaving");
		popupRoot.classList.remove("is-visible");

		const content = popupRoot.querySelector(".maplibregl-popup-content");
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			content?.removeEventListener("transitionend", onTransitionEnd);
			onDone();
		};
		const onTransitionEnd = (event: Event) => {
			if (!(event instanceof TransitionEvent)) return;
			if (event.propertyName !== "opacity") return;
			finish();
		};

		content?.addEventListener("transitionend", onTransitionEnd);
		window.setTimeout(finish, POPUP_EXIT_MS + 80);
	};

	const queueIdleOpen = (id: string) => {
		if (idlePopups.has(id) || pendingOpens.includes(id)) return;
		pendingOpens.push(id);
	};

	const queueIdleClose = (id: string) => {
		if (!idlePopups.has(id)) return;
		pendingCloses.add(id);
	};

	const onIdleCardEnter = () => {
		idleCardHovered = true;
		idleCardsEnabled = false;
	};

	const onIdleCardLeave = () => {
		idleCardHovered = false;
		if (!dotHovered && !popupHovered && !activeFeatureId) {
			idleCardsEnabled = true;
		}
	};

	const bindIdleCardHover = (idlePopup: maplibregl.Popup) => {
		const popupRoot = idlePopup.getElement();
		if (!popupRoot || popupRoot.dataset.idleHoverBound === "true") return;

		popupRoot.dataset.idleHoverBound = "true";
		popupRoot.addEventListener("mouseenter", onIdleCardEnter);
		popupRoot.addEventListener("mouseleave", onIdleCardLeave);
	};

	const closeIdleCard = (id: string, options?: { immediate?: boolean }) => {
		const idlePopup = idlePopups.get(id);
		if (!idlePopup) return;

		const popupRoot = idlePopup.getElement();
		popupRoot?.removeEventListener("mouseenter", onIdleCardEnter);
		popupRoot?.removeEventListener("mouseleave", onIdleCardLeave);

		idlePopups.delete(id);
		idleLngLats.delete(id);
		idleOpenedAt.delete(id);
		pendingCloses.delete(id);
		const orderIndex = idleOrder.indexOf(id);
		if (orderIndex !== -1) {
			idleOrder.splice(orderIndex, 1);
		}

		const removeNow = () => {
			idlePopup.remove();
		};

		if (options?.immediate) {
			removeNow();
			return;
		}

		dismissPopupElement(popupRoot, removeNow);
	};

	const clearIdleCards = () => {
		for (const id of [...idleOrder]) {
			closeIdleCard(id, { immediate: true });
		}
		pendingOpens.length = 0;
		pendingCloses.clear();
	};

	const collectAvoidRects = (excludeId?: string): ScreenRect[] => {
		const rects: ScreenRect[] = [];

		if (popup.isOpen()) {
			const userRect = readPopupScreenRect(popup, map);
			if (userRect) rects.push(userRect);
		}

		for (const [id, idlePopup] of idlePopups) {
			if (id === excludeId) continue;
			const rect = readPopupScreenRect(idlePopup, map);
			if (rect) rects.push(rect);
		}

		return rects;
	};

	const tryOpenIdleCard = (id: string, time: number): boolean => {
		if (!idleCardsEnabled || prefersReducedMotion) return false;
		if (idlePopups.has(id)) return true;

		const city = citiesById.get(id);
		if (!city) return true;

		while (idleOrder.length >= MAX_IDLE_CARDS) {
			const oldestId = idleOrder[0];
			if (!oldestId) return false;

			const oldestOpenedAt = idleOpenedAt.get(oldestId) ?? 0;
			if (time - oldestOpenedAt < IDLE_MIN_VISIBLE_MS) {
				return false;
			}

			if (time - lastIdleCloseAt < IDLE_STAGGER_MS) {
				return false;
			}

			closeIdleCard(oldestId);
			lastIdleCloseAt = time;
		}

		const lngLat: [number, number] = [city.lng, city.lat];
		const idlePopup = new maplibregl.Popup({
			closeButton: false,
			closeOnClick: false,
			maxWidth: "320px",
			className: "travel-city-popup travel-city-popup--auto",
		});

		const avoidRects = collectAvoidRects();
		idlePopup.setLngLat(lngLat).setHTML(buildCityCardHtml(city)).addTo(map);
		applyPopupPlacement(idlePopup, map, lngLat, shell, avoidRects);
		animatePopupElement(idlePopup.getElement());
		bindIdleCardHover(idlePopup);

		requestAnimationFrame(() => {
			applyPopupPlacement(idlePopup, map, lngLat, shell, collectAvoidRects(id));
		});

		idlePopups.set(id, idlePopup);
		idleLngLats.set(id, lngLat);
		idleOpenedAt.set(id, time);
		idleOrder.push(id);
		pendingCloses.delete(id);
		return true;
	};

	const processPendingIdleCards = (time: number) => {
		if (!idleCardsEnabled || prefersReducedMotion) return;

		if (time - lastIdleOpenAt >= IDLE_STAGGER_MS && pendingOpens.length > 0) {
			while (pendingOpens.length > 0) {
				const nextId = pendingOpens[0];
				if (!nextId) break;

				if (idlePopups.has(nextId)) {
					pendingOpens.shift();
					continue;
				}

				const opened = tryOpenIdleCard(nextId, time);
				if (opened) {
					pendingOpens.shift();
					lastIdleOpenAt = time;
				}
				break;
			}
		}

		if (time - lastIdleCloseAt >= IDLE_STAGGER_MS && pendingCloses.size > 0) {
			for (const id of pendingCloses) {
				if (!idlePopups.has(id)) {
					pendingCloses.delete(id);
					continue;
				}

				const openedAt = idleOpenedAt.get(id) ?? 0;
				if (time - openedAt < IDLE_MIN_VISIBLE_MS) continue;

				closeIdleCard(id);
				lastIdleCloseAt = time;
				break;
			}
		}
	};

	const pauseIdleCards = () => {
		idleCardsEnabled = false;
	};

	const resumeIdleCards = () => {
		if (!dotHovered && !popupHovered && !idleCardHovered) {
			idleCardsEnabled = true;
		}
	};

	const startBreathAnimation = () => {
		stopBreathAnimation();
		if (prefersReducedMotion || cities.length === 0) return;

		const BREATH_SPEED = 0.0018;
		const BASE_OPACITY = 0.42;
		const OPACITY_RANGE = 0.28;
		const FRAME_INTERVAL_MS = 40;
		let lastFrameTime = 0;

		const tick = (time: number) => {
			breathFrameId = requestAnimationFrame(tick);
			if (time - lastFrameTime < FRAME_INTERVAL_MS) return;
			lastFrameTime = time;

			const globalPhase = time * BREATH_SPEED;

			for (const [id, phaseOffset] of breathPhases) {
				const wave = Math.sin(globalPhase + phaseOffset);
				const breath = BASE_OPACITY + ((wave + 1) / 2) * OPACITY_RANGE;
				const prevWave = prevWaves.get(id) ?? wave;
				prevWaves.set(id, wave);

				map.setFeatureState(
					{ source: "cities", id },
					{ breath },
				);

				if (!idleCardsEnabled) continue;

				if (prevWave < IDLE_PEAK_ENTER && wave >= IDLE_PEAK_ENTER) {
					queueIdleOpen(id);
				} else if (wave < IDLE_PEAK_EXIT && idlePopups.has(id)) {
					queueIdleClose(id);
				}
			}

			processPendingIdleCards(time);
		};

		breathFrameId = requestAnimationFrame(tick);
	};

	const cancelScheduledHide = () => {
		if (hideTimer !== null) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
	};

	const scheduleHide = () => {
		cancelScheduledHide();
		hideTimer = setTimeout(() => {
			hideTimer = null;
			maybeHidePopup();
		}, prefersReducedMotion ? 0 : POPUP_HIDE_DELAY_MS);
	};

	const onPopupMouseEnter = () => {
		cancelScheduledHide();
		popupHovered = true;
	};

	const onPopupMouseLeave = () => {
		popupHovered = false;
		scheduleHide();
	};

	const setDotHover = (featureId: string | number | undefined, hover: boolean) => {
		if (featureId == null) return;

		if (hoveredFeatureId != null && hoveredFeatureId !== featureId) {
			map.setFeatureState(
				{ source: "cities", id: hoveredFeatureId },
				{ hover: false },
			);
		}

		map.setFeatureState({ source: "cities", id: featureId }, { hover });
		hoveredFeatureId = hover ? featureId : null;
	};

	const bindPopupHover = () => {
		const popupRoot = popup.getElement();
		if (!popupRoot) return;

		popupRoot.removeEventListener("mouseenter", onPopupMouseEnter);
		popupRoot.removeEventListener("mouseleave", onPopupMouseLeave);
		popupRoot.addEventListener("mouseenter", onPopupMouseEnter);
		popupRoot.addEventListener("mouseleave", onPopupMouseLeave);
	};

	const repositionActivePopup = () => {
		const placedRects: ScreenRect[] = [];

		if (activeLngLat && popup.isOpen()) {
			applyPopupPlacement(popup, map, activeLngLat, shell, placedRects);
			const userRect = readPopupScreenRect(popup, map);
			if (userRect) placedRects.push(userRect);
		}

		for (const id of idleOrder) {
			const idlePopup = idlePopups.get(id);
			const lngLat = idleLngLats.get(id);
			if (!idlePopup || !lngLat || !idlePopup.isOpen()) continue;
			applyPopupPlacement(idlePopup, map, lngLat, shell, placedRects);
			const rect = readPopupScreenRect(idlePopup, map);
			if (rect) placedRects.push(rect);
		}
	};

	const showPopup = (feature: GeoJSON.Feature) => {
		if (feature.geometry.type !== "Point") return;

		const city = cityFromFeature(feature);
		if (!city) return;

		popupDismissGeneration += 1;

		const lngLat = feature.geometry.coordinates as [number, number];
		activeFeatureId = city.id;
		activeLngLat = lngLat;
		cancelScheduledHide();
		pauseIdleCards();
		closeIdleCard(city.id, { immediate: true });
		const pendingIndex = pendingOpens.indexOf(city.id);
		if (pendingIndex !== -1) {
			pendingOpens.splice(pendingIndex, 1);
		}

		popup
			.setLngLat(lngLat)
			.setHTML(buildCityCardHtml(city))
			.addTo(map);
		applyPopupPlacement(popup, map, lngLat, shell, collectAvoidRects());
		bindPopupHover();
		animatePopupElement(popup.getElement());

		requestAnimationFrame(() => {
			applyPopupPlacement(popup, map, lngLat, shell, collectAvoidRects());
		});
	};

	const hidePopup = () => {
		cancelScheduledHide();
		activeLngLat = null;

		if (hoveredFeatureId != null) {
			map.setFeatureState(
				{ source: "cities", id: hoveredFeatureId },
				{ hover: false },
			);
			hoveredFeatureId = null;
		}

		const popupRoot = popup.getElement();
		popupRoot?.removeEventListener("mouseenter", onPopupMouseEnter);
		popupRoot?.removeEventListener("mouseleave", onPopupMouseLeave);

		activeFeatureId = null;
		popupHovered = false;

		const dismissGeneration = ++popupDismissGeneration;

		const finishHide = () => {
			if (dismissGeneration !== popupDismissGeneration) return;
			popup.remove();
			resumeIdleCards();
		};

		if (!popup.isOpen()) {
			finishHide();
			return;
		}

		dismissPopupElement(popupRoot, finishHide);
	};

	const maybeHidePopup = () => {
		if (!dotHovered && !popupHovered) {
			hidePopup();
		}
	};

	const onLoad = () => {
		if (cities.length === 0) return;

		const geojson = citiesToGeoJSON(cities);

		map.addSource("cities", {
			type: "geojson",
			data: geojson,
			promoteId: "id",
		});

		map.addLayer({
			id: "city-dots-halo",
			type: "circle",
			source: "cities",
			paint: {
				"circle-radius": [
					"case",
					["boolean", ["feature-state", "hover"], false],
					14,
					0,
				],
				"circle-color": "#000000",
				"circle-opacity": [
					"case",
					["boolean", ["feature-state", "hover"], false],
					0.1,
					0,
				],
			},
		});

		map.addLayer({
			id: "city-dots",
			type: "circle",
			source: "cities",
			paint: {
				"circle-radius": [
					"case",
					["boolean", ["feature-state", "hover"], false],
					6.5,
					5,
				],
				"circle-color": "#000000",
				"circle-opacity": [
					"coalesce",
					["feature-state", "breath"],
					0.55,
				],
				"circle-stroke-width": 0,
			},
		});

		startBreathAnimation();

		map.on("mouseenter", "city-dots", (event) => {
			map.getCanvas().style.cursor = "pointer";
			const feature = event.features?.[0];
			if (!feature) return;

			cancelScheduledHide();
			dotHovered = true;
			setDotHover(feature.id, true);
			showPopup(feature);
		});

		map.on("mouseleave", "city-dots", () => {
			map.getCanvas().style.cursor = "";
			dotHovered = false;
			scheduleHide();
		});

		map.on("click", "city-dots", (event) => {
			const feature = event.features?.[0];
			if (!feature) return;

			setDotHover(feature.id, true);

			const city = cityFromFeature(feature);
			if (city?.id === activeFeatureId) {
				hidePopup();
				return;
			}

			showPopup(feature);
		});

		map.on("click", (event) => {
			const features = map.queryRenderedFeatures(event.point, {
				layers: ["city-dots"],
			});
			if (features.length === 0) {
				hidePopup();
			}
		});
	};

	map.on("load", onLoad);
	map.on("move", repositionActivePopup);
	map.on("zoom", repositionActivePopup);

	const resizeObserver = new ResizeObserver(() => {
		map.resize();
		repositionActivePopup();
	});
	resizeObserver.observe(container);

	return () => {
		cancelScheduledHide();
		stopBreathAnimation();
		clearIdleCards();
		resizeObserver.disconnect();
		map.remove();
	};
}
