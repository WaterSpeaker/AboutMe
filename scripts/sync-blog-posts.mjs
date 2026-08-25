#!/usr/bin/env node
/**
 * Sync Blog posts from Lark Base into local JSON + full article HTML/images.
 *
 * Base: each row's「文本」field is a markdown link to one article.
 * Cards are sorted by document create time (newest first).
 * Each article body is fetched from Feishu and rendered locally (like Kilimanjaro).
 *
 * Prerequisites:
 *   lark-cli auth login --scope base:field:read,base:record:read,docs:document.media:download,search:docs:read
 *
 * Usage:
 *   npm run sync:blog
 */

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BASE_TOKEN = "GbUBbi7KsaGHrCsoNHhmcBlgyTb";
const TABLE_ID = "tblM0PgUBRxwCn4D";
const VIEW_ID = "vewh9rWkNR";
const FIELD_LINK = "文本";

const OUTPUT_JSON = join(ROOT, "src/data/blog-posts.json");
const BODIES_DIR = join(ROOT, "src/data/blog-bodies");
const ASSETS_ROOT = join(ROOT, "public/blog");

/** Prefer stable, readable slugs for known docs. */
const SLUG_BY_TOKEN = {
	RTKRdwyPuo1WWRxCyL7lUmPjgsf: "kilimanjaro",
	T9HEd9sBio0PvDxecjtlEheJgEg: "lost-satellites",
	Aso2dqH3Yoi4TzxwEX9l3FvfgMe: "nepal-abc",
	LIb0d3aK5oEKKjxd3MPl2ZOBgfp: "kamchatka",
	SKMWd3RBpoovYcxX6tClsw6Wgcf: "douyin-ai-volunteer",
	QQICwymUDiedizkb09jc292pnlh: "emei-night-hike",
	JjHDdXuw1o0v8pxtUfncwmSLnOI: "earring-board",
	LP23dwxnyoc2KSxCC6Ilmus2gEh: "pull-ups",
	EAsDdk6JioVAdAxFvU1lehzrgsd: "sponsor-a-child",
	HLxDdtW9uosmulx6Xv9lHLw2gGf: "half-marathon",
	BtUsdBRJXo3bbZxlq5ElTXtkgFb: "trail-running",
	KQXJdpTK7oZFH0xXKcIlTHOFgFg: "life-fragments",
	D5JXd5MbKo75GWxo5AdmVUaJy2e: "vibe-coding",
	DiVAdTeofoWjxVxciZOmTEiryGc: "vibe-coding-asset-plan",
};

/** Manual cover overrides (kept across sync; not wiped with article media). */
const COVER_BY_SLUG = {
	"vibe-coding-asset-plan": {
		cover: "/blog/vibe-coding-asset-plan/cover.jpg",
		coverAlt: "资产配置看板截图：净资产结构与金融资产分布",
	},
};

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/;
const TOKEN_RE = /\/(?:docx|wiki|doc|docs)\/([A-Za-z0-9]+)/;

function runLark(args) {
	try {
		const output = execFileSync("lark-cli", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			maxBuffer: 32 * 1024 * 1024,
		});
		return JSON.parse(output);
	} catch (error) {
		const message = error.stderr?.trim() || error.stdout?.trim() || error.message;
		try {
			return JSON.parse(message);
		} catch {
			throw new Error(message);
		}
	}
}

function sleep(ms) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		/* sync throttle for Lark rate limits */
	}
}

function asText(value) {
	if (value == null) return "";
	if (typeof value === "string") return value.trim();
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === "string") return item;
				if (item && typeof item === "object" && "text" in item) {
					return String(item.text ?? "");
				}
				return "";
			})
			.filter(Boolean)
			.join("\n")
			.trim();
	}
	if (typeof value === "object" && "text" in value) {
		return String(value.text ?? "").trim();
	}
	return String(value).trim();
}

function rowToRecord(fields, row, recordId) {
	const record = { record_id: recordId };
	for (let index = 0; index < fields.length; index += 1) {
		record[fields[index]] = row[index];
	}
	return record;
}

function parseLink(cell) {
	const text = asText(cell);
	const match = LINK_RE.exec(text);
	if (!match) return null;
	return { title: match[1].trim(), url: match[2].trim() };
}

