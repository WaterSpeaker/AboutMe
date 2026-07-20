#!/usr/bin/env node
/**
 * Sync Home photo gallery from Lark Base into src/data/photos.json.
 *
 * Prerequisites:
 *   lark-cli auth login --scope base:field:read,base:record:read,docs:document.media:download
 *
 * Usage:
 *   npm run sync:photos
 */

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BASE_TOKEN = "VLuDbpuWzaAhOKsLmz9m0qM7yie";
const TABLE_ID = "tblwbVBzDZJcFsur";
const VIEW_ID = "vewkYCwaeK";

const OUTPUT_JSON = join(ROOT, "src/data/photos.json");
const ASSETS_DIR = join(ROOT, "public/assets/photos");

const FIELD_CAPTION = "文本";
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

function main() {
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
			"\nAuthorize with:\n  lark-cli auth login --scope base:field:read,base:record:read,docs:document.media:download\nThen run:\n  npm run sync:photos",
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

	const photos = [];

	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (isEmptyRow(row)) continue;

		const record = rowToRecord(fields, row, recordIds[index]);
		const recordId = record.record_id;
		const caption = asText(record[FIELD_CAPTION]);
		const attachments = record[FIELD_IMAGE];

		if (!Array.isArray(attachments) || attachments.length === 0) {
			console.warn(`Skipping record ${recordId}: missing image.`);
			continue;
		}

		const file = attachments[0];
		const fileToken = file.file_token ?? file.token;
		if (!fileToken) {
			console.warn(`Skipping record ${recordId}: missing file token.`);
			continue;
		}

		const fileName = sanitizeFilename(file.name ?? `${recordId}-attachment`);
		const extension = extname(fileName) || ".jpg";
		const relativeOutputPath = `public/assets/photos/${recordId}${extension}`;

		try {
			downloadAttachment(fileToken, relativeOutputPath);
		} catch (error) {
			console.warn(`Failed to download image for ${recordId}:`, error.message);
			continue;
		}

		let width = 800;
		let height = 1200;
		try {
			const size = imageSize(readFileSync(join(ROOT, relativeOutputPath)));
			if (size.width && size.height) {
				width = size.width;
				height = size.height;
			}
		} catch (error) {
			console.warn(`Failed to read image size for ${recordId}:`, error.message);
		}

		photos.push({
			id: recordId,
			caption,
			src: `/assets/photos/${recordId}${extension}`,
			alt: caption || "照片",
			width,
			height,
		});
	}

	writeFileSync(OUTPUT_JSON, `${JSON.stringify(photos, null, "\t")}\n`, "utf8");
	console.log(`Synced ${photos.length} photos to ${OUTPUT_JSON}`);
}

main();
