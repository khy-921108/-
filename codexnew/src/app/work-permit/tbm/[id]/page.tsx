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
import { writeSharedActivity } from '@/lib/admin-session';

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

  // ── 현장 추가 등록(통합: 작업자 합류 + 장비 도착) ──
  const [addOpen, setAddOpen] = useState(false);
  const [addWorker, setAddWorker] = useState(false);
  const [addEquip, setAddEquip] = useState(false);
  const [addMsg, setAddMsg] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  // 작업자
  const [joinForm, setJoinForm] = useState({ name: '', birthDate: '', phone: '' });
  const [joinCand, setJoinCand] = useState<any>(null);   // 교육·서류 확인 결과
  const [joinBlocked, setJoinBlocked] = useState('');    // 교육 없음/만료
  const [joinBriefed, setJoinBriefed] = useState(false);
  const [joinSig, setJoinSig] = useState('');
  // 필수서류 그 자리 처리
  const [plForm, setPlForm] = useState({ nationality: '한국', bloodType: 'A형', jobType: '' });
  const [plConfirm, setPlConfirm] = useState(false);
  const [plSig, setPlSig] = useState('');
  const [plBusy, setPlBusy] = useState(false);
  const [utManager, setUtManager] = useState('');
  const [utBusy, setUtBusy] = useState(false);
  // 장비(여러 대)
  const [equipRows, setEquipRows] = useState<{ type: string; vehicleNumber: string }[]>([{ type: '', vehicleNumber: '' }]);
  // 현장 사진(항상 필수)
  const addFileRef = useRef<HTMLInputElement>(null);
  const [fieldPhoto, setFieldPhoto] = useState('');
  // 재시도해도 중복 등록되지 않게 하는 요청 식별자(등록 성공/취소 시 초기화)
  const addReqIdRef = useRef('');
  // 장비 도착 등록 완료 안내
  const [equipNotice, setEquipNotice] = useState(false);
  // 관리자 모드 여부(세션 만료 안내를 업체 경로와 구분하기 위해 기억)
  const adminModeRef = useRef(false);
  const [adminExpired, setAdminExpired] = useState(false);

  const call = useCallback(async (c: Cred, extra: any) => {
    const ac = new AbortController();
    // 🔴 서버 maxDuration(30초)보다 길게. 짧으면 서버는 저장 중인데 클라만 끊겨서
    //    재시도 두 건이 같은 스냅샷을 읽고 중복 등록될 수 있다.
    const t = setTimeout(() => ac.abort(), 35000);
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
    if (!json.success) {
      // 관리자 모드로 쓰던 중 관리자 세션이 끊긴 경우 — "본인확인 정보를 입력하세요"는 오해를 부른다.
      if (adminModeRef.current) { setAdminExpired(true); setData(null); return false; }
      setError(json.message || '조회 실패'); setData(null); return false;
    }
    if (json.data?.isAdmin) adminModeRef.current = true;
    setCred(c); setData(json.data); return true;
  }, [call]);

  // 관리자 모드일 때는 이 화면에서도 관리자 세션이 살아 있어야 한다.
  // 실제 조작(클릭·입력·스크롤)이 있었을 때만 heartbeat 를 보낸다 — 관리자 화면과 같은 기준.
  useEffect(() => {
    if (!data?.isAdmin) return;
    let touched = Date.now();
    let pinged = 0;
    let written = 0;
    // 관리자 화면들과 같은 공유 기록을 쓴다 — 여기서 작업 중이면 다른 관리자 탭도 로그아웃되지 않는다.
    const mark = () => {
      touched = Date.now();
      if (touched - written > 5000) { written = touched; writeSharedActivity(touched); }
    };
    const evs: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    writeSharedActivity();
    const timer = setInterval(async () => {
      if (touched <= pinged) return;
      pinged = Date.now();
      try {
        const res = await fetch('/api/admin/heartbeat', { method: 'POST' });
        if (res.status === 401) setAdminExpired(true);
      } catch { /* 네트워크 오류 무시 */ }
    }, 60 * 1000);
    return () => { evs.forEach((e) => window.removeEventListener(e, mark)); clearInterval(timer); };
  }, [data?.isAdmin]);

  // 진입 시: ① 관리자 로그인 세션이면 본인확인 없이 바로 진행(서버가 세션으로 인증)
  //          ② 아니면 sessionStorage 자격 자동 사용(업체 경로)
  useEffect(() => {
    let cred0: Cred | null = null;
    try {
      const raw = sessionStorage.getItem('wp_tbm_cred');
      if (raw) cred0 = JSON.parse(raw);
    } catch { /* */ }
    if (cred0) setForm(cred0);
    // 빈 자격으로 먼저 시도 → 관리자 세션이면 통과, 아니면 실패(조용히 무시하고 본인확인 폼 표시)
    const boot = async () => {
      const probe: Cred = cred0 ?? { name: '', birthDate: '', phone: '' };
      const json = await call(probe, { action: 'session' });
      if (json.success) { setCred(probe); setData(json.data); }
    };
    boot();
  }, [call]);

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

  // 작업자 교육·서류 확인(저장 없음)
  const checkWorker = async () => {
    if (!cred) return;
    setAddMsg(''); setJoinBlocked(''); setJoinCand(null);
    if (!joinForm.name.trim() || !joinForm.birthDate || joinForm.phone.length < 10) {
      setAddMsg('작업자의 이름·생년월일·연락처를 정확히 입력해 주세요.'); return;
    }
    setAddBusy(true);
    const json = await call(cred, {
      action: 'check-worker',
      joinName: joinForm.name.trim(), joinBirthDate: joinForm.birthDate, joinPhone: joinForm.phone,
    });
    setAddBusy(false);
    if (!json.success) {
      if (json.code === 'NOT_ELIGIBLE') setJoinBlocked(json.message || '안전교육을 먼저 받아야 합니다.');
      else setAddMsg(json.message || '확인 실패');
      return;
    }
    setJoinCand(json.data); setJoinBriefed(false); setJoinSig('');
    setPlForm({ nationality: '한국', bloodType: 'A형', jobType: '' }); setPlConfirm(false); setPlSig('');
    setUtManager(json.data?.undertakingManagerName ?? '');
  };

  // 개인서약 그 자리 작성 → 재확인
  const issueJoinPledge = async () => {
    if (!joinCand) return;
    if (!plForm.jobType.trim()) { setAddMsg('직종을 입력해 주세요.'); return; }
    if (!plConfirm) { setAddMsg('서약 내용 확인에 동의해 주세요.'); return; }
    if (!plSig) { setAddMsg('서약자 본인 서명을 입력해 주세요.'); return; }
    setPlBusy(true); setAddMsg('');
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
      if (!j.success) { setAddMsg(j.message || '서약서 발급 실패'); return; }
      await checkWorker();
    } catch { setAddMsg('네트워크 오류'); } finally { setPlBusy(false); }
  };

  // 이행각서 명단 추가 재발급 → 재확인
  const reissueUndertaking = async () => {
    if (!joinCand?.companyId) { setAddMsg('업체 정보가 없어 각서를 재발급할 수 없습니다.'); return; }
    if (!utManager.trim()) { setAddMsg('관리감독자명을 입력해 주세요.'); return; }
    setUtBusy(true); setAddMsg('');
    try {
      const res = await fetch('/api/company-undertakings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: joinCand.companyId, managerName: utManager.trim(),
          members: [{ name: joinForm.name.trim(), birthDate: joinForm.birthDate, phone: joinForm.phone }],
        }),
      });
      const j = await res.json();
      if (!j.success) { setAddMsg(j.message || '이행각서 재발급 실패'); return; }
      await checkWorker();
    } catch { setAddMsg('네트워크 오류'); } finally { setUtBusy(false); }
  };

  const pickAddPhoto = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    try { setFieldPhoto(await resizeToDataUrl(files[0])); setAddMsg(''); } catch { setAddMsg('사진 처리 실패'); }
    finally { if (addFileRef.current) addFileRef.current.value = ''; }
  };

  const resetAddForm = () => {
    setAddOpen(false); setAddWorker(false); setAddEquip(false); setAddMsg('');
    setJoinForm({ name: '', birthDate: '', phone: '' }); setJoinCand(null); setJoinBlocked('');
    setJoinBriefed(false); setJoinSig('');
    setEquipRows([{ type: '', vehicleNumber: '' }]); setFieldPhoto('');
    addReqIdRef.current = '';
  };

  // 통합 등록 제출 — 서버가 동일 검증(사진 필수, 작업자면 서류·서명 필수)
  const submitFieldAdd = async () => {
    if (!cred) return;
    if (!addWorker && !addEquip) { setAddMsg('추가할 항목을 최소 1개 선택해 주세요.'); return; }
    if (!fieldPhoto) { setAddMsg('현장 사진을 촬영해 주세요(필수).'); return; }
    if (addWorker) {
      if (!joinCand) { setAddMsg('작업자의 [교육·서류 확인]을 먼저 진행해 주세요.'); return; }
      if (!joinCand.docsOk) { setAddMsg('필수서류를 먼저 처리해 주세요.'); return; }
      if (!joinBriefed) { setAddMsg('위험요인·안전대책 설명 확인에 체크해 주세요.'); return; }
      if (!joinSig) { setAddMsg('작업자 서명을 입력해 주세요.'); return; }
    }
    const equipment = equipRows.map((r) => ({ type: r.type.trim(), vehicleNumber: r.vehicleNumber.trim() })).filter((r) => r.type);
    if (addEquip && equipment.length === 0) { setAddMsg('장비 종류를 입력해 주세요.'); return; }

    // 같은 등록 시도에는 같은 requestId 를 쓴다 → 통신이 끊겨 재시도해도 서버에서 중복 등록되지 않는다.
    if (!addReqIdRef.current) {
      addReqIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    const hadEquip = addEquip;

    setAddBusy(true); setAddMsg('');
    const json = await call(cred, {
      action: 'field-add',
      requestId: addReqIdRef.current,
      addWorker, addEquipment: addEquip,
      image: fieldPhoto,
      joinName: joinForm.name.trim(), joinBirthDate: joinForm.birthDate, joinPhone: joinForm.phone,
      briefed: addWorker ? joinBriefed : undefined,
      signature: addWorker ? joinSig : undefined,
      equipment: addEquip ? equipment : [],
    });
    if (!json.success) {
      // 통신이 끊겼을 뿐 서버는 저장했을 수 있다 → 재시도 안내 전에 실제 등록 여부를 확인한다.
      const check = await call(cred, { action: 'session' });
      const done = check?.success && (check.data?.additionRequestIds ?? []).includes(addReqIdRef.current);
      setAddBusy(false);
      if (done) {
        setData(check.data);
        resetAddForm();
        if (hadEquip) setEquipNotice(true);
        return;
      }
      // 서버는 "전부 저장" 또는 "전부 취소" 로만 끝난다 — 반쪽 저장은 없으니 그대로 재시도하면 된다.
      setAddMsg(`${json.message || '등록에 실패했습니다.'} (등록된 내용 없음 — 같은 화면에서 다시 시도하면 중복되지 않습니다)`);
      return;
    }
    setAddBusy(false);
    resetAddForm();
    // 장비 투입 안내 — 재서명을 강제하지는 않는다
    if (hadEquip) setEquipNotice(true);
    await loadSession(cred);
  };

  // ── 관리자 세션 만료(관리자 모드로 들어온 경우) ──
  if (adminExpired) {
    return (
      <main className="space-y-5">
        <div className="card text-center space-y-3 py-8">
          <p className="text-3xl">⏱</p>
          <h1 className="text-lg font-bold text-slate-800">세션이 만료되었습니다</h1>
          <p className="text-sm text-slate-500">장시간 사용하지 않아 관리자 로그인이 해제되었습니다.<br />다시 로그인해 주세요.</p>
          <a href="/admin/login?expired=1" className="btn-primary inline-block">관리자 로그인</a>
        </div>
      </main>
    );
  }

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

      {/* 관리자 로그인으로 들어온 경우 — 본인확인 생략, 나머지 규칙은 업체와 동일 */}
      {data.isAdmin && (
        <div className="card bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm space-y-1">
          <p>🛡 <b>관리자 모드</b>로 접속했습니다. 등록 주체가 <b>관리자</b>로 기록됩니다. (신청인: {data.applicantName ?? '-'})</p>
          <p className="text-xs">
            관리자는 <b>현장 추가 등록</b>만 할 수 있습니다. TBM 사진·작업자 서명·제출은 <b>신청인 본인</b>만 가능합니다(대행 불가).
          </p>
        </div>
      )}

      {/* 제출/확인 상태 */}
      {data.tbmSubmitted && (
        <div className={`card text-sm font-bold ${data.witnessConfirmed ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-sky-50 border border-sky-200 text-sky-700'}`}>
          {data.witnessConfirmed
            ? '✅ 현장담당자 확인 완료'
            : '✅ TBM 제출 완료 — 현장담당자 확인 절차 진행 중입니다 (2차 입회)'}
        </div>
      )}

      {/* ① 사진 — 관리자 모드에서는 대행 불가(서버도 403) */}
      <section className="card space-y-2">
        <h2 className="font-bold text-slate-700">① TBM 현장 사진 <span className="text-xs text-slate-400">({data.photoCount}/{data.maxPhotos})</span></h2>
        <div className="flex gap-2 flex-wrap">
          {previews.map((p, i) => <img key={i} src={p} alt={`사진${i + 1}`} className="w-24 h-14 object-cover rounded border border-slate-200" />)}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhoto(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || data.isAdmin || data.photoCount >= data.maxPhotos || data.witnessConfirmed}
          className={`w-full rounded-lg py-2 text-sm font-bold ${data.isAdmin || data.photoCount >= data.maxPhotos || data.witnessConfirmed ? 'bg-slate-100 text-slate-400' : 'btn-secondary'}`}>
          📷 {data.isAdmin ? '신청인 본인만 가능' : data.witnessConfirmed ? '확인 완료(수정 불가)' : data.photoCount >= data.maxPhotos ? '사진 2장 완료' : '사진 촬영/선택'}
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
                <span className="text-xs font-bold text-emerald-600">✅ 서명완료 {!data.witnessConfirmed && !data.isAdmin && <button onClick={() => setSignFor(r.name)} className="ml-1 text-slate-400 underline">재서명</button>}</span>
              ) : (data.witnessConfirmed || data.isAdmin) ? (
                <span className="text-xs text-slate-400">미서명</span>
              ) : (
                <button onClick={() => { setSig(''); setSignFor(r.name); }} className="btn-primary text-xs px-3 py-1.5">서명</button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 제출 */}
      {!data.witnessConfirmed && !data.isAdmin && (
        <section className="card space-y-2">
          <button onClick={submitTbm} disabled={busy || data.tbmSubmitted || (data.photoCount === 0 && confirmedCount === 0)}
            className={`w-full rounded-lg py-3 font-bold ${data.tbmSubmitted || (data.photoCount === 0 && confirmedCount === 0) ? 'bg-slate-100 text-slate-400' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
            {data.tbmSubmitted ? '✅ 제출 완료 (확인 대기)' : '제출 (안전환경 2차 확인 요청)'}
          </button>
          {!data.tbmSubmitted && data.photoCount === 0 && confirmedCount === 0 && <p className="text-[11px] text-amber-600 text-center">사진 또는 작업자 서명을 1개 이상 완료해야 제출할 수 있습니다.</p>}
          {data.tbmSubmitted && <p className="text-[11px] text-slate-400 text-center">제출 후에도 2차 확인 전까지 사진·서명을 추가할 수 있습니다.</p>}
        </section>
      )}

      {/* 현장 추가 등록(통합) — 개시 후에도 가능. 종료확인 후 숨김 */}
      {!data.closed && (
        <section className="card space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-bold text-slate-700">
              ➕ 현장 추가 등록
              {(data.additions ?? []).length > 0 && <span className="text-xs font-normal text-slate-400"> (기존 {(data.additions ?? []).length}건)</span>}
            </h2>
            {!addOpen && <button onClick={() => setAddOpen(true)} className="btn-primary text-xs px-3 py-1.5 shrink-0 whitespace-nowrap">+ 현장 추가 등록</button>}
          </div>

          {equipNotice && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-900 space-y-1">
              <p>🚜 <b>장비 도착이 등록되었습니다.</b></p>
              <p className="text-xs">장비 투입으로 위험이 달라졌다면 기존 작업자에게도 변경된 위험·안전대책을 알려주세요.</p>
              <button onClick={() => setEquipNotice(false)} className="text-xs font-bold underline">확인했습니다</button>
            </div>
          )}

          {(data.additions ?? []).length > 0 && (
            <ul className="text-xs text-slate-600 space-y-0.5">
              {(data.additions ?? []).map((f: any, i: number) => (
                <li key={i}>
                  ✅ {f.workerCount > 0 ? `작업자 ${f.workerCount}명` : ''}{f.workerCount > 0 && f.equipCount > 0 ? ' · ' : ''}{f.equipCount > 0 ? `장비 ${f.equipCount}대` : ''}
                  {' · '}{f.at ? new Date(new Date(f.at).getTime() + 9 * 3600 * 1000).toISOString().substring(11, 16) : ''}
                  {f.actorType === 'ADMIN' ? ' (관리자)' : ' (소장)'}
                </li>
              ))}
            </ul>
          )}

          {addOpen && (
            <div className="space-y-3 pt-1">
              {/* ① 무엇이 추가됩니까? */}
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
                <p className="text-sm font-bold text-slate-700">무엇이 추가됩니까?</p>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={addWorker} onChange={(e) => { setAddWorker(e.target.checked); setAddMsg(''); }} />
                  <span>작업자 합류</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={addEquip} onChange={(e) => { setAddEquip(e.target.checked); setAddMsg(''); }} disabled={!data.heavyOrExcav} />
                  <span>장비 도착{!data.heavyOrExcav && <span className="text-xs text-slate-400"> (중장비·굴착 허가서만)</span>}</span>
                </label>
                {addEquip && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    ⚠ 장비 운전기사도 안전교육을 받아야 합니다. 기사가 참여자 명단에 없으면 <b>[작업자 합류]</b>도 함께 체크하세요.
                  </p>
                )}
                {data.reported && (
                  <p className="text-[11px] text-red-600">※ 종료신고 이후에는 작업자·장비를 추가 등록할 수 없습니다.</p>
                )}
              </div>

              {/* ② 작업자 */}
              {addWorker && (
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="text-sm font-bold text-slate-700">👷 합류 작업자</p>
                  <input className="input-base text-sm" placeholder="이름" value={joinForm.name}
                    onChange={(e) => { setJoinForm({ ...joinForm, name: e.target.value }); setJoinCand(null); }} />
                  <input type="date" className="input-base text-sm" value={joinForm.birthDate}
                    onChange={(e) => { setJoinForm({ ...joinForm, birthDate: e.target.value }); setJoinCand(null); }} aria-label="생년월일" />
                  <input type="tel" inputMode="numeric" className="input-base text-sm" placeholder="연락처(숫자만)" value={joinForm.phone}
                    onChange={(e) => { setJoinForm({ ...joinForm, phone: e.target.value.replace(/[^0-9]/g, '').slice(0, 11) }); setJoinCand(null); }} />

                  {!joinCand && !joinBlocked && (
                    <button onClick={checkWorker} disabled={addBusy} className="btn-secondary w-full text-sm">{addBusy ? '확인 중…' : '교육·서류 확인'}</button>
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

                      {!joinCand.docsOk && (
                        <div className="rounded-lg bg-amber-50 border border-amber-300 p-2 space-y-2">
                          <p className="text-xs font-bold text-amber-800">⚠ 필수서류 미비: {(joinCand.docsMissing ?? []).join(', ')}</p>
                          {!joinCand.pledgeOk && (
                            <div className="space-y-2 border-t border-amber-200 pt-2">
                              <p className="text-xs font-bold text-slate-700">📝 개인 안전준수 서약 작성</p>
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
                            <label className="label">작업자 본인 서명 <span className="text-red-500">*</span></label>
                            <SignaturePad onChange={setJoinSig} />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ③ 장비 */}
              {addEquip && (
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="text-sm font-bold text-slate-700">🚜 도착 장비</p>
                  {equipRows.map((r, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input className="input-base text-sm flex-1 min-w-0" placeholder="종류 * (예: 크레인)" value={r.type}
                        onChange={(e) => setEquipRows((rows) => rows.map((x, idx) => idx === i ? { ...x, type: e.target.value } : x))} />
                      <input className="input-base text-sm flex-1 min-w-0" placeholder="차량번호 (선택)" value={r.vehicleNumber}
                        onChange={(e) => setEquipRows((rows) => rows.map((x, idx) => idx === i ? { ...x, vehicleNumber: e.target.value } : x))} />
                      {equipRows.length > 1 && (
                        <button onClick={() => setEquipRows((rows) => rows.filter((_, idx) => idx !== i))} className="text-xs text-red-600 shrink-0">삭제</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setEquipRows((rows) => [...rows, { type: '', vehicleNumber: '' }])} className="btn-secondary w-full text-xs">+ 장비 추가</button>
                </div>
              )}

              {/* ④ 현장 사진 — 항상 필수 */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <p className="text-sm font-bold text-slate-700">📷 현장 사진 <span className="text-red-500">*</span></p>
                <p className="text-[11px] text-slate-500">
                  {addEquip
                    ? '사람과 장비가 함께 찍히게 촬영해 주세요.'
                    : 'TBM 실시 장면(설명하는 모습)을 촬영해 주세요.'}
                </p>
                {fieldPhoto && <img src={fieldPhoto} alt="현장 사진" className="w-40 h-24 object-cover rounded border border-slate-200" />}
                <input ref={addFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickAddPhoto(e.target.files)} />
                <button onClick={() => addFileRef.current?.click()} className="btn-secondary w-full text-sm">📷 {fieldPhoto ? '사진 다시 촬영' : '사진 촬영'}</button>
              </div>

              {addMsg && <p className="text-xs text-red-600">{addMsg}</p>}
              <div className="flex gap-2">
                <button onClick={resetAddForm} className="btn-secondary flex-1 text-sm">취소</button>
                <button onClick={submitFieldAdd} disabled={addBusy || (!addWorker && !addEquip) || !fieldPhoto} className="btn-primary flex-1 text-sm">
                  {addBusy ? '등록 중…' : '현장 추가 등록 (시각 기록)'}
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