function extractToken(url) {
	const match = TOKEN_RE.exec(url);
	return match?.[1] ?? null;
}

function makeSlug(title, token, recordId) {
	if (token && SLUG_BY_TOKEN[token]) return SLUG_BY_TOKEN[token];

	const ascii = title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\x00-\x7F]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	if (ascii.length >= 4) return ascii;
	if (token) return token.slice(0, 12).toLowerCase();
	return recordId.replace(/^rec/i, "").toLowerCase();
}

function formatDate(isoOrUnix) {
	if (!isoOrUnix) return "";
	if (typeof isoOrUnix === "number") {
		const d = new Date(isoOrUnix * 1000);
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, "0");
		return `${y}-${m}`;
	}
	const match = String(isoOrUnix).match(/^(\d{4})-(\d{2})/);
	return match ? `${match[1]}-${match[2]}` : String(isoOrUnix).slice(0, 7);
}

function stripHtml(value) {
	return String(value)
		.replace(/<\/?h>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.trim();
}

function decodeEntities(value) {
	return String(value)
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ");
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function getAttr(attrs, name) {
	const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
	return match ? decodeEntities(match[1]) : "";
}

function lookupCreateTime(title, token) {
	const result = runLark([
		"drive",
		"+search",
		"--query",
		title.slice(0, 40),
		"--as",
		"user",
	]);

	if (!result.ok) {
		throw new Error(result.error?.message ?? "drive search failed");
	}

	const results = result.data?.results ?? [];
	for (const item of results) {
		const meta = item.result_meta ?? {};
		if (token && (meta.token === token || String(meta.url ?? "").includes(token))) {
			return {
				createdAt: meta.create_time ?? null,
				createdAtIso: meta.create_time_iso ?? null,
			};
		}
	}

	for (const item of results) {
		const meta = item.result_meta ?? {};
		const plain = stripHtml(item.title_highlighted ?? "");
		if (plain && (title.includes(plain.slice(0, 8)) || plain.includes(title.slice(0, 8)))) {
			return {
				createdAt: meta.create_time ?? null,
				createdAtIso: meta.create_time_iso ?? null,
			};
		}
	}

	return { createdAt: null, createdAtIso: null };
}

function fetchDocXml(url) {
	const result = runLark([
		"docs",
		"+fetch",
		"--api-version",
		"v2",
		"--doc",
		url,
		"--doc-format",
		"xml",
		"--detail",
		"full",
		"--as",
		"user",
	]);

	if (!result.ok) {
		return { content: "", error: result.error?.message ?? "fetch failed" };
	}

	return { content: result.data?.document?.content ?? "", error: null };
}

function extractImageTokens(xml) {
	const tokens = [];
	const seen = new Set();
	for (const match of xml.matchAll(/<img\b([^>]*)\/?>/gi)) {
		const src = getAttr(match[1], "src");
		if (src && !seen.has(src)) {
			seen.add(src);
			tokens.push(src);
		}
	}
	return tokens;
}

function extractVideoTokens(xml) {
	const tokens = [];
	const seen = new Set();
	for (const match of xml.matchAll(/<source\b([^>]*)\/?>/gi)) {
		const token = getAttr(match[1], "token") || getAttr(match[1], "src");
		const mime = getAttr(match[1], "mime");
		if (token && !seen.has(token) && (!mime || mime.startsWith("video/"))) {
			seen.add(token);
			tokens.push(token);
		}
	}
	return tokens;
}

function compressImageIfNeeded(savedPath, dir, basename) {
	try {
		const stats = execFileSync("stat", ["-f%z", savedPath], { encoding: "utf8" }).trim();
		const size = Number(stats);
		if (!Number.isFinite(size) || size <= 800_000) return savedPath;

		const jpgPath = join(dir, `${basename}.jpg`);
		const tempPath = join("/tmp", `blog-img-${basename}`);
		execFileSync("sips", ["-Z", "1600", savedPath, "--out", tempPath], {
			stdio: "ignore",
		});
		execFileSync(
			"sips",
			["-s", "format", "jpeg", "-s", "formatOptions", "82", tempPath, "--out", jpgPath],
			{ stdio: "ignore" },
		);
		if (savedPath !== jpgPath && existsSync(savedPath)) {
			rmSync(savedPath, { force: true });
		}
		return jpgPath;
	} catch {
		return savedPath;
	}
}

function downloadMedia(fileToken, outputDir, basename, { compress = true } = {}) {
	mkdirSync(outputDir, { recursive: true });
	const relativeBase = relative(ROOT, join(outputDir, basename));
	const result = runLark([
		"docs",
		"+media-download",
		"--token",
		fileToken,
		"--output",
		`./${relativeBase}`,
		"--as",
		"user",
	]);

	if (!result.ok) {
		throw new Error(result.error?.message ?? "media download failed");
	}

	const saved = result.data?.saved_path;
	if (!saved) throw new Error("media download returned no path");
	if (!compress) return saved;
	if (!/\.(png|jpe?g|webp|gif|heic)$/i.test(saved)) return saved;
	return compressImageIfNeeded(saved, outputDir, basename);
}

function extractDescriptionFromXml(xml, title) {
	const withoutTitle = xml.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "");
	const paragraphs = [...withoutTitle.matchAll(/<(?:p|blockquote)[^>]*>([\s\S]*?)<\/(?:p|blockquote)>/gi)]
		.map((match) =>
			decodeEntities(match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()),
		)
		.filter(Boolean);

	for (const line of paragraphs) {
		if (title && line === title) continue;
		if (line.length < 12) continue;
		if (/^地址[:：]/u.test(line)) continue;
		if (/^https?:\/\//i.test(line)) continue;
		return line.length > 120 ? `${line.slice(0, 118)}…` : line;
	}
	return "";
}

function extractLead(xml) {
	const withoutTitle = xml.replace(/<title[^>]*>[\s\S]*?<\/title>/i, "").trim();
	const match = withoutTitle.match(
		/^<blockquote[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/blockquote>/i,
	);
	if (!match) return "";
	return decodeEntities(match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function renderCiteLink(attrs, innerText) {
	const title = getAttr(attrs, "title") || innerText || "文档";
	const docId =
		getAttr(attrs, "doc-id") ||
		getAttr(attrs, "token") ||
		getAttr(attrs, "file-token");
	const fileType = (getAttr(attrs, "file-type") || "docx").toLowerCase();

	if (!docId) return escapeHtml(title);

	const path =
		fileType === "wiki"
			? "wiki"
			: fileType === "docx" || fileType === "doc"
				? "docx"
				: fileType === "sheet" || fileType === "sheets"
					? "sheets"
					: fileType === "bitable" || fileType === "base"
						? "base"
						: "docx";

	const href = `https://bytedance.larkoffice.com/${path}/${docId}`;
	return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(title)}</a>`;
}

function linkifyText(text) {
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

function linkifyHtml(html) {
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

function transformDocXml(xml, imageMap) {
	let html = xml;

	html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "");

	// Self-closing / paired cite → clickable Feishu doc links
	html = html.replace(/<cite\b([^>]*)\/>/gi, (_, attrs) => renderCiteLink(attrs, ""));
	html = html.replace(/<cite\b([^>]*)>([\s\S]*?)<\/cite>/gi, (_, attrs, inner) => {
		const text = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
		return renderCiteLink(attrs, text);
	});

	html = html.replace(/<img\b([^>]*)\/?>/gi, (_, attrs) => {
		const src = getAttr(attrs, "src");
		const alt = getAttr(attrs, "alt") || "";
		const caption = getAttr(attrs, "caption").replace(/\s+/g, " ").trim();
		const local = imageMap[src];
		if (!local) return "";
		const cap = caption
			? `<figcaption>${escapeHtml(caption)}</figcaption>`
			: "";
		return `<figure class="media"><img src="${local}" alt="${escapeHtml(alt)}" loading="lazy" />${cap}</figure>`;
	});

	// Feishu video blocks: <figure ...><source token="..." mime="video/..." /></figure>
	html = html.replace(
		/<figure\b([^>]*)>\s*<source\b([^>]*)\/?>\s*<\/figure>/gi,
		(_, _figureAttrs, sourceAttrs) => {
			const token = getAttr(sourceAttrs, "token") || getAttr(sourceAttrs, "src");
			const local = imageMap[token];
			if (!local) return "";
			return `<figure class="media media-video"><video controls playsinline preload="metadata" src="${local}"></video></figure>`;
		},
	);

	html = html.replace(/<grid\b[^>]*>/gi, '<div class="media-row">');
	html = html.replace(/<\/grid>/gi, "</div>");

	html = html.replace(/<column\b([^>]*)>/gi, (_, attrs) => {
		const ratio = Number.parseFloat(getAttr(attrs, "width-ratio") || "0.5");
		const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 0.5;
		return `<div class="media-col" style="flex:${safe} 1 0;max-width:${Math.round(safe * 100)}%">`;
	});
	html = html.replace(/<\/column>/gi, "</div>");

	html = html.replace(/<h1\b[^>]*>/gi, "<h2>");
	html = html.replace(/<\/h1>/gi, "</h2>");
	html = html.replace(/<h2\b[^>]*>/gi, "<h2>");
	html = html.replace(/<h3\b[^>]*>/gi, "<h3>");
	html = html.replace(/<h4\b[^>]*>/gi, "<h3>");
	html = html.replace(/<\/h4>/gi, "</h3>");

	html = html.replace(/<(p|blockquote|ul|ol|li|b|i|strong|em|u)\b[^>]*>/gi, "<$1>");
	html = html.replace(/<p>\s*<\/p>/gi, "");

	// Drop leftover unknown wrappers that might leak
	html = html.replace(/<\/?(?:sheet|bitable|synced_reference|whiteboard)\b[^>]*\/?>/gi, "");

	return linkifyHtml(html.trim());
}

function syncArticleBody(slug, url) {
	const fetched = fetchDocXml(url);
	if (fetched.error) {
		throw new Error(fetched.error);
	}

	const xml = fetched.content;
	const assetDir = join(ASSETS_ROOT, slug);
	const preservedCovers = [];
	if (existsSync(assetDir)) {
		for (const name of readdirSync(assetDir)) {
			if (/^cover\./i.test(name)) {
				const from = join(assetDir, name);
				const tmp = join("/tmp", `blog-cover-${slug}-${name}`);
				execFileSync("cp", [from, tmp]);
				preservedCovers.push({ name, tmp });
			}
		}
		rmSync(assetDir, { recursive: true, force: true });
	}
	mkdirSync(assetDir, { recursive: true });
	for (const item of preservedCovers) {
		execFileSync("cp", [item.tmp, join(assetDir, item.name)]);
		rmSync(item.tmp, { force: true });
	}

	const tokens = extractImageTokens(xml);
	const videoTokens = extractVideoTokens(xml);
	const imageMap = {};

	tokens.forEach((fileToken, index) => {
		const basename = String(index + 1).padStart(2, "0");
		try {
			console.log(`    image ${basename}/${String(tokens.length).padStart(2, "0")}`);
			const saved = downloadMedia(fileToken, assetDir, basename);
			const fileName = saved.split(/[/\\]/).pop();
			imageMap[fileToken] = `/blog/${slug}/${fileName}`;
			sleep(150);
		} catch (error) {
			console.warn(`    image ${basename} failed: ${error.message}`);
		}
	});

	videoTokens.forEach((fileToken, index) => {
		const basename = `video${videoTokens.length > 1 ? `-${String(index + 1).padStart(2, "0")}` : ""}`;
		try {
			console.log(`    video ${index + 1}/${videoTokens.length}`);
			const saved = downloadMedia(fileToken, assetDir, basename, { compress: false });
			let finalPath = saved;
			// Prefer a browser-friendly mp4 when source is QuickTime.
			if (/\.mov$/i.test(saved)) {
				const mp4Path = join(assetDir, `${basename}.mp4`);
				try {
					execFileSync(
						"avconvert",
						[
							"--source",
							saved,
							"--preset",
							"Preset960x540",
							"--output",
							mp4Path,
							"--replace",
						],
						{ stdio: "ignore" },
					);
					if (existsSync(mp4Path)) {
						rmSync(saved, { force: true });
						finalPath = mp4Path;
					}
				} catch {
					finalPath = saved;
				}
			}
			const fileName = finalPath.split(/[/\\]/).pop();
			imageMap[fileToken] = `/blog/${slug}/${fileName}`;
			sleep(150);
		} catch (error) {
			console.warn(`    video ${index + 1} failed: ${error.message}`);
		}
	});

	const bodyHtml = transformDocXml(xml, imageMap);
	const lead = extractLead(xml);
	const description = extractDescriptionFromXml(xml, "");
	const cover = Object.values(imageMap)[0] ?? "";

	mkdirSync(BODIES_DIR, { recursive: true });
	writeFileSync(join(BODIES_DIR, `${slug}.html`), `${bodyHtml}\n`, "utf8");

	return { bodyHtml, lead, description, cover, imageCount: tokens.length };
}

async function main() {
	const listResult = runLark([
		"base",
		"+record-list",
		"--base-token",
		BASE_TOKEN,
		"--table-id",
		TABLE_ID,
		"--view-id",
		VIEW_ID,
		"--limit",
		"200",
		"--format",
		"json",
		"--as",
		"user",
	]);

	if (!listResult.ok) {
		const hint = listResult.error?.hint ?? listResult.error?.message ?? "Unknown error";
		console.error("Failed to read Lark Base records.");
		console.error(hint);
		console.error(
			"\nAuthorize with:\n  lark-cli auth login --scope base:field:read,base:record:read,docs:document.media:download,search:docs:read\nThen run:\n  npm run sync:blog",
		);
		process.exit(1);
	}

	const payload = listResult.data ?? {};
	const fields = payload.fields ?? [];
	const rows = payload.data ?? [];
	const recordIds = payload.record_id_list ?? [];

	if (existsSync(BODIES_DIR)) {
		rmSync(BODIES_DIR, { recursive: true, force: true });
	}
	mkdirSync(BODIES_DIR, { recursive: true });
	mkdirSync(ASSETS_ROOT, { recursive: true });

	// Keep covers/ if present from older syncs, but article assets live under /blog/{slug}
	const posts = [];

	for (let index = 0; index < rows.length; index += 1) {
		const record = rowToRecord(fields, rows[index], recordIds[index]);
		const recordId = record.record_id;
		const parsed = parseLink(record[FIELD_LINK]);

		if (!parsed) {
			console.warn(`Skipping ${recordId}: no markdown link in「${FIELD_LINK}」`);
			continue;
		}

		const { title, url } = parsed;
		const token = extractToken(url);
		const slug = makeSlug(title, token, recordId);

		console.log(`→ ${title}`);

		let createdAt = null;
		let createdAtIso = null;
		try {
			const meta = lookupCreateTime(title, token);
			createdAt = meta.createdAt;
			createdAtIso = meta.createdAtIso;
			sleep(300);
		} catch (error) {
			console.warn(`  create time lookup failed: ${error.message}`);
		}

		let lead = "";
		let description = "";
		let cover = "";
		let coverAlt = title;

		try {
			const synced = syncArticleBody(slug, url);
			lead = synced.lead;
			description = synced.description || lead || "阅读全文。";
			cover = synced.cover;
			console.log(`  synced body + ${synced.imageCount} images`);
			sleep(200);
		} catch (error) {
			console.warn(`  body sync failed: ${error.message}`);
			description = "阅读全文。";
		}

		if (slug === "kilimanjaro" && cover) {
			coverAlt = "乞力马扎罗山顶的碟状云";
		}

		const coverOverride = COVER_BY_SLUG[slug];
		if (coverOverride) {
			cover = coverOverride.cover;
			coverAlt = coverOverride.coverAlt || coverAlt;
		}

		posts.push({
			slug,
			title,
			description,
			lead,
			date: formatDate(createdAtIso ?? createdAt),
			createdAt: createdAt ?? 0,
			createdAtIso: createdAtIso ?? "",
			cover,
			coverAlt,
			sourceUrl: url,
			recordId,
			token: token ?? "",
			bodyPath: `blog-bodies/${slug}.html`,
		});
	}

	posts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

	writeFileSync(OUTPUT_JSON, `${JSON.stringify(posts, null, "\t")}\n`, "utf8");
	console.log(`\nSynced ${posts.length} posts → ${OUTPUT_JSON}`);
	console.log("Order (newest first):");
	for (const post of posts) {
		console.log(`  ${post.createdAtIso || "?"}  ${post.title}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
