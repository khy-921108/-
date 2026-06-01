'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readDraft, writeDraft } from '@/lib/work-permit-draft';
import { SUPPLEMENTAL_WORKS, type SupplementalKey } from '@/lib/work-permit-constants';

/** datetime-local 값("YYYY-MM-DDTHH:mm")을 KST 고정 오프셋 ISO로 변환 */
function toKstIso(local: string): string {
  if (!local) return '';
  // 초가 없으면 :00 추가, +09:00 오프셋 부여 → 절대시각 확정
  const withSec = local.length === 16 ? `${local}:00` : local;
  return `${withSec}+09:00`;
}
/** KST ISO → datetime-local 표시값 복원 */
function fromKstIso(iso: string): string {
  if (!iso) return '';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}T${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export default function WorkPermitInfo() {
  const router = useRouter();

  const [applicantName, setApplicantName] = useState('');
  const [applicantTitle, setApplicantTitle] = useState('');
  const [workName, setWorkName] = useState('');
  const [workLocation, setWorkLocation] = useState('');
  const [equipmentNo, setEquipmentNo] = useState('');
  const [workStart, setWorkStart] = useState('');
  const [workEnd, setWorkEnd] = useState('');
  const [workContent, setWorkContent] = useState('');
  const [supp, setSupp] = useState<Record<SupplementalKey, boolean>>({
    confined: false, height: false, electric: false, excavation: false,
    hot: false, heavy: false, radiation: false,
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const d = readDraft();
    if (!d.company || !d.applicant) {
      router.replace('/work-permit');
      return;
    }
    setApplicantName(d.applicant.name);
    if (d.info) {
      setApplicantTitle(d.info.applicantTitle ?? '');
      setWorkName(d.info.workName ?? '');
      setWorkLocation(d.info.workLocation ?? '');
      setEquipmentNo(d.info.equipmentNo ?? '');
      setWorkStart(d.info.workStart ? fromKstIso(d.info.workStart) : '');
      setWorkEnd(d.info.workEnd ? fromKstIso(d.info.workEnd) : '');
      setWorkContent(d.info.workContent ?? '');
    }
    if (d.supplemental) {
      setSupp((prev) => {
        const next = { ...prev };
        for (const w of SUPPLEMENTAL_WORKS) {
          next[w.key] = d.supplemental?.[w.key] === 'Y';
        }
        return next;
      });
    }
  }, [router]);

  const periodValid =
    workStart && workEnd && new Date(toKstIso(workStart)).getTime() < new Date(toKstIso(workEnd)).getTime();

  const canNext =
    workName.trim() && workLocation.trim() && workContent.trim() && workStart && workEnd && periodValid;

  const goNext = () => {
    setError('');
    if (!canNext) {
      if (workStart && workEnd && !periodValid) {
        setError('작업 종료일시가 시작일시보다 빠를 수 없습니다.');
      } else {
        setError('필수 작업정보를 모두 입력해 주세요.');
      }
      return;
    }
    const supplemental: Record<string, 'Y' | 'N'> = {};
    for (const w of SUPPLEMENTAL_WORKS) supplemental[w.key] = supp[w.key] ? 'Y' : 'N';

    writeDraft({
      info: {
        workName: workName.trim(),
        workLocation: workLocation.trim(),
        equipmentNo: equipmentNo.trim(),
        workStart: toKstIso(workStart),
        workEnd: toKstIso(workEnd),
        workContent: workContent.trim(),
        applicantName,
        applicantTitle: applicantTitle.trim(),
      },
      supplemental,
      // 작업일시가 바뀌면 기존 참여자 유효성 재확인 필요 → 비움
      participants: [],
    });
    router.push('/work-permit/participants');
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 2 / 4</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">작업정보</h1>
        <p className="mt-1 text-sm text-slate-500">일반위험작업 허가서가 기본 적용됩니다.</p>
      </header>

      <div className="space-y-4">
        <div>
          <label className="label">작업명</label>
          <input className="input-base" value={workName} onChange={(e) => setWorkName(e.target.value)} placeholder="예: 배관 보온 교체" />
        </div>
        <div>
          <label className="label">작업장소</label>
          <input className="input-base" value={workLocation} onChange={(e) => setWorkLocation(e.target.value)} placeholder="예: 3공장 정문 옆" />
        </div>
        <div>
          <label className="label">장치번호 / 장치명 (선택)</label>
          <input className="input-base" value={equipmentNo} onChange={(e) => setEquipmentNo(e.target.value)} placeholder="예: P-101 / 냉각펌프" />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="label">작업 시작일시</label>
            <input type="datetime-local" className="input-base" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
          </div>
          <div>
            <label className="label">작업 종료일시</label>
            <input type="datetime-local" className="input-base" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">※ 참여자 교육 유효성은 <b>작업 종료일</b> 기준으로 판정됩니다.</p>
          </div>
        </div>
        <div>
          <label className="label">신청인 직책 (선택)</label>
          <input className="input-base" value={applicantTitle} onChange={(e) => setApplicantTitle(e.target.value)} placeholder="예: 현장소장" />
        </div>
        <div>
          <label className="label">작업개요</label>
          <textarea className="input-base min-h-[90px]" value={workContent} onChange={(e) => setWorkContent(e.target.value)} placeholder="작업 내용을 간단히 적어주세요." />
        </div>

        <div>
          <label className="label">보충작업 해당여부 (해당되는 항목 모두 체크)</label>
          <div className="grid grid-cols-2 gap-2">
            {SUPPLEMENTAL_WORKS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setSupp((p) => ({ ...p, [w.key]: !p[w.key] }))}
                className={`rounded-xl border-2 py-3 text-sm font-bold transition ${
                  supp[w.key] ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {supp[w.key] ? '■' : '□'} {w.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">※ 체크된 보충작업의 전용 허가서는 추후 단계에서 첨부됩니다(현장 작성).</p>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2">
        <button type="button" onClick={() => router.push('/work-permit')} className="btn-secondary">이전</button>
        <button type="button" onClick={goNext} disabled={!canNext} className="btn-primary">다음</button>
      </div>
    </main>
  );
}
