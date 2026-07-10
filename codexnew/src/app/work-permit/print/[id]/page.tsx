'use client';

/**
 * QR/인쇄 화면 — 회사양식(엑셀) 재현 문서뷰 (게이트③-5 D안).
 * 법적 원본 = 회사양식(.xlsx). 이 화면은 전자 확인용.
 * ⚠️ 양식/서명 규칙/xlsx 채움 로직이 바뀌면 이 화면 동기화 필요(검토요약.md §양식-인쇄 동기화 규칙).
 * 데이터: 공개 GET /api/work-permits/[id] 재사용(정화됨 — 이메일 노출 없음).
 */

import { useEffect, useState } from 'react';
import { SUPPLEMENTAL_WORKS, GENERAL_SAFETY_MEASURES, TBM_CHECKLIST } from '@/lib/work-permit-constants';
import { workTypesFor } from '@/lib/work-permit-types';

const p2 = (n: number) => String(n).padStart(2, '0');
function kst(iso?: string | null) { return iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000) : null; }
function fmtDate(iso?: string | null) { const k = kst(iso); return k ? `${k.getUTCFullYear()}.${p2(k.getUTCMonth() + 1)}.${p2(k.getUTCDate())}` : '-'; }
function fmtDateTime(iso?: string | null) { const k = kst(iso); return k ? `${k.getUTCFullYear()}.${p2(k.getUTCMonth() + 1)}.${p2(k.getUTCDate())} ${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}` : '-'; }
function fmtLog(iso?: string | null) { const k = kst(iso); return k ? `${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())} ${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}` : ''; }

/** 서명칸: 손서명 이미지 + 오른쪽아래 로그(이름·시각) / 미서명이면 "(서명)" 연회색 placeholder */
function Sig({ sig, name, at, w = 150, h = 34 }: { sig?: string | null; name?: string | null; at?: string | null; w?: number; h?: number }) {
  const has = !!(sig && String(sig).startsWith('data:image/'));
  if (!has) return <span className="sigph">{name ? `${name} ` : ''}(서명)</span>;
  const log = [name, fmtLog(at)].filter(Boolean).join(' · ');
  return (
    <span className="sigwrap" style={{ minWidth: w }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sig!} alt="서명" className="sigimg" style={{ maxWidth: w, maxHeight: h }} />
      {log && <span className="siglog">{log}</span>}
    </span>
  );
}

