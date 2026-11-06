import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaImage } from "../../src/components/media-image";

afterEach(cleanup);

test("MediaImage renders an image with its source and alt text", () => {
  render(<MediaImage src="/api/attachments/abc" alt="Harvest photo" className="rounded" />);

  const image = screen.getByRole("img", { name: "Harvest photo" });
  assert.equal(image.getAttribute("src"), "/api/attachments/abc");
  assert.equal(image.getAttribute("class"), "rounded");
});

test("MediaImage replaces a broken image with a message that keeps the alt text", () => {
  render(<MediaImage src="/api/attachments/missing" alt="Harvest photo" />);

  fireEvent.error(screen.getByRole("img", { name: "Harvest photo" }));

  const status = screen.getByRole("status");
  assert.equal(status.textContent, "Could not load image: Harvest photo");
  assert.equal(screen.queryByRole("img"), null);
});

test("MediaImage uses a generic message when a broken image has no alt text", () => {
  render(<MediaImage src="/api/attachments/missing" alt="" />);

  // An image with empty alt text is presentational, so target the element directly.
  const image = document.querySelector("img");
  assert.ok(image, "the image should render before it fails");
  fireEvent.error(image);

  assert.equal(screen.getByRole("status").textContent, "Image could not be loaded.");
});

test("MediaImage falls back immediately for an empty source", () => {
  render(<MediaImage src="" alt="Harvest photo" />);

  assert.equal(screen.queryByRole("img"), null);
  assert.equal(screen.getByRole("status").textContent, "Could not load image: Harvest photo");
});

test("MediaImage retries the image after the source changes", () => {
  const { rerender } = render(<MediaImage src="/api/attachments/first" alt="Harvest photo" />);
  fireEvent.error(screen.getByRole("img"));
  assert.ok(screen.getByRole("status"));

  rerender(<MediaImage src="/api/attachments/second" alt="Harvest photo" />);

  assert.equal(screen.getByRole("img").getAttribute("src"), "/api/attachments/second");
});
