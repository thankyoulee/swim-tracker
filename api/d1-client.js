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
	
	// 1. 先查询当前最新版本（检查冲突）
	const currentRow = await db.prepare("SELECT version FROM records WHERE date=?").bind(date).first();
	const currentVersion = currentRow ? currentRow.version : 0;
	
	// 2. 版本不一致，发生冲突
	if (currentVersion !== expectedVersion) {
		return { conflict: true, version: currentVersion };
	}
	
	// 3. 写入或更新数据
	if (currentVersion === 0) {
		await db.prepare("INSERT INTO records(date,version,payload,updated_at) VALUES(?,?,?,?)")
            .bind(date, version, JSON.stringify(payload), updatedAt).run();
	} else {
		await db.prepare("UPDATE records SET version=?, payload=?, updated_at=? WHERE date=?")
            .bind(version, JSON.stringify(payload), updatedAt, date).run();
	}
	
	// 4. 记录同步日志
	await db.prepare("INSERT INTO sync_changes(date,version,changed_at) VALUES(?,?,?)")
        .bind(date, version, updatedAt).run();
	
	return { version, updated_at: updatedAt };
}