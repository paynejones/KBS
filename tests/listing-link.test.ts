import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LISTING_DEFAULT_SORT,
  LISTING_PAGE_SIZE,
  type ListingWindow,
  listingOffsetFor,
  listingPageFor,
  listingSearch,
  readListingSearch,
} from "../src/lib/listing-link";

const TAG_ID = "5b9f2c1e-3a44-4a8e-9f61-0a1b2c3d4e5f";

function window_(overrides: Partial<ListingWindow> = {}): ListingWindow {
  return {
    page: 1,
    sort: LISTING_DEFAULT_SORT,
    query: "",
    tagId: "",
    from: "",
    through: "",
    ...overrides,
  };
}

test("a listing reads the page, sort and filters its address carries", () => {
  assert.deepEqual(readListingSearch("?page=3&sort=title-asc"), {
    page: 3,
    sort: "title-asc",
    query: null,
    tagId: null,
    from: null,
    through: null,
  });
  assert.deepEqual(
    readListingSearch(`?q=%20harvest%20&tagId=${TAG_ID}&from=2026-03-01&through=2026-03-31&page=1`),
    {
      page: 1,
      sort: null,
      query: "harvest",
      tagId: TAG_ID,
      from: "2026-03-01",
      through: "2026-03-31",
    },
  );
});

test("an address without a usable value falls back to no filter", () => {
  for (const search of ["", "?page=0", "?page=-2", "?page=1.5", "?page=abc", "?page="]) {
    assert.equal(readListingSearch(search).page, 1, `${search || "(empty)"} starts at the first page`);
  }
  for (const search of ["", "?sort=", "?sort=sideways", "?sort=UPSET"]) {
    assert.equal(readListingSearch(search).sort, null, `${search || "(empty)"} keeps the default sort`);
  }
  for (const search of ["?tagId=nope", "?tagId=", "?from=2026-02-30", "?from=March", "?through=2026-13-01"]) {
    const listing = readListingSearch(search);
    assert.equal(listing.tagId, null, `${search} is not a tag`);
    assert.equal(listing.from, null, `${search} is not a start date`);
    assert.equal(listing.through, null, `${search} is not an end date`);
  }
  assert.equal(readListingSearch(`?q=${"x".repeat(400)}`).query?.length, 200, "a long search is capped");
});

test("a listing address drops the defaults and keeps the filters", () => {
  assert.equal(listingSearch("", window_()), "");
  assert.equal(listingSearch("?page=2&sort=title-asc", window_()), "");
  assert.equal(
    listingSearch("", window_({ page: 2, sort: "created-asc" })),
    "?page=2&sort=created-asc",
  );
  assert.equal(
    listingSearch("", window_({ query: " harvest ", tagId: TAG_ID, from: "2026-03-01", through: "2026-03-31" })),
    `?q=harvest&tagId=${TAG_ID}&from=2026-03-01&through=2026-03-31`,
  );
});

test("a listing address leaves parameters it does not own alone", () => {
  assert.equal(
    listingSearch("?ref=sidebar&page=4", window_({ page: 2 })),
    "?ref=sidebar&page=2",
  );
  assert.equal(
    listingSearch("?ref=sidebar", window_({ sort: "updated-asc" })),
    "?ref=sidebar&sort=updated-asc",
  );
});

test("a listing address round-trips through the reader", () => {
  const listing = window_({
    page: 4,
    sort: "title-desc",
    query: "binder",
    tagId: TAG_ID,
    from: "2026-01-05",
    through: "2026-01-09",
  });
  const address = listingSearch("", listing);

  assert.deepEqual(readListingSearch(address), {
    page: 4,
    sort: "title-desc",
    query: "binder",
    tagId: TAG_ID,
    from: "2026-01-05",
    through: "2026-01-09",
  });
});

test("page numbers and offsets agree with a full listing window", () => {
  assert.equal(LISTING_PAGE_SIZE, 24);
  assert.equal(listingPageFor(0), 1);
  assert.equal(listingPageFor(23), 1);
  assert.equal(listingPageFor(24), 2);
  assert.equal(listingOffsetFor(1), 0);
  assert.equal(listingOffsetFor(3), 48);
});
