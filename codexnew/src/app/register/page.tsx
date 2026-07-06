'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  COMPANY_TYPES,
  companyStatusLabel,
  companyTypeLabel,
  type CompanyType,
} from '@/lib/company';
import { EQUIPMENT_TYPES, type EquipmentType } from '@/lib/equipment';

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

  // 1B 확장 필드
  const [spec, setSpec] = useState('');
  const [equipmentType, setEquipmentType] = useState<EquipmentType | ''>('');
  const [equipmentTypeEtc, setEquipmentTypeEtc] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // [R-5] 휴대폰 문자 인증(OTP)
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState(''); // 인증 당시 번호(변경 시 재인증)
  const [otpTtlLeft, setOtpTtlLeft] = useState(0);        // 남은 유효시간(초)
  const [otpResendLeft, setOtpResendLeft] = useState(0);  // 재전송 대기(초)
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpNotice, setOtpNotice] = useState('');

  const vehicleRequired =
    targetTypeCode === 'TRUCK' || targetTypeCode === 'HEAVY';

  // OTP 카운트다운 (1초 틱)
  useEffect(() => {
    if (otpTtlLeft <= 0 && otpResendLeft <= 0) return;
    const t = setInterval(() => {
      setOtpTtlLeft((s) => (s > 0 ? s - 1 : 0));
      setOtpResendLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [otpTtlLeft > 0, otpResendLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // 번호를 바꾸면 인증 무효 (다른 번호로 통과 방지)
  useEffect(() => {
    if (otpVerified && phone !== verifiedPhone) {
      setOtpVerified(false);
      setOtpSent(false);
      setOtpCode('');
      setOtpNotice('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const sendOtp = async () => {
    setOtpError('');
    setOtpNotice('');
    setOtpLoading(true);
    try {
      const res = await fetch('/api/verify-phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!json.success) {
        setOtpError(json.message || '발송 실패');
        if (typeof json.retryAfterSec === 'number') setOtpResendLeft(json.retryAfterSec);
        return;
      }
      setOtpSent(true);
      setOtpCode('');
      setOtpTtlLeft(json.data?.ttlSec ?? 120);
      setOtpResendLeft(json.data?.resendSec ?? 90);
      setOtpNotice('인증번호를 문자로 보냈습니다.');
    } catch {
      setOtpError('네트워크 오류가 발생했습니다.');
    } finally {
      setOtpLoading(false);
    }
  };

  const confirmOtp = async () => {
    setOtpError('');
    setOtpLoading(true);
    try {
      const res = await fetch('/api/verify-phone/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: otpCode }),
      });
      const json = await res.json();
      if (!json.success) {
        setOtpError(json.message || '인증 실패');
        return;
      }
      setOtpVerified(true);
      setVerifiedPhone(phone);
      setOtpNotice('');
    } catch {
      setOtpError('네트워크 오류가 발생했습니다.');
    } finally {
      setOtpLoading(false);
    }
  };

  useEffect(() => {
    if (sessionStorage.getItem('consent') !== 'Y') {
      router.replace('/consent');
    }
  }, [router]);

  // 업체 검색 (디바운스)
  const searchTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (selectedCompany) return;
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

  // 대상 변경 시 종속 필드 리셋
  useEffect(() => {
    if (targetTypeCode !== 'TRUCK' && targetTypeCode !== 'HEAVY') {
      setSpec('');
    }
    if (targetTypeCode !== 'HEAVY') {
      setEquipmentType('');
      setEquipmentTypeEtc('');
    }
    if (!vehicleRequired) {
      setVehicleNumber('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTypeCode]);

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

  // 폼 검증 (1B 추가)
  const specRequired = targetTypeCode === 'TRUCK' || targetTypeCode === 'HEAVY';
  const equipmentRequired = targetTypeCode === 'HEAVY';
  const equipmentEtcRequired = equipmentType === 'ETC';

  const canSubmit =
    !!selectedCompany &&
    name.trim() &&
    birthDate &&
    phone.length >= 10 &&
    otpVerified &&
    verifiedPhone === phone &&
    targetTypeCode &&
    (!vehicleRequired || vehicleNumber.trim().length > 0) &&
    (!specRequired || spec.trim().length > 0) &&
    (!equipmentRequired || equipmentType !== '') &&
    (!equipmentEtcRequired || equipmentTypeEtc.trim().length > 0) &&
    !loading;

  const onSubmit = async () => {
    if (!selectedCompany) {
      setError('업체를 먼저 선택해 주세요.');
      return;
    }
    setError('');
    setLoading(true);

    try {
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

      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          affiliation: selectedCompany.name,
          name,
          birthDate,
          phone,
          targetTypeCode,
          vehicleNumber: vehicleRequired ? vehicleNumber.trim() : null,
          spec: specRequired ? spec.trim() : null,
          equipmentType: equipmentRequired ? equipmentType : null,
          equipmentTypeEtc:
            equipmentRequired && equipmentType === 'ETC'
              ? equipmentTypeEtc.trim()
              : null,
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
                    <p className="text-xs text-slate-400 px-1">검색 중...</p>
                  ) : companyResults.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-center text-sm text-slate-500">
                      검색된 업체가 없습니다.
                    </div>
                  ) : (
                    <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                      {companyResults.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => onSelectCompany(c)}
                            className="w-full px-4 py-3 text-left hover:bg-slate-50"
                          >
                            <p className="font-semibold text-slate-800">{c.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {companyTypeLabel(c.company_type)} ·{' '}
                              {companyStatusLabel(c.status)}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {!showNewCompany && (
                    <button
                      type="button"
                      onClick={onOpenNewCompany}
                      className="w-full rounded-xl border-2 border-dashed border-brand bg-white px-4 py-3 text-sm font-bold text-brand hover:bg-brand/5"
                    >
                      + 신규 업체 등록
                    </button>
                  )}
                </div>
              )}

              {showNewCompany && (
                <div className="mt-3 rounded-xl border-2 border-brand/40 bg-white p-4 space-y-3">
                  <h3 className="text-sm font-bold text-slate-800">신규 업체 등록</h3>
                  <p className="text-xs text-slate-500">
                    등록 후 관리자 검토(검토중 상태)를 거쳐 정식 등록됩니다.
                  </p>
                  <div>
                    <label className="label">업체명 *</label>
                    <input
                      className="input-base"
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      placeholder="예: A물류"
                    />
                  </div>
                  <div>
                    <label className="label">업체 구분</label>
                    <select
                      className="input-base"
                      value={newCompanyType}
                      onChange={(e) =>
                        setNewCompanyType(e.target.value as CompanyType)
                      }
                    >
                      {COMPANY_TYPES.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">담당자명 (선택)</label>
                    <input
                      className="input-base"
                      value={newCompanyManager}
                      onChange={(e) => setNewCompanyManager(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">담당자 연락처 (선택, 숫자만)</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      className="input-base"
                      value={newCompanyPhone}
                      onChange={(e) =>
                        setNewCompanyPhone(formatPhone(e.target.value))
                      }
                      placeholder="01012345678"
                    />
                  </div>
                  {newCompanyError && (
                    <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">
                      {newCompanyError}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewCompany(false)}
                      className="btn-secondary"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={onSubmitNewCompany}
                      disabled={newCompanyLoading}
                      className="btn-primary"
                    >
                      {newCompanyLoading ? '등록 중...' : '등록 후 선택'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="label">성명</label>
          <input
            className="input-base"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
          />
        </div>
        <div>
          <label className="label">생년월일</label>
          <input
            type="date"
            className="input-base"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
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
            disabled={otpVerified}
          />

          {/* [R-5] 휴대폰 문자 인증 */}
          {otpVerified ? (
            <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3">
              <span className="text-lg">✅</span>
              <span className="font-bold text-emerald-700">본인 인증 완료</span>
              <button
                type="button"
                onClick={() => {
                  setOtpVerified(false);
                  setOtpSent(false);
                  setOtpCode('');
                }}
                className="ml-auto text-xs text-slate-500 underline"
              >
                번호 변경
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {!otpSent ? (
                <button
                  type="button"
                  onClick={sendOtp}
                  disabled={phone.length < 10 || otpLoading}
                  className="w-full rounded-xl border-2 border-brand bg-brand/5 py-3 text-base font-bold text-brand disabled:opacity-40"
                >
                  {otpLoading ? '발송 중...' : '📱 인증번호 받기'}
                </button>
              ) : (
                <div className="rounded-xl border-2 border-brand/40 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-700">인증번호 입력</span>
                    {otpTtlLeft > 0 ? (
                      <span className="text-xl font-extrabold text-brand tabular-nums">
                        {Math.floor(otpTtlLeft / 60)}:{String(otpTtlLeft % 60).padStart(2, '0')}
                      </span>
                    ) : (
                      <span className="text-sm font-bold text-red-600">시간 초과</span>
                    )}
                  </div>
                  {otpTtlLeft > 0 ? (
                    <>
                      <input
                        type="tel"
                        inputMode="numeric"
                        className="input-base text-center text-2xl font-extrabold tracking-[0.5em]"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                        placeholder="●●●●●●"
                        autoComplete="one-time-code"
                      />
                      <button
                        type="button"
                        onClick={confirmOtp}
                        disabled={otpCode.length !== 6 || otpLoading}
                        className="btn-primary"
                      >
                        {otpLoading ? '확인 중...' : '인증 확인'}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">시간이 초과되었습니다 — 아래 재전송을 눌러주세요.</p>
                  )}
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={otpResendLeft > 0 || otpLoading}
                    className="w-full rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40"
                  >
                    {otpResendLeft > 0 ? `재전송 (${otpResendLeft}초 후 가능)` : '인증번호 재전송'}
                  </button>
                </div>
              )}
              {otpNotice && (
                <p className="text-xs text-emerald-700 px-1">{otpNotice}</p>
              )}
              {otpError && (
                <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{otpError}</div>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="label">대상 구분</label>
          <div className="grid grid-cols-3 gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.code}
                type="button"
                onClick={() => setTargetTypeCode(t.code)}
                className={`rounded-xl border-2 py-4 font-bold transition ${
                  targetTypeCode === t.code
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <div className="text-2xl">{t.emoji}</div>
                <div className="mt-1 text-xs">{t.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 중장비: 장비종류 (필수) — 차량번호 위에 배치 */}
        {targetTypeCode === 'HEAVY' && (
          <>
            <div>
              <label className="label">장비종류</label>
              <select
                className="input-base"
                value={equipmentType}
                onChange={(e) =>
                  setEquipmentType(e.target.value as EquipmentType | '')
                }
              >
                <option value="">선택해 주세요</option>
                {EQUIPMENT_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            {equipmentType === 'ETC' && (
              <div>
                <label className="label">장비종류 (직접입력)</label>
                <input
                  className="input-base"
                  value={equipmentTypeEtc}
                  onChange={(e) => setEquipmentTypeEtc(e.target.value)}
                  placeholder="예: 항타기"
                />
              </div>
            )}
          </>
        )}

        {vehicleRequired && (
          <div>
            <label className="label">차량번호</label>
            <input
              className="input-base"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value)}
              placeholder="예: 12가3456"
            />
            <p className="mt-1 text-xs text-slate-500">
              ※ 화물차·중장비 기사는 출입 차량 식별을 위해 차량번호를 반드시 입력해 주세요.
            </p>
          </div>
        )}

        {/* 화물차/중장비 공통: 톤수/규격 */}
        {specRequired && (
          <div>
            <label className="label">
              {targetTypeCode === 'TRUCK' ? '톤수 / 규격' : '규격 / 톤수'}
            </label>
            <input
              className="input-base"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder={
                targetTypeCode === 'TRUCK' ? '예: 5톤 / 카고' : '예: 2.5톤 / 디젤'
              }
            />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="btn-primary"
      >
        {loading ? '확인 중...' : '교육 시작'}
      </button>
    </main>
  );
}