export default function WorkPermitPrint({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/work-permits/${params.id}`, { cache: 'no-store' });
        const json = await res.json();
        if (json.success) setData(json.data);
        else setErr(json.message || '조회 실패');
      } catch { setErr('네트워크 오류'); }
    })();
  }, [params.id]);

  if (err) return <main className="p-6 text-center text-red-600">{err}</main>;
  if (!data) return <main className="p-6 text-center text-slate-500">불러오는 중...</main>;

  const info = data.info ?? {};
  const supp = data.supplemental ?? {};
  const tbm = data.tbm ?? {};
  const comp = data.completion ?? {};
  const dept = data.deptConfirmations ?? {};
  const docs = data.docs ?? null;
  const suppTypes = workTypesFor(supp);
  const parts: any[] = data.participants ?? [];
  const photos: string[] = data.tbmPhotoUrls ?? [];

  // 참여자 확인 서명(돌려서명) name → {signature, at}
  const confList: any[] = Object.values(tbm.confirmations ?? {});
  const confByName = new Map<string, { signature: string; at?: string }>();
  for (const c of confList) if (c?.signature) confByName.set((c.name ?? '').trim(), { signature: c.signature, at: c.confirmedAt });
  // 서약 서명 name → {signature}
  const pledges: any[] = docs?.pledges ?? [];
  const pledgeSig = new Map<string, string>();
  for (const pl of pledges) if (pl?.signature) pledgeSig.set((pl.name ?? '').trim(), pl.signature);
  // 이름으로 서명 찾기(서약 우선 → TBM 확인) — 교육/각서 명단 재사용
  const sigOf = (name?: string | null) => {
    const n = (name ?? '').trim();
    return pledgeSig.get(n) ?? confByName.get(n)?.signature ?? null;
  };

  const suppLabels = SUPPLEMENTAL_WORKS.filter((w) => supp[w.key] === 'Y').map((w) => w.label);
  const left = GENERAL_SAFETY_MEASURES.filter((m) => m.side === 'L');
  const right = GENERAL_SAFETY_MEASURES.filter((m) => m.side === 'R');

  // 별지 관련부서 3차 확인 라벨
  const deptCell = (key: string) => {
    const dc = dept[key];
    if (!dc?.signature) return <Sig sig={null} />;
    if (dc.mode === 'EMERGENCY_PROXY') return <Sig sig={dc.signature} name={`긴급대리(안전환경)${dc.reason ? ` · ${dc.reason}` : ''}`} at={dc.at} />;
    return <Sig sig={dc.signature} name={dc.name || dc.by} at={dc.at} />;
  };

  return (
    <main className="wp-print">
      {/* 경고 배너 (화면·인쇄 공통) */}
      <div className="warn">
        ⚠️ 이 화면은 개인정보(성명·연락처·생년월일)와 서명이 포함된 <b>작업허가 확인용</b> 문서입니다. 무단 열람·유출을 금합니다.
      </div>

      {/* 화면 전용 버튼 */}
      <div className="no-print toolbar">
        <button onClick={() => window.print()} className="btn-primary">🖨 인쇄</button>
        <a href={`/api/work-permits/${params.id}/xlsx`} className="btn-secondary">📥 회사양식 .xlsx</a>
      </div>

      {/* ① TBM */}
      <section className="sheet">
        <h1 className="title">작업 전 안전미팅 (TBM)</h1>
        <table className="t"><tbody>
          <tr><th>일시</th><td>{fmtDateTime(info.workStart)}</td><th>장소</th><td>{info.workLocation}</td></tr>
          <tr><th>작업명</th><td colSpan={3}>{info.workName}</td></tr>
          <tr>
            <th>작업업체 / 팀장</th>
            <td>{data.companyName} / {info.applicantName} <Sig sig={tbm.teamLeader?.signature ?? data.applicantSignature} name={info.applicantName} at={data.createdAt} w={120} /></td>
            <th>안전관리자</th>
            <td>{tbm.safetyManager?.name || '안전환경'} <Sig sig={tbm.safetyManager?.signature ?? tbm.witness?.signature} name={tbm.safetyManager?.name || '안전환경'} at={tbm.witness?.at} w={120} /></td>
          </tr>
        </tbody></table>

        <div className="sec">작업내용 · 위험요인 · 안전대책</div>
        <table className="t small"><tbody>
          <tr><th style={{ width: 34 }}>No</th><th>작업 내용</th><th>위험 요인</th><th>안전 대책</th></tr>
          {Array.from({ length: Math.max(3, (tbm.riskFactors ?? []).length, (tbm.safetyMeasures ?? []).length) }).map((_, i) => (
            <tr key={i}>
              <td className="c">{i + 1}</td>
              <td>{i === 0 ? (tbm.workContent || info.workContent || '') : ''}</td>
              <td>{(tbm.riskFactors ?? [])[i] ?? ''}</td>
              <td>{(tbm.safetyMeasures ?? [])[i] ?? ''}</td>
            </tr>
          ))}
        </tbody></table>

        <table className="t small" style={{ marginTop: 6 }}><tbody>
          <tr><th style={{ width: 120 }}>오늘의 안전지시사항</th><td>{tbm.safetyInstructions || <span className="muted">(2차 승인 시 입력)</span>}</td></tr>
        </tbody></table>

        <div className="sec">작업 전 안전점검 <span className="muted">(현장 수기)</span></div>
        <table className="t small"><tbody>
          <tr><th>점검 항목</th><th style={{ width: 44 }}>양호</th><th style={{ width: 44 }}>불량</th></tr>
          {TBM_CHECKLIST.map((label, i) => (<tr key={i}><td>{label}</td><td className="c">□</td><td className="c">□</td></tr>))}
        </tbody></table>

        <div className="sec">참석자 (확인 서명)</div>
        <table className="t small"><tbody>
          <tr><th style={{ width: 34 }}>No</th><th>성명</th><th>소속</th><th style={{ width: '38%' }}>확인 서명</th></tr>
          {parts.map((pp, i) => {
            const c = confByName.get((pp.name ?? '').trim());
            return <tr key={i}><td className="c">{i + 1}</td><td>{pp.name}</td><td>{pp.companyName}</td>
              <td><Sig sig={c?.signature} name={pp.name} at={c?.at} w={130} /></td></tr>;
          })}
        </tbody></table>
      </section>

      {/* ② TBM 현장사진 */}
      <section className="sheet">
        <h1 className="title">TBM 현장 사진</h1>
        {photos.length > 0 ? (
          <div className="photos">
            {photos.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt={`현장사진 ${i + 1}`} className="photo" />
            ))}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: 'center', padding: '30px 0' }}>현장 사진 없음 — 회사양식 출력본에 현장 부착</p>
        )}
      </section>

      {/* ③ 일반위험작업허가서 (마스터) */}
      <section className="sheet">
        <div className="master-head">
          <h1 className="title" style={{ flex: 1 }}>일 반 위 험 작 업 허 가 서</h1>
          {data.qrDataUrl && <img src={data.qrDataUrl} alt="QR" className="qr" />}
        </div>
        <table className="t"><tbody>
          <tr><th>허가번호</th><td>{data.permitNumber}</td><th>허가일자</th><td>{fmtDate(data.createdAt)}</td></tr>
          <tr>
            <th>신청인</th>
            <td colSpan={3}>직책: {info.applicantTitle || '—'}　성명: {info.applicantName} <Sig sig={data.applicantSignature} name={info.applicantName} at={data.createdAt} w={120} /></td>
          </tr>
          <tr><th>허가기간</th><td colSpan={3}>{fmtDateTime(info.workStart)} ~ {fmtDateTime(info.workEnd)} (당일)</td></tr>
          <tr><th>작업장소·설비</th><td colSpan={3}>[업체] {data.companyName}　작업지역: {info.workLocation}{info.equipmentNo ? `　/ 장치: ${info.equipmentNo}` : ''}</td></tr>
          <tr><th>작업개요</th><td colSpan={3}>{info.workContent}</td></tr>
          <tr><th>보충작업</th><td colSpan={3}><div className="supp">{SUPPLEMENTAL_WORKS.map((w) => <span key={w.key}>{supp[w.key] === 'Y' ? '■' : '□'} {w.label}</span>)}</div></td></tr>
        </tbody></table>

        <div className="sec">안전조치 요구사항 <span className="muted">(발급자 현장 확인·수기)</span></div>
        <table className="t small"><tbody>
          {Array.from({ length: 8 }).map((_, i) => (
            <tr key={i}><td className="c" style={{ width: 30 }}>□</td><td>{left[i]?.label ?? ''}</td><td className="c" style={{ width: 30 }}>□</td><td>{right[i]?.label ?? ''}</td></tr>
          ))}
        </tbody></table>

        <div className="sec">안전조치 확인 · 승인 (작업 전)</div>
        <table className="t small"><tbody>
          <tr><th style={{ width: '25%' }}>승인자(요청부서)</th><td>{data.approval?.name || ''} <Sig sig={data.approval?.signature} name={data.approval?.name} at={data.approval?.at} w={120} /></td></tr>
          <tr><th>발급자(안전환경) · 1차</th><td>{data.issuer?.name || ''} <Sig sig={data.issuer?.signature} name={data.issuer?.name} at={data.issuer?.at} w={120} /></td></tr>
          <tr><th>입회자(안전환경) · 2차</th><td>{tbm.witness?.by || ''} <Sig sig={tbm.witness?.signature} name={tbm.witness?.by} at={tbm.witness?.at} w={120} /></td></tr>
        </tbody></table>

        <div className="sec">작업완료 확인 (작업 후)</div>
        <table className="t small"><tbody>
          <tr><th style={{ width: '25%' }}>완료시간 / 작업자</th><td>{comp.completedAt ? fmtDateTime(comp.completedAt) : ''} / {info.applicantName} <Sig sig={comp.workerSignature} name={info.applicantName} at={comp.completedAt} w={120} /></td></tr>
          <tr><th>확인자(안전환경)</th><td>{comp.confirmBy || ''} <Sig sig={comp.confirmSignature} name={comp.confirmBy} at={comp.confirmAt} w={120} /></td></tr>
          {comp.restoreState && <tr><th>복원(조치)상태</th><td>{comp.restoreState}</td></tr>}
        </tbody></table>
      </section>

      {/* ④ 체크된 별지 */}
      {suppTypes.map((t) => (
        <section key={t.key} className="sheet">
          <h1 className="title">{t.label}작업 허가서</h1>
          <table className="t"><tbody>
            <tr><th>허가번호</th><td>{data.permitNumber}</td><th>허가일자</th><td>{fmtDate(data.createdAt)}</td></tr>
            <tr><th>신청인</th><td colSpan={3}>직책: {info.applicantTitle || '—'}　성명: {info.applicantName} <Sig sig={data.applicantSignature} name={info.applicantName} at={data.createdAt} w={120} /></td></tr>
            <tr><th>허가기간</th><td colSpan={3}>{fmtDateTime(info.workStart)} ~ {fmtDateTime(info.workEnd)} (당일)</td></tr>
            <tr><th>작업개요</th><td colSpan={3}>[{t.label}] {info.workName} — {info.workContent}</td></tr>
          </tbody></table>
          <p className="muted note">※ {t.label}작업 안전조치 요구사항 · 가스농도/측정 항목은 회사양식(.xlsx) 별지에서 현장 수기 작성합니다.</p>
          <div className="sec">현장확인 / 완료</div>
          <table className="t small"><tbody>
            <tr><th style={{ width: '25%' }}>관련부서 현장확인(3차)</th><td>{deptCell(t.key)}</td></tr>
            <tr><th>작업완료(작업자)</th><td><Sig sig={comp.workerSignature} name={info.applicantName} at={comp.completedAt} w={120} /></td></tr>
          </tbody></table>
        </section>
      ))}

      {/* ⑤ 교육훈련결과서 */}
      {docs?.eduResult && (docs.eduResult.names ?? []).length > 0 && (
        <section className="sheet">
          <h1 className="title">안전 교육 / 훈련 결과서</h1>
          <table className="t"><tbody>
            <tr><th>교육 일시</th><td>{docs.eduResult.date ? fmtDate(docs.eduResult.date) : fmtDate(info.workStart)}</td></tr>
            <tr><th>교육 내용</th><td>{docs.eduResult.content}</td></tr>
          </tbody></table>
          <div className="sec">교육 대상자</div>
          <table className="t small"><tbody>
            <tr><th style={{ width: 34 }}>No</th><th>성명</th><th style={{ width: '45%' }}>서명</th></tr>
            {docs.eduResult.names.map((nm: string, i: number) => (
              <tr key={i}><td className="c">{i + 1}</td><td>{nm}</td><td><Sig sig={sigOf(nm)} name={nm} at={data.createdAt} w={130} /></td></tr>
            ))}
          </tbody></table>
          <p className="muted note">교육 실시자: {info.applicantName} <Sig sig={data.applicantSignature} name={info.applicantName} at={data.createdAt} w={110} /></p>
        </section>
      )}

      {/* ⑥ 안전준수 서약 (참여자별) */}
      {pledges.map((pl, i) => (
        <section key={i} className="sheet">
          <h1 className="title">공사 안전준수 서약서</h1>
          <table className="t"><tbody>
            <tr><th>성명</th><td>{pl.name}</td><th>업체명</th><td>{pl.companyName ?? ''}</td></tr>
            <tr><th>생년월일</th><td>{pl.birthDate ?? ''}</td><th>연락처</th><td>{pl.phone ?? ''}</td></tr>
            <tr><th>국적</th><td>{pl.nationality ?? ''}</td><th>혈액형</th><td>{pl.bloodType ?? ''}</td></tr>
            <tr><th>직종</th><td>{pl.jobType ?? ''}</td><th>출입일자</th><td>{pl.workDate ? fmtDate(pl.workDate) : fmtDate(info.workStart)}</td></tr>
          </tbody></table>
          <p className="muted note">※ 안전준수 서약 13개 조항 전문은 회사양식(.xlsx) 출력본에 포함됩니다.</p>
          <table className="t small"><tbody>
            <tr><th style={{ width: '50%' }}>소속</th><th>서약자</th></tr>
            <tr><td>{pl.companyName ?? ''}</td><td><Sig sig={pl.signature} name={pl.name} at={pl.workDate ?? data.createdAt} w={150} /></td></tr>
          </tbody></table>
        </section>
      ))}

      {/* ⑦ 이행각서 */}
      {docs?.undertaking && (docs.undertaking.members ?? []).length > 0 && (
        <section className="sheet">
          <h1 className="title">안전작업 이행각서 (업체)</h1>
          <table className="t"><tbody>
            <tr><th>소속사명</th><td>{docs.undertaking.companyName ?? data.companyName}</td><th>작업구역</th><td>{docs.undertaking.workArea ?? info.workLocation}</td></tr>
            <tr><th>출입기간</th><td>{fmtDate(info.workStart)} (당일)</td><th>관리감독자</th><td>{docs.undertaking.managerName ?? ''}</td></tr>
          </tbody></table>
          <div className="sec">명단</div>
          <table className="t small"><tbody>
            <tr><th style={{ width: 34 }}>No</th><th>성명</th><th>생년월일</th><th style={{ width: '38%' }}>서명</th></tr>
            {docs.undertaking.members.map((m: any, i: number) => (
              <tr key={i}><td className="c">{i + 1}</td><td>{m.name}</td><td>{m.birthDate ?? ''}</td><td><Sig sig={sigOf(m.name)} name={m.name} at={data.createdAt} w={130} /></td></tr>
            ))}
          </tbody></table>
          <p className="muted note">현장소장: {info.applicantName} <Sig sig={data.applicantSignature} name={info.applicantName} at={data.createdAt} w={110} /></p>
        </section>
      )}

      {/* 하단 법적 고지 */}
      <p className="legal">본 화면은 전자 확인용이며, 공식 서식은 회사양식(.xlsx) 출력본입니다.</p>

      <style jsx global>{`
        @page { size: A4; margin: 8mm; }
        .wp-print { max-width: 820px; margin: 0 auto; padding: 12px; color: #111; }
        .warn { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; font-size: 12px; padding: 8px 12px; border-radius: 8px; margin-bottom: 10px; }
        .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
        .toolbar a, .toolbar button { text-decoration: none; }
        .sheet { background: #fff; border: 1px solid #000; padding: 14px; margin-bottom: 14px; }
        .title { text-align: center; font-size: 17px; font-weight: 800; letter-spacing: 1px; margin-bottom: 10px; }
        .master-head { display: flex; align-items: center; gap: 8px; }
        .qr { width: 60px; height: 60px; }
        .sec { font-weight: 700; font-size: 12px; margin: 10px 0 4px; background: #e5e7eb; padding: 3px 6px; }
        .muted { color: #9ca3af; font-weight: 400; }
        .note { font-size: 10px; margin: 6px 0; }
        table.t { width: 100%; border-collapse: collapse; font-size: 11px; }
        table.t th, table.t td { border: 1px solid #000; padding: 4px 6px; text-align: left; vertical-align: middle; }
        table.t th { background: #f3f4f6; font-weight: 600; white-space: nowrap; }
        table.t.small th, table.t.small td { font-size: 10px; padding: 3px 5px; }
        .c { text-align: center; }
        .supp { display: flex; flex-wrap: wrap; gap: 10px; }
        .sigwrap { position: relative; display: inline-block; vertical-align: middle; }
        .sigimg { display: block; background: #fff; }
        .siglog { position: absolute; right: 0; bottom: -9px; font-size: 8px; color: #9ca3af; white-space: nowrap; }
        .sigph { color: #cbd5e1; font-size: 10px; }
        .photos { display: flex; flex-direction: column; gap: 10px; align-items: center; }
        .photo { max-width: 100%; border: 1px solid #d1d5db; }
        .legal { text-align: center; font-size: 11px; color: #6b7280; margin: 16px 0; }
        @media screen and (max-width: 640px) {
          .wp-print { padding: 8px; }
          .sheet { transform: scale(1); }
          table.t { font-size: 10px; }
        }
        @media print {
          .no-print { display: none !important; }
          .wp-print { max-width: 100%; padding: 0; }
          .sheet { border: none; padding: 4px 0; margin: 0; page-break-after: always; }
          .warn { page-break-after: avoid; }
          .siglog { color: #9ca3af; }
        }
      `}</style>
    </main>
  );
}
