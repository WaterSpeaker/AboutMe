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

function linkifyText(text: string): string {
	return text.replace(/https?:\/\/[^\s<>"'，。、！？；：）\]\}>]+/g, (raw) => {
		let url = raw;
		let trailing = "";
		while (/[),.;:!?]$/.test(url)) {
			trailing = `${url.slice(-1)}${trailing}`;
			url = url.slice(0, -1);
		}
		if (!url) return raw;
		return `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>${trailing}`;
	});
}

/** Turn bare http(s) URLs in HTML text nodes into clickable anchors. */
export function linkifyHtml(html: string): string {
	let result = "";
	let index = 0;

	while (index < html.length) {
		const rest = html.slice(index);
		const anchorOpen = rest.match(/^<a\b[^>]*>/i);
		if (anchorOpen) {
			const closeAt = html.toLowerCase().indexOf("</a>", index);
			if (closeAt === -1) {
				result += html.slice(index);
				break;
			}
			result += html.slice(index, closeAt + 4);
			index = closeAt + 4;
			continue;
		}

		if (html[index] === "<") {
			const end = html.indexOf(">", index);
			if (end === -1) {
				result += html.slice(index);
				break;
			}
			result += html.slice(index, end + 1);
			index = end + 1;
			continue;
		}

		let nextTag = html.indexOf("<", index);
		if (nextTag === -1) nextTag = html.length;
		result += linkifyText(html.slice(index, nextTag));
		index = nextTag;
	}

	return result;
}
