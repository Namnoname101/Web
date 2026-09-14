import { useEffect, useState, type FormEvent } from 'react';
import { GraduationCap, RefreshCw } from 'lucide-react';
import { ErrorNotice, Field, Modal, Spinner, type Translate } from './components';
import { api, errorMessage } from './lib';
import type { Locale, User } from './types';

interface Challenge { challengeId: string; expiresAt: string; captcha: { required: boolean; imageDataUrl?: string }; mappingReady: boolean }
type Result = ({ status: 'CONNECTED'; user: User }) | (Challenge & { status: 'CHALLENGE_REQUIRED' });
export default function UedConnect({ locale, t, connected, close }: { locale: Locale; t: Translate; connected: (user: User) => void; close: () => void }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(true);
  const start = async () => { setBusy(true); setError(''); try { setChallenge(await api<Challenge>('/auth/ued/start', 'POST', {})); } catch (err) { setError(errorMessage(err, locale)); } finally { setBusy(false); } };
  // Deferring the request avoids creating/deleting two challenges during React's
  // development StrictMode effect replay. Only the effect that actually starts owns cleanup.
  useEffect(() => { let started = false; const timer = setTimeout(() => { started = true; void start(); }, 0); return () => { clearTimeout(timer); if (started) void api('/auth/ued/challenge', 'DELETE').catch(() => undefined); }; }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!challenge) return;
    const form = event.currentTarget; const f = new FormData(form); setError(''); setBusy(true);
    const passwordInput = form.elements.namedItem('password') as HTMLInputElement;
    const credentials = { challengeId: challenge.challengeId, studentId: String(f.get('studentId')).trim(), password: String(f.get('password')), ...(challenge.captcha.required ? { captcha: String(f.get('captcha') || '').trim() } : {}) };
    passwordInput.value = '';
    try { const result = await api<Result>('/auth/ued/submit', 'POST', credentials); if (result.status === 'CONNECTED') { connected(result.user); close(); } else { setChallenge(result); setError(t('Cần xác thực thêm. Vui lòng nhập lại mật khẩu và mã xác nhận mới.', 'Another verification is needed. Please enter your password and the new code.')); } }
    catch (err) { setError(errorMessage(err, locale)); } finally { credentials.password = ''; setBusy(false); }
  };
  return <Modal title={t('Đăng nhập cổng sinh viên UED', 'Sign in to the UED student portal')} subtitle={t('Dùng mã sinh viên và mật khẩu hiện tại của bạn tại trường.', 'Use your student ID and current school password.')} onClose={close} busy={busy}>
    <form className="form-stack" onSubmit={submit}>{error && <ErrorNotice>{error}</ErrorNotice>}
      {!challenge ? <div className="empty-state">{busy ? <><Spinner /><p>{t('Đang kết nối với cổng sinh viên…', 'Connecting to the student portal…')}</p></> : <button type="button" className="button button-secondary" onClick={start}><RefreshCw size={16} />{t('Thử lại', 'Try again')}</button>}</div> : <>
        <Field label={t('Mã sinh viên', 'Student ID')}><input name="studentId" autoComplete="username" required maxLength={64} placeholder={t('Nhập mã sinh viên của bạn', 'Enter your student ID')} /></Field>
        <Field label={t('Mật khẩu cổng UED', 'UED portal password')}><input name="password" type="password" autoComplete="current-password" required maxLength={256} /></Field>
        {challenge.captcha.required && <div className="captcha-section">{challenge.captcha.imageDataUrl ? <img src={challenge.captcha.imageDataUrl} alt={t('Mã xác nhận từ cổng UED', 'Verification code from UED')} /> : <p className="muted">{t('Cổng trường yêu cầu mã xác nhận nhưng chưa tải được ảnh. Hãy lấy mã mới.', 'The portal requires a verification code, but the image could not be loaded. Request a new code.')}</p>}<Field label={t('Mã xác nhận trong ảnh', 'Code shown in the image')}><input name="captcha" autoComplete="off" required maxLength={64} /></Field><button type="button" className="text-link" onClick={start} disabled={busy}><RefreshCw size={14} />{t('Lấy mã mới', 'Get a new code')}</button></div>}
        {!challenge.mappingReady && <div className="callout callout-amber">{t('Bạn có thể kết nối tài khoản. Đồng bộ học tập sẽ bắt đầu khi cấu hình dữ liệu UED sẵn sàng.', 'You can connect your account. Academic sync will start when the UED data configuration is ready.')}</div>}
        <p className="muted small">{t('Mật khẩu chỉ dùng cho lần xác thực này. Phiên đăng nhập được mã hóa và dùng lại cho các lần đồng bộ tiếp theo.', 'Your password is only used for this sign-in. The session is encrypted and reused for future syncs.')}</p>
        <div className="form-footer"><button type="button" className="button button-quiet" onClick={close} disabled={busy}>{t('Hủy', 'Cancel')}</button><button className="button button-primary" disabled={busy}>{busy ? <Spinner /> : <GraduationCap size={17} />}{t('Kết nối tài khoản', 'Connect account')}</button></div>
      </>}
    </form>
  </Modal>;
}
