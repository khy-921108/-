'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { readDraft, writeDraft } from '@/lib/work-permit-draft';
import { companyTypeLabel } from '@/lib/company';

interface CompanySummary {
  id: string;
  name: string;
  company_type: string;
  status: string;
}

export default function WorkPermitStart() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [gate, setGate] = useState<'IDLE' | 'OK'>('IDLE');

  // 본인 업체(기본) + 변경/신규
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<CompanySummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLoading, setNewLoading] = useState(false);
  const [newErr, setNewErr] = useState('');

  useEffect(() => {
    const d = readDraft();
    if (d.applicant) {
      setName(d.applicant.name);
      setBirthDate(d.applicant.birthDate);
      setPhone(d.applicant.phone);
    }
    if (d.company) {
      setCompany(d.company);
      setGate('OK');
    }
  }, []);

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const onVerify = async () => {
    setError('');
    if (!name.trim() || !birthDate || phone.length < 10) {
      setError('이름·생년월일·연락처를 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/work-permits/verify-applicant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, birthDate, phone }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '확인에 실패했습니다.');
        return;
      }
      const status = json.data.status;
      if (status === 'NO_EDU') {
        setError('유효한 안전교육 수료 내역이 없습니다. 먼저 안전교육을 이수해 주세요.');
        return;
      }
      if (status === 'NO_COMPANY') {
        setError('업체 정보가 등록되어 있지 않습니다. 교육 신청 시 업체를 먼저 등록해 주세요.');
        return;
      }
      // OK
      const comp = json.data.company as { id: string; name: string };
      setCompany(comp);
      setGate('OK');
      writeDraft({
        applicant: { name: name.trim(), birthDate, phone, companyId: comp.id },
        company: comp,
      });
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 업체 변경 검색 (디바운스)
  const timer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!changing) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const q = keyword.trim();
        const url = q ? `/api/companies?keyword=${encodeURIComponent(q)}` : '/api/companies';
        const res = await fetch(url);
        const json = await res.json();
        if (json.success) setResults(json.data.items ?? []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [keyword, changing]);

  const selectCompany = (c: CompanySummary) => {
    const comp = { id: c.id, name: c.name };
    setCompany(comp);
    setChanging(false);
    setShowNew(false);
    setResults([]);
    writeDraft({ company: comp });
  };

  const submitNewCompany = async () => {
    setNewErr('');
    if (!newName.trim()) {
      setNewErr('업체명을 입력해 주세요.');
      return;
    }
    setNewLoading(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const json = await res.json();
      if (!json.success) {
        setNewErr(json.message || '등록 실패');
        return;
      }
      selectCompany(json.data as CompanySummary);
      setNewName('');
    } catch (e) {
      console.error(e);
      setNewErr('네트워크 오류가 발생했습니다.');
    } finally {
      setNewLoading(false);
    }
  };

  const goNext = () => {
    if (!company) return;
    writeDraft({
      applicant: { name: name.trim(), birthDate, phone, companyId: company.id },
      company,
    });
    router.push('/work-permit/info');
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 1 / 5</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">신청자 본인확인</h1>
        <p className="mt-1 text-sm text-slate-500">
          작업허가 신청은 <b>안전교육 수료 + 업체 등록</b>을 마친 분만 가능합니다.
        </p>
      </header>

      {/* 접이식 안내 가이드 (기본 펼침) */}
      <details open className="card">
        <summary className="cursor-pointer font-bold text-slate-800 text-sm select-none">📋 작업허가서 안내 (처음이면 펼쳐보세요)</summary>
        <div className="mt-3 space-y-2.5 text-sm text-slate-600">
          <div>
            <p className="font-bold text-slate-700">허가서가 필요한 작업</p>
            <p>화기·고소·밀폐·전기·중장비 등 위험작업과 공사성 작업. <span className="text-slate-400">(단순 납품·하역·방문은 출입증만으로 가능)</span></p>
          </div>
          <div>
            <p className="font-bold text-slate-700">준비물</p>
            <p>참여 작업자 전원 안전교육 수료 + 신청인(현장소장) 서명.</p>
          </div>
          <div>
            <p className="font-bold text-slate-700">절차</p>
            <p>신청 → 승인 → 현장 도착 후 TBM(사진+전원 서명) → 현장담당자 확인 → 작업 개시 → 종료신고.</p>
          </div>
          <div>
            <p className="font-bold text-slate-700">규칙</p>
            <p>허가서는 <b>당일 하루만 유효</b>(매일 신청). 지난 허가서는 조회 화면의 <b>[같은 내용으로 재신청]</b>으로 간편하게.</p>
          </div>
        </div>
      </details>

      {gate !== 'OK' ? (
        <div className="space-y-4">
          <div>
            <label className="label">성명</label>
            <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
          </div>
          <div>
            <label className="label">생년월일</label>
            <input type="date" className="input-base" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div>
            <label className="label">연락처 (숫자만)</label>
            <input
              type="tel"
              inputMode="numeric"
              className="input-base"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="01012345678"
            />
          </div>
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <button type="button" onClick={onVerify} disabled={loading} className="btn-primary">
            {loading ? '확인 중...' : '본인확인'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/work-permit/my')}
            className="w-full text-center text-sm text-slate-500 underline mt-1"
          >
            이미 신청한 내역 조회 →
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
            ✅ 교육 수료 확인 완료 — <b>{name}</b> 님
          </div>

          <div>
            <label className="label">작업요청 업체</label>
            {!changing ? (
              <div className="flex items-center justify-between rounded-xl border-2 border-brand bg-brand/5 px-4 py-3">
                <p className="font-bold text-slate-800">{company?.name}</p>
                <button
                  type="button"
                  onClick={() => { setChanging(true); setKeyword(''); setResults([]); }}
                  className="text-sm text-slate-500 hover:text-slate-700 underline"
                >
                  변경
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  className="input-base"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="업체명 검색"
                />
                {searching ? (
                  <p className="text-xs text-slate-400 px-1">검색 중...</p>
                ) : results.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-center text-sm text-slate-500">
                    검색된 업체가 없습니다.
                  </div>
                ) : (
                  <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => selectCompany(c)} className="w-full px-4 py-3 text-left hover:bg-slate-50">
                          <p className="font-semibold text-slate-800">{c.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{companyTypeLabel(c.company_type)}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!showNew ? (
                  <button type="button" onClick={() => { setShowNew(true); setNewName(keyword.trim()); }} className="w-full rounded-xl border-2 border-dashed border-brand bg-white px-4 py-3 text-sm font-bold text-brand hover:bg-brand/5">
                    + 신규 업체 등록
                  </button>
                ) : (
                  <div className="rounded-xl border-2 border-brand/40 bg-white p-4 space-y-3">
                    <label className="label">업체명 *</label>
                    <input className="input-base" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    {newErr && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{newErr}</div>}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setShowNew(false)} className="btn-secondary">취소</button>
                      <button type="button" onClick={submitNewCompany} disabled={newLoading} className="btn-primary">
                        {newLoading ? '등록 중...' : '등록 후 선택'}
                      </button>
                    </div>
                  </div>
                )}
                <button type="button" onClick={() => setChanging(false)} className="text-xs text-slate-500 underline">
                  취소 (기존 업체 유지)
                </button>
              </div>
            )}
          </div>

          <button type="button" onClick={goNext} disabled={!company} className="btn-primary">
            다음
          </button>
        </div>
      )}
    </main>
  );
}
