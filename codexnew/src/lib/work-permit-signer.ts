/**
 * R-6 게이트③-4: 서명자 표기 — 이메일 → 등록된 "부서 이름 직책"(예: 안전환경 김형준 대리).
 * 저장 로직은 건드리지 않고(승인 시 approved_by 등에 이메일 그대로 기록), 표시 시점에 admins 조회로 라벨링.
 */

export interface SignerProfile {
  department?: string | null;
  displayName?: string | null;
  title?: string | null;
}

/** 등록 프로필 → 표시 라벨. 미등록이면 이메일 앞부분으로 대체. */
export function signerLabel(profile: SignerProfile | null | undefined, email?: string | null): string {
  if (profile && (profile.department || profile.displayName || profile.title)) {
    return [profile.department, profile.displayName, profile.title].filter(Boolean).join(' ').trim();
  }
  if (email) return email.split('@')[0]; // 대체: tkxnflgudwns@naver.com → tkxnflgudwns
  return '';
}

/**
 * 서명자 이메일 목록 → { email(소문자) → 라벨 } 맵. admins 1회 조회.
 * supabase = service client. 실패해도 빈 맵(호출부에서 이메일 앞부분 대체).
 */
export async function resolveSignerLabels(
  supabase: any,
  emails: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = Array.from(new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase())));
  if (uniq.length === 0) return map;
  try {
    const { data } = await supabase
      .from('admins')
      .select('email, display_name, title, department')
      .in('email', uniq);
    for (const r of data ?? []) {
      map.set(
        String(r.email).toLowerCase(),
        signerLabel({ department: r.department, displayName: r.display_name, title: r.title }, r.email)
      );
    }
  } catch {
    /* 조회 실패 시 빈 맵 → 호출부에서 이메일 앞부분 대체 */
  }
  return map;
}

/** 맵에서 라벨 꺼내되 없으면 이메일 앞부분 대체 */
export function labelFor(map: Map<string, string>, email?: string | null): string {
  if (!email) return '';
  return map.get(email.toLowerCase()) || email.split('@')[0];
}
