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
  // R-6: 신청인 서명 / 안전관리자 서명 / 현장 사진
  const [applicantSig, setApplicantSig] = useState('');
  const [safetyManagerSig, setSafetyManagerSig] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  // 업로드 전 처리: 16:9 중앙 크롭(양식 사진칸 비율 고정) + 1280×720 리사이즈, ~200KB JPEG
  const resizeToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const W = 1280, H = 720; // 16:9 고정 → 별지 사진칸에 왜곡 없이 삽입
        const srcRatio = img.width / img.height;
        const dstRatio = W / H;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (srcRatio > dstRatio) {
          sw = Math.round(img.height * dstRatio);
          sx = Math.round((img.width - sw) / 2);
        } else {
          sh = Math.round(img.width / dstRatio);
          sy = Math.round((img.height - sh) / 2);
        }
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas'));
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        const TARGET = 200 * 1024;
        let q = 0.8;
        let out = canvas.toDataURL('image/jpeg', q);
        while (out.length * 0.75 > TARGET && q > 0.4) {
          q -= 0.1;
          out = canvas.toDataURL('image/jpeg', q);
        }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = 2 - photos.length;
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, room);
    for (const f of picked) {
      try {
        const url = await resizeToDataUrl(f);
        setPhotos((prev) => (prev.length >= 2 ? prev : [...prev, url]));
      } catch (e) {
        console.error('[photo resize]', e);
      }
    }
  };

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
          // R-6: 승인자·TBM 상세(정보 단계) + 서명·사진(확인 단계)
          approval: draft.approval ?? {},
          tbmDetail: draft.tbmDetail ?? {},
          signatures: {
            applicant: applicantSig || undefined,
            safetyManager: safetyManagerSig || undefined,
          },
          photos,
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
        {(draft.approval?.approverName || draft.approval?.approverTitle) && (
          <Row
            label="승인자"
            value={`${draft.approval?.approverTitle ?? ''} ${draft.approval?.approverName ?? ''}`.trim() +
              (draft.approval?.approvalMode ? ` (${draft.approval.approvalMode === 'SITE' ? '현장' : '원격'})` : '')}
          />
        )}
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
          <p className="text-sm font-bold text-slate-700">신청인 서명 (TBM 팀장 서명 겸용)</p>
          <p className="text-xs text-slate-500 mt-0.5 mb-2">서명하면 허가서 신청인란과 TBM 팀장란에 자동 인쇄됩니다. (선택)</p>
          <SignaturePad onChange={setApplicantSig} />
        </div>
        {draft.tbmDetail?.safetyManagerName && (
          <div>
            <p className="text-sm font-bold text-slate-700">안전관리자 서명 — {draft.tbmDetail.safetyManagerName} (선택)</p>
            <div className="mt-2">
              <SignaturePad onChange={setSafetyManagerSig} />
            </div>
          </div>
        )}
        <div>
          <p className="text-sm font-bold text-slate-700">TBM 실시 사진 (선택, 최대 2장)</p>
          <p className="text-xs text-slate-500 mt-0.5 mb-2">TBM 진행 장면 사진만 올려주세요. 별지 「1-2_TBM현장사진」에 자동 삽입됩니다.</p>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }}
            className="text-sm"
            disabled={photos.length >= 2}
          />
          {photos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {photos.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`현장사진 ${i + 1}`} className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
                  <button
                    type="button"
                    onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-red-500 text-xs text-white leading-5"
                    aria-label="사진 삭제"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
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
