import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { fetchAllRows, kstStamp, addSheet, zipHeaders } from '@/lib/backup';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * GET /api/admin/backup/data  (SUPER 전용)
 * 전체 데이터 백업 zip — 개인정보 포함이라 SUPER만. (사진은 별도 /photos 라우트)
 *  · JSON 원본(전 컬럼) + 엑셀(주요 목록) + 백업요약.txt
 * 산업안전보건법 3년 보존 대응 수단(Supabase 무료 플랜 자동백업 없음).
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const supabase = createServiceClient();

  try {
    const [completions, sessions, companies, permits, participants, pledges, undertakings] = await Promise.all([
      fetchAllRows(supabase, 'completions'),
      fetchAllRows(supabase, 'training_sessions'),
      fetchAllRows(supabase, 'companies'),
      fetchAllRows(supabase, 'work_permits'),
      fetchAllRows(supabase, 'work_permit_participants'),
      fetchAllRows(supabase, 'safety_pledges'),
      fetchAllRows(supabase, 'company_undertakings'),
    ]);

    const zip = new JSZip();
    // ── 원본 JSON(전 컬럼: 서명·장비·되돌리기 이력·종료 기록 전부 포함) ──
    zip.file('json/completions.json', JSON.stringify(completions, null, 2));
    zip.file('json/training_sessions.json', JSON.stringify(sessions, null, 2));
    zip.file('json/companies.json', JSON.stringify(companies, null, 2));
    zip.file('json/work_permits.json', JSON.stringify(permits, null, 2));
    zip.file('json/work_permit_participants.json', JSON.stringify(participants, null, 2));
    zip.file('json/safety_pledges.json', JSON.stringify(pledges, null, 2));
    zip.file('json/company_undertakings.json', JSON.stringify(undertakings, null, 2));

    // ── 엑셀(주요 목록) ──
    const wb = new ExcelJS.Workbook();
    addSheet(wb, '수료(completions)', completions);
    addSheet(wb, '인원(training_sessions)', sessions);
    addSheet(wb, '업체(companies)', companies);
    addSheet(wb, '작업허가(요약)', permits.map((p: any) => ({
      permit_number: p.permit_number, status: p.status,
      company: p.request_company_name, work_name: p.work_name,
      work_start: p.work_start, work_end: p.work_end,
      applicant: p.applicant_name, started_at: p.started_at,
      created_at: p.created_at,
    })));
    addSheet(wb, '서약(safety_pledges)', pledges);
    addSheet(wb, '이행각서(undertakings)', undertakings);
    const xbuf = await wb.xlsx.writeBuffer();
    zip.file('엑셀/데이터.xlsx', Buffer.from(xbuf as ArrayBuffer));

    // ── 요약 ──
    const { ymd, full } = kstStamp();
    const summary =
      `동남 울산공장 안전교육/작업허가 데이터 백업\n` +
      `생성 시각: ${full} (KST) · 생성자: ${auth.admin.email}\n` +
      `----------------------------------------\n` +
      `수료 기록(completions): ${completions.length}건\n` +
      `인원 명단(training_sessions): ${sessions.length}건\n` +
      `업체(companies): ${companies.length}건\n` +
      `작업허가서(work_permits): ${permits.length}건\n` +
      `작업허가 참여자(participants): ${participants.length}건\n` +
      `개인서약(safety_pledges): ${pledges.length}건\n` +
      `업체 이행각서(company_undertakings): ${undertakings.length}건\n` +
      `----------------------------------------\n` +
      `※ 이 파일은 데이터 백업입니다. TBM 현장 사진은 [사진 백업] 버튼으로 별도 다운로드하세요.\n` +
      `※ 산업안전보건법 서류 3년 보존 대응. 회사 NAS(안전환경부서자료)에 보관하세요.\n`;
    zip.file('백업요약.txt', summary);

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return new Response(new Uint8Array(buf), { headers: zipHeaders(`safety-edu-데이터백업-${ymd}.zip`) });
  } catch (e: any) {
    console.error('[backup/data]', e);
    return NextResponse.json({ success: false, code: 'BACKUP_FAILED', message: e?.message ?? '백업 생성 실패' }, { status: 500 });
  }
}
