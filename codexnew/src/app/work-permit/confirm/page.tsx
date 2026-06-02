'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readDraft, clearDraft, type WpDraft } from '@/lib/work-permit-draft';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';

function fmt(iso: string): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export default function WorkPermitConfirm() {
  const router = useRouter();
  const [draft, setDraft] = useState<WpDraft>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const d = readDraft();
    if (!d.company || !d.applicant || !d.info || !(d.participants && d.participants.length > 0)) {
      router.replace('/work-permit');
      return;
    }
    setDraft(d);
  }, [router]);

  const checkedSupp = SUPPLEMENTAL_WORKS.filter((w) => draft.supplemental?.[w.key] === 'Y');

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/work-permits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permitType: 'GENERAL',
          companyId: draft.company!.id,
          info: {
            ...draft.info,
            applicantPhone: draft.applicant!.phone,
            applicantBirthDate: draft.applicant!.birthDate,
          },
          supplemental: draft.supplemental ?? {},
          participants: (draft.participants ?? []).map((p) => ({
            name: p.name, birthDate: p.birthDate, phone: p.phone,
          })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        if (json.code === 'PARTICIPANT_NOT_ELIGIBLE' && json.data?.invalid) {
          const names = json.data.invalid.map((x: any) => x.name).join(', ');
          setError(`교육이 작업일 기준 만료되었거나 수료 정보가 없는 참여자가 있습니다: ${names}. 참여자 단계에서 제외 후 다시 제출해 주세요.`);
        } else {
          setError(json.message || '제출에 실패했습니다.');
        }
        setSubmitting(false);
        return;
      }
      clearDraft();
      sessionStorage.setItem('wpResult', JSON.stringify(json.data));
      router.push('/work-permit/result');
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
      setSubmitting(false);
    }
  };

  if (!draft.info) return null;

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 5 / 5</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">최종 확인</h1>
        <p className="mt-1 text-sm text-slate-500">제출 시 참여자 교육 유효성을 서버에서 다시 확인합니다.</p>
      </header>

      <div className="card space-y-2">
        <Row label="작업요청 업체" value={draft.company?.name ?? '-'} />
        <Row label="신청인" value={draft.applicant?.name ?? '-'} />
        <Row label="작업명" value={draft.info.workName} />
        <Row label="작업장소" value={draft.info.workLocation} />
        {draft.info.equipmentNo && <Row label="장치번호/명" value={draft.info.equipmentNo} />}
        <Row label="작업기간" value={`${fmt(draft.info.workStart)} ~ ${fmt(draft.info.workEnd)}`} />
        <Row label="작업개요" value={draft.info.workContent} />
        <Row label="보충작업" value={checkedSupp.length > 0 ? checkedSupp.map((w) => w.label).join(', ') : '해당 없음'} />
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">참여자 {draft.participants?.length ?? 0}명</p>
        {(draft.participants ?? []).map((p, i) => (
          <div key={i} className="card py-3">
            <p className="font-bold text-slate-800">{p.name} <span className="text-xs font-normal text-slate-500">{p.targetLabel ?? ''}</span></p>
            <p className="text-xs text-slate-600 mt-0.5">{p.companyName ?? ''} · 교육 유효 ~{p.expiresAt?.substring(0, 10)}</p>
          </div>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2">
        <button type="button" onClick={() => router.push('/work-permit/docs')} className="btn-secondary">이전</button>
        <button type="button" onClick={submit} disabled={submitting} className="btn-primary">
          {submitting ? '제출 중...' : '신청 제출'}
        </button>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-sm text-slate-500 shrink-0 w-24">{label}</span>
      <span className="text-sm font-semibold text-slate-800 break-all">{value}</span>
    </div>
  );
}
