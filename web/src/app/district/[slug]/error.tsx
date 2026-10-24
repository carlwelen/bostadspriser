"use client";

import { AnalyticsError } from "@/components/AnalyticsError";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AnalyticsError title="stadsdelens priser" reset={reset} />;
}
