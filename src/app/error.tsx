"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";

export default function RouteError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const pathname = usePathname();
  const lastPathname = useRef(pathname);
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : undefined;

  useEffect(() => {
    console.error(error);
  }, [error]);

  // A boundary at the app root can outlive the route that failed. Clear it when
  // navigation reaches a different path so the new page can render normally.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    retry();
  }, [pathname, retry]);

  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <h1 className="text-lg font-semibold tracking-tight">
        This page couldn’t load
      </h1>
      <p className="text-sm text-muted-foreground">
        Something went wrong while loading this page. Trying again usually fixes
        it.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to home
        </Link>
      </div>
      {typeof digest === "string" && digest ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Error {digest}
        </p>
      ) : null}
    </div>
  );
}
