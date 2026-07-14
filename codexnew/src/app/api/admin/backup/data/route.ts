import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { fetchFiltered, resolveMonth, monthRange, kstStamp, addSheet, zipHeaders } from '@/lib/backup';
import { generateWorkPermitXlsx } from '@/lib/work-permit-xlsx';
import { normalizePhone } from '@/lib/equipment';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * GET /api/admin/backup/data?month=YYYY-MM[&half=H1|H2]  (SUPER 전용)
 * 선택 월에 작업예정일이 걸치는 허가서 + 관련 수료·업체·서약·각서 백업 zip.
 *  · json/ 원본(전 컬럼) · 엑셀/데이터.xlsx 요약 · 허가서양식/{허가번호}.xlsx 건별(회사양식) · 백업요약.txt
 * 산업안전보건법 3년 보존 대응(Supabase 무료 플랜 자동백업 없음). 사진은 별도 /photos.
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const supabase = createServiceClient();

  const url = new URL(req.url);
  const month = resolveMonth(url.searchParams.get('month'));
  const half = (['H1', 'H2'].includes(url.searchParams.get('half') || '') ? url.searchParams.get('half') : null) as 'H1' | 'H2' | null;
  const { startIso, endIso, label } = monthRange(month, half);

  try {
    // 선택 범위와 작업기간(work_start~work_end)이 겹치는 허가서
    const permits = await fetchFiltered(supabase, 'work_permits', '*', (q) =>
      q.lte('work_start', endIso).gte('work_end', startIso).order('work_start', { ascending: true })
    );
    const permitIds = permits.map((p: any) => p.id);
    const companyIds = Array.from(new Set(permits.map((p: any) => p.request_company_id).filter(Boolean)));

    const participants = permitIds.length
      ? await fetchFiltered(supabase, 'work_permit_participants', '*', (q) => q.in('work_permit_id', permitIds)) : [];
    const companies = companyIds.length
      ? await fetchFiltered(supabase, 'companies', '*', (q) => q.in('id', companyIds)) : [];
    const pledges = companyIds.length
      ? await fetchFiltered(supabase, 'safety_pledges', '*', (q) => q.in('company_id', companyIds)) : [];
    const undertakings = companyIds.length
      ? await fetchFiltered(supabase, 'company_undertakings', '*', (q) => q.in('company_id', companyIds)) : [];

    // 수료: 참여자(이름+정규화전화)로 training_sessions → completions 매칭
    const phones = Array.from(new Set(participants.map((p: any) => normalizePhone(p.phone)).filter(Boolean)));
    let sessions: any[] = [];
    let completions: any[] = [];
    if (phones.length) {
      const cand = await fetchFiltered(supabase, 'training_sessions', 'id, name, phone, birth_date, affiliation, company_id', (q) => q.in('phone', phones));
      const pset = new Set(participants.map((p: any) => `${(p.name ?? '').trim()}|${normalizePhone(p.phone)}`));
      sessions = cand.filter((s: any) => pset.has(`${(s.name ?? '').trim()}|${normalizePhone(s.phone)}`));
      const sessIds = sessions.map((s: any) => s.id);
      if (sessIds.length) completions = await fetchFiltered(supabase, 'completions', '*', (q) => q.in('session_id', sessIds));
    }

    const tooMany = !half && permits.length > 150;

    const zip = new JSZip();
    zip.file('json/work_permits.json', JSON.stringify(permits, null, 2));
    zip.file('json/work_permit_participants.json', JSON.stringify(participants, null, 2));
    zip.file('json/companies.json', JSON.stringify(companies, null, 2));
    zip.file('json/safety_pledges.json', JSON.stringify(pledges, null, 2));
    zip.file('json/company_undertakings.json', JSON.stringify(undertakings, null, 2));
    zip.file('json/completions.json', JSON.stringify(completions, null, 2));
    zip.file('json/training_sessions.json', JSON.stringify(sessions, null, 2));

    // 엑셀 요약
    const wb = new ExcelJS.Workbook();
    addSheet(wb, '작업허가(요약)', permits.map((p: any) => ({
      permit_number: p.permit_number, status: p.status, company: p.request_company_name,
      work_name: p.work_name, work_start: p.work_start, work_end: p.work_end,
      applicant: p.applicant_name, started_at: p.started_at, created_at: p.created_at,
    })));
    addSheet(wb, '수료(completions)', completions);
    addSheet(wb, '업체(companies)', companies);
    addSheet(wb, '서약(pledges)', pledges);
    addSheet(wb, '이행각서(undertakings)', undertakings);
    const xbuf = await wb.xlsx.writeBuffer();
    zip.file('엑셀/데이터.xlsx', Buffer.from(xbuf as ArrayBuffer));

    // 허가서양식/ — 그 달 허가서를 회사양식 xlsx로 건별 생성
    let formOk = 0, formFail = 0;
    for (const p of permits) {
      try {
        const out = await generateWorkPermitXlsx(supabase, p.id);
        if (out) { zip.file(`허가서양식/${out.permitNumber}.xlsx`, new Uint8Array(out.buffer)); formOk++; }
        else formFail++;
      } catch (e) { formFail++; console.error('[backup/data form]', p.permit_number, e); }
    }

    const { full } = kstStamp();
    zip.file('백업요약.txt',
      `동남 울산공장 월별 데이터 백업\n대상 월: ${label}\n생성 시각: ${full} (KST) · 생성자: ${auth.admin.email}\n` +
      `----------------------------------------\n` +
      `작업허가서: ${permits.length}건 (회사양식 xlsx 생성 ${formOk} · 실패 ${formFail})\n` +
      `참여자: ${participants.length} · 업체: ${companies.length} · 수료: ${completions.length} · 서약: ${pledges.length} · 각서: ${undertakings.length}\n` +
      `----------------------------------------\n` +
      (tooMany ? '⚠ 대상이 150건을 넘습니다. 시간이 오래 걸리면 [전반기/후반기 분할 다운로드]를 이용하세요.\n' : '') +
      `※ TBM 현장 사진은 [이 달 사진 백업]으로 별도. 매월 그 달치를 받아 회사 NAS(안전환경부서자료)에 보관하세요.\n`
    );

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return new Response(new Uint8Array(buf), { headers: zipHeaders(`safety-edu-데이터백업-${label}.zip`) });
  } catch (e: any) {
    console.error('[backup/data]', e);
    return NextResponse.json({ success: false, code: 'BACKUP_FAILED', message: e?.message ?? '백업 생성 실패' }, { status: 500 });
  }
}
