'use client';

import { useEffect, useState } from 'react';
import { GENERAL_SAFETY_MEASURES, SUPPLEMENTAL_WORKS, TBM_CHECKLIST } from '@/lib/work-permit-constants';

function fmtDate(iso: string): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())}`;
}
function fmtDateTime(iso: string): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export default function WorkPermitPrint({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/work-permits/${params.id}`);
        const json = await res.json();
        if (json.success) setData(json.data);
        else setErr(json.message || '조회 실패');
      } catch {
        setErr('네트워크 오류');
      }
    })();
  }, [params.id]);

  if (err) return <main className="p-6 text-center text-red-600">{err}</main>;
  if (!data) return <main className="p-6 text-center text-slate-500">불러오는 중...</main>;

  const info = data.info;
  const supp = data.supplemental ?? {};
  const left = GENERAL_SAFETY_MEASURES.filter((m) => m.side === 'L');
  const right = GENERAL_SAFETY_MEASURES.filter((m) => m.side === 'R');
  const docs = data.docs ?? null;

  return (
    <main className="wp-print">
      <div className="no-print mb-4 flex gap-2">
        <button onClick={() => window.print()} className="btn-primary">🖨 인쇄</button>
        <a href={`/api/work-permits/${params.id}/xlsx`} className="btn-secondary text-center">📥 회사 양식 .xlsx</a>
      </div>

      <section className="permit-page">
        <h1 className="title">일반위험작업 허가서</h1>
        <table className="t">
          <tbody>
            <tr>
              <th>허가번호</th><td>{data.permitNumber}</td>
              <th>허가일자</th><td>{fmtDate(data.createdAt)}</td>
            </tr>
            <tr>
              <th>신청인</th>
              <td>직책 {info.applicantTitle || '—'} / 성명 {info.applicantName} <span className="sign">(서명)</span></td>
              <th>작업요청 업체</th><td>{data.companyName}</td>
            </tr>
            <tr>
              <th>허가기간</th>
              <td colSpan={3}>{fmtDateTime(info.workStart)} ~ {fmtDateTime(info.workEnd)}</td>
            </tr>
            <tr>
              <th>작업장소·장치</th>
              <td colSpan={3}>작업지역: {info.workLocation}{info.equipmentNo ? ` / 장치: ${info.equipmentNo}` : ''}</td>
            </tr>
            <tr>
              <th>작업개요</th>
              <td colSpan={3}>{info.workContent}</td>
            </tr>
          </tbody>
        </table>

        <div className="sec">보충작업 해당</div>
        <div className="supp">
          {SUPPLEMENTAL_WORKS.map((w) => (
            <span key={w.key} className="supp-item">
              {supp[w.key] === 'Y' ? '■' : '□'} {w.label}
            </span>
          ))}
        </div>

        <div className="sec">안전조치 요구사항 <span className="muted">(발급자 현장 확인)</span></div>
        <table className="t small">
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>
                <td className="chk">□ ○</td><td>{left[i]?.label ?? ''}</td>
                <td className="chk">□ ○</td><td>{right[i]?.label ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sec">가스농도 측정 <span className="muted">(현장 측정·수기)</span></div>
        <table className="t small"><tbody>
          <tr><th>가스명</th><th>결과</th><th>측정시간</th><th>측정자/확인자</th></tr>
          <tr><td>&nbsp;</td><td></td><td></td><td></td></tr>
          <tr><td>&nbsp;</td><td></td><td></td><td></td></tr>
        </tbody></table>

        <div className="sec">참여 작업자 / 장비</div>
        <table className="t small"><tbody>
          <tr><th>이름</th><th>업체</th><th>구분</th><th>차량/장비</th><th>교육 유효기간</th></tr>
          {(data.participants ?? []).map((p: any, i: number) => (
            <tr key={i}>
              <td>{p.name}</td><td>{p.companyName}</td><td>{p.targetType ?? ''}</td>
              <td>{p.vehicleNumber || p.spec || ''}</td><td>{fmtDate(p.expiresAt)}</td>
            </tr>
          ))}
        </tbody></table>

        <div className="sec">서명 <span className="muted">(현장 수기)</span></div>
        <table className="t small"><tbody>
          <tr><th>발급자</th><td className="sign">(서명)</td><th>승인자</th><td className="sign">(서명)</td></tr>
          <tr><th>입회자</th><td className="sign">(서명)</td><th>작업부서책임자</th><td className="sign">(서명)</td></tr>
          <tr><th>작업자(완료)</th><td className="sign" colSpan={3}>(서명)</td></tr>
        </tbody></table>
      </section>

      <section className="permit-page">
        <h1 className="title">작업 전 안전미팅 (TBM)</h1>
        <table className="t"><tbody>
          <tr>
            <th>일시</th><td>{fmtDateTime(info.workStart)}</td>
            <th>날씨</th><td className="muted">(현장)</td>
          </tr>
          <tr>
            <th>장소</th><td>{info.workLocation}</td>
            <th>작업명</th><td>{info.workName}</td>
          </tr>
          <tr>
            <th>팀장</th><td>소속 {data.companyName} / 성명 {info.applicantName} <span className="sign">(서명)</span></td>
            <th>안전관리자</th><td className="sign muted">(현장) (서명)</td>
          </tr>
        </tbody></table>

        <div className="sec">작업내용 · 위험요인 · 안전대책 <span className="muted">(현장 작성)</span></div>
        <table className="t small"><tbody>
          <tr><th>No</th><th>작업 내용</th><th>위험 요인</th><th>안전 대책</th></tr>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i}><td>{i + 1}</td><td></td><td></td><td></td></tr>
          ))}
        </tbody></table>

        <div className="sec">작업 전 점검 <span className="muted">(현장)</span></div>
        <table className="t small"><tbody>
          <tr><th>점검 항목</th><th>양호</th><th>불량</th></tr>
          {TBM_CHECKLIST.map((label, i) => (
            <tr key={i}><td>{label}</td><td>□</td><td>□</td></tr>
          ))}
        </tbody></table>

        <div className="sec">참석자 명단</div>
        <table className="t small"><tbody>
          <tr><th>성명</th><th>소속</th><th>서명</th></tr>
          {(data.participants ?? []).map((p: any, i: number) => (
            <tr key={i}><td>{p.name}</td><td>{p.companyName}</td><td className="sign">(서명)</td></tr>
          ))}
        </tbody></table>
      </section>

      {docs && (docs.pledges ?? []).map((pl: any, i: number) => (
        <section key={`pledge-${i}`} className="permit-page">
          <h1 className="title">공사 안전준수 서약서</h1>
          <table className="t"><tbody>
            <tr><th>성명</th><td>{pl.name}</td><th>업체명</th><td>{pl.companyName ?? ''}</td></tr>
            <tr><th>생년월일</th><td>{pl.birthDate ?? ''}</td><th>국적</th><td>{pl.nationality ?? ''}</td></tr>
            <tr><th>전화번호</th><td>{pl.phone ?? ''}</td><th>혈액형</th><td>{pl.bloodType ?? ''}</td></tr>
            <tr><th>직종</th><td>{pl.jobType ?? ''}</td><th>출입일자</th><td>{pl.workDate ? fmtDate(pl.workDate) : ''}</td></tr>
          </tbody></table>
          <p className="muted" style={{ fontSize: 10, margin: '6px 0' }}>※ 안전준수 서약내용 13개 조항은 회사 양식(.xlsx) 출력본에 포함됩니다.</p>
          <table className="t small"><tbody>
            <tr><th style={{ width: '50%' }}>소속</th><th>서약자 (서명)</th></tr>
            <tr>
              <td>{pl.companyName ?? ''}</td>
              <td>
                {pl.signature
                  ? <img src={pl.signature} alt="서명" style={{ height: 40, maxWidth: 160 }} />
                  : <span className="sign">{pl.name} (서명)</span>}
              </td>
            </tr>
          </tbody></table>
        </section>
      ))}

      {docs && docs.undertaking && (
        <section className="permit-page">
          <h1 className="title">안전작업 이행각서 (업체)</h1>
          <table className="t"><tbody>
            <tr><th>소속사명</th><td>{docs.undertaking.companyName ?? ''}</td></tr>
            <tr><th>작업구역</th><td>{docs.undertaking.workArea ?? ''}</td></tr>
            <tr><th>출입기간</th><td>{docs.undertaking.issuedAt ? `${fmtDate(docs.undertaking.issuedAt)} ~ ${fmtDate(docs.undertaking.expiresAt)}` : ''}</td></tr>
            <tr><th>관리감독자</th><td>{docs.undertaking.managerName ?? ''} {docs.undertaking.managerPhone ? `/ ${docs.undertaking.managerPhone}` : ''}</td></tr>
          </tbody></table>
          <div className="sec">커버 명단</div>
          <table className="t small"><tbody>
            <tr><th>No</th><th>성명</th><th>생년월일</th><th>연락처</th><th>서명</th></tr>
            {(docs.undertaking.members ?? []).map((m: any, i: number) => (
              <tr key={i}><td>{i + 1}</td><td>{m.name}</td><td>{m.birthDate ?? ''}</td><td>{m.phone ?? ''}</td><td className="sign">(서명)</td></tr>
            ))}
          </tbody></table>
          <p className="muted" style={{ fontSize: 10, marginTop: 6 }}>소속사 대표 / 현장소장: <span className="sign">(인)</span> — 현장 날인</p>
        </section>
      )}

      {docs && docs.eduResult && (docs.eduResult.names ?? []).length > 0 && (
        <section className="permit-page">
          <h1 className="title">안전 교육 / 훈련 결과서</h1>
          <table className="t"><tbody>
            <tr><th>교육 일시</th><td>{docs.eduResult.date ? fmtDate(docs.eduResult.date) : ''}</td></tr>
            <tr><th>교육 내용</th><td>{docs.eduResult.content}</td></tr>
          </tbody></table>
          <div className="sec">교육 대상자</div>
          <table className="t small"><tbody>
            <tr><th>No</th><th>성명</th><th>서명</th></tr>
            {docs.eduResult.names.map((nm: string, i: number) => (
              <tr key={i}><td>{i + 1}</td><td>{nm}</td><td className="sign">(서명)</td></tr>
            ))}
          </tbody></table>
          <p className="muted" style={{ fontSize: 10, marginTop: 6 }}>교육 실시자: <span className="sign">(서명)</span> — 현장</p>
        </section>
      )}

      <style jsx global>{`
        @page { size: A4; margin: 10mm; }
        .wp-print { max-width: 800px; margin: 0 auto; padding: 16px; }
        .permit-page { background: #fff; padding: 16px; margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 8px; }
        .title { text-align: center; font-size: 18px; font-weight: 800; margin-bottom: 12px; }
        .sec { font-weight: 700; font-size: 12px; margin: 10px 0 4px; border-left: 3px solid #334155; padding-left: 6px; }
        .muted { color: #94a3b8; font-weight: 400; }
        table.t { width: 100%; border-collapse: collapse; font-size: 11px; }
        table.t th, table.t td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
        table.t th { background: #f1f5f9; font-weight: 600; white-space: nowrap; }
        table.t.small th, table.t.small td { font-size: 10px; padding: 3px 5px; }
        .chk { white-space: nowrap; width: 36px; }
        .sign { color: #94a3b8; }
        .supp { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; padding: 4px 0; }
        .supp-item { white-space: nowrap; }
        @media screen { .wp-print { background: #f8fafc; } }
        @media print {
          .no-print { display: none !important; }
          .wp-print { padding: 0; max-width: 100%; }
          .permit-page { border: none; border-radius: 0; margin: 0; page-break-after: always; }
        }
      `}</style>
    </main>
  );
}
