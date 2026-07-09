'use client';

/**
 * 업체 현장 TBM 화면 (공개, 본인확인 게이트) — R-6 게이트③-6
 * 신청자 본인이 현장에서 ① TBM 사진 업로드 ② 작업자 돌려서명(한 폰 순차) → 제출.
 * 제출 시 안전환경에 알림 → 안전환경이 2차(입회) 승인 진행. 안전지시사항은 여기서 입력하지 않음.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import SignaturePad from '@/components/SignaturePad';

interface Cred { name: string; birthDate: string; phone: string }
interface RosterItem { name: string; companyName: string; confirmed: boolean }

// 신청 화면과 동일: 16:9 중앙크롭 1280×720, ~200KB JPEG
function resizeToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const W = 1280, H = 720;
      const srcRatio = img.width / img.height;
      const dstRatio = W / H;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (srcRatio > dstRatio) { sw = Math.round(img.height * dstRatio); sx = Math.round((img.width - sw) / 2); }
      else { sh = Math.round(img.width / dstRatio); sy = Math.round((img.height - sh) / 2); }
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas'));
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      let q = 0.8;
      let out = canvas.toDataURL('image/jpeg', q);
      while (out.length * 0.75 > 200 * 1024 && q > 0.4) { q -= 0.1; out = canvas.toDataURL('image/jpeg', q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

export default function SiteTbmPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [cred, setCred] = useState<Cred | null>(null);
  const [form, setForm] = useState<Cred>({ name: '', birthDate: '', phone: '' });
  const [data, setData] = useState<any>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signFor, setSignFor] = useState<string | null>(null);
  const [sig, setSig] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const call = useCallback(async (c: Cred, extra: any) => {
    const res = await fetch(`/api/work-permits/${id}/tbm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...c, ...extra }),
    });
    return res.json();
  }, [id]);

  const loadSession = useCallback(async (c: Cred) => {
    setError('');
    const json = await call(c, { action: 'session' });
    if (!json.success) { setError(json.message || '조회 실패'); setData(null); return false; }
    setCred(c); setData(json.data); return true;
  }, [call]);

  // 진입 시 sessionStorage 자격 자동 사용
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('wp_tbm_cred');
      if (raw) { const c = JSON.parse(raw); setForm(c); loadSession(c); }
    } catch { /* */ }
  }, [loadSession]);

  const onVerify = async () => {
    if (!form.name.trim() || !form.birthDate || form.phone.replace(/[^0-9]/g, '').length < 10) {
      setError('이름·생년월일·연락처를 정확히 입력해 주세요.'); return;
    }
    setBusy(true); await loadSession(form); setBusy(false);
  };

  const addPhoto = async (files: FileList | null) => {
    if (!files || !files[0] || !cred) return;
    setBusy(true); setError('');
    try {
      const durl = await resizeToDataUrl(files[0]);
      const json = await call(cred, { action: 'photo', image: durl });
      if (!json.success) { setError(json.message || '사진 업로드 실패'); }
      else { setPreviews((p) => [...p, durl]); setData((d: any) => ({ ...d, photoCount: json.data.photoCount })); }
    } catch { setError('사진 처리 실패'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const submitSign = async () => {
    if (!cred || !signFor) return;
    if (!sig) { setError('서명을 입력해 주세요.'); return; }
    setBusy(true); setError('');
    const json = await call(cred, { action: 'confirm', participantName: signFor, signature: sig });
    if (!json.success) { setError(json.message || '서명 저장 실패'); setBusy(false); return; }
    setSignFor(null); setSig('');
    await loadSession(cred);
    setBusy(false);
  };

  const submitTbm = async () => {
    if (!cred) return;
    setBusy(true); setError('');
    const json = await call(cred, { action: 'submit' });
    setBusy(false);
    if (!json.success) { setError(json.message || '제출 실패'); return; }
    setSubmitted(true);
  };

  // ── 본인확인 폼 ──
  if (!cred || !data) {
    return (
      <main className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold text-slate-800">현장 TBM 진행</h1>
          <p className="mt-1 text-sm text-slate-500">신청 시 입력한 <b>이름·생년월일·연락처</b>로 본인확인 후 진행합니다.</p>
        </header>
        <div className="card space-y-3">
          <div><label className="label">성명</label>
            <input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="홍길동" /></div>
          <div><label className="label">생년월일</label>
            <input type="date" className="input-base" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></div>
          <div><label className="label">연락처 (숫자만)</label>
            <input type="tel" inputMode="numeric" className="input-base" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^0-9]/g, '').slice(0, 11) })} placeholder="01012345678" /></div>
          {error && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}
          <button onClick={onVerify} disabled={busy} className="btn-primary">{busy ? '확인 중…' : '본인확인'}</button>
          <button onClick={() => router.push('/work-permit/my')} className="btn-secondary">내 작업허가 목록</button>
        </div>
      </main>
    );
  }

  // ── 제출 완료 ──
  if (submitted) {
    return (
      <main className="space-y-5">
        <div className="card text-center py-10 space-y-2">
          <div className="text-4xl">✅</div>
          <h1 className="text-xl font-bold text-slate-800">현장 TBM 제출 완료</h1>
          <p className="text-sm text-slate-500">안전환경 담당자에게 확인 요청이 전송되었습니다.<br />담당자의 2차(입회) 승인 후 작업이 개시됩니다.</p>
          <button onClick={() => router.push('/work-permit/my')} className="btn-primary mt-2">내 작업허가 목록</button>
        </div>
      </main>
    );
  }

  // ── 1차 승인 전 ──
  if (!data.issued) {
    return (
      <main className="space-y-5">
        <div className="card text-center py-10 space-y-2">
          <div className="text-4xl">⏳</div>
          <h1 className="text-lg font-bold text-slate-800">{data.permitNumber}</h1>
          <p className="text-sm text-slate-500">안전환경 <b>1차 승인(발급)</b> 후 현장 TBM을 진행할 수 있습니다.<br />승인되면 다시 시도해 주세요.</p>
          <button onClick={() => router.push('/work-permit/my')} className="btn-secondary mt-2">목록으로</button>
        </div>
      </main>
    );
  }

  const confirmedCount = (data.roster ?? []).filter((r: RosterItem) => r.confirmed).length;
  const total = (data.roster ?? []).length;

  return (
    <main className="space-y-5">
      <header>
        <p className="font-mono text-sm font-bold text-brand">{data.permitNumber}</p>
        <h1 className="text-xl font-bold text-slate-800">{data.workName}</h1>
        <p className="text-xs text-slate-500 mt-0.5">현장에서 TBM 사진과 작업자 서명을 완료한 뒤 제출하세요.</p>
      </header>

      {error && <div className="card bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {/* ① 사진 */}
      <section className="card space-y-2">
        <h2 className="font-bold text-slate-700">① TBM 현장 사진 <span className="text-xs text-slate-400">({data.photoCount}/{data.maxPhotos})</span></h2>
        <div className="flex gap-2 flex-wrap">
          {previews.map((p, i) => <img key={i} src={p} alt={`사진${i + 1}`} className="w-24 h-14 object-cover rounded border border-slate-200" />)}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhoto(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || data.photoCount >= data.maxPhotos}
          className={`w-full rounded-lg py-2 text-sm font-bold ${data.photoCount >= data.maxPhotos ? 'bg-slate-100 text-slate-400' : 'btn-secondary'}`}>
          📷 {data.photoCount >= data.maxPhotos ? '사진 2장 완료' : '사진 촬영/선택'}
        </button>
      </section>

      {/* ② 작업자 돌려서명 */}
      <section className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-700">② 작업자 서명 (돌려서명)</h2>
          <span className="text-xs text-slate-400">{confirmedCount}/{total} 완료</span>
        </div>
        <p className="text-[11px] text-slate-400">이 폰을 작업자에게 넘겨 각자 서명받으세요.</p>
        <div className="divide-y divide-slate-100">
          {(data.roster ?? []).map((r: RosterItem, i: number) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-slate-800">{r.name}</p>
                <p className="text-[11px] text-slate-400">{r.companyName}</p>
              </div>
              {r.confirmed ? (
                <span className="text-xs font-bold text-emerald-600">✅ 서명완료 <button onClick={() => setSignFor(r.name)} className="ml-1 text-slate-400 underline">재서명</button></span>
              ) : (
                <button onClick={() => { setSig(''); setSignFor(r.name); }} className="btn-primary text-xs px-3 py-1.5">서명</button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 제출 */}
      <section className="card space-y-2">
        <button onClick={submitTbm} disabled={busy || (data.photoCount === 0 && confirmedCount === 0)}
          className={`w-full rounded-lg py-3 font-bold ${data.photoCount === 0 && confirmedCount === 0 ? 'bg-slate-100 text-slate-400' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
          제출 (안전환경 2차 확인 요청)
        </button>
        {data.photoCount === 0 && confirmedCount === 0 && <p className="text-[11px] text-amber-600 text-center">사진 또는 작업자 서명을 1개 이상 완료해야 제출할 수 있습니다.</p>}
      </section>

      {/* 서명 모달 */}
      {signFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setSignFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">{signFor} 님 서명</h3>
            <SignaturePad onChange={setSig} />
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setSignFor(null)} disabled={busy}>취소</button>
              <button className="btn-primary" onClick={submitSign} disabled={busy}>{busy ? '저장 중…' : '서명 저장'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
