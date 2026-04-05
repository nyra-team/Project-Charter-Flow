import { db, activityTable, usersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

export async function logActivity(
  type: string,
  message: string,
  entityId: number,
  entityType: string,
  userId?: number
) {
  await db.insert(activityTable).values({ type, message, entityId, entityType, userId: userId ?? null });
}

export async function getRecentActivityWithUsers(limit = 20) {
  const items = await db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(limit);

  const userIds = [...new Set(items.filter(i => i.userId).map(i => i.userId!))];
  const users = userIds.length
    ? await db.select().from(usersTable).where(
        userIds.length === 1
          ? eq(usersTable.id, userIds[0])
          : (() => {
              const { inArray } = require("drizzle-orm");
              return inArray(usersTable.id, userIds);
            })()
      )
    : [];

  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

  return items.map(item => ({
    ...item,
    userName: item.userId ? userMap[item.userId] ?? null : null,
  }));
}
