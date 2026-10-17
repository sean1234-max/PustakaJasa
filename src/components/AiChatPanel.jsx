import { useEffect, useRef, useState } from 'react';

// "Ask Claude" on New Order step 2 (Sean, 2026-10-17): a chat box like
// Claude's own. The user says what to change in the order; Claude answers
// and makes the change (AppState's sendChatMessage). Each reply lists what
// it changed in the order, with an Undo. `children` sits under the chat
// (the Excel download).
export default function AiChatPanel({ messages, onSend, onUndo, onClear, children }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  // Grows with what is typed, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const send = async () => {
    const said = text.trim();
    if (!said || busy) return;
    setBusy(true);
    setText('');
    try {
      const sent = await onSend(said);
      if (!sent) setText(said);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat-head">
        <span className="ai-chat-title">Ask Claude</span>
        {messages.length > 0 && !busy && (
          <button type="button" className="ai-chat-clear" onClick={onClear}>New chat</button>
        )}
      </div>
      {messages.length > 0 && (
        <div className="ai-chat-list" ref={listRef}>
          {messages.map((m) => (
            <div key={m.id} className={`ai-chat-msg ai-chat-${m.role}${m.error ? ' ai-chat-error' : ''}`}>
              <div className="ai-chat-bubble">{m.text}</div>
              {m.done?.length > 0 && (
                <div className={`ai-chat-done${m.undone ? ' ai-chat-undone' : ''}`}>
                  <div className="ai-chat-done-title">{m.undone ? 'Undone' : 'Changed in the order'}</div>
                  <ul>{m.done.map((d) => <li key={d}>{d}</li>)}</ul>
                  {m.undo && !m.undone && (
                    <button type="button" className="ai-chat-undo" onClick={() => onUndo(m.id)}>Undo</button>
                  )}
                </div>
              )}
              {m.refused?.length > 0 && (
                <ul className="ai-chat-refused">{m.refused.map((d) => <li key={d}>⚠ {d}</li>)}</ul>
              )}
            </div>
          ))}
          {busy && <div className="ai-chat-msg ai-chat-assistant"><div className="ai-chat-bubble ai-chat-typing">Claude is working…</div></div>}
        </div>
      )}
      <div className="ai-chat-input">
        <textarea
          ref={inputRef}
          rows={1}
          maxLength={2000}
          value={text}
          disabled={busy}
          aria-label="Message to Claude"
          placeholder="Ask Claude a question or start a task…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="ai-chat-send" disabled={busy || !text.trim()} onClick={send} aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" />
          </svg>
        </button>
      </div>
      <p className="hint-text" style={{ margin: '6px 2px 0' }}>
        Upload the file first, then tell Claude what to change, e.g. &quot;Tajuk besar: MAJLIS APRESIASI KECEMERLANGAN 2026&quot; or
        &quot;put the tajuk besar at the bottom&quot;. Claude changes the Reference Sample rows and Remark, using only your words and the file.
        Names and quantities are changed in the tabs below. Enter sends; Shift+Enter starts a new line.
      </p>
      {children}
    </div>
  );
}
