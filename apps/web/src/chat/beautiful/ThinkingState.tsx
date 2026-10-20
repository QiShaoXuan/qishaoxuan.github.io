import { SparklesIcon } from '@heroicons/react/24/outline';
import type { ReactNode } from 'react';

/** Adapted from Beautiful UI (MIT), commit 44a274e598395ab61e7c96c26fda2758780253b7.
 * components/primitives/ThinkingState.tsx + components/atoms/Shimmer.tsx.
 * Keeps the header/shimmer primitive; removes demo timers, fabricated traces and tools.
 * https://github.com/slev12397/beautiful-ui
 */
function Shimmer({ children }: { children: ReactNode }) {
  return <span className="beautiful-shimmer">{children}</span>;
}

export function ThinkingState() {
  return (
    <div className="beautiful-thinking" role="status">
      <SparklesIcon aria-hidden="true" />
      <Shimmer>正在准备演示回复</Shimmer>
    </div>
  );
}
