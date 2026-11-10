import { json, type FetchCall } from "./fetch-stub";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

export type PageEditorPage = {
  id: string;
  title: string;
  parentId: string | null;
  [key: string]: unknown;
};

type PageSummary = Pick<PageEditorPage, "id" | "title" | "parentId">;
type PageEditorRoute = (call: FetchCall) => Response | undefined;

type PageEditorStubOptions = {
  page: PageEditorPage;
  pages?: PageSummary[];
  route?: PageEditorRoute;
};

/**
 * Answers the requests PageEditor and its child panels make by default. A test
 * can override any route, and cleanup fails the test instead of letting a new
 * endpoint silently receive a generic success response.
 */
export function stubPageEditor({
  page,
  pages,
  route,
}: PageEditorStubOptions): FetchCall[] {
  const pageList = pages ?? [
    { id: page.id, title: page.title, parentId: page.parentId },
  ];

  return stubStrictFetch("PageEditor", (call) => {
    const overridden = route?.(call);
    if (overridden) return overridden;

    if (call.url === "/api/pages" && call.method === "GET") return json(pageList);
    if (call.url === "/api/databases" && call.method === "GET") return json([]);

    if (call.url === `/api/pages/${page.id}` && call.method === "GET") {
      return json(page);
    }
    if (call.url === `/api/pages/${page.id}` && call.method === "PATCH") {
      return json({ ok: true });
    }
    if (call.url === `/api/pages/${page.id}/related` && call.method === "GET") {
      return json({ suggestions: [] });
    }
    if (call.url === `/api/pages/${page.id}/links`) {
      return call.method === "GET"
        ? json({ links: [], backlinks: [] })
        : json({ ok: true });
    }
    if (call.url === `/api/pages/${page.id}/records` && call.method === "GET") {
      return json({ records: [], options: [] });
    }
    if (call.url === `/api/pages/${page.id}/revisions`) {
      return call.method === "GET" ? json([]) : json({ ok: true });
    }
    if (
      (call.url === `/api/pages/${page.id}/tags` || call.url === "/api/tags") &&
      call.method === "GET"
    ) {
      return json([]);
    }

    return undefined;
  });
}

export function restorePageEditorFetch() {
  restoreStrictFetch();
}
