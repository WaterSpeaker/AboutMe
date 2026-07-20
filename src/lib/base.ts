/** Prefix a root-absolute path with Astro `base` (e.g. `/AboutMe/`). */
export function withBase(path: string): string {
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

/** Rewrite root-absolute `src` / `href` attributes inside HTML for the site base. */
export function withBaseInHtml(html: string): string {
	const base = import.meta.env.BASE_URL;
	if (base === "/") return html;

	return html.replace(
		/\b(src|href)=(["'])\/(?!\/)/gi,
		(_match, attr: string, quote: string) => `${attr}=${quote}${base}`,
	);
}
