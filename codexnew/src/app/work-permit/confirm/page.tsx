'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readDraft, clearDraft, type WpDraft } from '@/lib/work-permit-draft';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';
import SignaturePad from '@/components/SignaturePad';

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
  // R-6 ③-3: 신청 단계는 신청인 서명만. 안전관리자 서명·TBM 사진은 제거(사진은 현장 TBM 화면 ③-6에서).
  const [applicantSig, setApplicantSig] = useState('');
  const [confirmedToday, setConfirmedToday] = useState(false); // 복사 재신청 시 오늘 조건 확인

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
    if (!applicantSig) {
      setError('신청인(현장소장) 서명을 입력해 주세요. 서명해야 제출됩니다.');
      return;
    }
    if (draft.copied && !confirmedToday) {
      setError('복사 재신청은 오늘의 작업조건·위험요인 확인 체크가 필요합니다.');
      return;
    }
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
          // R-6 ③-3: 승인자/안전관리자/사진 미입력. 신청인 서명 + TBM 위험요인·안전대책만.
          approval: {},
          tbmDetail: draft.tbmDetail ?? {},
          equipment: draft.equipment ?? [], // 중장비·굴착 장비 정보

          signatures: {
            applicant: applicantSig || undefined,
          },
          photos: [],
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
        <Row label="담당" value="안전환경 김형준 대리 (검토·발급)" />
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

      <div className="card space-y-4">
        <div>
          <p className="text-sm font-bold text-slate-700">신청인(현장소장) 서명 <span className="text-red-500">*</span> <span className="text-xs font-normal text-slate-500">(TBM 팀장 서명 겸용)</span></p>
          <p className="text-xs text-slate-500 mt-0.5 mb-2">허가서 신청인란과 TBM 팀장란에 자동 인쇄됩니다. <b>서명해야 제출됩니다.</b></p>
          <SignaturePad onChange={setApplicantSig} />
        </div>
        <p className="text-xs text-slate-500">
          ※ TBM 현장 사진과 작업자 서명은 현장 도착 후 <b>[현장 TBM 진행]</b> 화면에서 올립니다(신청 단계 아님).
        </p>
      </div>

      {draft.copied && (
        <label className="card flex items-start gap-3 cursor-pointer border-2 border-amber-200 bg-amber-50/60">
          <input
            type="checkbox"
            checked={confirmedToday}
            onChange={(e) => setConfirmedToday(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span className="text-sm text-slate-700">
            <b>오늘의 작업조건·위험요인을 확인했습니다.</b><br />
            <span className="text-xs text-slate-500">이전 허가서 내용을 복사한 신청입니다. 오늘 현장의 가스·날씨·지반 등 조건이 다를 수 있어 반드시 재확인이 필요합니다.</span>
          </span>
        </label>
      )}

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2">
        <button type="button" onClick={() => router.push('/work-permit/docs')} className="btn-secondary">이전</button>
        <button type="button" onClick={submit} disabled={submitting || !applicantSig || (draft.copied && !confirmedToday)} className="btn-primary">
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
