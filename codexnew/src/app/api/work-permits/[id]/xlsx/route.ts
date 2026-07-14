import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generateWorkPermitXlsx } from '@/lib/work-permit-xlsx';

export const runtime = 'nodejs'; // exceljs + 템플릿 파일 읽기 + qrcode
export const dynamic = 'force-dynamic'; // ⚠️ 캐시 금지 — 없으면 옛 서명/종료확인 누락된 xlsx가 캐시됨
export const fetchCache = 'force-no-store';

/**
 * GET /api/work-permits/:id/xlsx  (공개, UUID 알아야) — 회사 양식 자동채움 다운로드
 * 생성 로직은 lib/work-permit-xlsx.ts(월별 백업과 공용).
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const supabase = createServiceClient();
  let out: { buffer: Buffer; permitNumber: string } | null;
  try {
    out = await generateWorkPermitXlsx(supabase, ctx.params.id);
  } catch (e) {
    console.error('[work-permits/:id/xlsx] fill error:', e);
    return NextResponse.json({ success: false, code: 'TEMPLATE_FAILED', message: '양식 생성에 실패했습니다.' }, { status: 500 });
  }
  if (!out) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '작업허가 신청을 찾을 수 없습니다.' }, { status: 404 });
  }
  return new NextResponse(out.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="WP-${out.permitNumber}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
