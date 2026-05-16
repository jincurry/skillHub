import { useEffect, useState } from 'react';
import { getTokenExpiry } from '../api/auth';

const WARN_MS = 5 * 60 * 1000; // show banner 5 min before expiry

function msUntilExpiry(exp: Date): number {
  return exp.getTime() - Date.now();
}

function fmtCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export function SessionExpiryBanner() {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    const exp = getTokenExpiry();
    if (!exp) return;

    let tick: ReturnType<typeof setInterval>;

    function update() {
      const remaining = msUntilExpiry(exp!);
      if (remaining <= 0) {
        // Token already expired — clearAuth + redirect handled by the 401
        // interceptor in client.ts; no need to double-trigger here.
        setVisible(false);
        clearInterval(tick);
        return;
      }
      if (remaining <= WARN_MS) {
        setVisible(true);
        setCountdown(fmtCountdown(remaining));
      }
    }

    // Schedule the first tick at the moment the warning window opens, then
    // switch to a 1 s interval for the live countdown.
    const delay = msUntilExpiry(exp) - WARN_MS;
    let wakeup: ReturnType<typeof setTimeout> | null = null;

    if (delay > 0) {
      wakeup = setTimeout(() => {
        update();
        tick = setInterval(update, 1000);
      }, delay);
    } else {
      // Already inside the warning window.
      update();
      tick = setInterval(update, 1000);
    }

    return () => {
      if (wakeup !== null) clearTimeout(wakeup);
      clearInterval(tick);
    };
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999,
      background: 'var(--amber-bg, #fffbeb)',
      border: '1px solid var(--amber-text, #d97706)',
      borderRadius: 8,
      padding: '10px 18px',
      display: 'flex', alignItems: 'center', gap: 16,
      boxShadow: '0 4px 16px rgba(0,0,0,.12)',
      fontSize: 13,
      color: 'var(--amber-text, #92400e)',
      maxWidth: 'calc(100vw - 40px)',
    }}>
      <span>⚠ 登录即将过期（{countdown}），请重新登录以保持会话。</span>
      <button
        onClick={() => window.location.assign('/login')}
        style={{
          padding: '4px 12px', borderRadius: 6,
          background: 'var(--amber-text, #d97706)', color: '#fff',
          border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          flexShrink: 0,
        }}
      >重新登录</button>
      <button
        onClick={() => setVisible(false)}
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--amber-text, #92400e)', fontSize: 16, lineHeight: 1,
          padding: '0 2px', flexShrink: 0,
        }}
        title="关闭提示"
      >×</button>
    </div>
  );
}
