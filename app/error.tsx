'use client';

import { CrashScreen } from './components/CrashScreen';

/** Catches render errors below the root layout, so the page keeps its theme and styles. */
export default function ErrorPage({ error }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <CrashScreen error={error} />;
}
