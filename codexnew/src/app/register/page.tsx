'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  COMPANY_TYPES,
  companyStatusLabel,
  companyTypeLabel,
  type CompanyType,
} from '@/lib/company';

type TargetCode = 'TRUCK' | 'WORKER' | 'HEAVY';

const TARGETS: { code: TargetCode; label: string; emoji: string }[] = [
  { code: 'TRUCK', label: '화물차 기사', emoji: '🚚' },
  { code: 'WORKER', label: '일반 작업자', emoji: '👷' },
  { code: 'HEAVY', label: '중장비 기사', emoji: '🏗️' },
];

interface CompanySummary {
  id: string;
  name: string;
  company_type: CompanyType;
  status: string;
}

export default function RegisterPage() {
  const router = useRouter();

  // 업체 검색/선택
  const [companyKeyword, setCompanyKeyword] = useState('');
  const [companyResults, setCompanyResults] = useState<CompanySummary[]>([]);
  const [companySearching, setCompanySearching] = useState(false);
  const [companyTouched, setCompanyTouched] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<CompanySummary | null>(null);

  // 업체 신규 등록 인라인 폼
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyType, setNewCompanyType] = useState<CompanyType>('GENERAL');
  const [newCompanyManager, setNewCompanyManager] = useState('');
  const [newCompanyPhone, setNewCompanyPhone] = useState('');
  const [newCompanyLoading, setNewCompanyLoading] = useState(false);
  const [newCompanyError, setNewCompanyError] = useState('');

  // 기본정보
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [targetTypeCode, setTargetTypeCode] = useState<TargetCode | ''>('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const vehicleRequired =
    targetTypeCode === 'TRUCK' || targetTypeCode === 'HEAVY';

  useEffect(() => {
    // 동의를 먼저 하도록 강제
    if (sessionStorage.getItem('consent') !== 'Y') {
      router.replace('/consent');
    }
  }, [router]);

  // 업체 검색 (디바운스)
  const searchTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (selectedCompany) return; // 선택된 상태에선 검색 중지
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!companyTouched) return;

    searchTimer.current = setTimeout(async () => {
      setCompanySearching(true);
      try {
        const q = companyKeyword.trim();
        const url = q
          ? `/api/companies?keyword=${encodeURIComponent(q)}`
          : '/api/companies';
        const res = await fetch(url);
        const json = await res.json();
        if (json.success) setCompanyResults(json.data.items ?? []);
      } catch (e) {
        console.error(e);
      } finally {
        setCompanySearching(false);
      }
    }, 250);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKeyword, selectedCompany, companyTouched]);

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const onSelectCompany = (c: CompanySummary) => {
    setSelectedCompany(c);
    setCompanyKeyword(c.name);
    setCompanyResults([]);
    setShowNewCompany(false);
  };

  const onClearCompany = () => {
    setSelectedCompany(null);
    setCompanyKeyword('');
    setCompanyResults([]);
    setShowNewCompany(false);
    setCompanyTouched(true);
  };

  const onOpenNewCompany = () => {
    setShowNewCompany(true);
    setNewCompanyName(companyKeyword.trim());
    setNewCompanyError('');
  };

  const onSubmitNewCompany = async () => {
    setNewCompanyError('');
    const trimmed = newCompanyName.trim();
    if (!trimmed) {
      setNewCompanyError('업체명을 입력해 주세요.');
      return;
    }
    setNewCompanyLoading(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          companyType: newCompanyType,
          managerName: newCompanyManager.trim() || undefined,
          phone: newCompanyPhone.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setNewCompanyError(json.message || '등록 실패');
        return;
      }
      // 등록 후 바로 선택 가능
      onSelectCompany(json.data as CompanySummary);
      setNewCompanyManager('');
      setNewCompanyPhone('');
    } catch (e) {
      console.error(e);
      setNewCompanyError('네트워크 오류가 발생했습니다.');
    } finally {
      setNewCompanyLoading(false);
    }
  };

  const canSubmit =
    !!selectedCompany &&
    name.trim() &&
    birthDate &&
    phone.length >= 10 &&
    targetTypeCode &&
    (!vehicleRequired || vehicleNumber.trim().length > 0) &&
    !loading;

  const onSubmit = async () => {
    if (!selectedCompany) {
      setError('업체를 먼저 선택해 주세요.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      // 1. 기존 수료 조회
      const lookupRes = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, birthDate, name }),
      });
      const lookup = await lookupRes.json();

      if (lookup.success && lookup.data.status === 'VALID') {
        sessionStorage.setItem('existingCompletion', JSON.stringify(lookup.data));
        router.push('/lookup/result');
        return;
      }

      // 2. 세션 생성
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          affiliation: selectedCompany.name, // 백업용 — 서버가 companyId 우선 사용
          name,
          birthDate,
          phone,
          targetTypeCode,
          vehicleNumber: vehicleRequired ? vehicleNumber.trim() : null,
          consentYn: true,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.message || '세션 생성에 실패했습니다.');
        setLoading(false);
        return;
      }

      sessionStorage.setItem('sessionId', json.data.sessionId);
      router.push('/video');
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 2 / 5</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">기본정보 입력</h1>
        <p className="mt-1 text-sm text-slate-500">
          수료증 발급에 필요한 정보입니다.
        </p>
      </header>

      <div className="space-y-4">
        {/* 업체 검색/선택 */}
        <div>
          <label className="label">소속 (업체명)</label>

          {selectedCompany ? (
            <div className="flex items-center justify-between rounded-xl border-2 border-brand bg-brand/5 px-4 py-3">
              <div>
                <p className="font-bold text-slate-800">{selectedCompany.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {companyTypeLabel(selectedCompany.company_type)} ·{' '}
                  {companyStatusLabel(selectedCompany.status)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClearCompany}
                className="text-sm text-slate-500 hover:text-slate-700 underline"
              >
                변경
              </button>
            </div>
          ) : (
            <>
              <input
                className="input-base"
                value={companyKeyword}
                onFocus={() => setCompanyTouched(true)}
                onChange={(e) => {
                  setCompanyKeyword(e.target.value);
                  setCompanyTouched(true);
                }}
                placeholder="업체명을 입력해 검색하세요"
              />
              <p className="mt-1 text-xs text-slate-500">
                업체를 검색해 선택하거나, 검색 결과에 없으면 아래 "신규 업체 등록"을 눌러 등록해 주세요.
              </p>

              {companyTouched && (
                <div className="mt-2 space-y-2">
                  {companySearching ? (
                    <p className="text-xs text-s
