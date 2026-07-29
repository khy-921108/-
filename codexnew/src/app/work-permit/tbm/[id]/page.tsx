'use client';

/**
 * 업체 현장 TBM 화면 (공개, 본인확인 게이트) — R-6 게이트③-6
 * 신청자 본인이 현장에서 ① TBM 사진 업로드 ② 작업자 돌려서명(한 폰 순차) → 제출.
 * 제출 시 안전환경에 알림 → 안전환경이 2차(입회) 승인 진행. 안전지시사항은 여기서 입력하지 않음.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import SignaturePad from '@/components/SignaturePad';
import { PLEDGE_INTRO, PLEDGE_CLAUSES } from '@/lib/work-permit-constants';

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

  // 현장 합류자 추가
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinForm, setJoinForm] = useState({ name: '', birthDate: '', phone: '' });
  const [joinCand, setJoinCand] = useState<any>(null);       // 수료 확인 결과(유효)
  const [joinBlocked, setJoinBlocked] = useState('');        // 수료 없음/만료 메시지
  const [joinBriefed, setJoinBriefed] = useState(false);
  const [joinSig, setJoinSig] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMsg, setJoinMsg] = useState('');
  // 합류자 필수서류 그 자리 처리(개인서약 작성 / 이행각서 명단 추가)
  const [plForm, setPlForm] = useState({ nationality: '한국', bloodType: 'A형', jobType: '' });
  const [plConfirm, setPlConfirm] = useState(false);
  const [plSig, setPlSig] = useState('');
  const [plBusy, setPlBusy] = useState(false);
  const [utManager, setUtManager] = useState('');
  const [utBusy, setUtBusy] = useState(false);

  // 장비 도착 등록
  const arrFileRef = useRef<HTMLInputElement>(null);
  const [arrOpen, setArrOpen] = useState(false);
  const [arrType, setArrType] = useState('');
  const [arrVehicle, setArrVehicle] = useState('');
  const [arrPhoto, setArrPhoto] = useState('');
  const [arrBusy, setArrBusy] = useState(false);
  const [arrMsg, setArrMsg] = useState('');

  const call = useCallback(async (c: Cred, extra: any) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000); // 무한 대기 방지
    try {
      const res = await fetch(`/api/work-permits/${id}/tbm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...c, ...extra }), signal: ac.signal,
      });
      return await res.json();
    } catch {
      return { success: false, message: '처리가 지연되었거나 네트워크 오류입니다. 다시 시도해 주세요.' };
    } finally {
      clearTimeout(t);
    }
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
    if (!json.success) { setBusy(false); setError(json.message || '제출 실패'); return; }
    await loadSession(cred); // tbmSubmitted 플래그 갱신(제출 후에도 화면 유지, 사진·서명 추가는 2차 전까지 가능)
    setBusy(false);
  };

  // 합류자 1단계: 수료 확인
  const checkJoin = async () => {
    if (!cred) return;
    setJoinMsg(''); setJoinBlocked(''); setJoinCand(null);
    if (!joinForm.name.trim() || !joinForm.birthDate || joinForm.phone.length < 10) {
      setJoinMsg('이름·생년월일·연락처를 정확히 입력해 주세요.'); return;
    }
    setJoinBusy(true);
    const json = await call(cred, {
      action: 'join', checkOnly: true,
      joinName: joinForm.name.trim(), joinBirthDate: joinForm.birthDate, joinPhone: joinForm.phone,
    });
    setJoinBusy(false);
    if (!json.success) {
      if (json.code === 'NOT_ELIGIBLE') setJoinBlocked(json.message || '안전교육을 먼저 받아야 합니다.');
      else setJoinMsg(json.message || '확인 실패');
      return;
    }
    setJoinCand(json.data); setJoinBriefed(false); setJoinSig('');
    setPlForm({ nationality: '한국', bloodType: 'A형', jobType: '' }); setPlConfirm(false); setPlSig('');
    setUtManager(json.data?.undertakingManagerName ?? '');
  };

  // 합류자 개인서약 그 자리 작성 → 재확인
  const issueJoinPledge = async () => {
    if (!joinCand) return;
    if (!plForm.jobType.trim()) { setJoinMsg('직종을 입력해 주세요.'); return; }
    if (!plConfirm) { setJoinMsg('서약 내용 확인에 동의해 주세요.'); return; }
    if (!plSig) { setJoinMsg('서약자 본인 서명을 입력해 주세요.'); return; }
    setPlBusy(true); setJoinMsg('');
    try {
      const res = await fetch('/api/safety-pledges', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: joinForm.name.trim(), birthDate: joinForm.birthDate, phone: joinForm.phone,
          companyId: joinCand.companyId, nationality: plForm.nationality, bloodType: plForm.bloodType,
          jobType: plForm.jobType.trim(), signature: plSig,
        }),
      });
      const j = await res.json();
      if (!j.success) { setJoinMsg(j.message || '서약서 발급 실패'); return; }
      await checkJoin(); // 서류 상태 재확인
    } catch { setJoinMsg('네트워크 오류'); } finally { setPlBusy(false); }
  };

  // 이행각서 명단에 합류자 추가 재발급 → 재확인
  const reissueUndertaking = async () => {
    if (!joinCand?.companyId) { setJoinMsg('업체 정보가 없어 각서를 재발급할 수 없습니다.'); return; }
    if (!utManager.trim()) { setJoinMsg('관리감독자명을 입력해 주세요.'); return; }
    setUtBusy(true); setJoinMsg('');
    try {
      const res = await fetch('/api/company-undertakings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: joinCand.companyId, managerName: utManager.trim(),
          members: [{ name: joinForm.name.trim(), birthDate: joinForm.birthDate, phone: joinForm.phone }],
        }),
      });
      const j = await res.json();
      if (!j.success) { setJoinMsg(j.message || '이행각서 재발급 실패'); return; }
      await checkJoin();
    } catch { setJoinMsg('네트워크 오류'); } finally { setUtBusy(false); }
  };

  // 합류자 2단계: 설명 확인 + 서명 → 등록
  const submitJoin = async () => {
    if (!cred || !joinCand) return;
    if (!joinBriefed) { setJoinMsg('위험요인·안전대책 설명 확인에 체크해 주세요.'); return; }
    if (!joinSig) { setJoinMsg('합류자 서명을 입력해 주세요.'); return; }
    setJoinBusy(true); setJoinMsg('');
    const json = await call(cred, {
      action: 'join',
      joinName: joinForm.name.trim(), joinBirthDate: joinForm.birthDate, joinPhone: joinForm.phone,
      briefed: true, signature: joinSig,
    });
    setJoinBusy(false);
    if (!json.success) { setJoinMsg(json.message || '합류 등록 실패'); return; }
    setJoinOpen(false); setJoinForm({ name: '', birthDate: '', phone: '' }); setJoinCand(null); setJoinSig('');
    await loadSession(cred);
  };

  const addArrivalPhoto = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    try { setArrPhoto(await resizeToDataUrl(files[0])); setArrMsg(''); } catch { setArrMsg('사진 처리 실패'); }
    finally { if (arrFileRef.current) arrFileRef.current.value = ''; }
  };

  const submitArrival = async () => {
    if (!cred) return;
    if (!arrType.trim()) { setArrMsg('장비 종류를 입력해 주세요.'); return; }
    if (!arrPhoto) { setArrMsg('장비 사진을 촬영해 주세요(필수).'); return; }
    setArrBusy(true); setArrMsg('');
    const json = await call(cred, {
      action: 'arrival', equipType: arrType.trim(), vehicleNumber: arrVehicle.trim(), image: arrPhoto,
    });
    setArrBusy(false);
    if (!json.success) { setArrMsg(json.message || '등록 실패'); return; }
    setArrType(''); setArrVehicle(''); setArrPhoto('');
    await loadSession(cred);
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

      {/* 제출/확인 상태 */}
      {data.tbmSubmitted && (
        <div className={`card text-sm font-bold ${data.witnessConfirmed ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-sky-50 border border-sky-200 text-sky-700'}`}>
          {data.witnessConfirmed
            ? '✅ 현장담당자 확인 완료'
            : '✅ TBM 제출 완료 — 현장담당자 확인 절차 진행 중입니다 (2차 입회)'}
        </div>
      )}

      {/* ① 사진 */}
      <section className="card space-y-2">
        <h2 className="font-bold text-slate-700">① TBM 현장 사진 <span className="text-xs text-slate-400">({data.photoCount}/{data.maxPhotos})</span></h2>
        <div className="flex gap-2 flex-wrap">
          {previews.map((p, i) => <img key={i} src={p} alt={`사진${i + 1}`} className="w-24 h-14 object-cover rounded border border-slate-200" />)}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhoto(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || data.photoCount >= data.maxPhotos || data.witnessConfirmed}
          className={`w-full rounded-lg py-2 text-sm font-bold ${data.photoCount >= data.maxPhotos || data.witnessConfirmed ? 'bg-slate-100 text-slate-400' : 'btn-secondary'}`}>
          📷 {data.witnessConfirmed ? '확인 완료(수정 불가)' : data.photoCount >= data.maxPhotos ? '사진 2장 완료' : '사진 촬영/선택'}
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
                <span className="text-xs font-bold text-emerald-600">✅ 서명완료 {!data.witnessConfirmed && <button onClick={() => setSignFor(r.name)} className="ml-1 text-slate-400 underline">재서명</button>}</span>
              ) : data.witnessConfirmed ? (
                <span className="text-xs text-slate-400">미서명</span>
              ) : (
                <button onClick={() => { setSig(''); setSignFor(r.name); }} className="btn-primary text-xs px-3 py-1.5">서명</button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 제출 */}
      {!data.witnessConfirmed && (
        <section className="card space-y-2">
          <button onClick={submitTbm} disabled={busy || data.tbmSubmitted || (data.photoCount === 0 && confirmedCount === 0)}
            className={`w-full rounded-lg py-3 font-bold ${data.tbmSubmitted || (data.photoCount === 0 && confirmedCount === 0) ? 'bg-slate-100 text-slate-400' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
            {data.tbmSubmitted ? '✅ 제출 완료 (확인 대기)' : '제출 (안전환경 2차 확인 요청)'}
          </button>
          {!data.tbmSubmitted && data.photoCount === 0 && confirmedCount === 0 && <p className="text-[11px] text-amber-600 text-center">사진 또는 작업자 서명을 1개 이상 완료해야 제출할 수 있습니다.</p>}
          {data.tbmSubmitted && <p className="text-[11px] text-slate-400 text-center">제출 후에도 2차 확인 전까지 사진·서명을 추가할 수 있습니다.</p>}
        </section>
      )}

      {/* 현장 합류자 추가 — 개시 후에도 가능, 종료신고 후 불가 */}
      {!data.reported && !data.closed && (
        <section className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700">👷 현장 합류자 {data.joinCount > 0 && <span className="text-xs font-normal text-slate-400">(합류 {data.joinCount}명)</span>}</h2>
            {!joinOpen && <button onClick={() => setJoinOpen(true)} className="btn-primary text-xs px-3 py-1.5">+ 현장 합류자 추가</button>}
          </div>
          {joinOpen && (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-1 gap-2">
                <input className="input-base text-sm" placeholder="이름" value={joinForm.name}
                  onChange={(e) => setJoinForm({ ...joinForm, name: e.target.value })} />
                <input type="date" className="input-base text-sm" value={joinForm.birthDate}
                  onChange={(e) => setJoinForm({ ...joinForm, birthDate: e.target.value })} aria-label="생년월일" />
                <input type="tel" inputMode="numeric" className="input-base text-sm" placeholder="연락처(숫자만)" value={joinForm.phone}
                  onChange={(e) => setJoinForm({ ...joinForm, phone: e.target.value.replace(/[^0-9]/g, '').slice(0, 11) })} />
              </div>
              {!joinCand && !joinBlocked && (
                <button onClick={checkJoin} disabled={joinBusy} className="btn-secondary w-full text-sm">{joinBusy ? '확인 중…' : '교육 수료 확인'}</button>
              )}
              {joinBlocked && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 space-y-1">
                  <p>⛔ {joinBlocked}</p>
                  <a href="/consent" target="_blank" rel="noreferrer" className="inline-block text-xs font-bold underline">→ 안전교육 시작하기</a>
                </div>
              )}
              {joinCand && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-2">
                  <p className="text-sm text-emerald-800 font-bold">✅ 교육 유효 — {joinCand.name} ({joinCand.companyName ?? '소속 미상'}{joinCand.targetLabel ? ` · ${joinCand.targetLabel}` : ''})</p>

                  {/* 필수서류 미비 — 그 자리에서 처리 */}
                  {!joinCand.docsOk && (
                    <div className="rounded-lg bg-amber-50 border border-amber-300 p-2 space-y-2">
                      <p className="text-xs font-bold text-amber-800">⚠ 필수서류 미비: {(joinCand.docsMissing ?? []).join(', ')}</p>

                      {!joinCand.pledgeOk && (
                        <div className="space-y-2 border-t border-amber-200 pt-2">
                          <p className="text-xs font-bold text-slate-700">📝 개인 안전준수 서약 작성 (그 자리 처리)</p>
                          <div className="grid grid-cols-2 gap-2">
                            <select className="input-base text-sm" value={plForm.nationality} onChange={(e) => setPlForm({ ...plForm, nationality: e.target.value })}>
                              {['한국', '中国', 'Việt Nam', '기타'].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <select className="input-base text-sm" value={plForm.bloodType} onChange={(e) => setPlForm({ ...plForm, bloodType: e.target.value })}>
                              {['A형', 'B형', 'O형', 'AB형'].map((b) => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </div>
                          <input className="input-base text-sm" placeholder="직종 (예: 크레인 기사)" value={plForm.jobType} onChange={(e) => setPlForm({ ...plForm, jobType: e.target.value })} />
                          <details className="rounded bg-white border border-slate-200 p-2 text-[11px] leading-relaxed text-slate-600">
                            <summary className="cursor-pointer font-bold">서약 내용 보기</summary>
                            <p className="mt-1">{PLEDGE_INTRO}</p>
                            <ol className="list-decimal pl-4 mt-1 space-y-0.5">{PLEDGE_CLAUSES.map((c, ci) => <li key={ci}>{c}</li>)}</ol>
                          </details>
                          <label className="flex items-start gap-2 text-xs text-slate-700">
                            <input type="checkbox" className="mt-0.5" checked={plConfirm} onChange={(e) => setPlConfirm(e.target.checked)} />
                            <span>위 서약 내용을 확인하였으며 동의합니다.</span>
                          </label>
                          <div>
                            <label className="label">서약자 본인 서명 <span className="text-red-500">*</span></label>
                            <SignaturePad onChange={setPlSig} />
                          </div>
                          <button onClick={issueJoinPledge} disabled={plBusy || !plConfirm || !plSig || !plForm.jobType.trim()} className="btn-primary w-full text-xs">
                            {plBusy ? '발급 중…' : '서약서 발급 후 계속'}
                          </button>
                        </div>
                      )}

                      {joinCand.pledgeOk && joinCand.undertakingStatus !== 'VALID' && (
                        <div className="space-y-2 border-t border-amber-200 pt-2">
                          <p className="text-xs font-bold text-slate-700">📄 업체 이행각서 명단 추가 재발급</p>
                          <input className="input-base text-sm" placeholder="관리감독자명" value={utManager} onChange={(e) => setUtManager(e.target.value)} />
                          <button onClick={reissueUndertaking} disabled={utBusy || !utManager.trim()} className="btn-primary w-full text-xs">
                            {utBusy ? '재발급 중…' : '명단에 추가 재발급 후 계속'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {joinCand.docsOk && (
                    <>
                      <label className="flex items-start gap-2 text-sm text-slate-700">
                        <input type="checkbox" className="mt-0.5" checked={joinBriefed} onChange={(e) => setJoinBriefed(e.target.checked)} />
                        <span>이 작업의 <b>위험요인·안전대책을 설명받았습니까?</b> (설명 완료 확인)</span>
                      </label>
                      <div>
                        <label className="label">합류자 본인 서명 <span className="text-red-500">*</span></label>
                        <SignaturePad onChange={setJoinSig} />
                      </div>
                      <button onClick={submitJoin} disabled={joinBusy || !joinBriefed || !joinSig} className="btn-primary w-full text-sm">
                        {joinBusy ? '등록 중…' : '합류 등록 (시각 기록)'}
                      </button>
                    </>
                  )}
                </div>
              )}
              {joinMsg && <p className="text-xs text-red-600">{joinMsg}</p>}
              <button onClick={() => { setJoinOpen(false); setJoinCand(null); setJoinBlocked(''); setJoinMsg(''); }} className="text-xs text-slate-400 underline">닫기</button>
            </div>
          )}
        </section>
      )}

      {/* 장비 도착 등록 — 중장비·굴착 허가서에만, 종료확인 후 불가 */}
      {data.heavyOrExcav && !data.closed && (
        <section className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700">🚜 장비 도착 <span className="text-xs font-normal text-slate-400">({(data.arrivals ?? []).length}건)</span></h2>
            {!arrOpen && <button onClick={() => setArrOpen(true)} className="btn-primary text-xs px-3 py-1.5">장비 도착 등록</button>}
          </div>
          {(data.arrivals ?? []).length > 0 && (
            <ul className="text-xs text-slate-600 space-y-0.5">
              {(data.arrivals ?? []).map((a: any, i: number) => (
                <li key={i}>✅ {a.type}{a.vehicleNumber ? ` · ${a.vehicleNumber}` : ''} · 도착 {a.at ? new Date(new Date(a.at).getTime() + 9 * 3600 * 1000).toISOString().substring(11, 16) : ''}</li>
              ))}
            </ul>
          )}
          {arrOpen && (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <input className="input-base text-sm" placeholder="장비 종류 * (예: 크레인)" value={arrType} onChange={(e) => setArrType(e.target.value)} />
                <input className="input-base text-sm" placeholder="차량번호 (선택)" value={arrVehicle} onChange={(e) => setArrVehicle(e.target.value)} />
              </div>
              <input ref={arrFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addArrivalPhoto(e.target.files)} />
              {arrPhoto
                ? <img src={arrPhoto} alt="장비 사진" className="w-32 h-20 object-cover rounded border border-slate-200" />
                : null}
              <button onClick={() => arrFileRef.current?.click()} className="btn-secondary w-full text-sm">📷 장비 사진 촬영 (필수)</button>
              {arrMsg && <p className="text-xs text-red-600">{arrMsg}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setArrOpen(false); setArrMsg(''); }} className="btn-secondary flex-1 text-sm">닫기</button>
                <button onClick={submitArrival} disabled={arrBusy || !arrType.trim() || !arrPhoto} className="btn-primary flex-1 text-sm">
                  {arrBusy ? '등록 중…' : '+ 도착 등록 (시각 기록)'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <p className="text-[11px] text-slate-400 text-center">
        ※ 계획에 없던 위험작업(중장비 등)을 추가해야 하면 새 허가서를 신청하거나 관리자에게 되돌리기를 요청하세요.
      </p>

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
