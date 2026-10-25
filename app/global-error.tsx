'use client';

import './globals.css';
import { CrashScreen } from './components/CrashScreen';

/** Last resort when the root layout itself throws: it replaces the layout, so it brings its own html and body. */
export default function GlobalError({ error }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased min-h-screen">
        <CrashScreen error={error} />
      </body>
    </html>
  );
}
