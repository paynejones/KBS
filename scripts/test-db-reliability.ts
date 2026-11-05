import "dotenv/config";
import assert from "node:assert/strict";
import path from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

function makeRequest(pathname: string, method: string, body?: unknown) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

async function expectFailure<T>(action: () => Promise<T>): Promise<T> {
  const originalConsoleError = console.error;
  try {
    console.error = () => undefined;
    return await action();
  } finally {
    console.error = originalConsoleError;
  }
}

async function waitForDatabaseConnectionsToClose(admin: Client, databaseName: string) {
  const timeoutAt = Date.now() + 10_000;

  while (Date.now() < timeoutAt) {
    const result = await admin.query<{ connections: string }>(
      "SELECT count(*)::text AS connections FROM pg_stat_activity WHERE datname = $1",
      [databaseName],
    );

    if (Number(result.rows[0]?.connections ?? 0) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for connections to temporary database ${databaseName} to close.`);
}

async function main() {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error("DATABASE_URL is required to run database integration checks.");

  const testDatabaseName = `kbs_reliability_test_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(configuredUrl);
  adminUrl.pathname = "/postgres";
  const testUrl = new URL(configuredUrl);
  testUrl.pathname = `/${testDatabaseName}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  let databaseCreated = false;
  let applicationPool: Pool | undefined;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`);
    databaseCreated = true;

    const migrationPool = new Pool({ connectionString: testUrl.toString() });
    try {
      await migrate(drizzle({ client: migrationPool }), {
        migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      });
    } finally {
      await migrationPool.end();
    }

    process.env.DATABASE_URL = testUrl.toString();
    const [
      { db, pool },
      { pages, databases, databaseRecords, databaseRecordRelations },
      { POST: createDatabase },
      { GET: getDatabase, DELETE: deleteDatabase },
      { POST: createProperty },
      { POST: createRecord },
      { PATCH: updateRecord, DELETE: deleteRecord },
      { POST: createView },
      { PATCH: updateView },
      { POST: createTemplate },
    ] = await Promise.all([
      import("../src/db"),
      import("../src/db/schema"),
      import("../src/app/api/databases/route"),
      import("../src/app/api/databases/[id]/route"),
      import("../src/app/api/databases/[id]/properties/route"),
      import("../src/app/api/databases/[id]/records/route"),
      import("../src/app/api/databases/[id]/records/[recordId]/route"),
      import("../src/app/api/databases/[id]/views/route"),
      import("../src/app/api/databases/[id]/views/[viewId]/route"),
      import("../src/app/api/databases/[id]/templates/route"),
      import("../src/app/api/pages/[id]/route"),
    ]);
    applicationPool = pool;
    const {
      GET: getPage,
      PATCH: updatePage,
      DELETE: deletePage,
    } = await import("../src/app/api/pages/[id]/route");
    const { POST: createPage } = await import("../src/app/api/pages/route");
    const { GET: listPages } = await import("../src/app/api/pages/route");
    const { GET: getPageTags } = await import("../src/app/api/pages/[id]/tags/route");
    const { POST: assignTag } = await import("../src/app/api/pages/[id]/tags/route");
    const { POST: createTag } = await import("../src/app/api/tags/route");
    const { GET: search } = await import("../src/app/api/search/route");
    const { GET: listTrash } = await import("../src/app/api/trash/route");
    const { POST: restoreTrashPage } = await import("../src/app/api/trash/[id]/restore/route");
    const { DELETE: purgeTrashPage } = await import("../src/app/api/trash/[id]/route");
    const { GET: exportWorkspace } = await import("../src/app/api/export/route");

    assert.equal((await listPages(makeRequest("/api/pages?tagId=invalid", "GET"))).status, 400,
      "page listing should reject malformed tag filters");
    assert.equal((await getPageTags(makeRequest("/api/pages/invalid/tags", "GET"), routeContext({ id: "invalid" }))).status, 400,
      "page tag routes should reject malformed page IDs");

    const pageCreateResponse = await createPage(makeRequest("/api/pages", "POST", {
      title: "Smoke searchable page",
      content: "An isolated browser-flow marker",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "An isolated browser-flow marker" }] }] },
    }));
    assert.equal(pageCreateResponse.status, 201);
    const smokePage = await pageCreateResponse.json() as { id: string; title: string };
    const smokePageContext = routeContext({ id: smokePage.id });

    const smokePatchResponse = await updatePage(makeRequest(`/api/pages/${smokePage.id}`, "PATCH", {
      title: "Smoke updated page",
      isFavorite: true,
    }), smokePageContext);
    assert.equal(smokePatchResponse.status, 200, "page edits and favorite changes should persist");

    const createdTagResponse = await createTag(makeRequest("/api/tags", "POST", { name: "Smoke test tag" }));
    assert.equal(createdTagResponse.status, 201);
    const smokeTag = await createdTagResponse.json() as { id: string };
    assert.equal((await assignTag(makeRequest(`/api/pages/${smokePage.id}/tags`, "POST", { tagId: smokeTag.id }), smokePageContext)).status, 200);

    const taggedPagesResponse = await listPages(makeRequest(`/api/pages?tagId=${smokeTag.id}`, "GET"));
    const taggedPages = await taggedPagesResponse.json() as { id: string; title: string; tags: { id: string }[] }[];
    assert.ok(taggedPages.some((page) => page.id === smokePage.id && page.tags.some((tag) => tag.id === smokeTag.id)),
      "page list should return pages filtered by tag with tag metadata");

    const favoritePagesResponse = await listPages(makeRequest("/api/pages?favorite=true", "GET"));
    const favoritePages = await favoritePagesResponse.json() as { id: string }[];
    assert.ok(favoritePages.some((page) => page.id === smokePage.id), "favorites filter should include the edited page");

    const smokeSearchResponse = await search(makeRequest("/api/search?q=browser-flow%20marker", "GET"));
    const smokeSearch = await smokeSearchResponse.json() as { pages: { id: string }[] };
    assert.ok(smokeSearch.pages.some((page) => page.id === smokePage.id), "global search should find page content");

    const smokePageReloadResponse = await getPage(makeRequest(`/api/pages/${smokePage.id}`, "GET"), smokePageContext);
    const reloadedSmokePage = await smokePageReloadResponse.json() as { title: string; content: string; isFavorite: boolean };
    assert.equal(reloadedSmokePage.title, "Smoke updated page");
    assert.equal(reloadedSmokePage.content, "An isolated browser-flow marker");
    assert.equal(reloadedSmokePage.isFavorite, true);

    assert.equal((await deletePage(makeRequest(`/api/pages/${smokePage.id}`, "DELETE"), smokePageContext)).status, 200,
      "isolated smoke-test page should move to the trash");

    const [failureParent] = await db.insert(pages).values({ title: "rollback target" }).returning();
    const [failureChild] = await db.insert(pages).values({ title: "rollback child", parentId: failureParent.id }).returning();

    const triggerPool = new Pool({ connectionString: testUrl.toString() });
    try {
      await triggerPool.query(`
        CREATE FUNCTION reject_test_page_trash() RETURNS trigger AS $$
        BEGIN
          IF NEW.deleted_at IS NOT NULL AND OLD.title = 'rollback target' THEN
            RAISE EXCEPTION 'intentional transaction rollback check';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_test_page_trash
          BEFORE UPDATE ON pages
          FOR EACH ROW EXECUTE FUNCTION reject_test_page_trash();
      `);

      const failedTrash = await expectFailure(() =>
        deletePage(
          makeRequest(`/api/pages/${failureParent.id}`, "DELETE"),
          routeContext({ id: failureParent.id }),
        ),
      );
      assert.equal(failedTrash.status, 500, "a failed trash should return a controlled server error");

      const [parentAfterFailure] = await db.select().from(pages).where(eq(pages.id, failureParent.id));
      const [childAfterFailure] = await db.select().from(pages).where(eq(pages.id, failureChild.id));
      assert.equal(parentAfterFailure?.deletedAt, null, "the parent should stay out of the trash when the transaction fails");
      assert.equal(childAfterFailure?.deletedAt, null, "the subtree should roll back with the failed trash");
    } finally {
      await triggerPool.query("DROP TRIGGER IF EXISTS reject_test_page_trash ON pages");
      await triggerPool.query("DROP FUNCTION IF EXISTS reject_test_page_trash()");
      await triggerPool.end();
    }

    const [root] = await db.insert(pages).values({ title: "success root" }).returning();
    const [target] = await db.insert(pages).values({ title: "success target", parentId: root.id }).returning();
    const [grandchild] = await db.insert(pages).values({ title: "success grandchild", parentId: target.id }).returning();
    const successfulDelete = await deletePage(
      makeRequest(`/api/pages/${target.id}`, "DELETE"),
      routeContext({ id: target.id }),
    );
    assert.equal(successfulDelete.status, 200);

    const [trashedTarget] = await db.select().from(pages).where(eq(pages.id, target.id));
    const [trashedGrandchild] = await db.select().from(pages).where(eq(pages.id, grandchild.id));
    assert.ok(trashedTarget?.deletedAt, "deleting a page should move it to the trash instead of removing it");
    assert.ok(trashedGrandchild?.deletedAt, "deleting a page should move its whole subtree to the trash");
    assert.equal(trashedGrandchild?.parentId, target.id, "trashing should keep the subtree intact for restore");

    const pagesAfterTrash = await (await listPages(makeRequest("/api/pages", "GET"))).json() as { id: string }[];
    assert.ok(!pagesAfterTrash.some((page) => page.id === target.id || page.id === grandchild.id),
      "trashed pages should not appear in page listings");
    assert.equal((await getPage(makeRequest(`/api/pages/${target.id}`, "GET"), routeContext({ id: target.id }))).status, 404,
      "trashed pages should not be readable through the page API");

    const trashListing = await (await listTrash()).json() as { items: { id: string; descendantCount: number }[] };
    const trashedRootEntry = trashListing.items.find((item) => item.id === target.id);
    assert.equal(trashedRootEntry?.descendantCount, 1, "the trash should list the trashed subtree once with its nested pages");

    assert.equal((await restoreTrashPage(makeRequest(`/api/trash/${target.id}/restore`, "POST"), routeContext({ id: target.id }))).status, 200);
    const [restoredTarget] = await db.select().from(pages).where(eq(pages.id, target.id));
    const [restoredGrandchild] = await db.select().from(pages).where(eq(pages.id, grandchild.id));
    assert.equal(restoredTarget?.deletedAt, null, "restoring should clear the trash mark");
    assert.equal(restoredGrandchild?.deletedAt, null, "restoring should clear the trash mark on the subtree");
    assert.equal(restoredTarget?.parentId, root.id, "restoring should keep the original parent");

    await deletePage(makeRequest(`/api/pages/${target.id}`, "DELETE"), routeContext({ id: target.id }));
    const purgeResponse = await purgeTrashPage(makeRequest(`/api/trash/${target.id}`, "DELETE"), routeContext({ id: target.id }));
    assert.equal(purgeResponse.status, 200, "permanent delete should succeed for a trashed page");
    assert.equal((await db.select().from(pages).where(eq(pages.id, target.id))).length, 0,
      "permanent delete should remove the page row");
    assert.equal((await db.select().from(pages).where(eq(pages.id, grandchild.id))).length, 0,
      "permanent delete should remove the whole subtree");

    const exportResponse = await exportWorkspace();
    assert.equal(exportResponse.status, 200);
    const exported = await exportResponse.json() as { format: string; counts: { pages: number }; pages: { id: string }[] };
    assert.equal(exported.format, "kbs-export");
    assert.ok(exported.counts.pages > 0 && exported.pages.some((page) => page.id === root.id),
      "the workspace export should include existing pages");

    const viewRollbackPool = new Pool({ connectionString: testUrl.toString() });
    try {
      await viewRollbackPool.query(`
        CREATE FUNCTION reject_test_default_view() RETURNS trigger AS $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM databases
            WHERE id = NEW.database_id AND name = 'rollback database create'
          ) THEN
            RAISE EXCEPTION 'intentional database creation rollback check';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_test_default_view
          BEFORE INSERT ON database_views
          FOR EACH ROW EXECUTE FUNCTION reject_test_default_view();
      `);
      const failedDatabaseCreate = await expectFailure(() => createDatabase(
        makeRequest("/api/databases", "POST", { name: "rollback database create" }),
      ));
      assert.equal(failedDatabaseCreate.status, 500);
      const rolledBackDatabase = await db.select().from(databases).where(eq(databases.name, "rollback database create"));
      assert.equal(rolledBackDatabase.length, 0, "the database row should roll back if its default view cannot be created");
    } finally {
      await viewRollbackPool.query("DROP TRIGGER IF EXISTS reject_test_default_view ON database_views");
      await viewRollbackPool.query("DROP FUNCTION IF EXISTS reject_test_default_view()");
      await viewRollbackPool.end();
    }

    async function createTestDatabase(name: string) {
      const response = await createDatabase(makeRequest("/api/databases", "POST", { name }));
      assert.equal(response.status, 201);
      return await response.json() as { id: string };
    }

    const sourceDatabase = await createTestDatabase("integration source");
    const targetDatabase = await createTestDatabase("integration target");
    const targetContext = routeContext({ id: targetDatabase.id });
    const sourceContext = routeContext({ id: sourceDatabase.id });

    const targetNumberPropertyResponse = await createProperty(
      makeRequest(`/api/databases/${targetDatabase.id}/properties`, "POST", { name: "Score", type: "number" }),
      targetContext,
    );
    assert.equal(targetNumberPropertyResponse.status, 201);
    const targetNumberProperty = await targetNumberPropertyResponse.json() as { id: string };

    const relationPropertyResponse = await createProperty(
      makeRequest(`/api/databases/${sourceDatabase.id}/properties`, "POST", {
        name: "Related target",
        type: "relation",
        options: { relatedDatabaseId: targetDatabase.id },
      }),
      sourceContext,
    );
    assert.equal(relationPropertyResponse.status, 201);
    const relationProperty = await relationPropertyResponse.json() as { id: string };

    const sourceNumberPropertyResponse = await createProperty(
      makeRequest(`/api/databases/${sourceDatabase.id}/properties`, "POST", { name: "Source score", type: "number" }),
      sourceContext,
    );
    assert.equal(sourceNumberPropertyResponse.status, 201);
    const sourceNumberProperty = await sourceNumberPropertyResponse.json() as { id: string };

    const rollupResponse = await createProperty(
      makeRequest(`/api/databases/${sourceDatabase.id}/properties`, "POST", {
        name: "Total score",
        type: "rollup",
        options: { relationPropertyId: relationProperty.id, targetPropertyId: targetNumberProperty.id, aggregation: "sum" },
      }),
      sourceContext,
    );
    assert.equal(rollupResponse.status, 201, "rollups should accept a numeric field on the related database");

    const targetRecordResponse = await createRecord(
      makeRequest(`/api/databases/${targetDatabase.id}/records`, "POST", { title: "target record" }),
      targetContext,
    );
    assert.equal(targetRecordResponse.status, 201);
    const targetRecord = await targetRecordResponse.json() as { id: string };
    await updateRecord(
      makeRequest(`/api/databases/${targetDatabase.id}/records/${targetRecord.id}`, "PATCH", {
        values: { [targetNumberProperty.id]: 12 },
      }),
      routeContext({ id: targetDatabase.id, recordId: targetRecord.id }),
    );

    const sourceRecordResponse = await createRecord(
      makeRequest(`/api/databases/${sourceDatabase.id}/records`, "POST", { title: "source record" }),
      sourceContext,
    );
    assert.equal(sourceRecordResponse.status, 201);
    const sourceRecord = await sourceRecordResponse.json() as { id: string };
    const sourceRecordContext = routeContext({ id: sourceDatabase.id, recordId: sourceRecord.id });
    const relationPatch = {
      values: { [sourceNumberProperty.id]: 8 },
      relations: { [relationProperty.id]: [targetRecord.id] },
    };
    const relationSaved = await updateRecord(
      makeRequest(`/api/databases/${sourceDatabase.id}/records/${sourceRecord.id}`, "PATCH", relationPatch),
      sourceRecordContext,
    );
    assert.equal(relationSaved.status, 200);
    const savedRelation = await relationSaved.json() as { relations: Record<string, string[]> };
    assert.deepEqual(savedRelation.relations[relationProperty.id], [targetRecord.id]);

    const foreignPropertyValue = await updateRecord(
      makeRequest(`/api/databases/${sourceDatabase.id}/records/${sourceRecord.id}`, "PATCH", {
        values: { [targetNumberProperty.id]: 77 },
      }),
      sourceRecordContext,
    );
    assert.equal(foreignPropertyValue.status, 400, "record values must not reference another database's properties");
    const invalidNumberValue = await updateRecord(
      makeRequest(`/api/databases/${sourceDatabase.id}/records/${sourceRecord.id}`, "PATCH", {
        values: { [sourceNumberProperty.id]: "not a number" },
      }),
      sourceRecordContext,
    );
    assert.equal(invalidNumberValue.status, 400, "record values must match the property's declared type");

    const triggerRelationPool = new Pool({ connectionString: testUrl.toString() });
    try {
      await triggerRelationPool.query(`
        CREATE FUNCTION reject_test_relation_insert() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'intentional relation transaction rollback check';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_test_relation_insert
          BEFORE INSERT ON database_record_relations
          FOR EACH ROW EXECUTE FUNCTION reject_test_relation_insert();
      `);

      const failedRelationUpdate = await expectFailure(() =>
        updateRecord(
          makeRequest(`/api/databases/${sourceDatabase.id}/records/${sourceRecord.id}`, "PATCH", {
            values: { [sourceNumberProperty.id]: 99 },
            relations: { [relationProperty.id]: [targetRecord.id] },
          }),
          sourceRecordContext,
        ),
      );
      assert.equal(failedRelationUpdate.status, 500);
      const [recordAfterFailure] = await db.select().from(databaseRecords).where(eq(databaseRecords.id, sourceRecord.id));
      const relationsAfterFailure = await db.select().from(databaseRecordRelations).where(eq(databaseRecordRelations.sourceRecordId, sourceRecord.id));
      assert.deepEqual(recordAfterFailure.values, { [sourceNumberProperty.id]: 8 }, "field updates should roll back with a failed relation write");
      assert.equal(relationsAfterFailure.length, 1, "the previous relation should survive a failed replacement");
    } finally {
      await triggerRelationPool.query("DROP TRIGGER IF EXISTS reject_test_relation_insert ON database_record_relations");
      await triggerRelationPool.query("DROP FUNCTION IF EXISTS reject_test_relation_insert()");
      await triggerRelationPool.end();
    }

    const relationRetry = await updateRecord(
      makeRequest(`/api/databases/${sourceDatabase.id}/records/${sourceRecord.id}`, "PATCH", {
        values: { [sourceNumberProperty.id]: 12 },
        relations: { [relationProperty.id]: [targetRecord.id] },
      }),
      sourceRecordContext,
    );
    assert.equal(relationRetry.status, 200, "relation updates should succeed after the database recovers");

    const viewResponse = await createView(
      makeRequest(`/api/databases/${sourceDatabase.id}/views`, "POST", {
        name: "Recent source records",
        type: "table",
        config: { filterText: "source" },
      }),
      sourceContext,
    );
    assert.equal(viewResponse.status, 201);
    const createdView = await viewResponse.json() as { id: string };
    const updatedViewResponse = await updateView(
      makeRequest(`/api/databases/${sourceDatabase.id}/views/${createdView.id}`, "PATCH", {
        config: { filterText: "source", sortBy: "title", sortDirection: "desc" },
      }),
      routeContext({ id: sourceDatabase.id, viewId: createdView.id }),
    );
    assert.equal(updatedViewResponse.status, 200);

    const templateResponse = await createTemplate(
      makeRequest(`/api/databases/${sourceDatabase.id}/templates`, "POST", {
        name: "Source template",
        title: "From template",
        values: { [sourceNumberProperty.id]: 5 },
      }),
      sourceContext,
    );
    assert.equal(templateResponse.status, 201);
    const template = await templateResponse.json() as { id: string };
    const templatedRecordResponse = await createRecord(
      makeRequest(`/api/databases/${sourceDatabase.id}/records`, "POST", { templateId: template.id }),
      sourceContext,
    );
    assert.equal(templatedRecordResponse.status, 201);
    const templatedRecord = await templatedRecordResponse.json() as { title: string; values: Record<string, unknown> };
    assert.equal(templatedRecord.title, "From template");
    assert.deepEqual(templatedRecord.values, { [sourceNumberProperty.id]: 5 });

    const loadedSourceResponse = await getDatabase(
      makeRequest(`/api/databases/${sourceDatabase.id}`, "GET"),
      sourceContext,
    );
    assert.equal(loadedSourceResponse.status, 200);
    const loadedSource = await loadedSourceResponse.json() as { records: { id: string; relations: Record<string, string[]> }[]; views: { id: string; config: Record<string, unknown> }[] };
    assert.ok(loadedSource.records.some((item) => item.id === sourceRecord.id && item.relations[relationProperty.id]?.[0] === targetRecord.id));
    assert.equal(loadedSource.views.find((view) => view.id === createdView.id)?.config.sortDirection, "desc");

    const deleteRecordResponse = await deleteRecord(
      makeRequest(`/api/databases/${sourceDatabase.id}/records/${sourceRecord.id}`, "DELETE"),
      sourceRecordContext,
    );
    assert.equal(deleteRecordResponse.status, 200);
    const relationsAfterRecordDelete = await db.select().from(databaseRecordRelations).where(eq(databaseRecordRelations.sourceRecordId, sourceRecord.id));
    assert.equal(relationsAfterRecordDelete.length, 0, "deleting a record should remove its relation rows");

    const deleteDatabaseResponse = await deleteDatabase(
      makeRequest(`/api/databases/${sourceDatabase.id}`, "DELETE"),
      sourceContext,
    );
    assert.equal(deleteDatabaseResponse.status, 200);
    const [deletedDatabase] = await db.select().from(databases).where(eq(databases.id, sourceDatabase.id));
    assert.equal(deletedDatabase, undefined, "database deletion should cascade its owned data");

    const targetStillExists = await db.select().from(databases).where(eq(databases.id, targetDatabase.id));
    assert.equal(targetStillExists.length, 1, "deleting one database should not affect a related database");

    await pool.end();
    applicationPool = undefined;
    console.log("Database reliability checks passed: page CRUD, favorites, tags, search, transactions, trash and restore, workspace export, database CRUD, relations, rollups, views, and templates.");
  } finally {
    if (applicationPool) await applicationPool.end();
    try {
      if (databaseCreated) {
        // Pool.end() starts client shutdown, but the PostgreSQL socket close can
        // finish just after its promise resolves. Wait for the server to see
        // those sessions disappear before dropping the temporary database.
        await waitForDatabaseConnectionsToClose(admin, testDatabaseName);
        await admin.query(`DROP DATABASE "${testDatabaseName}"`);
      }
    } finally {
      await admin.end();
    }
  }
}

main().catch((error) => {
  console.error("Database reliability checks failed:", error);
  process.exitCode = 1;
});
