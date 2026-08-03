#!/usr/bin/env node
/**
 * Sync travel recommendations from Lark Base into src/data/travel-recommendations.json.
 *
 * Source:
 *   https://my.feishu.cn/wiki/QipFwO7LUidJEdknxaXchDZPngc?table=tbldlCF2vok0eB1G&view=vewNhBX7cO
 *
 * Prerequisites:
 *   lark-cli auth login --scope base:field:read,base:record:read
 *
 * Usage:
 *   npm run sync:travel-recs
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BASE_TOKEN = "R5Bhb4gyCa0B02s4Nulcu9bPnKh";
const TABLE_ID = "tbldlCF2vok0eB1G";
const VIEW_ID = "vewNhBX7cO";

const OUTPUT_JSON = join(ROOT, "src/data/travel-recommendations.json");

const FIELD_SUBMITTER = "提交人";
const FIELD_SUBMITTED_AT = "提交时间";
const FIELD_PLACE = "推荐的地方";
const FIELD_REASON = "推荐理由";

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

function asSubmitter(value) {
	if (!Array.isArray(value) || value.length === 0) {
		return { id: "", name: "" };
	}

	const person = value[0];
	if (!person || typeof person !== "object") {
		return { id: "", name: "" };
	}

	return {
		id: String(person.id ?? person.open_id ?? "").trim(),
		name: String(person.name ?? person.localized_name ?? "").trim(),
		...(person.avatar_url ? { avatarUrl: String(person.avatar_url) } : {}),
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
			"\nAuthorize with:\n  lark-cli auth login --scope base:field:read,base:record:read\nThen run:\n  npm run sync:travel-recs",
		);
		process.exit(1);
	}

	const payload = listResult.data ?? {};
	const fields = payload.fields ?? [];
	const rows = payload.data ?? [];
	const recordIds = payload.record_id_list ?? [];

	const recommendations = [];

	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (isEmptyRow(row)) continue;

		const record = rowToRecord(fields, row, recordIds[index]);
		const place = asText(record[FIELD_PLACE]);
		const reason = asText(record[FIELD_REASON]);
		const submitter = asSubmitter(record[FIELD_SUBMITTER]);
		const submittedAt = asText(record[FIELD_SUBMITTED_AT]);

		if (!place) {
			console.warn(`Skipping record ${record.record_id}: missing place.`);
			continue;
		}

		recommendations.push({
			id: record.record_id,
			place,
			reason,
			submitterName: submitter.name || "匿名",
			submitterId: submitter.id,
			...(submitter.avatarUrl ? { avatarUrl: submitter.avatarUrl } : {}),
			...(submittedAt ? { submittedAt } : {}),
		});
	}

	// Newest first when timestamps exist; otherwise keep view order reversed
	// so the latest submissions appear first in the gallery.
	recommendations.reverse();

	writeFileSync(
		OUTPUT_JSON,
		`${JSON.stringify(recommendations, null, "\t")}\n`,
		"utf8",
	);
	console.log(`Synced ${recommendations.length} recommendations to ${OUTPUT_JSON}`);
}

main();
