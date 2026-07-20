#!/usr/bin/env node
/**
 * Sync travel city markers from Lark Base into src/data/travel-cities.json.
 *
 * Prerequisites:
 *   lark-cli auth login --scope base:field:read,base:record:read,docs:document.media:download
 *
 * Usage:
 *   npm run sync:travel
 */

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BASE_TOKEN = "H8vCbSjSRauWKasobBfmPSMayCs";
const TABLE_ID = "tblHArLKLswyfGgn";
const VIEW_ID = "vew4u0nhGv";

const OUTPUT_JSON = join(ROOT, "src/data/travel-cities.json");
const ASSETS_DIR = join(ROOT, "public/assets/travel");

const FIELD_CITY = "城市";
const FIELD_COUNTRY = "国家";
const FIELD_DESCRIPTION = "描述";
const FIELD_LINK = "链接";
const FIELD_IMAGE = "图片";

function runLark(args) {
	try {
		const output = execFileSync("lark-cli", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return JSON.parse(output);
	} catch (error) {
		const message = error.stderr?.trim() || error.stdout?.trim() || error.message;
		try {
			return JSON.parse(message);
		} catch {
			throw error;
		}
	}
}

function asText(value) {
	if (value == null) return "";
	if (typeof value === "string") return value.trim();
	if (typeof value === "number") return String(value);
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

function sanitizeFilename(name) {
	return name.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
}

function downloadAttachment(fileToken, relativeOutputPath) {
	runLark([
		"docs",
		"+media-download",
		"--token",
		fileToken,
		"--output",
		relativeOutputPath,
		"--as",
		"user",
	]);
}

const COUNTRY_ALIASES = {
	中国: "China",
	坦桑尼亚: "Tanzania",
	Netherland: "Netherlands",
	Netherlands: "Netherlands",
};

const CITY_ALIASES = {
	上虞: "Shangyu",
	阿鲁沙: "Arusha",
	Moshi: "Moshi",
};

async function geocodePlace(city, country) {
	const englishCountry = COUNTRY_ALIASES[country] ?? country;
	const englishCity = city ? (CITY_ALIASES[city] ?? city) : "";

	// 城市为空时，落点到国家中心。
	if (!englishCity) {
		if (!englishCountry) {
			throw new Error("Missing country for country-center geocoding");
		}

		const url = new URL("https://nominatim.openstreetmap.org/search");
		url.searchParams.set("country", englishCountry);
		url.searchParams.set("format", "json");
		url.searchParams.set("limit", "1");
		url.searchParams.set("featuretype", "country");

		const response = await fetch(url, {
			headers: {
				"User-Agent": "PodcastTravelSite/1.0 (personal website sync)",
				"Accept-Language": "zh-CN,en",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Country geocoding failed for "${englishCountry}": HTTP ${response.status}`,
			);
		}

		const results = await response.json();
		if (!Array.isArray(results) || results.length === 0) {
			throw new Error(`No country center found for "${englishCountry}"`);
		}

		return {
			lng: Number(results[0].lon),
			lat: Number(results[0].lat),
		};
	}

	const query = [englishCity, englishCountry].filter(Boolean).join(", ");
	const url = new URL("https://nominatim.openstreetmap.org/search");
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");
	url.searchParams.set("limit", "1");

	const response = await fetch(url, {
		headers: {
			"User-Agent": "PodcastTravelSite/1.0 (personal website sync)",
			"Accept-Language": "zh-CN,en",
		},
	});

	if (!response.ok) {
		throw new Error(`Geocoding failed for "${query}": HTTP ${response.status}`);
	}

	const results = await response.json();
	if (!Array.isArray(results) || results.length === 0) {
		throw new Error(`No coordinates found for "${query}"`);
	}

	return {
		lng: Number(results[0].lon),
		lat: Number(results[0].lat),
	};
}

function rowToRecord(fields, row, recordId) {
	const record = { record_id: recordId };

	for (let index = 0; index < fields.length; index += 1) {
		record[fields[index]] = row[index];
	}

	return record;
}

function isEmptyRow(row) {
	return row.every((cell) => {
		if (cell == null) return true;
		if (typeof cell === "string") return cell.trim() === "";
		if (Array.isArray(cell)) return cell.length === 0;
		return false;
	});
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
			"\nAuthorize with:\n  lark-cli auth login --scope base:field:read,base:record:read,docs:document.media:download\nThen run:\n  npm run sync:travel",
		);
		process.exit(1);
	}

	const payload = listResult.data ?? {};
	const fields = payload.fields ?? [];
	const rows = payload.data ?? [];
	const recordIds = payload.record_id_list ?? [];

	if (existsSync(ASSETS_DIR)) {
		rmSync(ASSETS_DIR, { recursive: true, force: true });
	}
	mkdirSync(ASSETS_DIR, { recursive: true });

	const cities = [];

	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (isEmptyRow(row)) continue;

		const record = rowToRecord(fields, row, recordIds[index]);
		const recordId = record.record_id;
		const city = asText(record[FIELD_CITY]);
		const country = asText(record[FIELD_COUNTRY]);
		const description = asText(record[FIELD_DESCRIPTION]);
		const link = asText(record[FIELD_LINK]);

		if (!country) {
			console.warn(`Skipping record ${recordId}: missing country.`);
			continue;
		}

		let location;
		try {
			location = await geocodePlace(city, country);
			if (!city) {
				console.log(`Record ${recordId}: city empty, using country center of "${country}".`);
			}
			// Nominatim usage policy: max 1 request per second.
			await new Promise((resolve) => setTimeout(resolve, 1100));
		} catch (error) {
			console.warn(`Skipping record ${recordId}: ${error.message}`);
			continue;
		}

		let attachmentUrl = "";
		const attachments = record[FIELD_IMAGE];
		if (Array.isArray(attachments) && attachments.length > 0) {
			const file = attachments[0];
			const fileToken = file.file_token ?? file.token;
			const fileName = sanitizeFilename(file.name ?? `${recordId}-attachment`);
			const extension = extname(fileName) || ".jpg";
			const relativeOutputPath = `public/assets/travel/${recordId}${extension}`;

			if (fileToken) {
				try {
					downloadAttachment(fileToken, relativeOutputPath);
					attachmentUrl = `/assets/travel/${recordId}${extension}`;
				} catch (error) {
					console.warn(`Failed to download image for ${recordId}:`, error.message);
				}
			}
		}

		cities.push({
			id: recordId,
			city,
			country,
			lng: location.lng,
			lat: location.lat,
			description,
			...(link ? { link } : {}),
			...(attachmentUrl ? { attachmentUrl } : {}),
		});
	}

	writeFileSync(OUTPUT_JSON, `${JSON.stringify(cities, null, "\t")}\n`, "utf8");
	console.log(`Synced ${cities.length} cities to ${OUTPUT_JSON}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
