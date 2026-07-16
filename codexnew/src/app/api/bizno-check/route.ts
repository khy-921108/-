import { NextResponse } from 'next/server';
import { isValidBizNo, formatBizNo } from '@/lib/bizno';
import { checkBizStatus } from '@/lib/bizno-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * POST /api/bizno-check  (공개 — 공개 등록·관리자 모달 [검증] 버튼 공용)
 * body { bizNo } → { valid, checked, status?, label }
 *  - 체크섬 불통과 → valid:false (국세청 호출 안 함 — 낭비 방지)
 *  - 체크섬 통과 + 키 설정 → 국세청 상태조회(계속/휴업/폐업/미등록)
 *  - 키 미설정/호출 실패 → 형식 검사 결과만(checked:false). 흐름 안 막음.
 * 키는 서버(app_settings)에만 — 클라 노출 없음.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const bizNo = typeof body?.bizNo === 'string' ? body.bizNo : '';

  if (!isValidBizNo(bizNo)) {
    return NextResponse.json({
      success: true,
      data: { valid: false, checked: false, label: '형식상 불가능한 사업자번호입니다.' },
    });
  }

  const r = await checkBizStatus(bizNo);
  if (!r.checked) {
    return NextResponse.json({
      success: true,
      data: {
        valid: true, checked: false,
        label: r.reason === 'NO_KEY' ? '형식 검사 통과 (국세청 조회는 키 설정 후 가능)' : '형식 검사 통과 (국세청 조회 실패 — 잠시 후 재시도)',
      },
    });
  }
  return NextResponse.json({
    success: true,
    data: { valid: true, checked: true, status: r.status, label: r.label, bizNo: formatBizNo(bizNo) },
  });
}
