/**
 * Transitions.dev-style spinning digit reel.
 * Builds one .t-reel-col per digit; colons stay static separators.
 */

const REEL_SPINS = 2;

function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ensureBlurFilters(count: number) {
	let svg = document.getElementById("t-reel-blur-defs") as SVGSVGElement | null;
	if (!svg) {
		svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.id = "t-reel-blur-defs";
		svg.setAttribute("width", "0");
		svg.setAttribute("height", "0");
		svg.setAttribute("aria-hidden", "true");
		svg.style.position = "absolute";
		document.body.prepend(svg);

		const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
		svg.appendChild(defs);
	}

	const defs = svg.querySelector("defs");
	if (!defs) return;

	for (let i = 0; i < count; i++) {
		const id = `t-reel-blur-${i}`;
		if (document.getElementById(id)) continue;

		const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
		filter.id = id;
		filter.setAttribute("x", "-20%");
		filter.setAttribute("y", "-40%");
		filter.setAttribute("width", "140%");
		filter.setAttribute("height", "180%");

		const blur = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"feGaussianBlur",
		);
		blur.setAttribute("in", "SourceGraphic");
		blur.setAttribute("stdDeviation", "0 0");
		filter.appendChild(blur);
		defs.appendChild(filter);
	}
}

function buildReel(reel: HTMLElement, value: string) {
	reel.replaceChildren();

	for (const ch of value) {
		if (ch < "0" || ch > "9") {
			const sep = document.createElement("span");
			sep.className = "t-reel-sep";
			sep.textContent = ch;
			reel.appendChild(sep);
			continue;
		}

		const digit = Number(ch);
		const col = document.createElement("span");
		col.className = "t-reel-col";

		const strip = document.createElement("span");
		strip.className = "t-reel-strip";

		const totalCells = REEL_SPINS * 10 + digit + 1;
		for (let n = 0; n < totalCells; n++) {
			const cell = document.createElement("span");
			cell.className = "t-reel-digit";
			cell.textContent = String(n % 10);
			strip.appendChild(cell);
		}

		strip.style.transform = "translateY(0)";
		col.appendChild(strip);
		reel.appendChild(col);
	}
}

function cellHeight(reel: HTMLElement) {
	const sample = reel.querySelector<HTMLElement>(".t-reel-digit");
	if (sample) return sample.getBoundingClientRect().height;

	const raw = getComputedStyle(reel).getPropertyValue("--reel-cell").trim();
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function readCssTime(value: string, fallbackMs: number) {
	const trimmed = value.trim();
	if (!trimmed) return fallbackMs;
	if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed) || fallbackMs;
	if (trimmed.endsWith("s")) return (Number.parseFloat(trimmed) || 0) * 1000 || fallbackMs;
	return Number.parseFloat(trimmed) || fallbackMs;
}

function decayBlur(
	blur: SVGFEGaussianBlurElement,
	fromY: number,
	durationMs: number,
	delayMs: number,
) {
	const startAt = performance.now() + delayMs;
	const endAt = startAt + durationMs;

	const tick = (now: number) => {
		if (now < startAt) {
			blur.setAttribute("stdDeviation", `0 ${fromY}`);
			requestAnimationFrame(tick);
			return;
		}

		const t = Math.min(1, (now - startAt) / durationMs);
		// Hold blur early, then ease out near landing
		const eased = 1 - (1 - t) ** 3;
		const y = fromY * (1 - eased);
		blur.setAttribute("stdDeviation", `0 ${y}`);

		if (now < endAt) requestAnimationFrame(tick);
		else blur.setAttribute("stdDeviation", "0 0");
	};

	requestAnimationFrame(tick);
}

function spinReel(reel: HTMLElement) {
	if (reel.dataset.spun === "true") return;
	reel.dataset.spun = "true";

	const styles = getComputedStyle(reel);
	const durationMs = readCssTime(styles.getPropertyValue("--reel-dur"), 1400);
	const staggerMs = readCssTime(styles.getPropertyValue("--reel-stagger"), 90);
	const spinBlur =
		Number.parseFloat(styles.getPropertyValue("--reel-spin-blur")) || 3;
	const ease =
		styles.getPropertyValue("--reel-ease").trim() ||
		"cubic-bezier(0.16, 1, 0.3, 1)";

	const cols = [...reel.querySelectorAll<HTMLElement>(".t-reel-col")];
	ensureBlurFilters(cols.length);
	const height = cellHeight(reel);

	// Force layout, then animate on next frame
	void reel.offsetHeight;

	cols.forEach((col, index) => {
		const strip = col.querySelector<HTMLElement>(".t-reel-strip");
		if (!strip) return;

		const offset = (strip.children.length - 1) * height;
		const delayMs = index * staggerMs;
		const filterId = `t-reel-blur-${index}`;
		const blur = document
			.getElementById(filterId)
			?.querySelector("feGaussianBlur") as SVGFEGaussianBlurElement | null;

		strip.style.filter = `url(#${filterId})`;
		strip.style.transition = `transform ${durationMs}ms ${ease} ${delayMs}ms`;

		if (blur) {
			blur.setAttribute("stdDeviation", `0 ${spinBlur}`);
			decayBlur(blur, spinBlur, durationMs, delayMs);
		}

		requestAnimationFrame(() => {
			strip.style.transform = `translateY(-${offset}px)`;
		});
	});
}

function showFinal(reel: HTMLElement, value: string) {
	reel.replaceChildren();
	reel.dataset.spun = "true";

	for (const ch of value) {
		if (ch < "0" || ch > "9") {
			const sep = document.createElement("span");
			sep.className = "t-reel-sep";
			sep.textContent = ch;
			reel.appendChild(sep);
			continue;
		}

		const col = document.createElement("span");
		col.className = "t-reel-col";
		const strip = document.createElement("span");
		strip.className = "t-reel-strip";
		const cell = document.createElement("span");
		cell.className = "t-reel-digit";
		cell.textContent = ch;
		strip.appendChild(cell);
		col.appendChild(strip);
		reel.appendChild(col);
	}
}

export function initSpinningReels(root: ParentNode = document) {
	const hosts = [
		...root.querySelectorAll<HTMLElement>(".race-result__time[data-result]"),
	];
	if (hosts.length === 0) return () => {};

	const reduced = prefersReducedMotion();

	for (const host of hosts) {
		const value = host.dataset.result ?? "";
		const reel = host.querySelector<HTMLElement>(".t-reel");
		if (!reel || !value) continue;

		if (reduced) {
			showFinal(reel, value);
			continue;
		}

		buildReel(reel, value);
	}

	if (reduced) return () => {};

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const module = entry.target as HTMLElement;
				const reel = module.querySelector<HTMLElement>(".t-reel");
				if (reel) spinReel(reel);
				observer.unobserve(module);
			}
		},
		{
			threshold: 0.45,
			rootMargin: "0px 0px -10% 0px",
		},
	);

	for (const host of hosts) {
		const reel = host.querySelector<HTMLElement>(".t-reel");
		const module = host.closest<HTMLElement>(".race-result") ?? host;
		if (reel && reel.dataset.spun !== "true") observer.observe(module);
	}

	return () => observer.disconnect();
}
