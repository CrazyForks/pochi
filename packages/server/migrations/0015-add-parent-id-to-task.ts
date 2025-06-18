import { type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .alterTable("task")
    .addColumn("parentId", "integer", (col) => col.references("task.id"))
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema
    .alterTable("task")
    .dropColumn("parentId")
    .execute();
}

