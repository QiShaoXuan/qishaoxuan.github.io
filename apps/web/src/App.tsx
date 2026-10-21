import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { ResumePage } from './resume/ResumePage';
import pdfMetadata from './resume/pdf-metadata.json';
import { ChatWidget } from './chat/ChatWidget';
import type { ChatMode } from './chat/ChatWidget';

const mobileQuery = '(max-width: 767px)';
const isMobile = () => window.matchMedia(mobileQuery).matches;
function subscribeToViewport(onChange: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>('floating');
  const mobile = useSyncExternalStore(subscribeToViewport, isMobile, () => false);

  useEffect(() => {
    if (!chatOpen || !mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [chatOpen, mobile]);

  return (
    <div className="app-shell" data-chat-open={chatOpen} data-chat-mode={chatMode}>
      <div className="resume-region" inert={chatOpen && mobile}>
        <a className="skip-link" href="#resume">跳到简历正文</a>
        <a className="resume-download" href={`${import.meta.env.BASE_URL}resume.pdf?v=${pdfMetadata.sourceHash}`} download="齐少轩的简历.pdf" aria-label="下载简历 PDF" title="下载简历 PDF">
          <ArrowDownTrayIcon aria-hidden="true" />
        </a>
        <main><ResumePage /></main>
      </div>
      <ChatWidget open={chatOpen} onOpenChange={setChatOpen} mode={chatMode} onModeChange={setChatMode} />
    </div>
  );
}
