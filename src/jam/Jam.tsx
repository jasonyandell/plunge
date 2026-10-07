/** Family jam board: type an idea, watch it get built, try the preview, talk back. */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  JAM_AVAILABLE, JAM_LIVE_SITE, JamUnavailable, STATUS_HINT, STATUS_LABEL, fetchBoard, fetchThread, forgetIdentity, jamInvite,
  loadIdentity, passphraseFromHash, saveIdentity, submitIdea, submitReply, whenLabel, type JamBoard, type JamIdentity, type JamThread,
} from './client';
import './jam.css';

const POLL_MS = 30000;
const storage = (): Storage | null => { try { return localStorage; } catch { return null; } };

export function Jam({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const [identity, setIdentity] = useState<JamIdentity | null>(() => {
    const saved = storage() ? loadIdentity(storage()!) : null;
    const invited = typeof location !== 'undefined' ? passphraseFromHash(location.hash) : null;
    return invited ? { name: saved?.name ?? '', passphrase: invited } : saved;
  });
  const [name, setName] = useState(identity?.name ?? '');
  const [passphrase, setPassphrase] = useState(identity?.passphrase ?? '');
  const [board, setBoard] = useState<JamBoard | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [thread, setThread] = useState<JamThread | null>(null);
  const [idea, setIdea] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const ready = Boolean(identity?.name && identity.passphrase);

  const fail = (error: unknown) => {
    if (error instanceof Error && error.message === 'passphrase') {
      setIdentity(current => current ? { ...current, passphrase: '' } : null);
      setPassphrase('');
      setNotice('That passphrase did not match. Ask whoever runs the game for it.');
    } else if (error instanceof JamUnavailable) setNotice(error.message);
    else setNotice(error instanceof Error ? error.message : 'Something hiccuped. Try again in a minute.');
  };
  const refresh = async (who = identity, which = selected) => {
    if (!who?.passphrase || !JAM_AVAILABLE) return;
    try {
      const [nextBoard, nextThread] = await Promise.all([fetchBoard(who.passphrase), which ? fetchThread(which, who.passphrase) : null]);
      setBoard(nextBoard); if (which) setThread(nextThread); setNotice('');
    } catch (error) { fail(error); }
  };
  useEffect(() => {
    if (!ready) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [ready, identity?.passphrase, selected]);

  const enter = (event: Event) => {
    event.preventDefault();
    const next = { name: name.trim().slice(0, 24), passphrase: passphrase.trim() };
    if (!next.name || !next.passphrase) { setNotice('A first name and the family passphrase, please.'); return; }
    if (storage()) saveIdentity(next, storage()!);
    setIdentity(next); setNotice('');
  };
  const leave = () => { if (storage()) forgetIdentity(storage()!); setIdentity(null); setBoard(null); setSelected(null); setThread(null); };
  const send = async () => {
    if (!identity || busy) return;
    setBusy(true);
    try {
      const filed = await submitIdea(identity, idea.trim());
      setIdea(''); setNotice('');
      setBoard(current => current ? { ...current, ideas: [filed, ...current.ideas] } : current);
      setSelected(filed.number);
    } catch (error) { fail(error); } finally { setBusy(false); }
  };
  const answer = async () => {
    if (!identity || !selected || busy) return;
    setBusy(true);
    try {
      const message = await submitReply(selected, identity, text.trim());
      setText(''); setNotice('');
      setThread(current => current ? { ...current, messages: [...current.messages, message] } : current);
    } catch (error) { fail(error); } finally { setBusy(false); }
  };
  const copyInvite = async () => {
    if (!identity) return;
    const link = jamInvite(identity.passphrase);
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { window.prompt('Copy this invite', link); }
  };
  const open = (number: number) => { setSelected(number); setThread(null); setCopied(false); setNotice(''); };
  const current = thread ?? board?.ideas.find(item => item.number === selected) ?? null;
  const title = !JAM_AVAILABLE ? 'Family jam' : !ready ? 'Family jam' : selected ? 'Your idea' : 'Family jam';

  return <dialog class="jam-dialog" ref={dialog} onCancel={onClose} aria-label={title}>
    <header class="jam-header">
      <div><p class="eyebrow">Build the game with us</p><h2>{title}</h2></div>
      <button type="button" class="jam-close" onClick={onClose} aria-label="Close the jam">×</button>
    </header>
    <div class="jam-body">
      {!JAM_AVAILABLE ? <>
        <p class="jam-intro">This is a preview of one idea. The jam board itself lives on the main Plunge site.</p>
        <a class="jam-try" href={`${JAM_LIVE_SITE}/?jam=1${location.hash.startsWith('#jam=') ? location.hash : ''}`}>Open the jam on Plunge</a>
      </> : !ready ? <form onSubmit={enter}>
        <p class="jam-intro">Got an idea for Plunge? Say it here and it gets built. You'll see it on the board, try it before it ships, and talk to the builder in plain words.</p>
        <label class="jam-label">Your first name<input value={name} maxLength={24} autoComplete="given-name" placeholder="Mom" onInput={e => setName(e.currentTarget.value)} /></label>
        <label class="jam-label">Family passphrase<input value={passphrase} autoCapitalize="none" autoCorrect="off" spellcheck={false} placeholder="Ask Jason" onInput={e => setPassphrase(e.currentTarget.value)} /></label>
        <button type="submit" class="big-btn">Come on in</button>
        <p class="jam-fine">Ideas and replies are posted publicly on GitHub under your first name. Plunge is public domain, so whatever gets built is too.</p>
      </form> : selected ? <>
        <button type="button" class="text-btn" onClick={() => { setSelected(null); setThread(null); }}>← All ideas</button>
        {current ? <>
          <div class="jam-idea"><small>{current.from} · {whenLabel(current.created)}</small><p>{thread?.idea ?? current.title}</p></div>
          <p><span class={`jam-status ${current.status}`}>{STATUS_LABEL[current.status]}</span></p>
          <p class="setting-hint">{STATUS_HINT[current.status]}</p>
          {current.preview && <a class="jam-try" href={current.preview} target="_blank" rel="noopener">Try it</a>}
          {thread ? <div class="jam-thread">{thread.messages.length === 0 && <p class="setting-hint">No replies yet. The builder usually answers within a few minutes.</p>}
            {thread.messages.map((message, index) => <div key={`${message.at}-${index}`} class={`jam-message ${message.kind}`}>
              <strong>{message.from}</strong> <small>· {whenLabel(message.at)}</small><p>{message.body}</p></div>)}
          </div> : <p role="status" class="setting-hint">Opening the conversation…</p>}
          {current.status !== 'shipped' && <label class="jam-label">Reply to the builder
            <textarea value={text} maxLength={1500} placeholder="Looks good, but make the letters bigger." onInput={e => setText(e.currentTarget.value)} />
            <button type="button" class="big-btn" disabled={busy || !text.trim()} onClick={() => void answer()}>{busy ? 'Sending…' : 'Send reply'}</button>
          </label>}
        </> : <p role="status">Finding that idea…</p>}
      </> : <>
        <p class="jam-intro">Hi {identity!.name}. What should Plunge add or fix? Say it the way you'd say it at the table.</p>
        <label class="jam-label">Your idea
          <textarea value={idea} maxLength={2000} placeholder="Gran's tiles should wiggle when she wins." onInput={e => setIdea(e.currentTarget.value)} />
        </label>
        <button type="button" class="big-btn" disabled={busy || idea.trim().length < 4} onClick={() => void send()}>{busy ? 'Sending…' : 'Send it in'}</button>
        <div class="jam-row"><h3>On the board</h3>{board && <small class="setting-hint">{board.ideas.length} {board.ideas.length === 1 ? 'idea' : 'ideas'}</small>}</div>
        {!board ? <p role="status" class="setting-hint">Opening the board…</p>
          : board.ideas.length === 0 ? <p class="jam-empty">Nothing on the board yet. Yours could be first.</p>
          : <div class="jam-list">{board.ideas.map(item => <button type="button" key={item.number} class="jam-item" onClick={() => open(item.number)}>
            <strong>{item.title}</strong>
            <small>{item.from} · {whenLabel(item.created)}{item.replies ? ` · ${item.replies} ${item.replies === 1 ? 'reply' : 'replies'}` : ''}</small>
            <span><span class={`jam-status ${item.status}`}>{STATUS_LABEL[item.status]}</span></span>
          </button>)}</div>}
        <p class="jam-fine">Ideas and replies are posted publicly on GitHub under your first name. Plunge is public domain, so whatever gets built is too.</p>
      </>}
      {notice && <p class="jam-notice" role="alert">{notice}</p>}
    </div>
    {JAM_AVAILABLE && ready && <footer class="jam-footer">
      <button type="button" class="text-btn" onClick={leave}>Not {identity!.name}?</button>
      <button type="button" class="text-btn" onClick={() => void copyInvite()}>{copied ? 'Invite copied!' : 'Copy invite'}</button>
      <button type="button" class="big-btn secondary" onClick={onClose}>Back to the game</button>
    </footer>}
  </dialog>;
}
