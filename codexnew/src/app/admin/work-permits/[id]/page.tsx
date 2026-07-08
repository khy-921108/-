'use client';

/**
 * 관리자 작업허가서 상세 (조회 전용) — R-6 게이트③-1
 * ⚠️ 순수 조회. 승인/서명/완료/부서확인 "버튼·저장"은 ③-2 이후. 여기선 상태만 표시.
 * 데이터 = 기존 공개 GET /api/work-permits/[id] 재사용(admin 레이아웃 requireAdmin 보호).
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

interface Conf { name: string; signature?: string; confirmedAt?: string }

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { l: string; c: string }> = {
    APPROVED: { l: '✅ 승인', c: 'bg-emerald-100 text-emerald-700' },
    REJECTED: { l: '⛔ 반려', c: 'bg-red-100 text-red-700' },
    SUBMITTED: { l: '⏳ 대기', c: 'bg-slate-100 text-slate-600' },
  };
  const s = m[status] ?? m.SUBMITTED;
  return <span className={`rounded-full text-xs font-bold px-2 py-0.5 ${s.c}`}>{s.l}</span>;
}

/** 서명 현황 한 줄: 서명 이미지 썸네일 + 서명자·시각 / 또는 미서명 뱃지 */
function SigRow({ label, sub, signature, who, at, pending }: {
  label: string; sub?: string; signature?: string | null; who?: string | null; at?: string | null; pending?: string;
}) {
  const signed = !!(signature && signature.startsWith('data:image/'));
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="w-32 shrink-0">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
      {signed ? (
        <>
          <img src={signature!} alt="서명" className="h-9 border border-slate-200 rounded bg-white px-1" />
          <div className="text-xs text-slate-600">
            {who && <span className="font-medium">{who}</span>}
            {at && <span className="text-slate-400"> · {fmtDateTime(at)}</span>}
          </div>
        </>
      ) : (
        <span className={`rounded-full text-xs font-medium px-2 py-0.5 ${pending ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
          {pending ?? '미서명'}
        </span>
      )}
    </div>
  );
}

export default function AdminWorkPermitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/work-permits/${id}`);
        const json = await res.json();
        if (json.success) setData(json.data);
        else setError(json.message || '조회 실패');
      } catch {
        setError('네트워크 오류');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="py-10 text-center text-slate-500">불러오는 중…</div>;
  if (error || !data) return <div className="card text-center text-red-600 py-8">{error || '데이터 없음'}</div>;

  const info = data.info ?? {};
  const tbm = data.tbm ?? {};
  const confs: Conf[] = Object.values(tbm.confirmations ?? {});
  const confByName = new Map(confs.map((c) => [(c.name ?? '').trim(), c]));
  const pledgeSigByName = new Map<string, boolean>(
    (data.docs?.pledges ?? []).map((p: any) => [(p.name ?? '').trim(), !!p.signature])
  );
  const checkedSupp = SUPPLEMENTAL_WORKS.filter((w) => data.supplemental?.[w.key] === 'Y');
  const participants: any[] = data.participants ?? [];
  const photoCount = Array.isArray(tbm.photos) ? tbm.photos.length : 0;

  return (
    <main className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <a href="/admin/work-permits" className="text-xs text-slate-500 hover:underline">← 작업허가 목록</a>
          <h1 className="text-xl font-bold text-slate-800 mt-1 flex items-center gap-2">
            <span className="font-mono text-brand">{data.permitNumber}</span>
            <StatusBadge status={data.status} />
          </h1>
        </div>
        <a href={`/api/work-permits/${id}/xlsx`} className="btn-secondary text-sm">📥 회사양식 xlsx</a>
      </div>

      {/* 기본정보 */}
      <section className="card space-y-1.5 text-sm">
        <h2 className="font-bold text-slate-700 mb-2">기본정보</h2>
        <Row k="작업명" v={info.workName} />
        <Row k="업체" v={data.companyName} />
        <Row k="작업장소" v={info.workLocation} />
        <Row k="장치번호/명" v={info.equipmentNo} />
        <Row k="작업개요" v={info.workContent} />
        <Row k="작업일시" v={`${fmtDateTime(info.workStart)} ~ ${fmtDateTime(info.workEnd)}`} />
        <Row k="신청인" v={`${info.applicantTitle ? info.applicantTitle + ' ' : ''}${info.applicantName ?? ''}`} />
        <Row k="신청일시" v={fmtDateTime(data.createdAt)} />
      </section>

      {/* 보충작업 별지 */}
      <section className="card text-sm">
        <h2 className="font-bold text-slate-700 mb-2">보충작업 별지 ({checkedSupp.length})</h2>
        {checkedSupp.length === 0 ? (
          <p className="text-slate-400">해당 없음 (일반위험작업만)</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {checkedSupp.map((w) => (
              <span key={w.key} className="rounded-full bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5">{w.label}</span>
            ))}
          </div>
        )}
      </section>

      {/* 참여자 명단 + TBM 확인 / 서약 서명 */}
      <section className="card text-sm">
        <h2 className="font-bold text-slate-700 mb-2">참여자 ({participants.length})</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left py-1">성명</th>
              <th className="text-left">소속</th>
              <th className="text-center">TBM 확인</th>
              <th className="text-center">서약 서명</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p, i) => {
              const nm = (p.name ?? '').trim();
              const tbmOk = confByName.has(nm) && !!confByName.get(nm)?.signature;
              const plOk = pledgeSigByName.get(nm) === true;
              return (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-800">{p.name}</td>
                  <td className="text-slate-500">{p.companyName}</td>
                  <td className="text-center">{tbmOk ? '✅' : '—'}</td>
                  <td className="text-center">{plOk ? '✅' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* TBM 상세 */}
      <section className="card text-sm space-y-1.5">
        <h2 className="font-bold text-slate-700 mb-2">TBM 상세</h2>
        <Row k="위험요인" v={(tbm.riskFactors ?? []).join(', ')} />
        <Row k="안전대책" v={(tbm.safetyMeasures ?? []).join(', ')} />
        <Row k="안전관리자" v={tbm.safetyManager?.name} />
        <Row k="현장사진" v={photoCount > 0 ? `${photoCount}장 첨부` : '없음'} />
        <Row k="참석 확인" v={`${confs.filter((c) => c.signature).length} / ${participants.length}명`} />
      </section>

      {/* 서명 현황 (핵심) */}
      <section className="card">
        <h2 className="font-bold text-slate-700 mb-1">서명 현황</h2>
        <p className="text-[11px] text-slate-400 mb-2">※ 발급·승인·완료·부서확인 서명 입력은 다음 단계(③-2)에서 추가됩니다. 현재는 상태만 표시.</p>
        <SigRow label="신청인" sub="TBM 팀장 겸용" signature={data.applicantSignature} who={info.applicantName} at={data.createdAt} />
        <SigRow label="안전관리자" sub="TBM 확인" signature={tbm.safetyManager?.signature} who={tbm.safetyManager?.name} />
        <SigRow label="발급 (안전환경)" signature={data.issuer?.signature} who={data.issuer?.name} at={data.issuer?.at} />
        <SigRow label="승인 (요청부서)" sub="현장책임자" signature={data.approval?.signature} who={data.approval?.name} at={data.approval?.at} />
        <SigRow label="작업완료" sub="작업자 서명" signature={data.completion?.workerSignature} who={info.applicantName} at={data.completion?.completedAt} />
        {checkedSupp.length > 0 && (
          <SigRow label="별지 부서확인" sub={`${checkedSupp.map((w) => w.label).join('·')}`} signature={null} pending="③-2 예정" />
        )}
      </section>
    </main>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-slate-400">{k}</span>
      <span className="text-slate-800 whitespace-pre-wrap">{v || '-'}</span>
    </div>
  );
}
