export async function getRecord(db, date) {
	const row = await db.prepare("SELECT version,payload,updated_at FROM records WHERE date=?").bind(date).first();
	return row ? { ...JSON.parse(row.payload), version: row.version, updated_at: row.updated_at } : null;
}

export async function putRecord(db, date, payload, expectedVersion) {
	if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
		throw new TypeError("expectedVersion 必须是非负整数");
	}
	const version = expectedVersion + 1;
	const updatedAt = new Date().toISOString();
	const [write] = await db.batch([
		db.prepare(`INSERT INTO records(date,version,payload,updated_at)
			SELECT ?,?,?,? WHERE ?=0 OR EXISTS (SELECT 1 FROM records WHERE date=? AND version=?)
			ON CONFLICT(date) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at
			WHERE records.version=?`).bind(date, version, JSON.stringify(payload), updatedAt, expectedVersion, date, expectedVersion, expectedVersion),
		db.prepare(`INSERT INTO sync_changes(date,version,changed_at)
			SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM records WHERE date=? AND version=?)
			AND NOT EXISTS (SELECT 1 FROM sync_changes WHERE date=? AND version=?)`).bind(date, version, updatedAt, date, version, date, version),
	]);
	if (!write?.meta?.changes) {
		const current = await db.prepare("SELECT version FROM records WHERE date=?").bind(date).first();
		return { conflict: true, version: current?.version || 0 };
	}
	return { version, updated_at: updatedAt };
}
